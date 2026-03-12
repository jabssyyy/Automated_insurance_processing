"""
Doc Check — Early document completeness check (Path B only).

Catches missing documents immediately after upload, before any
downstream processing begins.  This is an intentional architectural
gate: telling the patient about missing docs HERE saves them from
waiting through validation before discovering the gap.
"""

from __future__ import annotations

from typing import Any


# ═══════════════════════════════════════════════════════════════════════
# Required documents per claim type
# ═══════════════════════════════════════════════════════════════════════

REQUIRED_DOCS: dict[str, list[str]] = {
    "inpatient": [
        "discharge_summary",
        "hospital_bill",
        "id_proof",
        "policy_document",
        "prescription",
    ],
    "daycare": [
        "hospital_bill",
        "id_proof",
        "policy_document",
        "procedure_report",
    ],
    "icu": [
        "discharge_summary",
        "hospital_bill",
        "id_proof",
        "policy_document",
        "prescription",
        "icu_notes",
    ],
}


# ═══════════════════════════════════════════════════════════════════════
# Human-readable display names
# ═══════════════════════════════════════════════════════════════════════

DOCUMENT_DISPLAY_NAMES: dict[str, str] = {
    "discharge_summary": "Discharge Summary",
    "hospital_bill": "Hospital Bill",
    "id_proof": "ID Proof",
    "policy_document": "Policy Document",
    "prescription": "Prescription",
    "lab_report": "Lab Report",
    "icu_notes": "ICU Notes",
    "procedure_report": "Procedure Report",
}


def _display_name(doc_key: str) -> str:
    """Convert a snake_case doc key to its human-readable display name."""
    return DOCUMENT_DISPLAY_NAMES.get(
        doc_key,
        doc_key.replace("_", " ").title(),
    )


# ═══════════════════════════════════════════════════════════════════════
# Completeness checker
# ═══════════════════════════════════════════════════════════════════════

def check_completeness(
    claim_json: dict[str, Any],
    claim_type: str,
) -> dict[str, Any]:
    """
    Compare uploaded documents against the required set for *claim_type*.

    Parameters
    ----------
    claim_json : dict
        The merged ClaimJSON stored on Claim.claim_json.
        Expected to contain ``extracted_doc_types`` — a list of document
        type keys that were successfully extracted by M1.
    claim_type : str
        One of ``"inpatient"``, ``"daycare"``, ``"icu"``.

    Returns
    -------
    dict
        ``complete``           — bool, True when every required doc is present.
        ``missing_documents``  — list of human-readable names for missing docs.
        ``present_documents``  — list of human-readable names for present docs.
        ``claim_type``         — the claim type that was checked against.
    """
    claim_type_lower = claim_type.lower()
    required = REQUIRED_DOCS.get(claim_type_lower, [])

    # Documents that M1 successfully extracted (stored as snake_case keys)
    extracted: list[str] = claim_json.get("extracted_doc_types", []) if claim_json else []
    extracted_set = set(extracted)

    missing: list[str] = []
    present: list[str] = []

    for doc_key in required:
        if doc_key in extracted_set:
            present.append(_display_name(doc_key))
        else:
            missing.append(_display_name(doc_key))

    return {
        "complete": len(missing) == 0,
        "missing_documents": missing,
        "present_documents": present,
        "claim_type": claim_type_lower,
    }
