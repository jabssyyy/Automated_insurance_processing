"""
Doc Check — API Router.

POST /check/{claim_id}    — check document completeness for a claim
POST /recheck/{claim_id}  — re-check after additional documents uploaded

Runs immediately after M1 for Path B (reimbursement) ONLY.
Catches missing documents BEFORE downstream processing.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.rbac import require_role
from dashboard.status import update_status
from shared.audit import log_action
from shared.database import get_db
from shared.models import Claim

from doc_check.completeness import check_completeness

logger = logging.getLogger("claimsense.doc_check")
router = APIRouter()

# Roles permitted to trigger a completeness check
CHECK_ROLES = ("patient", "hospital_staff", "admin")
SSE_ROLES_ALL = ["patient", "hospital_staff", "insurer"]


# ═══════════════════════════════════════════════════════════════════════
# Shared logic
# ═══════════════════════════════════════════════════════════════════════

async def _run_completeness_check(
    claim_id: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """
    Core logic shared by ``/check`` and ``/recheck``.

    1. Fetch the Claim from DB.
    2. Run ``check_completeness`` against its ``claim_json``.
    3. Update claim status, broadcast SSE, and log audit.
    4. Return result dict.
    """
    # ── Fetch claim ───────────────────────────────────────────────────
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()

    if claim is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Claim {claim_id} not found.",
        )

    # Determine claim type (enum value → lowercase string)
    claim_type = (
        claim.claim_type.value
        if hasattr(claim.claim_type, "value")
        else str(claim.claim_type)
    ).lower()

    # ── Run completeness check ────────────────────────────────────────
    check_result = check_completeness(
        claim_json=claim.claim_json or {},
        claim_type=claim_type,
    )

    # ── INCOMPLETE path ───────────────────────────────────────────────
    if not check_result["complete"]:
        missing_names = ", ".join(check_result["missing_documents"])

        # Update status → DOCUMENTS_MISSING  (also broadcasts SSE)
        await update_status(
            claim_id=claim_id,
            status="DOCUMENTS_MISSING",
            detail=f"Documents missing: {missing_names}",
            role_visibility=SSE_ROLES_ALL,
            db=db,
        )

        # Audit trail
        await log_action(
            db,
            claim_id=claim_id,
            actor="system",
            action_type="doc_check_incomplete",
            module="doc_check",
            details={
                "claim_type": claim_type,
                "missing_documents": check_result["missing_documents"],
                "present_documents": check_result["present_documents"],
            },
        )

        # Notification (log intent — notification module handles delivery)
        logger.info(
            "Notification needed: claim=%s missing docs: %s",
            claim_id,
            missing_names,
        )

        await db.commit()

        return {
            "claim_id": claim_id,
            "complete": False,
            "missing_documents": check_result["missing_documents"],
            "present_documents": check_result["present_documents"],
            "claim_type": claim_type,
        }

    # ── COMPLETE path ─────────────────────────────────────────────────
    await update_status(
        claim_id=claim_id,
        status="DOCUMENTS_COMPLETE",
        detail="All documents received and verified",
        role_visibility=SSE_ROLES_ALL,
        db=db,
    )

    await log_action(
        db,
        claim_id=claim_id,
        actor="system",
        action_type="doc_check_complete",
        module="doc_check",
        details={
            "claim_type": claim_type,
            "present_documents": check_result["present_documents"],
        },
    )

    await db.commit()

    return {
        "claim_id": claim_id,
        "complete": True,
        "present_documents": check_result["present_documents"],
        "claim_type": claim_type,
    }


# ═══════════════════════════════════════════════════════════════════════
# POST /check/{claim_id}
# ═══════════════════════════════════════════════════════════════════════

@router.post("/check/{claim_id}", summary="Check document completeness")
async def check_documents(
    claim_id: str,
    current_user: dict = Depends(require_role(*CHECK_ROLES)),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Check whether all required documents are present for a claim.

    Called immediately after M1 finishes for Path B (reimbursement).
    If any documents are missing, the claim status moves to
    ``DOCUMENTS_MISSING`` and the patient is notified.
    """
    return await _run_completeness_check(claim_id, db)


# ═══════════════════════════════════════════════════════════════════════
# POST /recheck/{claim_id}
# ═══════════════════════════════════════════════════════════════════════

@router.post("/recheck/{claim_id}", summary="Re-check after additional upload")
async def recheck_documents(
    claim_id: str,
    current_user: dict = Depends(require_role(*CHECK_ROLES)),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Re-check document completeness after additional documents have been
    uploaded via ``POST /m1/upload-additional/{claim_id}``.

    Fetches the updated ``claim_json`` from the DB and re-runs the
    completeness check.  Moves status to ``DOCUMENTS_COMPLETE`` if all
    docs are now present.
    """
    return await _run_completeness_check(claim_id, db)
