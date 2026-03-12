"""
M3 — Clean Claim Guarantee Router.

Endpoints:
    POST /m3/finalize/{claim_id}     — final check + adjudicator summary + FHIR package
    POST /m3/submit/{claim_id}       — simulate insurer API submission
    POST /m3/mock-approve/{claim_id} — demo-only: simulate insurer approval
"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.audit import log_action
from shared.config import get_settings
from shared.database import get_db
from shared.models import (
    Claim, ClaimStatus, StatusUpdate,
    Notification, NotificationChannel, DeliveryStatus,
)
from shared.schemas import ClaimJSON
from shared.sse import sse_manager

from m3.final_check import final_completeness_check
from m3.adjudicator import generate_adjudicator_summary
from m3.fhir_builder import build_fhir_package, generate_submission_summary

logger = logging.getLogger("claimsense.m3.router")
settings = get_settings()
router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════
# Response schemas
# ═══════════════════════════════════════════════════════════════════════


class FinalizeResponse(BaseModel):
    claim_id: str
    adjudicator_summary: str
    fhir_package: dict[str, Any]
    fhir_summary: str
    submission_ready: bool
    completeness: dict[str, Any]


class FinalizeErrorResponse(BaseModel):
    claim_id: str
    submission_ready: bool = False
    newly_required: list[str]
    message: str


class SubmitResponse(BaseModel):
    claim_id: str
    reference_number: str
    status: str
    estimated_response: str
    fhir_package_summary: str
    cashless_monitor_active: bool = False


class MockApproveResponse(BaseModel):
    claim_id: str
    status: str
    approved_amount: Optional[float] = None
    message: str


# ═══════════════════════════════════════════════════════════════════════
# POST /finalize/{claim_id}
# ═══════════════════════════════════════════════════════════════════════


@router.post(
    "/finalize/{claim_id}",
    summary="Run final checks, generate adjudicator summary, build FHIR package",
)
async def finalize_claim(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
) -> FinalizeResponse | FinalizeErrorResponse:
    """
    Final safety gate before submission:
    1. Final completeness check (claim-evolution aware)
    2. Generate adjudicator summary (Gemini)
    3. Build FHIR R4 package
    """
    # ── Fetch claim ───────────────────────────────────────────────────
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()

    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")
    if not claim.claim_json:
        raise HTTPException(status_code=400, detail="No claim data — run M1 first")

    claim_json = ClaimJSON(**{
        k: v for k, v in claim.claim_json.items() if k != "m2_validation"
    })
    m2_results = claim.claim_json.get("m2_validation", {})

    # ══════════════════════════════════════════════════════════════════
    # Step 1: Final completeness check
    # ══════════════════════════════════════════════════════════════════

    completeness = final_completeness_check(
        claim_json=claim_json,
        claim_type=claim.claim_type.value if hasattr(claim.claim_type, 'value') else str(claim.claim_type),
    )

    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="final_completeness_check", module="m3",
        details=completeness,
    )

    if not completeness["complete"]:
        newly_req = completeness["newly_required"]
        await _broadcast_status(
            db, claim_id, "DOCUMENTS_MISSING",
            f"Additional documents required: {', '.join(newly_req)}",
        )
        return FinalizeErrorResponse(
            claim_id=claim_id,
            submission_ready=False,
            newly_required=completeness["all_missing"],
            message=f"Cannot finalize — {len(completeness['all_missing'])} document(s) missing or newly required",
        )

    # ══════════════════════════════════════════════════════════════════
    # Step 2: Generate adjudicator summary
    # ══════════════════════════════════════════════════════════════════

    claim.status = ClaimStatus.ASSEMBLING_PACKAGE
    await db.flush()

    await _broadcast_status(
        db, claim_id, "ASSEMBLING_PACKAGE",
        "Generating adjudicator summary and assembling FHIR package",
    )

    adj_summary = await generate_adjudicator_summary(claim_json, m2_results)

    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="adjudicator_summary_generated", module="m3",
        details={"summary_length": len(adj_summary)},
    )

    # ══════════════════════════════════════════════════════════════════
    # Step 3: Build FHIR R4 package
    # ══════════════════════════════════════════════════════════════════

    fhir_package = build_fhir_package(claim_json, m2_results, adj_summary)
    fhir_summary = generate_submission_summary(fhir_package)

    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="fhir_package_built", module="m3",
        details={
            "bundle_entries": len(fhir_package.get("entry", [])),
            "summary": fhir_summary,
        },
    )

    # ── Save to claim record ──────────────────────────────────────────
    updated_json = claim.claim_json.copy()
    updated_json["m3_package"] = {
        "adjudicator_summary": adj_summary,
        "fhir_package": fhir_package,
        "fhir_summary": fhir_summary,
        "finalized_at": datetime.now(timezone.utc).isoformat(),
    }
    claim.claim_json = updated_json
    await db.flush()

    await _broadcast_status(
        db, claim_id, "ASSEMBLING_PACKAGE",
        "Final package assembled — ready for submission",
    )

    return FinalizeResponse(
        claim_id=claim_id,
        adjudicator_summary=adj_summary,
        fhir_package=fhir_package,
        fhir_summary=fhir_summary,
        submission_ready=True,
        completeness=completeness,
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /submit/{claim_id}
# ═══════════════════════════════════════════════════════════════════════


@router.post(
    "/submit/{claim_id}",
    response_model=SubmitResponse,
    summary="Simulate insurer API submission",
)
async def submit_claim(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
) -> SubmitResponse:
    """
    Simulate submitting the FHIR package to the insurer's API.

    Generates a mock reference number and sets up the IRDAI 3-hour
    monitor for cashless claims.
    """
    # ── Fetch claim ───────────────────────────────────────────────────
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()

    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")

    m3_data = (claim.claim_json or {}).get("m3_package")
    if not m3_data:
        raise HTTPException(
            status_code=400,
            detail="No M3 package — run POST /m3/finalize first",
        )

    # ── Simulate insurer submission ───────────────────────────────────
    ref_number = f"INS-2026-{random.randint(100000, 999999)}"
    submission_time = datetime.now(timezone.utc)

    is_cashless = False
    if hasattr(claim.path, 'value'):
        is_cashless = claim.path.value == "cashless"
    else:
        is_cashless = str(claim.path) == "cashless"

    estimated_response = (
        "within 3 hours (IRDAI cashless mandate)"
        if is_cashless
        else "5-7 business days"
    )

    # ── Update claim status → SUBMITTED ───────────────────────────────
    claim.status = ClaimStatus.SUBMITTED
    updated_json = claim.claim_json.copy()
    updated_json["submission"] = {
        "reference_number": ref_number,
        "submitted_at": submission_time.isoformat(),
        "is_cashless": is_cashless,
        "irdai_deadline": (
            submission_time.isoformat()
            if is_cashless else None
        ),
    }
    claim.claim_json = updated_json
    await db.flush()

    # ── SSE broadcast ─────────────────────────────────────────────────
    await _broadcast_status(
        db, claim_id, "SUBMITTED",
        f"Claim submitted to insurer (Ref: {ref_number}). {estimated_response}.",
    )

    # ── Notification to patient ───────────────────────────────────────
    try:
        notification = Notification(
            claim_id=claim_id,
            user_id=claim.patient_id,
            channel=NotificationChannel.IN_APP,
            message=(
                f"Your claim {claim_id} has been submitted to the insurer! "
                f"Reference: {ref_number}. "
                f"Expected response: {estimated_response}."
            ),
            delivery_status=DeliveryStatus.SENT,
            sent_at=submission_time,
        )
        db.add(notification)
        await db.flush()
    except Exception as exc:
        logger.warning("Failed to create submission notification: %s", exc)

    # ── Audit log ─────────────────────────────────────────────────────
    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="claim_submitted", module="m3",
        details={
            "reference_number": ref_number,
            "is_cashless": is_cashless,
            "submitted_at": submission_time.isoformat(),
        },
    )

    fhir_summary = m3_data.get("fhir_summary", "")

    return SubmitResponse(
        claim_id=claim_id,
        reference_number=ref_number,
        status="Under Review",
        estimated_response=estimated_response,
        fhir_package_summary=fhir_summary,
        cashless_monitor_active=is_cashless,
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /mock-approve/{claim_id} — DEMO ONLY
# ═══════════════════════════════════════════════════════════════════════


@router.post(
    "/mock-approve/{claim_id}",
    response_model=MockApproveResponse,
    summary="[DEMO] Simulate insurer approval",
)
async def mock_approve_claim(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
) -> MockApproveResponse:
    """
    Demo-only endpoint that simulates the insurer approving a claim.

    Updates status to APPROVED and notifies the patient.
    """
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()

    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")

    # ── Approve ───────────────────────────────────────────────────────
    claim.status = ClaimStatus.APPROVED
    approved_amount = float(claim.total_amount or 0)
    if approved_amount == 0 and claim.claim_json:
        billing = claim.claim_json.get("billing_breakdown", {})
        approved_amount = float(billing.get("total", 0))

    # Get copay from M2 results
    m2_results = (claim.claim_json or {}).get("m2_validation", {})
    copay = 0
    for rule in m2_results.get("coverage_results", []):
        if rule.get("rule_name") == "copay_calculation":
            copay = rule.get("details", {}).get("copay_amount_inr", 0)
            break

    insurer_pays = approved_amount - copay

    updated_json = claim.claim_json.copy() if claim.claim_json else {}
    updated_json["approval"] = {
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "approved_amount": approved_amount,
        "copay": copay,
        "insurer_pays": insurer_pays,
    }
    claim.claim_json = updated_json
    await db.flush()

    # ── SSE broadcast ─────────────────────────────────────────────────
    await _broadcast_status(
        db, claim_id, "APPROVED",
        f"Claim approved! Insurer pays Rs. {insurer_pays:,.0f} (Co-pay: Rs. {copay:,.0f})",
    )

    # ── Notification ──────────────────────────────────────────────────
    try:
        notification = Notification(
            claim_id=claim_id,
            user_id=claim.patient_id,
            channel=NotificationChannel.IN_APP,
            message=(
                f"Great news! Your claim {claim_id} has been approved. "
                f"Insurer will pay Rs. {insurer_pays:,.0f}."
            ),
            delivery_status=DeliveryStatus.SENT,
            sent_at=datetime.now(timezone.utc),
        )
        db.add(notification)
        await db.flush()
    except Exception as exc:
        logger.warning("Failed to create approval notification: %s", exc)

    # ── Audit log ─────────────────────────────────────────────────────
    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="claim_approved_mock", module="m3",
        details={
            "approved_amount": approved_amount,
            "copay": copay,
            "insurer_pays": insurer_pays,
        },
    )

    return MockApproveResponse(
        claim_id=claim_id,
        status="APPROVED",
        approved_amount=insurer_pays,
        message=f"Claim approved. Insurer pays Rs. {insurer_pays:,.0f} (Co-pay: Rs. {copay:,.0f}).",
    )


# ═══════════════════════════════════════════════════════════════════════
# Helper — SSE + StatusUpdate
# ═══════════════════════════════════════════════════════════════════════


async def _broadcast_status(
    db: AsyncSession,
    claim_id: str,
    status_value: str,
    detail: str,
) -> None:
    """Insert a StatusUpdate row and broadcast via SSE to all roles."""
    roles = ["patient", "hospital_staff", "insurer", "admin"]

    update = StatusUpdate(
        claim_id=claim_id,
        status=status_value,
        detail=detail,
        role_visibility=roles,
    )
    db.add(update)
    await db.flush()

    await sse_manager.broadcast(
        claim_id=claim_id,
        status=status_value,
        detail=detail,
        role_visibility=roles,
    )
