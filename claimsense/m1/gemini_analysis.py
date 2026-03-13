"""
M1 — Gemini Claim Analysis (dual-output).

After document extraction, this module sends the full claim data + policy
details to Gemini and produces TWO outputs:
    Output A — Policyholder Summary (minimal)
    Output B — Insurer Detailed Report
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from google import genai
from google.genai import types as genai_types

from shared.config import get_settings

logger = logging.getLogger("claimsense.m1.analysis")
settings = get_settings()

MODEL = "gemini-2.0-flash"


# ── Gemini clients with fallback ─────────────────────────────────────

_client_primary = None
_client_backup = None


def _get_client() -> genai.Client:
    global _client_primary
    if _client_primary is None:
        api_key = settings.GEMINI_API_KEY
        if not api_key:
            raise ValueError("GEMINI_API_KEY not set")
        _client_primary = genai.Client(api_key=api_key)
    return _client_primary


def _get_backup_client() -> genai.Client:
    global _client_backup
    if _client_backup is None:
        api_key = settings.GEMINI_API_KEY_BACKUP
        if not api_key:
            raise ValueError("GEMINI_API_KEY_BACKUP not set")
        _client_backup = genai.Client(api_key=api_key)
    return _client_backup


# ── Analysis prompt ──────────────────────────────────────────────────

ANALYSIS_PROMPT = """You are an expert Indian health insurance claim analyst for ClaimSense.ai.

You are given:
1. Extracted claim data from uploaded medical documents
2. Policy details (coverage, limits, exclusions)
3. Claim type (reimbursement or cashless)

Analyze the claim and produce TWO outputs in a single JSON response.

Return ONLY valid JSON. No markdown backticks. No explanation.

{
  "policyholder_summary": {
    "outcome": "Likely to be Approved | Likely to be Rejected | Needs Further Review",
    "reason": "One-line plain English reason for the patient"
  },
  "insurer_report": {
    "patient_name": "string",
    "diagnosis": "string",
    "dates_of_hospitalisation": "admission to discharge",
    "total_claimed_amount": 0,
    "policy_coverage_limit": 0,
    "document_review": [
      {"document": "name", "status": "Found | Missing | Incomplete", "findings": "what was found"}
    ],
    "rule_checks": [
      {"rule": "name", "status": "PASS | FAIL | UNCLEAR", "detail": "explanation"}
    ],
    "red_flags": ["list of anomalies or issues detected"],
    "recommendation": "Approve | Reject | Investigate Further",
    "reasoning": "Detailed multi-line reasoning for the recommendation"
  }
}

IMPORTANT RULES:
- Be thorough in checking policy rules: coverage limits, waiting periods, exclusions, sub-limits, co-pay
- Flag any mismatch between documents (different patient names, dates, amounts)
- If mandatory documents are missing, note this clearly
- Base your recommendation on Indian insurance regulations (IRDAI guidelines)
- Always provide concrete numbers when comparing claim amount vs policy limit
"""


# ── Main analysis function ───────────────────────────────────────────

async def analyze_claim(
    claim_json: dict[str, Any],
    policy_details: dict[str, Any],
    claim_type: str = "reimbursement",
) -> dict[str, Any]:
    """
    Send claim data to Gemini for comprehensive analysis.

    Returns dict with keys: policyholder_summary, insurer_report.
    Uses primary key with backup fallback.
    """
    context = json.dumps({
        "claim_data": claim_json,
        "policy_details": policy_details,
        "claim_type": claim_type,
    }, indent=2, default=str)

    prompt_text = f"{ANALYSIS_PROMPT}\n\n--- CLAIM DATA ---\n{context}"

    try:
        return await _analyze_with_client(_get_client(), prompt_text)
    except Exception as primary_exc:
        logger.warning("Primary key failed for analysis: %s — trying backup", primary_exc)
        try:
            return await _analyze_with_client(_get_backup_client(), prompt_text)
        except Exception as backup_exc:
            logger.error("Both keys failed for analysis: %s, %s", primary_exc, backup_exc)
            return _fallback_analysis(claim_json, str(backup_exc))


async def _analyze_with_client(
    client: genai.Client,
    prompt_text: str,
) -> dict[str, Any]:
    """Run analysis with a specific Gemini client."""
    parts = [genai_types.Part.from_text(text=prompt_text)]

    response = client.models.generate_content(
        model=MODEL,
        contents=genai_types.Content(parts=parts),
    )
    raw = response.text.strip()
    parsed = _parse_json(raw)

    if parsed and "policyholder_summary" in parsed and "insurer_report" in parsed:
        logger.info("Gemini analysis completed successfully")
        return parsed

    # Retry with stricter instruction
    retry_parts = parts + [
        genai_types.Part.from_text(
            text=f"\n\nYour response:\n{raw}\n\nThis is NOT valid JSON or missing required keys. "
                 "Return ONLY the JSON with policyholder_summary and insurer_report keys."
        ),
    ]
    response2 = client.models.generate_content(
        model=MODEL,
        contents=genai_types.Content(parts=retry_parts),
    )
    parsed2 = _parse_json(response2.text.strip())
    if parsed2 and "policyholder_summary" in parsed2:
        return parsed2

    raise ValueError(f"Could not parse analysis response: {response2.text[:200]}")


def _fallback_analysis(claim_json: dict, error: str) -> dict[str, Any]:
    """Return a structured fallback when Gemini is completely unavailable."""
    return {
        "policyholder_summary": {
            "outcome": "Needs Further Review",
            "reason": "AI analysis is temporarily unavailable. Your claim will be reviewed manually.",
        },
        "insurer_report": {
            "patient_name": claim_json.get("patient_name", "Unknown"),
            "diagnosis": ", ".join(
                d.get("description", d.get("code", ""))
                for d in claim_json.get("diagnosis_codes", [])
            ) or "Not extracted",
            "dates_of_hospitalisation": f"{claim_json.get('admission_date', '?')} to {claim_json.get('discharge_date', '?')}",
            "total_claimed_amount": claim_json.get("total_amount", 0),
            "policy_coverage_limit": 0,
            "document_review": [],
            "rule_checks": [],
            "red_flags": [f"AI analysis failed: {error}"],
            "recommendation": "Investigate Further",
            "reasoning": "Automated analysis could not be completed. Manual review required.",
        },
        "ai_error": error,
    }


# ── JSON helper ──────────────────────────────────────────────────────

def _parse_json(text: str) -> Optional[dict]:
    cleaned = text
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None
