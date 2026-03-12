"""
Dashboard — Status Dashboard Router.

Endpoints for real-time claim status, SSE stream, and role-based views.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from starlette.responses import StreamingResponse

from shared.sse import sse_manager

router = APIRouter()


@router.get("/claims", summary="List claims for current user's role")
async def list_claims():
    """Return claims visible to the current user's role."""
    return {"status": "not_implemented", "claims": []}


@router.get("/stream/{user_id}", summary="SSE stream for real-time updates")
async def sse_stream(user_id: int, role: str = "patient"):
    """
    Server-Sent Events stream for real-time claim status updates.

    The client connects and receives events filtered by their role.
    """
    sse_manager.connect(user_id, role)
    return StreamingResponse(
        sse_manager.event_generator(user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
