"""
M2 — Summary Generator (Step 3): Gemini-powered human-readable summaries.

Produces two summaries from the validation results:
    1. **Patient summary** — simple, jargon-free, specific to THIS claim.
    2. **Insurer snapshot** — audit-ready, structured, every rule listed.

The LLM is used ONLY for writing natural-language summaries from
already-computed deterministic results.  It has zero authority over
pass/fail outcomes.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import google.generativeai as genai

from shared.config import get_settings
from shared.schemas import ClaimJSON, CodeValidationResult, RuleResult

logger = logging.getLogger("claimsense.m2.summary_gen")
settings = get_settings()

genai.configure(api_key=settings.GEMINI_API_KEY)


# ═══════════════════════════════════════════════════════════════════════
# Prompt builders
# ═══════════════════════════════════════════════════════════════════════


def _build_patient_prompt(
    claim: ClaimJSON,
    code_results: list[CodeValidationResult],
    coverage_results: list[RuleResult],
) -> str:
    """Build the patient-facing summary prompt."""
    # Serialize results for the prompt
    coverage_data = [
        {
            "rule": r.rule_name,
            "passed": r.passed,
            "message": r.message,
            "details": r.details,
        }
        for r in coverage_results
    ]
    code_data = [
        {
            "code": c.code,
            "valid": c.is_valid,
            "warnings": c.warnings,
        }
        for c in code_results
        if not c.is_valid
    ]

    return f"""You are a claim assistance expert helping an Indian patient understand their health insurance claim.
Write a clear, simple summary for a patient who has never read an insurance policy.

CLAIM DETAILS:
- Patient: {claim.patient_name}
- Hospital: {claim.hospital_name}
- Admission: {claim.admission_date} to {claim.discharge_date}
- Total Bill: ₹{claim.billing_breakdown.total}
- Policy: {claim.policy_number}

COVERAGE CHECK RESULTS:
{json.dumps(coverage_data, indent=2, default=str)}

CODE ISSUES (if any):
{json.dumps(code_data, indent=2, default=str)}

INSTRUCTIONS:
1. Explain what is covered and what is not covered, and WHY.
2. State the exact co-pay amount in INR that the patient owes.
3. List any issues found and what they mean for the patient.
4. Use simple language — no medical or insurance jargon.
5. Use ₹ (INR) for all amounts.
6. Be specific to THIS claim — no generic advice.
7. Keep it under 300 words.
8. End with the immediate next step for the patient."""


def _build_insurer_prompt(
    claim: ClaimJSON,
    code_results: list[CodeValidationResult],
    coverage_results: list[RuleResult],
) -> str:
    """Build the insurer/adjudicator summary prompt."""
    coverage_data = [
        {
            "rule": r.rule_name,
            "status": "PASS" if r.passed else "FAIL",
            "message": r.message,
            "details": r.details,
        }
        for r in coverage_results
    ]
    code_data = [
        {
            "code": c.code,
            "valid": c.is_valid,
            "description": c.description,
            "warnings": c.warnings,
        }
        for c in code_results
    ]

    diagnosis_list = ", ".join(
        f"{d.code} ({d.description})" for d in claim.diagnosis_codes
    )
    procedure_list = ", ".join(
        f"{p.code} ({p.description})" for p in claim.procedure_codes
    )

    return f"""You are an insurance adjudicator writing a formal audit-ready summary.

CLAIM DETAILS:
- Claim Policy: {claim.policy_number}
- Patient: {claim.patient_name} (ID: {claim.patient_id})
- Hospital: {claim.hospital_name} (ID: {claim.hospital_id})
- Attending Doctor: {claim.doctor_name} (Reg: {claim.doctor_registration_number})
- Admission: {claim.admission_date} | Discharge: {claim.discharge_date}
- Diagnoses: {diagnosis_list}
- Procedures: {procedure_list}
- Total Billed: ₹{claim.billing_breakdown.total}
- Billing Breakdown: Room ₹{claim.billing_breakdown.room_charges}, ICU ₹{claim.billing_breakdown.icu_charges}, OT ₹{claim.billing_breakdown.ot_charges}, Medicines ₹{claim.billing_breakdown.medicines}, Diagnostics ₹{claim.billing_breakdown.diagnostics}, Other ₹{claim.billing_breakdown.other}

RULE-BY-RULE COVERAGE RESULTS:
{json.dumps(coverage_data, indent=2, default=str)}

CODE VALIDATION RESULTS:
{json.dumps(code_data, indent=2, default=str)}

INSTRUCTIONS:
1. List EVERY rule checked with its PASS/FAIL status.
2. Include relevant INR amounts for each check.
3. Flag any code compatibility issues.
4. Use a structured format with sections and bullet points.
5. Include a RECOMMENDATION at the end (approve / reject / needs review).
6. Be precise — this will be used in audit trails."""


# ═══════════════════════════════════════════════════════════════════════
# Generator functions
# ═══════════════════════════════════════════════════════════════════════


async def generate_patient_summary(
    claim_json: ClaimJSON,
    code_results: list[CodeValidationResult],
    coverage_results: list[RuleResult],
) -> str:
    """
    Generate a patient-friendly summary of the claim validation results.

    Uses Gemini 2.0 Flash to produce natural-language output from
    already-computed deterministic results.

    Returns
    -------
    str
        Human-readable summary for the patient.
    """
    if not settings.GEMINI_API_KEY:
        return _fallback_patient_summary(claim_json, coverage_results)

    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        prompt = _build_patient_prompt(claim_json, code_results, coverage_results)

        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                temperature=0.3,
                max_output_tokens=1024,
            ),
        )
        return response.text.strip()

    except Exception as exc:
        logger.error("Gemini patient summary failed: %s", exc)
        return _fallback_patient_summary(claim_json, coverage_results)


async def generate_insurer_snapshot(
    claim_json: ClaimJSON,
    code_results: list[CodeValidationResult],
    coverage_results: list[RuleResult],
) -> str:
    """
    Generate an audit-ready summary for the insurance adjudicator.

    Uses Gemini 2.0 Flash to produce structured output from
    already-computed deterministic results.

    Returns
    -------
    str
        Structured summary for insurer review.
    """
    if not settings.GEMINI_API_KEY:
        return _fallback_insurer_snapshot(claim_json, code_results, coverage_results)

    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        prompt = _build_insurer_prompt(claim_json, code_results, coverage_results)

        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                temperature=0.2,
                max_output_tokens=2048,
            ),
        )
        return response.text.strip()

    except Exception as exc:
        logger.error("Gemini insurer snapshot failed: %s", exc)
        return _fallback_insurer_snapshot(claim_json, code_results, coverage_results)


# ═══════════════════════════════════════════════════════════════════════
# Fallback summaries (when Gemini is unavailable)
# ═══════════════════════════════════════════════════════════════════════


def _fallback_patient_summary(
    claim: ClaimJSON, coverage: list[RuleResult]
) -> str:
    """Generate a basic patient summary without Gemini."""
    passed = sum(1 for r in coverage if r.passed)
    failed = sum(1 for r in coverage if not r.passed)

    # Find copay
    copay_msg = ""
    for r in coverage:
        if r.rule_name == "copay_calculation":
            copay_msg = r.message
            break

    lines = [
        f"## Claim Summary for {claim.patient_name}",
        f"",
        f"**Hospital:** {claim.hospital_name}",
        f"**Admission:** {claim.admission_date} to {claim.discharge_date}",
        f"**Total Bill:** ₹{claim.billing_breakdown.total}",
        f"**Policy:** {claim.policy_number}",
        f"",
        f"### Coverage Results",
        f"- ✅ {passed} checks passed",
        f"- ❌ {failed} checks failed or have warnings" if failed else f"- All checks passed!",
        f"",
    ]

    if copay_msg:
        lines.append(f"**{copay_msg}**")
        lines.append("")

    for r in coverage:
        if not r.passed:
            lines.append(f"- ⚠️ {r.message}")

    return "\n".join(lines)


def _fallback_insurer_snapshot(
    claim: ClaimJSON,
    codes: list[CodeValidationResult],
    coverage: list[RuleResult],
) -> str:
    """Generate a basic insurer snapshot without Gemini."""
    lines = [
        f"## Adjudicator Summary",
        f"",
        f"**Policy:** {claim.policy_number} | **Patient:** {claim.patient_name}",
        f"**Hospital:** {claim.hospital_name} | **Doctor:** {claim.doctor_name}",
        f"**Dates:** {claim.admission_date} to {claim.discharge_date}",
        f"**Total Billed:** ₹{claim.billing_breakdown.total}",
        f"",
        f"### Rule-by-Rule Results",
    ]
    for r in coverage:
        status = "✅ PASS" if r.passed else "❌ FAIL"
        lines.append(f"- [{status}] **{r.rule_name}**: {r.message}")

    lines.append("")
    lines.append("### Code Validation")
    invalid_codes = [c for c in codes if not c.is_valid]
    if invalid_codes:
        for c in invalid_codes:
            lines.append(f"- ⚠️ {c.code}: {', '.join(c.warnings)}")
    else:
        lines.append("- All codes validated successfully")

    return "\n".join(lines)
