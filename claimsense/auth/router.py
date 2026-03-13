"""
ClaimSense — Auth Router.

Endpoints:
    POST /auth/login       — authenticate with email + password → JWT
    POST /auth/demo-login  — hackathon quick-login by role → JWT
    GET  /auth/me          — return current user info from JWT
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_db
from shared.models import User, UserRole
from shared.schemas import TokenResponse, UserLoginRequest
from auth.jwt_handler import create_access_token
from auth.rbac import get_current_user

router = APIRouter()
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── Request schemas (local, not worth adding to shared) ──────────────

class DemoLoginRequest(BaseModel):
    """Hackathon quick-login — just pick a role."""
    role: str


# ═════════════════════════════════════════════════════════════════════
# POST /login
# ═════════════════════════════════════════════════════════════════════

@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Login with email and password",
)
async def login(
    body: UserLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Authenticate user credentials and return a JWT access token."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not pwd_ctx.verify(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    token = create_access_token(
        user_id=str(user.id),
        role=user.role if isinstance(user.role, str) else user.role.value,
        email=user.email,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user.role if isinstance(user.role, str) else user.role.value,
        "user_id": user.id,
    }


# ═════════════════════════════════════════════════════════════════════
# POST /demo-login
# ═════════════════════════════════════════════════════════════════════

@router.post(
    "/demo-login",
    response_model=TokenResponse,
    summary="Hackathon quick-login by role",
)
async def demo_login(
    body: DemoLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Accept a role name and return a JWT for the seeded demo user of that role.

    No password required — this is the quick-login for hackathon demos.
    """
    # Validate the requested role
    try:
        role_enum = UserRole(body.role)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role: {body.role}. Must be one of {[r.value for r in UserRole]}",
        )

    # Find the demo user for this role
    result = await db.execute(
        select(User).where(User.role == role_enum.value).limit(1)
    )
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No demo user found for role '{body.role}'.",
        )

    token = create_access_token(
        user_id=str(user.id),
        role=user.role if isinstance(user.role, str) else user.role.value,
        email=user.email,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user.role if isinstance(user.role, str) else user.role.value,
        "user_id": user.id,
    }


# ═════════════════════════════════════════════════════════════════════
# GET /me
# ═════════════════════════════════════════════════════════════════════

@router.get(
    "/me",
    summary="Get current user info from JWT",
)
async def me(
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Return the authenticated user's info as stored in the JWT payload."""
    return user
