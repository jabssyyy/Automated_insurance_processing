"""
ClaimSense — JWT Token Handler.

Creates and verifies HS256 JWT tokens.
    - create_access_token(user_id, role)  → signed JWT string
    - verify_token(token)                 → decoded payload dict or HTTPException 401
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException, status
from jose import JWTError, jwt

from shared.config import get_settings

settings = get_settings()


def create_access_token(
    user_id: str,
    role: str,
    email: str = "",
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    Create a signed JWT access token.

    Parameters
    ----------
    user_id : str
        Unique identifier for the user.
    role : str
        User role (patient, hospital_staff, insurer, admin).
    email : str, optional
        User email to embed in the token.
    expires_delta : timedelta, optional
        Custom expiry; defaults to 24 hours.

    Returns
    -------
    str
        Encoded JWT string.
    """
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(hours=24)
    )
    payload: dict[str, Any] = {
        "user_id": user_id,
        "role": role,
        "email": email,
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def verify_token(token: str) -> dict[str, Any]:
    """
    Decode and verify a JWT token.

    Returns
    -------
    dict
        Decoded payload containing user_id, role, email.

    Raises
    ------
    HTTPException (401)
        If the token is invalid or expired.
    """
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        )
