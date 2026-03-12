"""
ClaimSense.ai — In-App Notification Fallback Panel.

ALWAYS stores notifications to the DB regardless of Twilio delivery
success. If Twilio fails, this becomes the only delivery channel.

Provides CRUD for the in-app notification inbox:
  * ``store_notification``  — persist a notification record
  * ``get_notifications``   — retrieve notifications for a user
  * ``mark_read``           — mark a notification as read
  * ``get_unread_count``    — count of unread notifications
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import (
    DeliveryStatus,
    Notification,
    NotificationChannel,
)

logger = logging.getLogger("claimsense.notifications")


# ═══════════════════════════════════════════════════════════════════════
# store_notification
# ═══════════════════════════════════════════════════════════════════════

async def store_notification(
    claim_id: str,
    user_id: int,
    message: str,
    channel: str,
    delivery_status: str,
    db: AsyncSession,
) -> Notification:
    """
    Store a notification record in the database.

    This is ALWAYS called — even if Twilio delivery succeeded — to ensure
    the in-app notification panel has a complete history.

    Parameters
    ----------
    claim_id : str
        Related claim ID.
    user_id : int
        Target user's ID.
    message : str
        Notification message body.
    channel : str
        Delivery channel used: ``"whatsapp"``, ``"sms"``, or ``"none"``
        (maps to ``in_app`` if neither worked).
    delivery_status : str
        ``"sent"`` or ``"failed"``.
    db : AsyncSession
        Active database session.

    Returns
    -------
    Notification
        The persisted notification record.
    """
    # Map channel string to enum
    channel_map = {
        "whatsapp": NotificationChannel.WHATSAPP,
        "sms": NotificationChannel.SMS,
        "none": NotificationChannel.IN_APP,
        "in_app": NotificationChannel.IN_APP,
    }
    channel_enum = channel_map.get(channel, NotificationChannel.IN_APP)

    # Map delivery status string to enum
    status_map = {
        "sent": DeliveryStatus.SENT,
        "failed": DeliveryStatus.FAILED,
        "pending": DeliveryStatus.PENDING,
    }
    status_enum = status_map.get(delivery_status, DeliveryStatus.PENDING)

    notification = Notification(
        claim_id=claim_id,
        user_id=user_id,
        channel=channel_enum,
        message=message,
        delivery_status=status_enum,
        is_read=False,
        sent_at=datetime.now(timezone.utc) if status_enum == DeliveryStatus.SENT else None,
    )
    db.add(notification)
    await db.flush()

    logger.info(
        "Notification stored: id=%s claim=%s user=%s channel=%s delivered=%s",
        notification.id, claim_id, user_id, channel, delivery_status,
    )
    return notification


# ═══════════════════════════════════════════════════════════════════════
# get_notifications
# ═══════════════════════════════════════════════════════════════════════

async def get_notifications(
    user_id: int,
    db: AsyncSession,
    unread_only: bool = False,
) -> list[dict[str, Any]]:
    """
    Retrieve notifications for a user, sorted newest-first.

    Parameters
    ----------
    user_id : int
        Target user's ID.
    db : AsyncSession
        Active database session.
    unread_only : bool, optional
        If ``True``, return only unread notifications.

    Returns
    -------
    list[dict]
        List of notification dicts with id, claim_id, message, channel,
        delivery_status, is_read, and sent_at.
    """
    query = select(Notification).where(Notification.user_id == user_id)

    if unread_only:
        query = query.where(Notification.is_read == False)  # noqa: E712

    query = query.order_by(Notification.id.desc())
    result = await db.execute(query)
    notifications = result.scalars().all()

    return [
        {
            "id": n.id,
            "claim_id": n.claim_id,
            "message": n.message,
            "channel": n.channel.value if hasattr(n.channel, "value") else str(n.channel),
            "delivery_status": n.delivery_status.value if hasattr(n.delivery_status, "value") else str(n.delivery_status),
            "is_read": n.is_read,
            "sent_at": n.sent_at.isoformat() if n.sent_at else None,
        }
        for n in notifications
    ]


# ═══════════════════════════════════════════════════════════════════════
# mark_read
# ═══════════════════════════════════════════════════════════════════════

async def mark_read(notification_id: int, db: AsyncSession) -> bool:
    """
    Mark a specific notification as read.

    Parameters
    ----------
    notification_id : int
        The notification's primary key.
    db : AsyncSession
        Active database session.

    Returns
    -------
    bool
        ``True`` if the notification was found and updated.
    """
    result = await db.execute(
        select(Notification).where(Notification.id == notification_id)
    )
    notification = result.scalar_one_or_none()

    if notification is None:
        return False

    notification.is_read = True
    await db.flush()
    logger.info("Notification %d marked as read.", notification_id)
    return True


# ═══════════════════════════════════════════════════════════════════════
# get_unread_count
# ═══════════════════════════════════════════════════════════════════════

async def get_unread_count(user_id: int, db: AsyncSession) -> int:
    """
    Count unread notifications for a user.

    Parameters
    ----------
    user_id : int
        Target user's ID.
    db : AsyncSession
        Active database session.

    Returns
    -------
    int
        Number of unread notifications.
    """
    result = await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == user_id,
            Notification.is_read == False,  # noqa: E712
        )
    )
    return result.scalar() or 0
