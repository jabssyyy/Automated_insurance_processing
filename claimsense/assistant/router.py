"""
Assistant — Conversational Assistant Router.

Endpoint for claim-specific chat powered by Gemini.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.post("/chat", summary="Chat about a specific claim")
async def chat():
    """Ask a question about a claim — answers grounded in Claim JSON data."""
    return {"status": "not_implemented", "message": "Assistant endpoint — coming soon"}
