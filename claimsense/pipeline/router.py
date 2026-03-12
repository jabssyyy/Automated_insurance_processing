"""
Pipeline — Demo Orchestration Router.

Wires together M1 → doc_check → M2 → Review → M3 for the live demo.
Includes deliberate delays between steps so SSE updates are visible
on all three screens (patient, hospital staff, insurer).

Endpoints:
    POST /pipeline/process/{claim_id}   — run full pipeline
    POST /pipeline/continue/{claim_id}  — resume after pause point
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.audit import log_action
from shared.database import get_db
from shared.models import Claim, ClaimStatus, StatusUpdate
from shared.sse import sse_manager

from doc_check.completeness import check_completeness

logger = logging.getLogger("claimsense.pipeline")
router = APIRouter()

# Visible delay between pipeline stages (seconds).
# Keeps SSE transitions visible for the judges.
STAGE_DELAY = 1.5
INSURER_PROCESSING_DELAY = 3.0

SSE_ROLES_ALL = ["patient", "hospital_staff", "insurer", "admin"]


# ═══════════════════════════════════════════════════════════════════════
# Helper — SSE + StatusUpdate
# ═══════════════════════════════════════════════════════════════════════


async def _broadcast(
    db: AsyncSession,
    claim_id: str,
    status_value: str,
    detail: str,
) -> None:
    """Insert a StatusUpdate row and broadcast via SSE."""
    update = StatusUpdate(
        claim_id=claim_id,
        status=status_value,
        detail=detail,
        role_visibility=SSE_ROLES_ALL,
    )
    db.add(update)
    await db.flush()

    try:
        await sse_manager.broadcast(
            claim_id=claim_id,
            status=status_value,
            detail=detail,
            role_visibility=SSE_ROLES_ALL,
        )
    except Exception as exc:
        logger.warning("SSE broadcast failed: %s", exc)


# ═══════════════════════════════════════════════════════════════════════
# POST /process/{claim_id}
# ═══════════════════════════════════════════════════════════════════════


@router.post("/process/{claim_id}", summary="Run full demo pipeline")
async def process_claim(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Chain the entire ClaimSense pipeline in sequence:

    1. Verify M1 extraction is done (documents must already be uploaded)
    2. Run doc_check → STOP if incomplete
    3. Run M2 validation
    4. Run review check → STOP if needs human review
    5. Run M3 finalize
    6. Run M3 submit
    7. Simulate insurer processing (3 s delay)
    8. Run M3 mock-approve

    Between each step a 1.5 s delay is inserted so the SSE transitions
    are visible on all three demo screens.
    """
    steps_completed: list[str] = []

    # ── Fetch claim ───────────────────────────────────────────────────
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()

    if not claim:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Claim {claim_id} not found.",
        )

    # ── Step 1: Verify M1 has run ─────────────────────────────────────
    if not claim.claim_json or not claim.claim_json.get("extracted_doc_types"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="M1 extraction has not run — upload documents first.",
        )
    steps_completed.append("m1_verified")

    # ── Step 2: Doc check ─────────────────────────────────────────────
    claim_type = (
        claim.claim_type.value
        if hasattr(claim.claim_type, "value")
        else str(claim.claim_type)
    ).lower()

    doc_result = check_completeness(
        claim_json=claim.claim_json,
        claim_type=claim_type,
    )

    if not doc_result["complete"]:
        missing = ", ".join(doc_result["missing_documents"])
        claim.status = ClaimStatus.DOCUMENTS_MISSING
        await _broadcast(
            db, claim_id, "DOCUMENTS_MISSING",
            f"Documents missing: {missing}",
        )
        await log_action(
            db, claim_id=claim_id, actor="system",
            action_type="pipeline_paused_docs_missing", module="pipeline",
            details={"missing": doc_result["missing_documents"]},
        )
        await db.commit()
        steps_completed.append("doc_check_incomplete")

        return {
            "claim_id": claim_id,
            "final_status": "DOCUMENTS_MISSING",
            "steps_completed": steps_completed,
            "paused": True,
            "pause_reason": f"Missing documents: {missing}",
            "missing_documents": doc_result["missing_documents"],
        }

    claim.status = ClaimStatus.DOCUMENTS_COMPLETE
    await _broadcast(
        db, claim_id, "DOCUMENTS_COMPLETE",
        "All documents received and verified",
    )
    steps_completed.append("doc_check_complete")
    await db.flush()
    await asyncio.sleep(STAGE_DELAY)

    # ── Step 3: M2 Validation ─────────────────────────────────────────
    await _broadcast(
        db, claim_id, "POLICY_VALIDATING",
        "Starting policy and medical validation...",
    )
    await asyncio.sleep(STAGE_DELAY)

    try:
        from m2.router import validate_claim
        m2_result = await validate_claim(claim_id=claim_id, db=db)
        steps_completed.append("m2_validation")
    except Exception as exc:
        logger.error("M2 validation failed: %s", exc)
        await db.commit()
        return {
            "claim_id": claim_id,
            "final_status": "M2_ERROR",
            "steps_completed": steps_completed,
            "paused": True,
            "pause_reason": f"M2 validation error: {exc}",
        }

    await asyncio.sleep(STAGE_DELAY)

    # ── Step 4: Review check ──────────────────────────────────────────
    try:
        from review.router import check_review_needed
        review_result = await check_review_needed(claim_id=claim_id, db=db)
        steps_completed.append("review_check")

        if review_result.needs_review:
            await db.commit()
            return {
                "claim_id": claim_id,
                "final_status": "UNDER_HUMAN_REVIEW",
                "steps_completed": steps_completed,
                "paused": True,
                "pause_reason": "Claim flagged for human review — insurer must approve",
                "review_id": review_result.review_id,
                "trigger_reasons": review_result.trigger_reasons,
            }

    except Exception as exc:
        logger.error("Review check failed: %s", exc)
        await db.commit()
        return {
            "claim_id": claim_id,
            "final_status": "REVIEW_ERROR",
            "steps_completed": steps_completed,
            "paused": True,
            "pause_reason": f"Review check error: {exc}",
        }

    await asyncio.sleep(STAGE_DELAY)

    # ── Step 5–8: Finalize → Submit → Approve ─────────────────────────
    return await _run_post_review_steps(claim_id, db, steps_completed)


# ═══════════════════════════════════════════════════════════════════════
# POST /continue/{claim_id}
# ═══════════════════════════════════════════════════════════════════════


@router.post("/continue/{claim_id}", summary="Resume pipeline after pause")
async def continue_pipeline(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Resume the pipeline after a pause point (missing docs or review).

    Checks the current claim status and runs the remaining steps:
    - ``DOCUMENTS_MISSING`` → re-run doc check, then continue
    - ``DOCUMENTS_COMPLETE`` → run M2 → review → M3
    - ``UNDER_HUMAN_REVIEW`` / ``ASSEMBLING_PACKAGE`` → run M3 steps
    - ``SUBMITTED`` → run mock-approve
    """
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()

    if not claim:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Claim {claim_id} not found.",
        )

    current = (
        claim.status.value
        if hasattr(claim.status, "value")
        else str(claim.status)
    )
    steps_completed: list[str] = [f"resumed_from_{current}"]

    # ── DOCUMENTS_MISSING: re-check completeness ─────────────────────
    if current == "DOCUMENTS_MISSING":
        claim_type = (
            claim.claim_type.value
            if hasattr(claim.claim_type, "value")
            else str(claim.claim_type)
        ).lower()

        doc_result = check_completeness(
            claim_json=claim.claim_json or {},
            claim_type=claim_type,
        )

        if not doc_result["complete"]:
            missing = ", ".join(doc_result["missing_documents"])
            await db.commit()
            return {
                "claim_id": claim_id,
                "final_status": "DOCUMENTS_MISSING",
                "steps_completed": steps_completed,
                "paused": True,
                "pause_reason": f"Still missing: {missing}",
                "missing_documents": doc_result["missing_documents"],
            }

        claim.status = ClaimStatus.DOCUMENTS_COMPLETE
        await _broadcast(
            db, claim_id, "DOCUMENTS_COMPLETE",
            "All documents received and verified",
        )
        steps_completed.append("doc_check_complete")
        await db.flush()
        await asyncio.sleep(STAGE_DELAY)
        current = "DOCUMENTS_COMPLETE"

    # ── DOCUMENTS_COMPLETE: run M2 ────────────────────────────────────
    if current == "DOCUMENTS_COMPLETE":
        await _broadcast(
            db, claim_id, "POLICY_VALIDATING",
            "Starting policy and medical validation...",
        )
        await asyncio.sleep(STAGE_DELAY)

        try:
            from m2.router import validate_claim
            m2_result = await validate_claim(claim_id=claim_id, db=db)
            steps_completed.append("m2_validation")
        except Exception as exc:
            logger.error("M2 validation failed: %s", exc)
            await db.commit()
            return {
                "claim_id": claim_id,
                "final_status": "M2_ERROR",
                "steps_completed": steps_completed,
                "paused": True,
                "pause_reason": f"M2 validation error: {exc}",
            }

        await asyncio.sleep(STAGE_DELAY)

        # Review check
        try:
            from review.router import check_review_needed
            review_result = await check_review_needed(claim_id=claim_id, db=db)
            steps_completed.append("review_check")

            if review_result.needs_review:
                await db.commit()
                return {
                    "claim_id": claim_id,
                    "final_status": "UNDER_HUMAN_REVIEW",
                    "steps_completed": steps_completed,
                    "paused": True,
                    "pause_reason": "Claim flagged for human review",
                    "review_id": review_result.review_id,
                    "trigger_reasons": review_result.trigger_reasons,
                }
        except Exception as exc:
            logger.error("Review check failed: %s", exc)
            await db.commit()
            return {
                "claim_id": claim_id,
                "final_status": "REVIEW_ERROR",
                "steps_completed": steps_completed,
                "paused": True,
                "pause_reason": f"Review check error: {exc}",
            }

        await asyncio.sleep(STAGE_DELAY)
        current = "ASSEMBLING_PACKAGE"

    # ── UNDER_HUMAN_REVIEW / ASSEMBLING_PACKAGE: run M3 ──────────────
    if current in ("UNDER_HUMAN_REVIEW", "ASSEMBLING_PACKAGE"):
        return await _run_post_review_steps(claim_id, db, steps_completed)

    # ── SUBMITTED: mock-approve ───────────────────────────────────────
    if current == "SUBMITTED":
        await asyncio.sleep(INSURER_PROCESSING_DELAY)
        try:
            from m3.router import mock_approve_claim
            approve_result = await mock_approve_claim(claim_id=claim_id, db=db)
            steps_completed.append("mock_approved")
        except Exception as exc:
            logger.error("Mock approve failed: %s", exc)
            await db.commit()
            return {
                "claim_id": claim_id,
                "final_status": "APPROVE_ERROR",
                "steps_completed": steps_completed,
                "paused": True,
                "pause_reason": f"Mock approve error: {exc}",
            }

        await db.commit()
        return {
            "claim_id": claim_id,
            "final_status": "APPROVED",
            "steps_completed": steps_completed,
            "paused": False,
        }

    # ── Already terminal ──────────────────────────────────────────────
    await db.commit()
    return {
        "claim_id": claim_id,
        "final_status": current,
        "steps_completed": steps_completed,
        "paused": False,
        "message": f"Claim is already in terminal status: {current}",
    }


# ═══════════════════════════════════════════════════════════════════════
# Shared post-review logic: M3 finalize → submit → mock-approve
# ═══════════════════════════════════════════════════════════════════════


async def _run_post_review_steps(
    claim_id: str,
    db: AsyncSession,
    steps_completed: list[str],
) -> dict[str, Any]:
    """Run M3 finalize → submit → 3 s delay → mock-approve."""

    # ── M3 finalize ───────────────────────────────────────────────────
    try:
        from m3.router import finalize_claim
        finalize_result = await finalize_claim(claim_id=claim_id, db=db)
        steps_completed.append("m3_finalized")
    except Exception as exc:
        logger.error("M3 finalize failed: %s", exc)
        await db.commit()
        return {
            "claim_id": claim_id,
            "final_status": "M3_ERROR",
            "steps_completed": steps_completed,
            "paused": True,
            "pause_reason": f"M3 finalize error: {exc}",
        }

    await asyncio.sleep(STAGE_DELAY)

    # ── M3 submit ─────────────────────────────────────────────────────
    try:
        from m3.router import submit_claim
        submit_result = await submit_claim(claim_id=claim_id, db=db)
        steps_completed.append("m3_submitted")
    except Exception as exc:
        logger.error("M3 submit failed: %s", exc)
        await db.commit()
        return {
            "claim_id": claim_id,
            "final_status": "SUBMIT_ERROR",
            "steps_completed": steps_completed,
            "paused": True,
            "pause_reason": f"M3 submit error: {exc}",
        }

    # ── Simulate insurer processing ───────────────────────────────────
    await _broadcast(
        db, claim_id, "UNDER_INSURER_REVIEW",
        "Claim under insurer review...",
    )
    await asyncio.sleep(INSURER_PROCESSING_DELAY)

    # ── M3 mock-approve ───────────────────────────────────────────────
    try:
        from m3.router import mock_approve_claim
        approve_result = await mock_approve_claim(claim_id=claim_id, db=db)
        steps_completed.append("mock_approved")
    except Exception as exc:
        logger.error("Mock approve failed: %s", exc)
        await db.commit()
        return {
            "claim_id": claim_id,
            "final_status": "APPROVE_ERROR",
            "steps_completed": steps_completed,
            "paused": True,
            "pause_reason": f"Mock approve error: {exc}",
        }

    await db.commit()

    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="pipeline_complete", module="pipeline",
        details={"steps": steps_completed},
    )

    return {
        "claim_id": claim_id,
        "final_status": "APPROVED",
        "steps_completed": steps_completed,
        "paused": False,
    }
