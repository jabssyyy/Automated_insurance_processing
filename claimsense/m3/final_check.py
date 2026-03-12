"""
M3 — Final Completeness Check.

Last-chance safety gate before FHIR packaging.  Re-evaluates document
completeness against the *evolved* claim — fields that didn't exist at
initial upload may now be required based on billing data or claim type.

Example: if ICU charges appear in ``billing_breakdown`` but the claim
type was ``inpatient``, ICU admission notes are now required.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

from shared.schemas import ClaimJSON

logger = logging.getLogger("claimsense.m3.final_check")

# ═══════════════════════════════════════════════════════════════════════
# Required documents by claim type
# ═══════════════════════════════════════════════════════════════════════

BASE_REQUIRED_DOCS = [
    "discharge_summary",
    "hospital_bill",
    "id_proof",
]

TYPE_SPECIFIC_DOCS: dict[str, list[str]] = {
    "inpatient": ["admission_form", "treating_doctor_certificate"],
    "daycare": ["daycare_procedure_note"],
    "icu": ["icu_admission_notes", "icu_chart", "treating_doctor_certificate"],
}


# ═══════════════════════════════════════════════════════════════════════
# Main function
# ═══════════════════════════════════════════════════════════════════════


def final_completeness_check(
    claim_json: ClaimJSON,
    claim_type: str = "inpatient",
) -> dict[str, Any]:
    """
    Run a final completeness check that considers claim evolution.

    Unlike the early doc check, this accounts for fields that became
    relevant during the pipeline (e.g. ICU charges discovered, OT used).

    Parameters
    ----------
    claim_json : ClaimJSON
        The current claim data.
    claim_type : str
        Claim type (inpatient / daycare / icu).

    Returns
    -------
    dict
        ``{"complete": bool, "newly_required": list[str]}``
    """
    present_docs = set()
    missing_docs: list[str] = []
    newly_required: list[str] = []

    # Build set of present documents
    for doc_type, status in claim_json.document_status.items():
        if status == "present":
            present_docs.add(doc_type.lower().strip())

    # ── Check base required documents ─────────────────────────────────
    for doc in BASE_REQUIRED_DOCS:
        if doc not in present_docs:
            missing_docs.append(doc)

    # ── Check type-specific documents ─────────────────────────────────
    type_docs = TYPE_SPECIFIC_DOCS.get(claim_type.lower(), [])
    for doc in type_docs:
        if doc not in present_docs:
            missing_docs.append(doc)

    # ═══════════════════════════════════════════════════════════════════
    # Claim-evolution checks — newly required based on billing data
    # ═══════════════════════════════════════════════════════════════════

    billing = claim_json.billing_breakdown

    # ── ICU charges present but no ICU notes ──────────────────────────
    if billing.icu_charges > Decimal("0"):
        if "icu_admission_notes" not in present_docs:
            newly_required.append("icu_admission_notes")
        if "icu_chart" not in present_docs:
            newly_required.append("icu_chart")

    # ── OT charges present but no OT notes ────────────────────────────
    if billing.ot_charges > Decimal("0"):
        if "operation_notes" not in present_docs:
            newly_required.append("operation_notes")
        if "anaesthesia_notes" not in present_docs:
            newly_required.append("anaesthesia_notes")

    # ── Diagnostics charges but no investigation reports ──────────────
    if billing.diagnostics > Decimal("0"):
        if "investigation_reports" not in present_docs:
            newly_required.append("investigation_reports")

    # ── High medicine charges (>₹50,000) need itemized prescription ───
    if billing.medicines > Decimal("50000"):
        if "itemized_prescription" not in present_docs:
            newly_required.append("itemized_prescription")

    # ── Pre-auth present → pre-auth letter needed ─────────────────────
    if claim_json.pre_auth_number:
        if "pre_auth_letter" not in present_docs:
            newly_required.append("pre_auth_letter")

    # ── Multiple procedures → each needs an operation note ────────────
    if len(claim_json.procedure_codes) > 1:
        if "operation_notes" not in present_docs:
            if "operation_notes" not in newly_required:
                newly_required.append("operation_notes")

    # Combine all missing
    all_missing = list(set(missing_docs + newly_required))
    is_complete = len(all_missing) == 0

    logger.info(
        "Final completeness check: complete=%s, missing=%d, newly_required=%d",
        is_complete, len(missing_docs), len(newly_required),
    )

    return {
        "complete": is_complete,
        "missing_base_docs": missing_docs,
        "newly_required": newly_required,
        "all_missing": all_missing,
    }
