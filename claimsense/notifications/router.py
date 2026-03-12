"""
Notifications — API Router.

Endpoints for sending notifications and retrieving in-app messages.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.post("/send", summary="Send notification for a claim event")
async def send_notification():
    """Trigger WhatsApp → SMS → in-app notification chain."""
    return {"status": "not_implemented", "message": "Notification endpoint — coming soon"}


@router.get("/inbox/{user_id}", summary="Get in-app notifications")
async def get_inbox(user_id: int):
    """List in-app notifications for a user."""
    return {"user_id": user_id, "notifications": []}
