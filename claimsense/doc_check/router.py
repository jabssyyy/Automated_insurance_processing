"""
Doc Check — API Router.

Endpoint for checking document completeness before claim processing.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.post("/check/{claim_id}", summary="Check document completeness")
async def check_completeness(claim_id: str):
    """Check if all required documents are present for a claim."""
    return {"claim_id": claim_id, "status": "not_implemented", "message": "Doc check endpoint — coming soon"}
