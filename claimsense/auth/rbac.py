"""
ClaimSense.ai — Role-Based Access Control (RBAC).

Provides a ``require_role`` dependency factory that restricts endpoint
access to users with one of the specified roles.

Usage::

    @router.get("/insurer-only")
    async def insurer_view(user: User = Depends(require_role("insurer", "admin"))):
        ...
"""

from __future__ import annotations

from typing import Callable, Sequence

from fastapi import Depends, HTTPException, status

from shared.models import User, UserRole
from auth.jwt_handler import get_current_user


def require_role(*allowed_roles: str) -> Callable:
    """
    Return a FastAPI dependency that validates the current user's role.

    Parameters
    ----------
    *allowed_roles : str
        One or more role strings (e.g. ``"patient"``, ``"insurer"``).

    Returns
    -------
    Callable
        An async dependency that returns the ``User`` or raises 403.
    """

    async def _role_guard(
        current_user: User = Depends(get_current_user),
    ) -> User:
        if current_user.role.value not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Role '{current_user.role.value}' is not authorised. "
                    f"Required: {', '.join(allowed_roles)}."
                ),
            )
        return current_user

    return _role_guard
