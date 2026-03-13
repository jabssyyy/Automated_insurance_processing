"""
ClaimSense.ai — Dashboard Status Tracking & Aggregation.

Core business logic for the real-time status dashboard:
  * ``update_status``       — persist + broadcast a status change
  * ``get_claim_timeline``  — role-filtered chronological history
  * ``get_active_claims``   — role-scoped claim list
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.audit import log_action
from shared.models import Claim, StatusUpdate, User
from shared.sse import sse_manager

logger = logging.getLogger("claimsense.dashboard")

# ═══════════════════════════════════════════════════════════════════════
# Role visibility rules
# ═══════════════════════════════════════════════════════════════════════

PATIENT_VISIBLE = {
    "DOCUMENTS_MISSING",
    "DOCUMENTS_COMPLETE",
    "POLICY_VALIDATING",
    "UNDER_HUMAN_REVIEW",
    "APPROVED",
    "DENIED",
    "QUERY_RAISED",
    "ESCALATED_TO_IRDAI",
}

HOSPITAL_STAFF_VISIBLE = PATIENT_VISIBLE | {
    "ASSEMBLING_PACKAGE",
    "SUBMITTED",
    "UNDER_INSURER_REVIEW",
}

# Insurers and admins see everything
ALL_STATUSES = HOSPITAL_STAFF_VISIBLE | {
    "ICD_CHECK_RUNNING",
}


# ═══════════════════════════════════════════════════════════════════════
# update_status
# ═══════════════════════════════════════════════════════════════════════

async def update_status(
    claim_id: str,
    status: str,
    detail: str,
    role_visibility: list[str],
    db: AsyncSession,
    extra: Optional[dict[str, Any]] = None,
) -> StatusUpdate:
    """
    Persist a ``StatusUpdate`` record, broadcast via SSE, and log to audit.

    Parameters
    ----------
    claim_id : str
        Claim ID (``CS-2026-XXXX``).
    status : str
        New ``ClaimStatus`` value.
    detail : str
        Human-readable detail message.
    role_visibility : list[str]
        Roles allowed to see this update.
    db : AsyncSession
        Active database session.
    extra : dict, optional
        Additional payload merged into the SSE event.

    Returns
    -------
    StatusUpdate
        The persisted status-update record.
    """
    # 1. Persist to DB
    record = StatusUpdate(
        claim_id=claim_id,
        status=status,
        detail=detail,
        role_visibility=role_visibility,
    )
    db.add(record)
    await db.flush()

    # 2. Also update the claim's current status
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if claim is not None:
        claim.status = status

    # 3. Broadcast via SSE
    try:
        sent_count = await sse_manager.broadcast(
            claim_id=claim_id,
            status=status,
            detail=detail,
            role_visibility=role_visibility,
            extra=extra,
        )
        logger.info(
            "SSE broadcast: claim=%s status=%s → sent to %d clients",
            claim_id, status, sent_count,
        )
    except Exception as exc:
        logger.error("SSE broadcast failed for claim %s: %s", claim_id, exc)

    # 4. Audit trail
    await log_action(
        db,
        claim_id=claim_id,
        actor="system",
        action_type="status_update",
        module="dashboard",
        details={
            "status": status,
            "detail": detail,
            "role_visibility": role_visibility,
            "extra": extra or {},
        },
    )

    logger.info("Status updated: claim=%s → %s", claim_id, status)
    return record


# ═══════════════════════════════════════════════════════════════════════
# get_claim_timeline
# ═══════════════════════════════════════════════════════════════════════

async def get_claim_timeline(
    claim_id: str,
    user_role: str,
    db: AsyncSession,
) -> list[dict[str, Any]]:
    """
    Fetch the chronological status timeline for a claim, filtered by role.

    Parameters
    ----------
    claim_id : str
        Claim ID to fetch timeline for.
    user_role : str
        Current user's role — controls which updates are visible.
    db : AsyncSession
        Active database session.

    Returns
    -------
    list[dict]
        Chronological list of ``{status, detail, timestamp}`` dicts.
    """
    result = await db.execute(
        select(StatusUpdate)
        .where(StatusUpdate.claim_id == claim_id)
        .order_by(StatusUpdate.timestamp.asc())
    )
    updates = result.scalars().all()

    timeline: list[dict[str, Any]] = []
    for u in updates:
        # Role-based visibility filter
        visibility = u.role_visibility or []
        if user_role == "admin" or user_role in visibility:
            timeline.append({
                "id": u.id,
                "status": u.status,
                "detail": u.detail,
                "timestamp": u.timestamp.isoformat() if u.timestamp else None,
            })

    return timeline


# ═══════════════════════════════════════════════════════════════════════
# get_active_claims
# ═══════════════════════════════════════════════════════════════════════

async def get_active_claims(
    user_id: int,
    role: str,
    db: AsyncSession,
) -> list[dict[str, Any]]:
    """
    Return claims visible to the given user based on their role.

    Visibility rules
    ----------------
    * **patient** — own claims only (``patient_id`` matches ``user_id``).
    * **hospital_staff** — claims where ``hospital_id`` matches the user's hospital.
    * **insurer** — claims where ``insurer_id`` matches the user's insurer.
    * **admin** — all claims.

    Returns
    -------
    list[dict]
        Each dict contains: claim_id, current_status, patient_name,
        total_amount, created_at.
    """
    # Build the base query
    query = select(Claim)

    if role == "patient":
        query = query.where(Claim.patient_id == user_id)
    elif role == "hospital_staff":
        # Fetch the user to get their hospital_id
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if user and user.hospital_id:
            query = query.where(Claim.hospital_id == user.hospital_id)
        else:
            return []
    elif role == "insurer":
        # In demo mode, insurer sees all claims (no insurer_id filtering)
        pass
    elif role == "admin":
        pass  # No filter — admin sees all
    else:
        return []

    query = query.order_by(Claim.created_at.desc())
    result = await db.execute(query)
    claims = result.scalars().all()

    active_list: list[dict[str, Any]] = []
    for c in claims:
        # Extract patient name from claim_json if available
        patient_name = "Unknown"
        if c.claim_json and isinstance(c.claim_json, dict):
            patient_name = c.claim_json.get("patient_name", "Unknown")

        active_list.append({
            "claim_id": c.id,
            "current_status": c.status.value if hasattr(c.status, "value") else str(c.status),
            "patient_name": patient_name,
            "total_amount": float(c.total_amount) if c.total_amount else None,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })

    return active_list
