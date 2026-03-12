"""
M2 — Policy Parser: Gemini-powered policy PDF extraction with caching.

Reads an Indian health insurance policy PDF via Gemini 2.0 Flash and
extracts all coverage rules into a structured JSON.  Results are cached
in the ``PolicyCache`` table so the same policy is never re-parsed.

This is **Step 1** of the M2 pipeline.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

import google.generativeai as genai
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config import get_settings
from shared.models import PolicyCache

logger = logging.getLogger("claimsense.m2.policy_parser")
settings = get_settings()

# ── Configure Gemini ──────────────────────────────────────────────────
genai.configure(api_key=settings.GEMINI_API_KEY)

# ── Extraction prompt ─────────────────────────────────────────────────
POLICY_EXTRACTION_PROMPT = """You are an insurance policy analyzer specializing in Indian health insurance.
Read this policy document and extract ALL coverage rules into the following JSON structure.
Return ONLY valid JSON — no markdown, no explanation, no extra text.

{
  "room_rent_limit_per_day": <number in INR or null if no limit>,
  "waiting_period_days": <number of days>,
  "excluded_procedures": ["list of excluded procedure names"],
  "excluded_conditions": ["list of excluded condition names"],
  "copay_percentage": <number, e.g. 10 for 10%>,
  "sub_limit_icu_per_day": <number in INR or null if no sub-limit>,
  "sub_limit_ot": <number in INR or null if no sub-limit>,
  "is_cashless_eligible": <boolean>,
  "requires_pre_auth": <boolean>,
  "sum_insured": <number in INR>,
  "daycare_procedures_covered": ["list of covered daycare procedure names"],
  "policy_start_date": "YYYY-MM-DD",
  "policy_end_date": "YYYY-MM-DD"
}

Extract every field carefully. If a value is not specified in the document,
use null for numbers and empty arrays for lists. Dates must be ISO format."""


# ── Default rules (used when no policy file or Gemini unavailable) ────
DEFAULT_POLICY_RULES: dict[str, Any] = {
    "room_rent_limit_per_day": 5000,
    "waiting_period_days": 30,
    "excluded_procedures": ["cosmetic surgery", "dental treatment", "infertility treatment"],
    "excluded_conditions": [
        "pre-existing conditions within waiting period",
        "self-inflicted injuries",
        "substance abuse related conditions",
    ],
    "copay_percentage": 10,
    "sub_limit_icu_per_day": 10000,
    "sub_limit_ot": 50000,
    "is_cashless_eligible": True,
    "requires_pre_auth": True,
    "sum_insured": 500000,
    "daycare_procedures_covered": [
        "cataract surgery",
        "dialysis",
        "chemotherapy",
        "radiotherapy",
        "lithotripsy",
    ],
    "policy_start_date": "2025-04-01",
    "policy_end_date": "2026-03-31",
}


async def parse_policy(
    policy_file_path: Optional[str],
    policy_number: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """
    Parse an insurance policy PDF and return structured rules.

    Pipeline:
        1. Check ``PolicyCache`` — return immediately if cached.
        2. If not cached and a file is provided, send to Gemini 2.0 Flash.
        3. Parse Gemini's JSON response.
        4. Cache the result in ``PolicyCache``.
        5. Return the rules dict.

    Parameters
    ----------
    policy_file_path : str or None
        Absolute path to the policy PDF file.  If ``None`` or the file
        does not exist, default rules are returned.
    policy_number : str
        Unique policy identifier used as the cache key.
    db : AsyncSession
        Active database session.

    Returns
    -------
    dict[str, Any]
        Parsed policy rules.
    """
    # ── Step 1: check cache ───────────────────────────────────────────
    cached = await db.execute(
        select(PolicyCache).where(PolicyCache.policy_number == policy_number)
    )
    cached_entry = cached.scalar_one_or_none()
    if cached_entry and cached_entry.rules_json:
        logger.info("PolicyCache hit for %s", policy_number)
        return cached_entry.rules_json

    # ── Step 2: attempt Gemini extraction ─────────────────────────────
    rules = await _extract_with_gemini(policy_file_path)

    # ── Step 3: cache the result ──────────────────────────────────────
    if cached_entry:
        cached_entry.rules_json = rules
    else:
        new_cache = PolicyCache(policy_number=policy_number, rules_json=rules)
        db.add(new_cache)
    await db.flush()

    logger.info("Cached policy rules for %s", policy_number)
    return rules


async def _extract_with_gemini(file_path: Optional[str]) -> dict[str, Any]:
    """
    Send the policy PDF to Gemini 2.0 Flash and parse the response.

    Falls back to ``DEFAULT_POLICY_RULES`` if:
    - No file path provided
    - File does not exist
    - Gemini API key is not set
    - Gemini returns unparseable output
    """
    if not file_path or not Path(file_path).exists():
        logger.warning("No policy file at '%s' — using default rules", file_path)
        return DEFAULT_POLICY_RULES.copy()

    if not settings.GEMINI_API_KEY:
        logger.warning("GEMINI_API_KEY not set — using default rules")
        return DEFAULT_POLICY_RULES.copy()

    try:
        # Upload the file to Gemini
        uploaded = genai.upload_file(file_path, mime_type="application/pdf")

        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(
            [uploaded, POLICY_EXTRACTION_PROMPT],
            generation_config=genai.GenerationConfig(
                temperature=0.1,  # Low temperature for factual extraction
                max_output_tokens=4096,
            ),
        )

        # Parse JSON from response
        raw_text = response.text.strip()

        # Strip markdown code fences if present
        if raw_text.startswith("```"):
            lines = raw_text.split("\n")
            # Remove first and last lines (```json and ```)
            lines = [l for l in lines if not l.strip().startswith("```")]
            raw_text = "\n".join(lines)

        rules = json.loads(raw_text)
        logger.info("Successfully extracted policy rules via Gemini")
        return rules

    except json.JSONDecodeError as exc:
        logger.error("Gemini returned invalid JSON: %s", exc)
        return DEFAULT_POLICY_RULES.copy()
    except Exception as exc:
        logger.error("Gemini extraction failed: %s", exc)
        return DEFAULT_POLICY_RULES.copy()
