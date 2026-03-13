"""
ClaimSense — Dashboard API Router.

Endpoints
---------
* ``GET /stream``              — SSE real-time event stream (token via query param)
* ``GET /claims``              — Active claims for authenticated user
* ``GET /timeline/{claim_id}`` — Role-filtered status timeline for a claim
* ``POST /create-claim``       — Create a new claim for the current patient
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from auth.jwt_handler import verify_token
from auth.rbac import require_role
from shared.database import get_db
from shared.models import Claim, ClaimStatus
from shared.sse import sse_manager

from dashboard.status import get_active_claims, get_claim_timeline

logger = logging.getLogger("claimsense.dashboard")

router = APIRouter()


# ── Request schemas ──────────────────────────────────────────────────

class CreateClaimRequest(BaseModel):
    """Create a new claim for the logged-in patient."""
    policy_number: str
    claim_type: str = "inpatient"   # inpatient | daycare | icu
    path: str = "cashless"          # cashless | reimbursement


# ═══════════════════════════════════════════════════════════════════════
# GET /stream — Server-Sent Events endpoint
# ═══════════════════════════════════════════════════════════════════════

@router.get("/stream", summary="SSE stream for real-time claim updates")
async def sse_stream(
    token: str = Query(..., description="JWT token (SSE can't send headers)"),
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
    user_id = payload.get("user_id")
    role: str | None = payload.get("role")

    if user_id is None or not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing required claims (user_id, role).",
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
    current_user: dict[str, Any] = Depends(
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
    claims = await get_active_claims(
        user_id=current_user["user_id"],
        role=current_user["role"],
        db=db,
    )
    return {"claims": claims, "count": len(claims)}


# ═══════════════════════════════════════════════════════════════════════
# GET /timeline/{claim_id} — Status timeline for a claim
# ═══════════════════════════════════════════════════════════════════════

@router.get("/timeline/{claim_id}", summary="Status timeline for a claim")
async def claim_timeline(
    claim_id: str,
    current_user: dict[str, Any] = Depends(
        require_role("patient", "hospital_staff", "insurer", "admin")
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Return the chronological list of status updates for a claim,
    filtered by the authenticated user's role visibility.
    """
    timeline = await get_claim_timeline(
        claim_id=claim_id,
        user_role=current_user["role"],
        db=db,
    )
    return {"claim_id": claim_id, "timeline": timeline}


# ═══════════════════════════════════════════════════════════════════════
# POST /create-claim — Create a new claim
# ═══════════════════════════════════════════════════════════════════════

@router.post("/create-claim", summary="Create a new claim for current patient")
async def create_claim(
    body: CreateClaimRequest,
    current_user: dict[str, Any] = Depends(require_role("patient", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new claim with an auto-generated CS-2026-XXXX ID.
    Returns the new claim_id so the frontend can immediately use it.
    """
    # Generate next claim ID
    result = await db.execute(
        select(sa_func.count()).select_from(Claim)
    )
    count = result.scalar() or 0
    claim_id = f"CS-2026-{count + 1:04d}"

    # Prevent duplicate IDs
    existing = await db.execute(select(Claim).where(Claim.id == claim_id))
    if existing.scalar_one_or_none():
        claim_id = f"CS-2026-{count + 100:04d}"

    user_id = current_user["user_id"]
    # Handle string user_id from JWT
    if isinstance(user_id, str):
        user_id = int(user_id)

    claim = Claim(
        id=claim_id,
        patient_id=user_id,
        claim_type=body.claim_type,
        path=body.path,
        policy_number=body.policy_number,
        status=ClaimStatus.DOCUMENTS_MISSING.value,
    )
    db.add(claim)
    await db.flush()

    logger.info("Created claim %s for patient %s", claim_id, user_id)

    return {
        "claim_id": claim_id,
        "status": ClaimStatus.DOCUMENTS_MISSING.value,
        "message": f"Claim {claim_id} created successfully",
    }

