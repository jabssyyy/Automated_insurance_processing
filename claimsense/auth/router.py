"""
ClaimSense.ai — Auth Router.

Endpoints:
    POST /auth/register  — create a new user
    POST /auth/login     — authenticate and receive a JWT
    GET  /auth/me        — return current user profile
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_db
from shared.models import User, UserRole
from shared.schemas import (
    TokenResponse,
    UserCreateRequest,
    UserLoginRequest,
    UserResponse,
)
from auth.jwt_handler import create_access_token, get_current_user

router = APIRouter()
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
)
async def register(
    body: UserCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> User:
    """Create a new platform user with hashed password."""
    # Check for duplicate email
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered.",
        )

    # Validate role
    try:
        role = UserRole(body.role)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role: {body.role}. Must be one of {[r.value for r in UserRole]}",
        )

    user = User(
        email=body.email,
        hashed_password=pwd_ctx.hash(body.password),
        role=role,
        phone=body.phone,
        hospital_id=body.hospital_id,
        insurer_id=body.insurer_id,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Login and receive JWT",
)
async def login(
    body: UserLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Authenticate user credentials and return a JWT access token."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not pwd_ctx.verify(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    token = create_access_token(
        data={"sub": user.email, "role": user.role.value, "user_id": user.id}
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user.role.value,
        "user_id": user.id,
    }


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Get current user profile",
)
async def me(current_user: User = Depends(get_current_user)) -> User:
    """Return the authenticated user's profile."""
    return current_user
