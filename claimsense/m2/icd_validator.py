"""
M2 — ICD-10 & Procedure Code Validator (Step 2a).

Deterministic validation of diagnosis and procedure codes against
known-good databases.  Also checks for incompatible diagnosis–procedure
pairs that may indicate coding errors or fraud.

This module loads JSON data files at import time for fast lookups.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from shared.schemas import CodeValidationResult

logger = logging.getLogger("claimsense.m2.icd_validator")

# ═══════════════════════════════════════════════════════════════════════
# Load reference data at module level (singleton, loaded once)
# ═══════════════════════════════════════════════════════════════════════

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _load_json(filename: str) -> Any:
    """Load a JSON file from the data directory."""
    path = _DATA_DIR / filename
    if not path.exists():
        logger.warning("Data file not found: %s", path)
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ── ICD-10 codes ──────────────────────────────────────────────────────
_icd10_raw = _load_json("icd10_codes.json")
ICD10_CODES: dict[str, str] = {
    entry["code"]: entry["description"]
    for entry in (_icd10_raw.get("codes", []) if isinstance(_icd10_raw, dict) else _icd10_raw)
}

# ── Procedure codes ───────────────────────────────────────────────────
_proc_raw = _load_json("procedure_codes.json")
PROCEDURE_CODES: dict[str, str] = {
    entry["code"]: entry["description"]
    for entry in (_proc_raw.get("codes", []) if isinstance(_proc_raw, dict) else _proc_raw)
}

# ── Incompatible diagnosis–procedure pairs ────────────────────────────
_pairs_raw = _load_json("incompatible_pairs.json")
INCOMPATIBLE_PAIRS: list[dict[str, str]] = (
    _pairs_raw.get("pairs", []) if isinstance(_pairs_raw, dict) else _pairs_raw
)

logger.info(
    "Loaded %d ICD-10 codes, %d procedure codes, %d incompatible pairs",
    len(ICD10_CODES),
    len(PROCEDURE_CODES),
    len(INCOMPATIBLE_PAIRS),
)


# ═══════════════════════════════════════════════════════════════════════
# Validation functions
# ═══════════════════════════════════════════════════════════════════════


def validate_diagnosis_code(code: str) -> CodeValidationResult:
    """
    Check a single ICD-10 diagnosis code against the known database.

    Returns
    -------
    CodeValidationResult
        ``is_valid=True`` if the code exists, with its description.
    """
    code_upper = code.strip().upper()
    if code_upper in ICD10_CODES:
        return CodeValidationResult(
            code=code_upper,
            is_valid=True,
            description=ICD10_CODES[code_upper],
            warnings=[],
        )
    return CodeValidationResult(
        code=code_upper,
        is_valid=False,
        description="",
        warnings=[f"ICD-10 code '{code_upper}' not found in reference database"],
    )


def validate_procedure_code(code: str) -> CodeValidationResult:
    """
    Check a single procedure code against the known database.

    Returns
    -------
    CodeValidationResult
        ``is_valid=True`` if the code exists, with its description.
    """
    code_clean = code.strip()
    if code_clean in PROCEDURE_CODES:
        return CodeValidationResult(
            code=code_clean,
            is_valid=True,
            description=PROCEDURE_CODES[code_clean],
            warnings=[],
        )
    return CodeValidationResult(
        code=code_clean,
        is_valid=False,
        description="",
        warnings=[f"Procedure code '{code_clean}' not found in reference database"],
    )


def check_incompatible_pairs(
    diagnosis_codes: list[str],
    procedure_codes: list[str],
) -> list[CodeValidationResult]:
    """
    Check all diagnosis–procedure combinations against known incompatible pairs.

    Parameters
    ----------
    diagnosis_codes : list[str]
        Diagnosis codes from the claim.
    procedure_codes : list[str]
        Procedure codes from the claim.

    Returns
    -------
    list[CodeValidationResult]
        One entry per incompatible pair found, with ``is_valid=False``
        and the reason in ``warnings``.
    """
    results: list[CodeValidationResult] = []
    diag_set = {c.strip().upper() for c in diagnosis_codes}
    proc_set = {c.strip() for c in procedure_codes}

    for pair in INCOMPATIBLE_PAIRS:
        pair_diag = pair["diagnosis"].strip().upper()
        pair_proc = pair["procedure"].strip()

        if pair_diag in diag_set and pair_proc in proc_set:
            results.append(
                CodeValidationResult(
                    code=f"{pair_diag}+{pair_proc}",
                    is_valid=False,
                    description="Incompatible diagnosis-procedure pair",
                    warnings=[pair.get("reason", "Flagged as incompatible pair")],
                )
            )

    return results


def validate_codes(
    diagnosis_codes: list[dict[str, str]],
    procedure_codes: list[dict[str, str]],
) -> list[CodeValidationResult]:
    """
    Run the complete ICD-10 + procedure code validation pipeline.

    This is the main entry point called by the M2 router.

    Parameters
    ----------
    diagnosis_codes : list[dict]
        Each dict has ``code`` and ``description`` keys (from ClaimJSON).
    procedure_codes : list[dict]
        Each dict has ``code`` and ``description`` keys (from ClaimJSON).

    Returns
    -------
    list[CodeValidationResult]
        Combined results: individual validations + pair compatibility checks.
    """
    results: list[CodeValidationResult] = []

    # ── Validate individual diagnosis codes ───────────────────────────
    diag_code_strings: list[str] = []
    for entry in diagnosis_codes:
        code = entry.get("code", "")
        if code:
            diag_code_strings.append(code)
            result = validate_diagnosis_code(code)
            results.append(result)

    # ── Validate individual procedure codes ───────────────────────────
    proc_code_strings: list[str] = []
    for entry in procedure_codes:
        code = entry.get("code", "")
        if code:
            proc_code_strings.append(code)
            result = validate_procedure_code(code)
            results.append(result)

    # ── Check for incompatible pairs ──────────────────────────────────
    pair_results = check_incompatible_pairs(diag_code_strings, proc_code_strings)
    results.extend(pair_results)

    # ── Summary logging ───────────────────────────────────────────────
    valid_count = sum(1 for r in results if r.is_valid)
    invalid_count = sum(1 for r in results if not r.is_valid)
    logger.info(
        "Code validation complete: %d valid, %d invalid/flagged",
        valid_count,
        invalid_count,
    )

    return results
