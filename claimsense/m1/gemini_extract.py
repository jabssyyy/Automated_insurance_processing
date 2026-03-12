"""
M1 DocTriage — Gemini 2.0 Flash Document Extraction.

Reads any document format (PDF, scanned, handwritten, regional languages)
via Gemini 2.0 Flash Vision API and returns structured JSON.

No OCR libraries — Gemini handles everything in one API call.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

from google import genai
from google.genai import types as genai_types

from shared.config import get_settings

logger = logging.getLogger("claimsense.m1.extract")
settings = get_settings()

# ── Gemini client ─────────────────────────────────────────────────────────────

_client = None
MODEL = "gemini-2.0-flash"


def _get_client() -> genai.Client:
    """Lazy-init the Gemini client so the module imports even without an API key."""
    global _client
    if _client is None:
        api_key = settings.GEMINI_API_KEY
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not set. Configure it in .env.")
        _client = genai.Client(api_key=api_key)
    return _client

# ── Extraction prompt ─────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """You are a medical document data extractor for Indian health insurance claims.
Read this document and extract ALL information into the following JSON structure.
Return ONLY valid JSON. No markdown backticks. No explanation.
If a field is not found in the document, set it to null.

{
  "document_type": "one of: discharge_summary, prescription, lab_report, hospital_bill, id_proof, policy_document, other",
  "patient_name": "string",
  "patient_id": "string or null",
  "date_of_birth": "YYYY-MM-DD or null",
  "gender": "M/F/Other or null",
  "hospital_name": "string or null",
  "hospital_id": "string or null",
  "admission_date": "YYYY-MM-DD or null",
  "discharge_date": "YYYY-MM-DD or null",
  "diagnosis_codes": [{"code": "ICD-10 code", "description": "diagnosis name"}],
  "procedure_codes": [{"code": "procedure code", "description": "procedure name"}],
  "billing_items": [{"item_name": "string", "amount": 0, "category": "room/icu/ot/medicines/diagnostics/other"}],
  "total_amount": 0,
  "doctor_name": "string or null",
  "doctor_registration_number": "string or null"
}"""

STRICT_RETRY_PROMPT = """The previous response was not valid JSON. Please re-read the document.
Return ONLY a single valid JSON object matching this exact schema. No backticks. No explanation.
Ensure all keys are present even if the values are null."""


# ── Helper: read file bytes ───────────────────────────────────────────────────

def _read_file(file_path: str) -> bytes:
    with open(file_path, "rb") as f:
        return f.read()


def _guess_mime(mime_type: str) -> str:
    """Normalise common MIME types."""
    mapping = {
        "image/jpg": "image/jpeg",
    }
    return mapping.get(mime_type, mime_type)


# ── Main extraction function ──────────────────────────────────────────────────

async def extract_from_document(
    file_path: str,
    mime_type: str,
) -> dict[str, Any]:
    """
    Send a document to Gemini 2.0 Flash and return parsed structured data.

    - PDFs: uploaded via genai file upload
    - Images: sent as inline bytes

    If JSON parsing fails on the first attempt, retries with a stricter prompt.

    Returns
    -------
    dict
        Parsed JSON matching the extraction schema.

    Raises
    ------
    ValueError
        If Gemini response cannot be parsed as JSON after two attempts.
    """
    mime_type = _guess_mime(mime_type)
    file_bytes = _read_file(file_path)

    try:
        # Build the content parts
        if mime_type == "application/pdf":
            # Upload PDF to Gemini for processing
            uploaded_file = _get_client().files.upload(
                file=file_path,
                config=genai_types.UploadFileConfig(mime_type=mime_type),
            )
            parts = [
                genai_types.Part.from_uri(
                    file_uri=uploaded_file.uri,
                    mime_type=mime_type,
                ),
                genai_types.Part.from_text(text=EXTRACTION_PROMPT),
            ]
        else:
            # Images: send as inline bytes
            parts = [
                genai_types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
                genai_types.Part.from_text(text=EXTRACTION_PROMPT),
            ]

        # First attempt
        response = _get_client().models.generate_content(
            model=MODEL,
            contents=genai_types.Content(parts=parts),
        )
        raw_text = response.text.strip()
        parsed = _parse_json(raw_text)

        if parsed is not None:
            logger.info("Gemini extraction succeeded on first attempt for %s", file_path)
            return parsed

        # Retry with stricter prompt
        logger.warning("First extraction parse failed for %s, retrying with strict prompt", file_path)
        retry_parts = parts + [
            genai_types.Part.from_text(text=f"\n\nYour previous response:\n{raw_text}\n\n{STRICT_RETRY_PROMPT}"),
        ]
        response2 = _get_client().models.generate_content(
            model=MODEL,
            contents=genai_types.Content(parts=retry_parts),
        )
        raw_text2 = response2.text.strip()
        parsed2 = _parse_json(raw_text2)

        if parsed2 is not None:
            logger.info("Gemini extraction succeeded on retry for %s", file_path)
            return parsed2

        raise ValueError(f"Could not parse Gemini response as JSON after 2 attempts: {raw_text2[:200]}")

    except ValueError:
        raise
    except Exception as exc:
        logger.error("Gemini extraction error for %s: %s", file_path, exc)
        raise ValueError(f"Gemini API error: {exc}") from exc


# ── JSON parsing helper ───────────────────────────────────────────────────────

def _parse_json(text: str) -> Optional[dict]:
    """
    Try to parse text as JSON. Strips markdown backticks if present.
    Returns None if parsing fails.
    """
    # Remove markdown code fences if Gemini wraps the response
    cleaned = text
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        # Remove first and last lines (```json and ```)
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None
