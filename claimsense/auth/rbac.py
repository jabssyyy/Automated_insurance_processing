"""
ClaimSense — Role-Based Access Control (RBAC).

Provides:
    - require_role(*allowed_roles)  → FastAPI Depends that checks JWT + role
    - get_current_user              → FastAPI Depends that just verifies JWT (any role)

Both return a dict: {"user_id": ..., "role": ..., "email": ...}

Usage::

    @router.get("/insurer-only")
    async def insurer_view(user = Depends(require_role("insurer", "admin"))):
        ...

    @router.get("/any-logged-in")
    async def any_view(user = Depends(get_current_user)):
        ...
"""

from __future__ import annotations

from typing import Any, Callable

from fastapi import Depends, HTTPException, Request, status

from auth.jwt_handler import verify_token


def _extract_token(request: Request) -> str:
    """Pull the Bearer token from the Authorization header."""
    auth_header: str | None = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return auth_header.removeprefix("Bearer ").strip()


async def get_current_user(request: Request) -> dict[str, Any]:
    """
    FastAPI dependency — verify the JWT and return the payload.

    Returns
    -------
    dict
        {"user_id": ..., "role": ..., "email": ...}
    """
    token = _extract_token(request)
    payload = verify_token(token)
    return {
        "user_id": payload.get("user_id"),
        "role": payload.get("role"),
        "email": payload.get("email", ""),
    }


def require_role(*allowed_roles: str) -> Callable:
    """
    Return a FastAPI dependency that restricts access to specific roles.

    Parameters
    ----------
    *allowed_roles : str
        One or more role strings (e.g. "patient", "insurer").

    Returns
    -------
    Callable
        An async dependency that returns the user payload dict or raises 403.
    """

    async def _role_guard(
        user: dict[str, Any] = Depends(get_current_user),
    ) -> dict[str, Any]:
        if user["role"] not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Role '{user['role']}' is not authorised. "
                    f"Required: {', '.join(allowed_roles)}."
                ),
            )
        return user

    return _role_guard
