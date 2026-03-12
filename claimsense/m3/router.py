"""
M3 — Clean Claim Guarantee Router.

Endpoints for FHIR packaging, adjudicator summary, and submission.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.post("/package/{claim_id}", summary="Build FHIR R4 package")
async def build_package(claim_id: str):
    """Assemble the FHIR R4 submission package for a claim."""
    return {"claim_id": claim_id, "status": "not_implemented", "message": "M3 packaging — coming soon"}


@router.post("/submit/{claim_id}", summary="Submit FHIR package to insurer")
async def submit_claim(claim_id: str):
    """Submit the assembled FHIR R4 package to the insurer API."""
    return {"claim_id": claim_id, "status": "not_implemented"}
