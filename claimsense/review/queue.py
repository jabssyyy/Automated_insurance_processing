"""
Review — Human Review Queue Logic.

Governance layer: "the system proposes, humans approve."
Sits between M2 (validation) and M3 (clean claim packaging).

Review triggers (no M4 fraud detection in demo):
    1. High-value claim — total > HIGH_VALUE_THRESHOLD (Rs. 5 lakh)
    2. Any coverage rule returned FAIL
    3. Any coverage rule returned a WARNING (sub-limit excess, etc.)
    4. Any ICD-10 incompatible diagnosis–procedure pair flagged

Functions:
    - ``should_review``      — evaluate whether a claim needs human review
    - ``create_review_item`` — insert a pending ReviewItem
    - ``approve_claim``      — mark approved, audit-log, return
    - ``reject_claim``       — mark rejected with denial reason, audit-log
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.audit import log_action
from shared.config import Settings, get_settings
from shared.models import Claim, ClaimStatus, ReviewItem, ReviewStatus

logger = logging.getLogger("claimsense.review.queue")


# ═══════════════════════════════════════════════════════════════════════
# 1. Should Review?
# ═══════════════════════════════════════════════════════════════════════


def should_review(
    claim_id: str,
    m2_results: dict[str, Any],
    claim_total: float,
    config: Optional[Settings] = None,
) -> dict[str, Any]:
    """
    Determine whether a claim needs human review before proceeding to M3.

    Parameters
    ----------
    claim_id : str
        Claim identifier (``CS-2026-XXXX``).
    m2_results : dict
        The ``m2_validation`` dict stored in ``claim.claim_json``.
        Expected keys: ``coverage_results``, ``code_results``.
    claim_total : float
        Total billed amount in INR.
    config : Settings, optional
        Application settings; defaults to ``get_settings()``.

    Returns
    -------
    dict
        ``{"needs_review": bool, "trigger_reasons": list[str]}``
    """
    if config is None:
        config = get_settings()

    trigger_reasons: list[str] = []

    # ── Trigger A: High-value claim ───────────────────────────────────
    threshold = config.HIGH_VALUE_THRESHOLD
    if claim_total > threshold:
        trigger_reasons.append(
            f"High-value claim (Rs. {claim_total:,.0f} exceeds threshold Rs. {threshold:,.0f})"
        )

    # ── Trigger B & C: Coverage FAIL or WARNING ───────────────────────
    coverage_results = m2_results.get("coverage_results", [])
    for rule in coverage_results:
        passed = rule.get("passed", True)
        rule_name = rule.get("rule_name", "unknown")
        message = rule.get("message", "")
        details = rule.get("details", {})

        if not passed:
            # Check if it's a warning (excess/sub-limit) or hard fail
            excess = details.get("excess_inr")
            if excess and excess > 0:
                trigger_reasons.append(
                    f"Sub-limit exceeded — {rule_name}: {message}"
                )
            else:
                trigger_reasons.append(
                    f"Coverage check failed — {rule_name}: {message}"
                )

    # ── Trigger D: Incompatible diagnosis–procedure pairs ─────────────
    code_results = m2_results.get("code_results", [])
    for code_entry in code_results:
        is_valid = code_entry.get("is_valid", True)
        code = code_entry.get("code", "")
        warnings = code_entry.get("warnings", [])

        if not is_valid:
            # Check if it's a pair (contains "+")
            if "+" in code:
                trigger_reasons.append(
                    f"ICD-10 incompatible pair: {code} — {', '.join(warnings)}"
                )
            else:
                trigger_reasons.append(
                    f"Invalid code: {code} — {', '.join(warnings)}"
                )

    needs_review = len(trigger_reasons) > 0

    logger.info(
        "Review check for %s: needs_review=%s, reasons=%d",
        claim_id, needs_review, len(trigger_reasons),
    )

    return {
        "needs_review": needs_review,
        "trigger_reasons": trigger_reasons,
    }


# ═══════════════════════════════════════════════════════════════════════
# 2. Create Review Item
# ═══════════════════════════════════════════════════════════════════════


async def create_review_item(
    claim_id: str,
    trigger_reasons: list[str],
    db: AsyncSession,
) -> ReviewItem:
    """
    Insert a pending review item into the queue.

    Parameters
    ----------
    claim_id : str
        Claim to review.
    trigger_reasons : list[str]
        Human-readable list of why review was triggered.
    db : AsyncSession
        Active database session.

    Returns
    -------
    ReviewItem
        The newly created review item.
    """
    item = ReviewItem(
        claim_id=claim_id,
        trigger_reasons=trigger_reasons,
        status=ReviewStatus.PENDING.value,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)

    await log_action(
        db,
        claim_id=claim_id,
        actor="system",
        action_type="review_item_created",
        module="review",
        details={
            "review_id": item.id,
            "trigger_reasons": trigger_reasons,
            "reason_count": len(trigger_reasons),
        },
    )

    logger.info(
        "Created review item #%d for claim %s (%d triggers)",
        item.id, claim_id, len(trigger_reasons),
    )

    return item


# ═══════════════════════════════════════════════════════════════════════
# 3. Approve Claim
# ═══════════════════════════════════════════════════════════════════════


async def approve_claim(
    review_id: int,
    reviewer_id: int,
    notes: Optional[str],
    db: AsyncSession,
) -> ReviewItem:
    """
    Mark a review item as approved and update the claim status.

    Parameters
    ----------
    review_id : int
        The ReviewItem primary key.
    reviewer_id : int
        ID of the insurer/admin user who approved.
    notes : str, optional
        Reviewer's notes.
    db : AsyncSession
        Active database session.

    Returns
    -------
    ReviewItem
        The updated review item.

    Raises
    ------
    ValueError
        If the review item is not found or not in pending status.
    """
    result = await db.execute(
        select(ReviewItem).where(ReviewItem.id == review_id)
    )
    item = result.scalar_one_or_none()

    if not item:
        raise ValueError(f"Review item #{review_id} not found")
            f"Review item #{review_id} is already {item.status} — cannot approve"
        )

    # Update review item
    item.status = ReviewStatus.APPROVED.value
    item.reviewer_id = reviewer_id
    item.notes = notes
    item.resolved_at = datetime.now(timezone.utc)

    # Update claim status → ready for M3
    claim_result = await db.execute(
        select(Claim).where(Claim.id == item.claim_id)
    )
    claim = claim_result.scalar_one_or_none()
    if claim:
        claim.status = ClaimStatus.ASSEMBLING_PACKAGE.value

    await db.flush()

    await log_action(
        db,
        claim_id=item.claim_id,
        actor=f"user:{reviewer_id}",
        action_type="review_approved",
        module="review",
        details={
            "review_id": review_id,
            "reviewer_id": reviewer_id,
            "notes": notes,
        },
    )

    logger.info("Review #%d APPROVED by user %d", review_id, reviewer_id)
    return item


# ═══════════════════════════════════════════════════════════════════════
# 4. Reject Claim
# ═══════════════════════════════════════════════════════════════════════


async def reject_claim(
    review_id: int,
    reviewer_id: int,
    notes: Optional[str],
    denial_reason: str,
    db: AsyncSession,
) -> ReviewItem:
    """
    Mark a review item as rejected and update the claim to DENIED.

    Parameters
    ----------
    review_id : int
        The ReviewItem primary key.
    reviewer_id : int
        ID of the insurer/admin user who rejected.
    notes : str, optional
        Internal reviewer notes.
    denial_reason : str
        Plain-English reason for denial (shown to patient).
    db : AsyncSession
        Active database session.

    Returns
    -------
    ReviewItem
        The updated review item.

    Raises
    ------
    ValueError
        If the review item is not found or not in pending status.
    """
    result = await db.execute(
        select(ReviewItem).where(ReviewItem.id == review_id)
    )
    item = result.scalar_one_or_none()

    if not item:
        raise ValueError(f"Review item #{review_id} not found")
    if item.status != ReviewStatus.PENDING.value:
        raise ValueError(
            f"Review item #{review_id} is already {item.status} — cannot reject"
        )

    # Update review item
    item.status = ReviewStatus.REJECTED.value
    item.reviewer_id = reviewer_id
    item.notes = notes
    item.denial_reason = denial_reason
    item.resolved_at = datetime.now(timezone.utc)

    # Update claim status → DENIED
    claim_result = await db.execute(
        select(Claim).where(Claim.id == item.claim_id)
    )
    claim = claim_result.scalar_one_or_none()
    if claim:
        claim.status = ClaimStatus.DENIED.value

    await db.flush()

    await log_action(
        db,
        claim_id=item.claim_id,
        actor=f"user:{reviewer_id}",
        action_type="review_rejected",
        module="review",
        details={
            "review_id": review_id,
            "reviewer_id": reviewer_id,
            "notes": notes,
            "denial_reason": denial_reason,
        },
    )

    logger.info("Review #%d REJECTED by user %d: %s", review_id, reviewer_id, denial_reason)
    return item
