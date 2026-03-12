"""
M1 DocTriage — API Router.

POST /upload/{claim_id}             — upload + extract documents for a claim
POST /upload-additional/{claim_id}  — upload missing docs, merges into existing claim JSON
"""

from __future__ import annotations

import logging
import os
import tempfile
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from auth.rbac import require_role
from dashboard.status import update_status
from shared.audit import log_action
from shared.database import get_db
from shared.models import Claim, Document

from m1.gemini_extract import extract_from_document
from m1.metadata_gate import run_gate

logger = logging.getLogger("claimsense.m1")
router = APIRouter()

# Roles that can upload documents
UPLOADER_ROLES = ("patient", "hospital_staff", "admin")

SSE_ROLES_ALL = ["patient", "hospital_staff", "insurer"]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _mime_from_filename(filename: str) -> str:
    """Guess MIME type from file extension."""
    ext = os.path.splitext(filename)[1].lower()
    return {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
    }.get(ext, "application/octet-stream")


def _merge_claim_json(existing: dict | None, new_extracts: list[dict]) -> dict:
    """
    Merge extracted data from multiple documents into a single ClaimJSON.

    Priority rules:
        - Patient details: first non-null wins
        - Hospital details: first non-null wins
        - Diagnosis codes: union across all documents
        - Procedure codes: union across all documents
        - Billing: from hospital_bill documents
        - Document status: list of doc_types successfully extracted
    """
    merged = existing or {}

    # Collected lists
    all_diagnosis: list[dict] = list(merged.get("diagnosis_codes", []))
    all_procedures: list[dict] = list(merged.get("procedure_codes", []))
    all_billing: list[dict] = list(merged.get("billing_items", []))
    doc_types: list[str] = list(merged.get("extracted_doc_types", []))

    for ext in new_extracts:
        doc_type = ext.get("document_type", "other")
        if doc_type and doc_type not in doc_types:
            doc_types.append(doc_type)

        # Patient details — first non-null wins
        for field in ("patient_name", "patient_id", "date_of_birth", "gender"):
            if not merged.get(field) and ext.get(field):
                merged[field] = ext[field]

        # Hospital details — first non-null wins
        for field in ("hospital_name", "hospital_id", "admission_date", "discharge_date",
                       "doctor_name", "doctor_registration_number"):
            if not merged.get(field) and ext.get(field):
                merged[field] = ext[field]

        # Diagnosis codes — union by code
        existing_codes = {d["code"] for d in all_diagnosis}
        for dc in ext.get("diagnosis_codes", []) or []:
            if dc.get("code") and dc["code"] not in existing_codes:
                all_diagnosis.append(dc)
                existing_codes.add(dc["code"])

        # Procedure codes — union by code
        existing_procs = {p["code"] for p in all_procedures}
        for pc in ext.get("procedure_codes", []) or []:
            if pc.get("code") and pc["code"] not in existing_procs:
                all_procedures.append(pc)
                existing_procs.add(pc["code"])

        # Billing — from hospital_bill documents
        if doc_type == "hospital_bill":
            for bi in ext.get("billing_items", []) or []:
                all_billing.append(bi)
            if ext.get("total_amount") is not None:
                merged["total_amount"] = ext["total_amount"]

    merged["diagnosis_codes"] = all_diagnosis
    merged["procedure_codes"] = all_procedures
    merged["billing_items"] = all_billing
    merged["extracted_doc_types"] = doc_types

    return merged


async def _process_files(
    claim_id: str,
    files: list[UploadFile],
    db: AsyncSession,
    merge_existing: bool = False,
) -> dict[str, Any]:
    """
    Process uploaded files: gate → extract → persist → merge.

    Parameters
    ----------
    claim_id : str
        Target claim ID.
    files : list[UploadFile]
        Files uploaded by the user.
    db : AsyncSession
        Active DB session.
    merge_existing : bool
        If True, merge into existing claim_json instead of creating new.
    """
    # Verify the claim exists
    from sqlalchemy import select
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if claim is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Claim {claim_id} not found.",
        )

    per_file_results: list[dict] = []
    successful_extracts: list[dict] = []

    for upload_file in files:
        filename = upload_file.filename or "unknown"
        mime_type = _mime_from_filename(filename)
        file_result: dict[str, Any] = {
            "filename": filename,
            "doc_type": None,
            "passed_gate": False,
            "extraction_success": False,
            "rejection_reason": None,
        }

        # Save file temporarily
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=os.path.splitext(filename)[1])
        try:
            file_bytes = await upload_file.read()
            with os.fdopen(tmp_fd, "wb") as f:
                f.write(file_bytes)

            # 1. Run metadata gate
            gate_result = await run_gate(tmp_path, file_bytes, mime_type, db)
            file_result["passed_gate"] = gate_result["passed"]

            if not gate_result["passed"]:
                file_result["rejection_reason"] = gate_result["rejection_reason"]
                per_file_results.append(file_result)
                logger.info(
                    "File %s rejected by gate: %s", filename, gate_result["rejection_reason"]
                )
                continue

            # 2. Run Gemini extraction
            try:
                extracted = await extract_from_document(tmp_path, mime_type)
                file_result["extraction_success"] = True
                file_result["doc_type"] = extracted.get("document_type", "other")
                successful_extracts.append(extracted)
            except (ValueError, Exception) as exc:
                logger.error("Gemini extraction failed for %s: %s", filename, exc)
                file_result["extraction_success"] = False
                file_result["rejection_reason"] = f"Extraction failed: {exc}"
                per_file_results.append(file_result)
                continue

            # 3. Save Document record
            doc = Document(
                claim_id=claim_id,
                doc_type=file_result["doc_type"],
                file_path=tmp_path,
                file_hash=gate_result["file_hash"],
                extracted_data=extracted,
                is_verified=True,
            )
            db.add(doc)
            await db.flush()

            # 4. Audit log
            await log_action(
                db,
                claim_id=claim_id,
                actor="system",
                action_type="document_extracted",
                module="m1",
                details={
                    "filename": filename,
                    "doc_type": file_result["doc_type"],
                    "mime_type": mime_type,
                },
            )

        except Exception as exc:
            logger.error("Error processing file %s: %s", filename, exc)
            file_result["rejection_reason"] = f"Processing error: {exc}"
        finally:
            # Clean up temp file if it still exists
            try:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            except OSError:
                pass

        per_file_results.append(file_result)

    # Merge extracted data into claim JSON
    existing_json = claim.claim_json if merge_existing else None
    merged = _merge_claim_json(existing_json, successful_extracts)
    claim.claim_json = merged

    # Update total_amount on claim if extracted
    if merged.get("total_amount") is not None:
        from decimal import Decimal
        claim.total_amount = Decimal(str(merged["total_amount"]))

    await db.flush()

    # Broadcast SSE
    detail_msg = (
        f"{len(successful_extracts)} document(s) processed successfully."
        if successful_extracts
        else "Documents uploaded but extraction pending."
    )
    await update_status(
        claim_id=claim_id,
        status="DOCUMENTS_COMPLETE" if successful_extracts else "DOCUMENTS_MISSING",
        detail=detail_msg,
        role_visibility=SSE_ROLES_ALL,
        db=db,
    )

    return {
        "claim_id": claim_id,
        "claim_json": merged,
        "per_file_results": per_file_results,
    }


# ── POST /upload/{claim_id} ───────────────────────────────────────────────────

@router.post("/upload/{claim_id}", summary="Upload & extract documents for a claim")
async def upload_documents(
    claim_id: str,
    files: list[UploadFile],
    current_user: dict = Depends(require_role(*UPLOADER_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload one or more medical documents for a claim.

    For each file:
    1. Run metadata gate (blank, duplicate, corrupt, password-protected)
    2. Extract structured data via Gemini 2.0 Flash
    3. Save Document record to DB
    4. Merge all extractions into a single ClaimJSON

    Returns per-file results and the merged claim JSON.
    """
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files uploaded.",
        )

    return await _process_files(claim_id, files, db, merge_existing=False)


# ── POST /upload-additional/{claim_id} ─────────────────────────────────────────

@router.post("/upload-additional/{claim_id}", summary="Upload missing documents (merges into existing)")
async def upload_additional_documents(
    claim_id: str,
    files: list[UploadFile],
    current_user: dict = Depends(require_role(*UPLOADER_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload additional / missing documents for a claim.

    Same processing as /upload, but MERGES into existing claim JSON
    instead of replacing it.
    """
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files uploaded.",
        )

    return await _process_files(claim_id, files, db, merge_existing=True)
