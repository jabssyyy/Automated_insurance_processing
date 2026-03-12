"""
ClaimSense.ai — Server-Sent Events (SSE) Connection Manager.

Maintains per-user async queues and broadcasts status updates to all
connected clients whose role is in the event's ``role_visibility`` list.

Features
--------
* Role-filtered broadcast — patients don't see insurer-only events.
* 30-second heartbeat keep-alive to prevent proxy/LB timeouts.
* Thread-safe via ``asyncio.Queue`` (one per connected user).
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Optional


class ConnectionManager:
    """
    Manages Server-Sent Event connections for real-time status updates.

    Usage in a FastAPI endpoint::

        @app.get("/stream/{user_id}")
        async def stream(user_id: int):
            role = "patient"  # from JWT
            sse_manager.connect(user_id, role)
            return EventSourceResponse(sse_manager.event_generator(user_id))
    """

    HEARTBEAT_INTERVAL: int = 30  # seconds

    def __init__(self) -> None:
        # user_id → (asyncio.Queue, role)
        self._connections: dict[int, tuple[asyncio.Queue, str]] = {}

    # ── Connection lifecycle ──────────────────────────────────────────

    def connect(self, user_id: int, role: str) -> asyncio.Queue:
        """
        Register a new SSE connection for ``user_id``.

        If the user already has a connection, the old queue is replaced.

        Parameters
        ----------
        user_id : int
            Authenticated user's ID.
        role : str
            User role (``patient``, ``hospital_staff``, ``insurer``, ``admin``).

        Returns
        -------
        asyncio.Queue
            The queue that will receive events for this user.
        """
        queue: asyncio.Queue = asyncio.Queue()
        self._connections[user_id] = (queue, role)
        return queue

    def disconnect(self, user_id: int) -> None:
        """Remove the SSE connection for ``user_id``."""
        self._connections.pop(user_id, None)

    @property
    def active_count(self) -> int:
        """Number of currently connected clients."""
        return len(self._connections)

    # ── Broadcasting ──────────────────────────────────────────────────

    async def broadcast(
        self,
        claim_id: str,
        status: str,
        detail: str,
        role_visibility: list[str],
        extra: Optional[dict[str, Any]] = None,
    ) -> int:
        """
        Push a status event to every connected user whose role is visible.

        Parameters
        ----------
        claim_id : str
            Claim ID (``CS-2026-XXXX``).
        status : str
            New ``ClaimStatus`` value.
        detail : str
            Human-readable detail message.
        role_visibility : list[str]
            Roles allowed to see this event (e.g. ``["patient", "hospital_staff"]``).
        extra : dict, optional
            Additional payload merged into the event JSON.

        Returns
        -------
        int
            Number of users the event was sent to.
        """
        event_data: dict[str, Any] = {
            "claim_id": claim_id,
            "status": status,
            "detail": detail,
            "role_visibility": role_visibility,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **(extra or {}),
        }
        sent = 0
        for uid, (queue, role) in self._connections.items():
            if role in role_visibility or role == "admin":
                await queue.put(event_data)
                sent += 1
        return sent

    # ── Event generator (yields SSE-formatted strings) ────────────────

    async def event_generator(self, user_id: int) -> AsyncGenerator[str, None]:
        """
        Async generator that yields SSE-formatted events for ``user_id``.

        Includes a 30-second heartbeat comment to keep the connection alive
        through proxies and load-balancers.

        Yields
        ------
        str
            SSE-formatted string: ``data: {...}\\n\\n`` or ``: heartbeat\\n\\n``.
        """
        if user_id not in self._connections:
            return

        queue, _ = self._connections[user_id]

        try:
            while True:
                try:
                    # Wait for an event with a timeout for heartbeat
                    event_data = await asyncio.wait_for(
                        queue.get(), timeout=self.HEARTBEAT_INTERVAL
                    )
                    yield f"data: {json.dumps(event_data)}\n\n"
                except asyncio.TimeoutError:
                    # Send heartbeat keep-alive comment
                    yield ": heartbeat\n\n"
        finally:
            self.disconnect(user_id)


# ── Module-level singleton ────────────────────────────────────────────
sse_manager = ConnectionManager()
