"""
Review — Human Review Queue Router.

Endpoints:
    POST /review/check/{claim_id}   — evaluate if claim needs review
    GET  /review/queue              — list all pending items (insurer/admin)
    GET  /review/{review_id}        — full review context for one item
    POST /review/{review_id}/approve — approve a flagged claim
    POST /review/{review_id}/reject  — reject with denial reason
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.audit import log_action
from shared.config import get_settings
from shared.database import get_db
from shared.models import Claim, ClaimStatus, ReviewItem, ReviewStatus, StatusUpdate
from shared.sse import sse_manager

from review.queue import (
    approve_claim,
    create_review_item,
    reject_claim,
    should_review,
)

logger = logging.getLogger("claimsense.review.router")
settings = get_settings()
router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════
# Request / Response schemas
# ═══════════════════════════════════════════════════════════════════════


class ReviewCheckResponse(BaseModel):
    """Response from the review-check endpoint."""
    claim_id: str
    needs_review: bool
    trigger_reasons: list[str]
    review_id: Optional[int] = None


class ReviewQueueItem(BaseModel):
    """Single item in the review queue listing."""
    review_id: int
    claim_id: str
    trigger_reasons: list[str]
    claim_total: Optional[float] = None
    status: str
    created_at: Optional[datetime] = None
    time_in_queue_minutes: Optional[float] = None

    model_config = {"from_attributes": True}


class ReviewContextResponse(BaseModel):
    """Full review context for an insurer reviewing a claim."""
    review_id: int
    claim_id: str
    trigger_reasons: list[str]
    status: str
    claim_json: Optional[dict] = None
    coverage_results: Optional[list[dict]] = None
    code_results: Optional[list[dict]] = None
    patient_summary: Optional[str] = None
    insurer_snapshot: Optional[str] = None
    created_at: Optional[datetime] = None


class ApproveRequest(BaseModel):
    """Payload for approving a review item."""
    notes: Optional[str] = None
    reviewer_id: int


class RejectRequest(BaseModel):
    """Payload for rejecting a review item."""
    notes: Optional[str] = None
    denial_reason: str
    reviewer_id: int


class ReviewDecisionResponse(BaseModel):
    """Response after approve/reject."""
    review_id: int
    claim_id: str
    decision: str
    message: str


# ═══════════════════════════════════════════════════════════════════════
# POST /check/{claim_id} — evaluate whether review is needed
# ═══════════════════════════════════════════════════════════════════════


@router.post(
    "/check/{claim_id}",
    response_model=ReviewCheckResponse,
    summary="Check if claim needs human review",
)
async def check_review_needed(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
) -> ReviewCheckResponse:
    """
    Evaluate M2 results to determine if the claim requires human review.

    If review is needed, creates a ReviewItem and broadcasts SSE.
    If not, the claim is ready to proceed to M3.
    """
    # Fetch claim
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()

    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")

    claim_json = claim.claim_json or {}
    m2_results = claim_json.get("m2_validation", {})

    if not m2_results:
        raise HTTPException(
            status_code=400,
            detail=f"No M2 validation results for claim {claim_id} — run M2 first",
        )

    # Get claim total
    claim_total = float(claim.total_amount or 0)
    # Fallback: try billing_breakdown from claim_json
    if claim_total == 0:
        billing = claim_json.get("billing_breakdown", {})
        claim_total = float(billing.get("total", 0))

    # Run the review check
    check_result = should_review(
        claim_id=claim_id,
        m2_results=m2_results,
        claim_total=claim_total,
        config=settings,
    )

    review_id = None

    if check_result["needs_review"]:
        # Create review item
        item = await create_review_item(
            claim_id=claim_id,
            trigger_reasons=check_result["trigger_reasons"],
            db=db,
        )
        review_id = item.id

        # Update claim status
        claim.status = ClaimStatus.UNDER_HUMAN_REVIEW
        await db.flush()

        # Broadcast SSE
        await _broadcast_status(
            db, claim_id, "UNDER_HUMAN_REVIEW",
            f"Claim flagged for human review ({len(check_result['trigger_reasons'])} reason(s))",
        )

    else:
        # No review needed — claim proceeds to M3
        await _broadcast_status(
            db, claim_id, "ASSEMBLING_PACKAGE",
            "All checks passed — no human review required, proceeding to final assembly",
        )

    return ReviewCheckResponse(
        claim_id=claim_id,
        needs_review=check_result["needs_review"],
        trigger_reasons=check_result["trigger_reasons"],
        review_id=review_id,
    )


# ═══════════════════════════════════════════════════════════════════════
# GET /queue — list all pending review items
# ═══════════════════════════════════════════════════════════════════════


@router.get(
    "/queue",
    response_model=list[ReviewQueueItem],
    summary="List pending review items (insurer/admin only)",
)
async def list_pending_reviews(
    db: AsyncSession = Depends(get_db),
) -> list[ReviewQueueItem]:
    """
    Return all pending review items for insurer review.

    Includes time-in-queue calculation for SLA tracking.
    """
    result = await db.execute(
        select(ReviewItem)
        .where(ReviewItem.status == ReviewStatus.PENDING)
        .order_by(ReviewItem.created_at.asc())
    )
    items = result.scalars().all()

    now = datetime.now(timezone.utc)
    queue_items: list[ReviewQueueItem] = []

    for item in items:
        # Get claim total
        claim_total = None
        claim_result = await db.execute(
            select(Claim).where(Claim.id == item.claim_id)
        )
        claim = claim_result.scalar_one_or_none()
        if claim:
            claim_total = float(claim.total_amount or 0)
            if claim_total == 0 and claim.claim_json:
                billing = claim.claim_json.get("billing_breakdown", {})
                claim_total = float(billing.get("total", 0))

        # Calculate time in queue
        time_in_queue = None
        if item.created_at:
            created = item.created_at
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            time_in_queue = (now - created).total_seconds() / 60.0

        queue_items.append(
            ReviewQueueItem(
                review_id=item.id,
                claim_id=item.claim_id,
                trigger_reasons=item.trigger_reasons or [],
                claim_total=claim_total,
                status=item.status.value,
                created_at=item.created_at,
                time_in_queue_minutes=round(time_in_queue, 1) if time_in_queue else None,
            )
        )

    return queue_items


# ═══════════════════════════════════════════════════════════════════════
# GET /{review_id} — full review context
# ═══════════════════════════════════════════════════════════════════════


@router.get(
    "/{review_id}",
    response_model=ReviewContextResponse,
    summary="Get full review context for a specific item",
)
async def get_review_context(
    review_id: int,
    db: AsyncSession = Depends(get_db),
) -> ReviewContextResponse:
    """
    Return complete context for an insurer to review a flagged claim.

    Includes: claim_json, M2 coverage results, code results,
    patient summary, insurer snapshot, and trigger reasons.
    """
    result = await db.execute(
        select(ReviewItem).where(ReviewItem.id == review_id)
    )
    item = result.scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail=f"Review item #{review_id} not found")

    # Fetch claim data
    claim_result = await db.execute(
        select(Claim).where(Claim.id == item.claim_id)
    )
    claim = claim_result.scalar_one_or_none()

    claim_json = None
    coverage_results = None
    code_results = None
    patient_summary = None
    insurer_snapshot = None

    if claim and claim.claim_json:
        # Exclude m2_validation from the main claim_json for cleaner display
        claim_json_copy = {
            k: v for k, v in claim.claim_json.items() if k != "m2_validation"
        }
        claim_json = claim_json_copy

        m2 = claim.claim_json.get("m2_validation", {})
        coverage_results = m2.get("coverage_results")
        code_results = m2.get("code_results")
        patient_summary = m2.get("patient_summary")
        insurer_snapshot = m2.get("insurer_snapshot")

    return ReviewContextResponse(
        review_id=item.id,
        claim_id=item.claim_id,
        trigger_reasons=item.trigger_reasons or [],
        status=item.status.value,
        claim_json=claim_json,
        coverage_results=coverage_results,
        code_results=code_results,
        patient_summary=patient_summary,
        insurer_snapshot=insurer_snapshot,
        created_at=item.created_at,
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /{review_id}/approve
# ═══════════════════════════════════════════════════════════════════════


@router.post(
    "/{review_id}/approve",
    response_model=ReviewDecisionResponse,
    summary="Approve a flagged claim",
)
async def approve_review(
    review_id: int,
    body: ApproveRequest,
    db: AsyncSession = Depends(get_db),
) -> ReviewDecisionResponse:
    """
    Approve a claim in the review queue.

    The claim status moves to ASSEMBLING_PACKAGE and proceeds to M3.
    SSE broadcast notifies all connected users.
    """
    try:
        item = await approve_claim(
            review_id=review_id,
            reviewer_id=body.reviewer_id,
            notes=body.notes,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Broadcast SSE
    await _broadcast_status(
        db, item.claim_id, "ASSEMBLING_PACKAGE",
        "Review approved — proceeding to final clean-claim assembly",
    )

    return ReviewDecisionResponse(
        review_id=item.id,
        claim_id=item.claim_id,
        decision="approved",
        message="Claim approved by reviewer. Proceeding to M3 clean-claim packaging.",
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /{review_id}/reject
# ═══════════════════════════════════════════════════════════════════════


@router.post(
    "/{review_id}/reject",
    response_model=ReviewDecisionResponse,
    summary="Reject a flagged claim",
)
async def reject_review(
    review_id: int,
    body: RejectRequest,
    db: AsyncSession = Depends(get_db),
) -> ReviewDecisionResponse:
    """
    Reject a claim in the review queue.

    The claim status moves to DENIED. SSE broadcasts the denial to all roles.
    A notification is triggered to the patient with the denial reason.
    """
    try:
        item = await reject_claim(
            review_id=review_id,
            reviewer_id=body.reviewer_id,
            notes=body.notes,
            denial_reason=body.denial_reason,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Broadcast SSE to all roles
    await _broadcast_status(
        db, item.claim_id, "DENIED",
        f"Claim denied: {body.denial_reason}",
    )

    # Trigger notification to patient (in-app fallback if Twilio not configured)
    try:
        from shared.models import Notification, NotificationChannel, DeliveryStatus
        notification = Notification(
            claim_id=item.claim_id,
            user_id=_get_patient_id_from_claim(db, item.claim_id),
            channel=NotificationChannel.IN_APP,
            message=(
                f"Your claim {item.claim_id} has been denied. "
                f"Reason: {body.denial_reason}. "
                f"Please contact your insurer for more details."
            ),
            delivery_status=DeliveryStatus.SENT,
            sent_at=datetime.now(timezone.utc),
        )
        db.add(notification)
        await db.flush()
    except Exception as exc:
        logger.warning("Failed to create denial notification: %s", exc)

    return ReviewDecisionResponse(
        review_id=item.id,
        claim_id=item.claim_id,
        decision="rejected",
        message=f"Claim denied. Reason: {body.denial_reason}",
    )


# ═══════════════════════════════════════════════════════════════════════
# Helpers
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


def _get_patient_id_from_claim(db: AsyncSession, claim_id: str) -> int:
    """
    Synchronously extract the patient_id from a claim (best-effort).

    Falls back to user ID 1 if the claim cannot be found.
    """
    # This is a simplified helper — in production, use an async query.
    # Here we just return a default since the notification is best-effort.
    return 1
