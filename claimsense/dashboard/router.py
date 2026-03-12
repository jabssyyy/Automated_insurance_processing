"""
ClaimSense.ai — Dashboard API Router.

Endpoints
---------
* ``GET /stream``              — SSE real-time event stream (token via query param)
* ``GET /claims``              — Active claims for authenticated user
* ``GET /timeline/{claim_id}`` — Role-filtered status timeline for a claim
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from auth.jwt_handler import get_current_user, verify_token
from auth.rbac import require_role
from shared.database import get_db
from shared.models import User
from shared.sse import sse_manager

from dashboard.status import get_active_claims, get_claim_timeline

logger = logging.getLogger("claimsense.dashboard")

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════
# GET /stream — Server-Sent Events endpoint
# ═══════════════════════════════════════════════════════════════════════

@router.get("/stream", summary="SSE stream for real-time claim updates")
async def sse_stream(
    token: str = Query(..., description="JWT token (SSE can't send headers)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Server-Sent Events endpoint for real-time status updates.

    Because the browser ``EventSource`` API cannot set custom headers,
    the JWT is passed as a query parameter: ``/stream?token=xxx``.

    The stream is role-filtered — each user only receives events their
    role is authorised to see.
    """
    # Verify the JWT from query param
    payload = verify_token(token)
    email: str | None = payload.get("sub")
    user_id: int | None = payload.get("user_id")
    role: str | None = payload.get("role")

    if not email or user_id is None or not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing required claims (sub, user_id, role).",
        )

    # Register the connection with SSE manager
    sse_manager.connect(user_id, role)
    logger.info("SSE connected: user_id=%s role=%s", user_id, role)

    async def event_stream():
        """Wrap the SSE manager generator with disconnect cleanup."""
        try:
            async for event in sse_manager.event_generator(user_id):
                yield event
        finally:
            sse_manager.disconnect(user_id)
            logger.info("SSE disconnected: user_id=%s", user_id)

    return EventSourceResponse(
        event_stream(),
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ═══════════════════════════════════════════════════════════════════════
# GET /claims — Active claims for authenticated user
# ═══════════════════════════════════════════════════════════════════════

@router.get("/claims", summary="List active claims for current user")
async def list_claims(
    current_user: User = Depends(
        require_role("patient", "hospital_staff", "insurer", "admin")
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Return claims visible to the authenticated user based on their role.

    * **patient** — own claims only
    * **hospital_staff** — claims from their hospital
    * **insurer** — claims routed to their insurer
    * **admin** — all claims
    """
    role = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    claims = await get_active_claims(
        user_id=current_user.id,
        role=role,
        db=db,
    )
    return {"claims": claims, "count": len(claims)}


# ═══════════════════════════════════════════════════════════════════════
# GET /timeline/{claim_id} — Status timeline for a claim
# ═══════════════════════════════════════════════════════════════════════

@router.get("/timeline/{claim_id}", summary="Status timeline for a claim")
async def claim_timeline(
    claim_id: str,
    current_user: User = Depends(
        require_role("patient", "hospital_staff", "insurer", "admin")
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Return the chronological list of status updates for a claim,
    filtered by the authenticated user's role visibility.
    """
    role = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    timeline = await get_claim_timeline(
        claim_id=claim_id,
        user_role=role,
        db=db,
    )
    return {"claim_id": claim_id, "timeline": timeline}
