"""
Review — Human Review Queue Router.

Endpoints for listing, claiming, and resolving review items.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/pending", summary="List pending review items")
async def list_pending():
    """List all claims awaiting human review."""
    return {"status": "not_implemented", "items": []}


@router.post("/decide", summary="Submit review decision")
async def submit_decision():
    """Approve or reject a flagged claim."""
    return {"status": "not_implemented"}
