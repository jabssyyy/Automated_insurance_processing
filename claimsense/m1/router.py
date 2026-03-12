"""
M1 DocTriage — API Router.

Endpoints for document upload and Gemini-powered extraction.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.post("/extract", summary="Upload & extract document via Gemini")
async def extract_document():
    """Upload a medical document and extract structured data using Gemini 2.0 Flash."""
    return {"status": "not_implemented", "message": "M1 extraction endpoint — coming soon"}


@router.get("/status/{claim_id}", summary="Get extraction status for a claim")
async def extraction_status(claim_id: str):
    """Return the extraction status and results for a specific claim."""
    return {"claim_id": claim_id, "status": "not_implemented"}
