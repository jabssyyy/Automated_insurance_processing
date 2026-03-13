"""
M2 — Policy & Medical Validation Router.

Orchestrates the full M2 validation pipeline:

    Step 1:  Parse policy via Gemini (with caching)
    Step 2a: ICD-10 + procedure code validation       ─┐ run in PARALLEL
    Step 2b: Deterministic Python coverage validation  ─┘
    Step 3:  Generate patient + insurer summaries via Gemini

Every step is audit-logged.  SSE broadcasts fire at each stage transition.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.audit import log_action
from shared.config import get_settings
from shared.database import get_db
from shared.models import Claim, ClaimStatus, StatusUpdate
from shared.schemas import ClaimJSON, CodeValidationResult, RuleResult
from shared.sse import sse_manager

from m2.policy_parser import parse_policy
from m2.icd_validator import validate_codes
from m2.coverage_engine import validate_coverage
from m2.summary_gen import generate_patient_summary, generate_insurer_snapshot

logger = logging.getLogger("claimsense.m2.router")
settings = get_settings()
router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════
# Response schema
# ═══════════════════════════════════════════════════════════════════════

from pydantic import BaseModel, Field
from decimal import Decimal
from typing import Optional


class M2ValidationResponse(BaseModel):
    """Full response from the M2 validation pipeline."""
    claim_id: str
    code_results: list[dict[str, Any]]
    coverage_results: list[dict[str, Any]]
    patient_summary: str
    insurer_snapshot: str
    has_warnings: bool
    has_failures: bool
    passed_count: int
    failed_count: int
    requires_human_review: bool
    review_reasons: list[str]


# ═══════════════════════════════════════════════════════════════════════
# Main validation endpoint
# ═══════════════════════════════════════════════════════════════════════


@router.post(
    "/validate/{claim_id}",
    response_model=M2ValidationResponse,
    summary="Run full M2 validation pipeline",
)
async def validate_claim(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
) -> M2ValidationResponse:
    """
    Execute the complete M2 Policy & Medical Validation pipeline.

    Steps:
        1. Parse policy (Gemini + cache)
        2a. ICD-10 code validation (parallel)
        2b. Deterministic coverage validation (parallel)
        3. Generate summaries (Gemini)

    All steps are audit-logged and SSE-broadcast.
    """
    # ── Fetch claim ───────────────────────────────────────────────────
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()

    if not claim:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Claim {claim_id} not found",
        )

    if not claim.claim_json:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Claim {claim_id} has no claim_json — run M1 extraction first",
        )

    # Parse the stored JSONB into the ClaimJSON schema
    claim_json = ClaimJSON(**claim.claim_json)

    # ── Update status: POLICY_VALIDATING ──────────────────────────────
    claim.status = ClaimStatus.POLICY_VALIDATING.value
    await db.flush()

    await _broadcast_status(
        db, claim_id, "POLICY_VALIDATING",
        "Policy validation started — parsing policy document",
    )

    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="m2_pipeline_started", module="m2",
        details={"policy_number": claim_json.policy_number},
    )

    # ══════════════════════════════════════════════════════════════════
    # STEP 1: Parse policy (with caching)
    # ══════════════════════════════════════════════════════════════════
    policy_file = None  # Will be populated if policy PDF exists on disk
    if claim.policy_number:
        # Check for policy file in data directory
        from pathlib import Path
        data_dir = Path(__file__).resolve().parent.parent / "data"
        candidate = data_dir / "sample_policy.pdf"
        if candidate.exists():
            policy_file = str(candidate)

    policy_rules = await parse_policy(
        policy_file_path=policy_file,
        policy_number=claim_json.policy_number,
        db=db,
    )

    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="policy_parsed", module="m2",
        details={"rules_keys": list(policy_rules.keys())},
    )

    # ══════════════════════════════════════════════════════════════════
    # STEP 2a + 2b: Run in PARALLEL
    # ══════════════════════════════════════════════════════════════════

    await _broadcast_status(
        db, claim_id, "ICD_CHECK_RUNNING",
        "Running ICD-10 code validation and coverage checks in parallel",
    )
    claim.status = ClaimStatus.ICD_CHECK_RUNNING.value
    await db.flush()

    # Wrap synchronous functions in async wrappers for parallel execution
    async def _async_icd_validate() -> list[CodeValidationResult]:
        diag_dicts = [{"code": d.code, "description": d.description} for d in claim_json.diagnosis_codes]
        proc_dicts = [{"code": p.code, "description": p.description} for p in claim_json.procedure_codes]
        return validate_codes(diag_dicts, proc_dicts)

    async def _async_coverage_validate() -> list[RuleResult]:
        return validate_coverage(claim_json, policy_rules)

    # Run both in parallel
    code_results, coverage_results = await asyncio.gather(
        _async_icd_validate(),
        _async_coverage_validate(),
    )

    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="icd_validation_complete", module="m2",
        details={
            "total_codes_checked": len(code_results),
            "invalid_codes": sum(1 for c in code_results if not c.is_valid),
        },
    )

    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="coverage_validation_complete", module="m2",
        details={
            "total_rules": len(coverage_results),
            "passed": sum(1 for r in coverage_results if r.passed),
            "failed": sum(1 for r in coverage_results if not r.passed),
        },
    )

    # ══════════════════════════════════════════════════════════════════
    # STEP 3: Generate summaries (Gemini)
    # ══════════════════════════════════════════════════════════════════

    patient_summary, insurer_snapshot = await asyncio.gather(
        generate_patient_summary(claim_json, code_results, coverage_results),
        generate_insurer_snapshot(claim_json, code_results, coverage_results),
    )

    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="summaries_generated", module="m2",
        details={
            "patient_summary_length": len(patient_summary),
            "insurer_snapshot_length": len(insurer_snapshot),
        },
    )

    # ══════════════════════════════════════════════════════════════════
    # Compute flags and determine if human review is needed
    # ══════════════════════════════════════════════════════════════════

    has_failures = any(not r.passed for r in coverage_results)
    has_warnings = any(
        not r.passed and "exceed" in r.message.lower()
        for r in coverage_results
    )
    has_code_issues = any(not c.is_valid for c in code_results)

    passed_count = sum(1 for r in coverage_results if r.passed)
    failed_count = sum(1 for r in coverage_results if not r.passed)

    # Determine if human review is needed
    review_reasons: list[str] = []

    if has_failures:
        failed_rules = [r.rule_name for r in coverage_results if not r.passed]
        review_reasons.append(f"Coverage failures: {', '.join(failed_rules)}")

    if has_code_issues:
        bad_codes = [c.code for c in code_results if not c.is_valid]
        review_reasons.append(f"Invalid/incompatible codes: {', '.join(bad_codes)}")

    # High-value claim trigger
    total_amount = claim_json.billing_breakdown.total
    if total_amount > settings.HIGH_VALUE_THRESHOLD:
        review_reasons.append(
            f"High-value claim: ₹{total_amount} exceeds threshold ₹{settings.HIGH_VALUE_THRESHOLD}"
        )

    requires_human_review = len(review_reasons) > 0

    # ══════════════════════════════════════════════════════════════════
    # Save results to claim record
    # ══════════════════════════════════════════════════════════════════

    validation_results = {
        "policy_rules": policy_rules,
        "code_results": [c.model_dump() for c in code_results],
        "coverage_results": [r.model_dump() for r in coverage_results],
        "patient_summary": patient_summary,
        "insurer_snapshot": insurer_snapshot,
        "requires_human_review": requires_human_review,
        "review_reasons": review_reasons,
    }

    # Merge validation results into claim_json
    updated_json = claim.claim_json.copy() if claim.claim_json else {}
    updated_json["m2_validation"] = validation_results
    claim.claim_json = updated_json

    # Set claim status based on results
    if requires_human_review:
        claim.status = ClaimStatus.UNDER_HUMAN_REVIEW.value
    else:
        claim.status = ClaimStatus.ASSEMBLING_PACKAGE.value

    await db.flush()

    # ── Final SSE broadcast ───────────────────────────────────────────
    detail_msg = (
        f"Policy validation complete: {passed_count} passed, {failed_count} failed. "
        f"{'Requires human review.' if requires_human_review else 'Ready for M3 packaging.'}"
    )
    next_status = "UNDER_HUMAN_REVIEW" if requires_human_review else "ASSEMBLING_PACKAGE"

    await _broadcast_status(db, claim_id, next_status, detail_msg)

    await log_action(
        db, claim_id=claim_id, actor="system",
        action_type="m2_pipeline_complete", module="m2",
        details={
            "passed": passed_count,
            "failed": failed_count,
            "requires_human_review": requires_human_review,
        },
    )

    # ── Build response ────────────────────────────────────────────────
    return M2ValidationResponse(
        claim_id=claim_id,
        code_results=[c.model_dump() for c in code_results],
        coverage_results=[r.model_dump() for r in coverage_results],
        patient_summary=patient_summary,
        insurer_snapshot=insurer_snapshot,
        has_warnings=has_warnings,
        has_failures=has_failures,
        passed_count=passed_count,
        failed_count=failed_count,
        requires_human_review=requires_human_review,
        review_reasons=review_reasons,
    )


@router.get(
    "/coverage/{claim_id}",
    summary="Get cached validation results for a claim",
)
async def get_coverage(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return previously computed M2 validation results from the claim record."""
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()

    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")

    m2_data = (claim.claim_json or {}).get("m2_validation")
    if not m2_data:
        raise HTTPException(
            status_code=404,
            detail=f"No M2 validation results for claim {claim_id} — run POST /m2/validate/{claim_id} first",
        )

    return {"claim_id": claim_id, "validation": m2_data}


# ═══════════════════════════════════════════════════════════════════════
# Helper — SSE + StatusUpdate
# ═══════════════════════════════════════════════════════════════════════


async def _broadcast_status(
    db: AsyncSession,
    claim_id: str,
    status_value: str,
    detail: str,
) -> None:
    """Insert a StatusUpdate row and broadcast via SSE."""
    roles = ["patient", "hospital_staff", "insurer", "admin"]

    update = StatusUpdate(
        claim_id=claim_id,
        status=status_value,
        detail=detail,
        role_visibility=roles,
    )
    db.add(update)
    await db.flush()

    await sse_manager.broadcast(
        claim_id=claim_id,
        status=status_value,
        detail=detail,
        role_visibility=roles,
    )
