"""
ClaimSense.ai — Notifications API Router.

Endpoints
---------
* ``POST /send/{claim_id}``        — trigger notification for a status change
* ``GET /``                        — in-app notification inbox for current user
* ``POST /{notification_id}/read`` — mark a notification as read
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.rbac import require_role
from shared.audit import log_action
from shared.database import get_db
from shared.models import Claim, User

from notifications.fallback_panel import (
    get_notifications,
    get_unread_count,
    mark_read,
    store_notification,
)
from notifications.twilio_service import send_with_priority

logger = logging.getLogger("claimsense.notifications")

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════
# Status → message templates
# ═══════════════════════════════════════════════════════════════════════

STATUS_MESSAGES: dict[str, str] = {
    "DOCUMENTS_MISSING": (
        "ClaimSense Update: Your claim {claim_id} needs additional documents: "
        "{missing_list}. Please upload them to continue processing."
    ),
    "DOCUMENTS_COMPLETE": (
        "ClaimSense Update: All documents for claim {claim_id} received! "
        "We're now validating your coverage."
    ),
    "POLICY_VALIDATING": (
        "ClaimSense Update: Checking your policy coverage for claim {claim_id}..."
    ),
    "UNDER_HUMAN_REVIEW": (
        "ClaimSense Update: Claim {claim_id} is being reviewed by our team. "
        "We'll update you shortly."
    ),
    "SUBMITTED": (
        "ClaimSense Update: Claim {claim_id} has been submitted to your insurer!"
    ),
    "APPROVED": (
        "ClaimSense Update: Great news! Claim {claim_id} has been approved. "
        "Amount: Rs. {amount}"
    ),
    "DENIED": (
        "ClaimSense Update: Claim {claim_id} was not approved. Reason: {reason}. "
        "Chat with our assistant for details."
    ),
    "QUERY_RAISED": (
        "ClaimSense Update: The insurer has a question about claim {claim_id}: "
        "{query}. Please respond."
    ),
    "ESCALATED_TO_IRDAI": (
        "ClaimSense Update: Claim {claim_id} has been escalated to IRDAI as the "
        "insurer did not respond within the required 3 hours."
    ),
}


# ═══════════════════════════════════════════════════════════════════════
# Request schemas
# ═══════════════════════════════════════════════════════════════════════

class SendNotificationRequest(BaseModel):
    """Body for the POST /send/{claim_id} endpoint."""
    status: str = Field(..., description="Claim status that triggered the notification")
    detail: str = Field(default="", description="Additional detail (optional)")


# ═══════════════════════════════════════════════════════════════════════
# Helper: generate message from status
# ═══════════════════════════════════════════════════════════════════════

def _generate_message(
    claim_id: str,
    claim_status: str,
    detail: str,
    claim: Optional[Any] = None,
) -> str:
    """
    Generate a user-friendly notification message from a status code.

    Uses the STATUS_MESSAGES template if available, falling back to
    a generic message.
    """
    template = STATUS_MESSAGES.get(claim_status)
    if not template:
        return f"ClaimSense Update: Your claim {claim_id} status is now {claim_status}. {detail}"

    # Build substitution values
    amount = "N/A"
    if claim and claim.total_amount:
        amount = f"{claim.total_amount:,.2f}"

    format_kwargs = {
        "claim_id": claim_id,
        "missing_list": detail or "Please check your document list",
        "amount": amount,
        "reason": detail or "Not specified",
        "query": detail or "Please check the portal for details",
    }

    try:
        return template.format(**format_kwargs)
    except KeyError:
        return f"ClaimSense Update: Claim {claim_id} — {claim_status}. {detail}"


# ═══════════════════════════════════════════════════════════════════════
# POST /send/{claim_id} — Trigger notification for a status change
# ═══════════════════════════════════════════════════════════════════════

@router.post("/send/{claim_id}", summary="Send a notification for a claim status change")
async def send_notification(
    claim_id: str,
    body: SendNotificationRequest,
    current_user: dict[str, Any] = Depends(
        require_role("hospital_staff", "insurer", "admin")
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger the notification priority chain for a claim status update.

    1. Fetch the claim and patient user from the DB.
    2. Generate a human-friendly message from the status.
    3. Attempt WhatsApp → SMS → fallback.
    4. Always store in the in-app notification panel.
    5. Log to audit trail.
    """
    # 1. Fetch the claim
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if claim is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Claim {claim_id} not found.",
        )

    # 2. Fetch the patient user
    result = await db.execute(select(User).where(User.id == claim.patient_id))
    patient = result.scalar_one_or_none()
    if patient is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient user (id={claim.patient_id}) not found.",
        )

    # 3. Generate message
    message = _generate_message(claim_id, body.status, body.detail, claim)

    # 4. Try Twilio priority chain
    delivery_result: dict[str, Any] = {"channel": "none", "delivered": False}
    if patient.phone:
        delivery_result = send_with_priority(patient.phone, message)
    else:
        logger.warning(
            "Patient %s has no phone number — skipping Twilio, using in-app only.",
            patient.id,
        )

    # 5. ALWAYS store in fallback panel
    notification = await store_notification(
        claim_id=claim_id,
        user_id=patient.id,
        message=message,
        channel=delivery_result["channel"],
        delivery_status="sent" if delivery_result["delivered"] else "failed",
        db=db,
    )

    # 6. Audit trail
    await log_action(
        db,
        claim_id=claim_id,
        actor=current_user.get("email", "system"),
        action_type="send_notification",
        module="notifications",
        details={
            "status": body.status,
            "channel_used": delivery_result["channel"],
            "delivered": delivery_result["delivered"],
            "notification_id": notification.id,
        },
    )

    return {
        "channel_used": delivery_result["channel"],
        "delivered": delivery_result["delivered"],
        "notification_id": notification.id,
        "message": message,
    }


# ═══════════════════════════════════════════════════════════════════════
# GET / — In-app notification inbox for authenticated user
# ═══════════════════════════════════════════════════════════════════════

@router.get("/", summary="In-app notification inbox")
async def get_inbox(
    unread_only: bool = False,
    current_user: dict[str, Any] = Depends(
        require_role("patient", "hospital_staff", "insurer", "admin")
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Return the authenticated user's notifications, sorted newest first.
    Includes the unread count for badge display.
    """
    notifications = await get_notifications(
        user_id=current_user["user_id"],
        db=db,
        unread_only=unread_only,
    )
    unread = await get_unread_count(current_user["user_id"], db)

    return {
        "notifications": notifications,
        "unread_count": unread,
        "total": len(notifications),
    }


# ═══════════════════════════════════════════════════════════════════════
# POST /{notification_id}/read — Mark a notification as read
# ═══════════════════════════════════════════════════════════════════════

@router.post("/{notification_id}/read", summary="Mark notification as read")
async def mark_notification_read(
    notification_id: int,
    current_user: dict[str, Any] = Depends(
        require_role("patient", "hospital_staff", "insurer", "admin")
    ),
    db: AsyncSession = Depends(get_db),
):
    """Mark a specific notification as read."""
    success = await mark_read(notification_id, db)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Notification {notification_id} not found.",
        )
    return {"status": "ok", "notification_id": notification_id, "is_read": True}
