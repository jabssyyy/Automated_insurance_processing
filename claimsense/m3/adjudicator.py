"""
M3 — Adjudicator Summary Generator.

Uses Gemini 2.0 Flash to produce a structured claim justification
document for the insurer's adjudication team.

The LLM summarises already-computed deterministic results — it has
zero authority over pass/fail outcomes.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import google.generativeai as genai

from shared.config import get_settings
from shared.schemas import ClaimJSON

logger = logging.getLogger("claimsense.m3.adjudicator")
settings = get_settings()

genai.configure(api_key=settings.GEMINI_API_KEY)


async def generate_adjudicator_summary(
    claim_json: ClaimJSON,
    m2_results: dict[str, Any],
) -> str:
    """
    Generate a structured adjudicator summary for the insurer.

    Parameters
    ----------
    claim_json : ClaimJSON
        The backbone claim data.
    m2_results : dict
        M2 validation results (coverage_results, code_results, etc.).

    Returns
    -------
    str
        Structured adjudicator summary.
    """
    if not settings.GEMINI_API_KEY:
        return _fallback_summary(claim_json, m2_results)

    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        prompt = _build_prompt(claim_json, m2_results)

        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                temperature=0.2,
                max_output_tokens=2048,
            ),
        )
        summary = response.text.strip()
        logger.info("Adjudicator summary generated (%d chars)", len(summary))
        return summary

    except Exception as exc:
        logger.error("Gemini adjudicator summary failed: %s", exc)
        return _fallback_summary(claim_json, m2_results)


def _build_prompt(claim: ClaimJSON, m2: dict[str, Any]) -> str:
    """Build the Gemini prompt for adjudicator summary generation."""
    diagnosis_list = ", ".join(
        f"{d.code} ({d.description})" for d in claim.diagnosis_codes
    )
    procedure_list = ", ".join(
        f"{p.code} ({p.description})" for p in claim.procedure_codes
    )

    coverage_data = json.dumps(
        m2.get("coverage_results", []), indent=2, default=str
    )
    code_data = json.dumps(
        m2.get("code_results", []), indent=2, default=str
    )

    return f"""You are writing a structured claim justification for an insurance adjudicator.
Based on the claim data and validation results below, generate a summary containing:

1. **Patient and Admission Overview** (1-2 sentences)
2. **Medically Necessary Services Identified** — list each service with justification
3. **Length of Stay Assessment** — compare against standard clinical norms for the primary procedure
4. **Guideline Alignment Statements** (e.g., "4-day stay for angioplasty is within standard cardiology guidelines")
5. **Coding Assessment** — list any ICD-10 or procedure code issues found
6. **Coverage Rule Results** — summarize PASS/FAIL/WARNING outcomes with INR amounts
7. **Recommendation** — based on the validation results, state whether this claim appears clean for processing

Write for a professional audience. Be specific with INR amounts. Use ₹ symbol.

CLAIM DATA:
- Patient: {claim.patient_name} (ID: {claim.patient_id})
- DOB: {claim.date_of_birth} | Gender: {claim.gender}
- Hospital: {claim.hospital_name} (ID: {claim.hospital_id})
- Doctor: {claim.doctor_name} (Reg: {claim.doctor_registration_number})
- Admission: {claim.admission_date} | Discharge: {claim.discharge_date}
- Policy: {claim.policy_number}
- Pre-Auth: {claim.pre_auth_number or "N/A"}
- Diagnoses: {diagnosis_list}
- Procedures: {procedure_list}

BILLING:
- Room: ₹{claim.billing_breakdown.room_charges}
- ICU: ₹{claim.billing_breakdown.icu_charges}
- OT: ₹{claim.billing_breakdown.ot_charges}
- Medicines: ₹{claim.billing_breakdown.medicines}
- Diagnostics: ₹{claim.billing_breakdown.diagnostics}
- Other: ₹{claim.billing_breakdown.other}
- TOTAL: ₹{claim.billing_breakdown.total}

COVERAGE RULE RESULTS:
{coverage_data}

CODE VALIDATION RESULTS:
{code_data}"""


def _fallback_summary(claim: ClaimJSON, m2: dict[str, Any]) -> str:
    """Generate a structured summary without Gemini."""
    coverage = m2.get("coverage_results", [])
    code_results = m2.get("code_results", [])

    passed = sum(1 for r in coverage if r.get("passed", True))
    failed = sum(1 for r in coverage if not r.get("passed", True))

    diagnosis_list = ", ".join(
        f"{d.code} ({d.description})" for d in claim.diagnosis_codes
    )
    procedure_list = ", ".join(
        f"{p.code} ({p.description})" for p in claim.procedure_codes
    )

    # Calculate LOS
    from datetime import datetime
    try:
        adm = datetime.strptime(claim.admission_date, "%Y-%m-%d")
        dis = datetime.strptime(claim.discharge_date, "%Y-%m-%d")
        los = (dis - adm).days
    except ValueError:
        los = "Unknown"

    lines = [
        "# Adjudicator Summary",
        "",
        "## 1. Patient and Admission Overview",
        f"Patient {claim.patient_name} (DOB: {claim.date_of_birth}, {claim.gender}) "
        f"was admitted to {claim.hospital_name} on {claim.admission_date} "
        f"and discharged on {claim.discharge_date} ({los} day stay).",
        "",
        "## 2. Medically Necessary Services",
        f"- Diagnoses: {diagnosis_list}",
        f"- Procedures: {procedure_list}",
        "",
        "## 3. Length of Stay Assessment",
        f"- Length of stay: {los} days",
        f"- Attending physician: {claim.doctor_name} (Reg: {claim.doctor_registration_number})",
        "",
        "## 4. Billing Summary",
        f"- Room: ₹{claim.billing_breakdown.room_charges}",
        f"- ICU: ₹{claim.billing_breakdown.icu_charges}",
        f"- OT: ₹{claim.billing_breakdown.ot_charges}",
        f"- Medicines: ₹{claim.billing_breakdown.medicines}",
        f"- Diagnostics: ₹{claim.billing_breakdown.diagnostics}",
        f"- Other: ₹{claim.billing_breakdown.other}",
        f"- **Total: ₹{claim.billing_breakdown.total}**",
        "",
        "## 5. Coding Assessment",
    ]

    invalid_codes = [c for c in code_results if not c.get("is_valid", True)]
    if invalid_codes:
        for c in invalid_codes:
            lines.append(f"- ⚠️ {c['code']}: {', '.join(c.get('warnings', []))}")
    else:
        lines.append("- All ICD-10 and procedure codes validated successfully.")

    lines.extend([
        "",
        "## 6. Coverage Rule Results",
    ])
    for r in coverage:
        status = "✅ PASS" if r.get("passed") else "❌ FAIL"
        lines.append(f"- [{status}] **{r.get('rule_name', 'N/A')}**: {r.get('message', '')}")

    lines.extend([
        "",
        f"## 7. Recommendation",
        f"Coverage checks: {passed} passed, {failed} failed.",
    ])

    if failed == 0 and not invalid_codes:
        lines.append("**Recommendation: APPROVE** — Claim appears clean for processing.")
    elif failed > 0:
        lines.append("**Recommendation: REVIEW REQUIRED** — Coverage failures detected.")
    else:
        lines.append("**Recommendation: REVIEW REQUIRED** — Code issues detected.")

    return "\n".join(lines)
