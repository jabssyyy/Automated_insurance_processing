"""
M2 — Policy & Medical Validation Router.

Endpoints for running policy validation, ICD checks, and coverage analysis.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.post("/validate/{claim_id}", summary="Run full M2 validation pipeline")
async def validate_claim(claim_id: str):
    """Run policy parsing, ICD validation, and coverage engine on a claim."""
    return {"claim_id": claim_id, "status": "not_implemented", "message": "M2 validation — coming soon"}


@router.get("/coverage/{claim_id}", summary="Get coverage results")
async def get_coverage(claim_id: str):
    """Return coverage analysis results for a claim."""
    return {"claim_id": claim_id, "status": "not_implemented"}
