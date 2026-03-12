"""
ClaimSense.ai — Immutable Audit Logger.

Every automated action (Gemini extraction, policy check, human review,
FHIR submission) is recorded here with full context for regulatory
traceability.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import AuditLog


async def log_action(
    db: AsyncSession,
    *,
    claim_id: Optional[str] = None,
    actor: str,
    action_type: str,
    module: str,
    details: Optional[dict[str, Any]] = None,
) -> AuditLog:
    """
    Insert an immutable audit-log row.

    Parameters
    ----------
    db : AsyncSession
        Active database session.
    claim_id : str, optional
        Related claim ID (``CS-2026-XXXX``).
    actor : str
        Who performed the action — user email or ``"system"``.
    action_type : str
        Short verb, e.g. ``"extract_document"``, ``"approve_review"``.
    module : str
        Originating module, e.g. ``"m1"``, ``"m2"``, ``"review"``.
    details : dict, optional
        Arbitrary JSONB payload with additional context.

    Returns
    -------
    AuditLog
        The persisted audit-log row.
    """
    entry = AuditLog(
        claim_id=claim_id,
        actor=actor,
        action_type=action_type,
        module=module,
        details=details or {},
    )
    db.add(entry)
    await db.flush()
    return entry
