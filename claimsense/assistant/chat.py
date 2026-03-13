"""
ClaimSense.ai — GenAI-Powered Conversational Assistant.

Provides claim-specific chat grounded in the claim's actual data.
Each role sees different context depth:

* **patient**        — simplified coverage, co-pay, status
* **hospital_staff** — above + document checklist, pre-auth
* **insurer**        — everything + adjudicator summary, validation results

The assistant does NOT make decisions — it surfaces what the pipeline
already determined. No hallucination risk on coverage because it reports
M2's deterministic results, not its own analysis.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config import get_settings
from shared.models import Claim, Document, StatusUpdate, User

logger = logging.getLogger("claimsense.assistant")
settings = get_settings()


# ═══════════════════════════════════════════════════════════════════════
# build_claim_context
# ═══════════════════════════════════════════════════════════════════════

async def build_claim_context(
    claim_id: str,
    user_role: str,
    db: AsyncSession,
) -> str:
    """
    Fetch claim data from the DB and build a role-appropriate context string.

    ALL roles see
    ~~~~~~~~~~~~~
    * Claim status, patient name, hospital, dates
    * Document status
    * Current timeline

    patient sees (additionally)
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~
    * M2 patient_summary, coverage results (simplified), co-pay amount

    hospital_staff sees (additionally)
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    * Everything patient sees + document checklist, pre-auth status

    insurer sees (additionally)
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~
    * Everything + M2 insurer_snapshot, adjudicator summary, all validation
      results

    Parameters
    ----------
    claim_id : str
        Claim ID to build context for.
    user_role : str
        Current user's role.
    db : AsyncSession
        Active database session.

    Returns
    -------
    str
        Formatted context string with clear labeled sections.
    """
    # Fetch claim
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()

    if claim is None:
        return f"=== ERROR ===\nClaim {claim_id} not found in the system."

    claim_json = claim.claim_json or {}

    # Fetch patient info
    patient_result = await db.execute(select(User).where(User.id == claim.patient_id))
    patient = patient_result.scalar_one_or_none()

    # Fetch documents
    doc_result = await db.execute(
        select(Document).where(Document.claim_id == claim_id)
    )
    documents = doc_result.scalars().all()

    # Fetch timeline
    timeline_result = await db.execute(
        select(StatusUpdate)
        .where(StatusUpdate.claim_id == claim_id)
        .order_by(StatusUpdate.timestamp.asc())
    )
    timeline = timeline_result.scalars().all()

    # ── Build context sections ────────────────────────────────────────

    sections: list[str] = []

    # == CLAIM STATUS ==
    status_val = claim.status.value if hasattr(claim.status, "value") else str(claim.status)
    sections.append(
        f"=== CLAIM STATUS ===\n"
        f"Claim ID: {claim.id}\n"
        f"Current Status: {status_val}\n"
        f"Claim Type: {claim.claim_type.value if hasattr(claim.claim_type, 'value') else claim.claim_type}\n"
        f"Path: {claim.path.value if hasattr(claim.path, 'value') else claim.path}\n"
        f"Policy Number: {claim.policy_number or 'N/A'}\n"
        f"Total Amount: Rs. {claim.total_amount:,.2f}" if claim.total_amount else
        f"=== CLAIM STATUS ===\n"
        f"Claim ID: {claim.id}\n"
        f"Current Status: {status_val}\n"
        f"Claim Type: {claim.claim_type.value if hasattr(claim.claim_type, 'value') else claim.claim_type}\n"
        f"Path: {claim.path.value if hasattr(claim.path, 'value') else claim.path}\n"
        f"Policy Number: {claim.policy_number or 'N/A'}\n"
        f"Total Amount: Not yet calculated"
    )

    # == PATIENT INFO ==
    patient_name = claim_json.get("patient_name", "Unknown")
    hospital_name = claim_json.get("hospital_name", "Unknown")
    admission_date = claim_json.get("admission_date", "N/A")
    discharge_date = claim_json.get("discharge_date", "N/A")
    doctor_name = claim_json.get("doctor_name", "N/A")

    sections.append(
        f"=== PATIENT INFO ===\n"
        f"Patient Name: {patient_name}\n"
        f"Hospital: {hospital_name}\n"
        f"Admission Date: {admission_date}\n"
        f"Discharge Date: {discharge_date}\n"
        f"Doctor: {doctor_name}"
    )

    # == DOCUMENTS ==
    doc_section = "=== DOCUMENTS ===\n"
    if documents:
        for doc in documents:
            verified = "✓ Verified" if doc.is_verified else "○ Pending verification"
            doc_section += f"- {doc.doc_type}: {verified}\n"
    else:
        doc_section += "No documents uploaded yet.\n"

    # Also include document_status from claim_json if available
    doc_status = claim_json.get("document_status", {})
    if doc_status:
        doc_section += "\nDocument Checklist:\n"
        for doc_type, status_str in doc_status.items():
            icon = "✓" if status_str == "present" else "✗"
            doc_section += f"  {icon} {doc_type}: {status_str}\n"

    sections.append(doc_section.rstrip())

    # == TIMELINE ==
    timeline_section = "=== TIMELINE ===\n"
    if timeline:
        for entry in timeline:
            ts = entry.timestamp.strftime("%Y-%m-%d %H:%M") if entry.timestamp else "N/A"
            timeline_section += f"- [{ts}] {entry.status}: {entry.detail or ''}\n"
    else:
        timeline_section += "No status updates recorded yet.\n"
    sections.append(timeline_section.rstrip())

    # ── Role-specific additional context ──────────────────────────────

    if user_role in ("patient", "hospital_staff", "insurer", "admin"):
        # Coverage summary (from claim_json if M2 has run)
        coverage = claim_json.get("coverage_results", {})
        patient_summary = claim_json.get("patient_summary", {})

        coverage_section = "=== COVERAGE SUMMARY ===\n"
        if coverage:
            coverage_section += (
                f"Overall Eligible: {'Yes' if coverage.get('overall_eligible') else 'No'}\n"
                f"Eligible Amount: Rs. {coverage.get('eligible_amount', 'N/A')}\n"
                f"Co-Pay Amount: Rs. {coverage.get('co_pay_amount', 'N/A')}\n"
            )
            excluded = coverage.get("excluded_items", [])
            if excluded:
                coverage_section += f"Excluded Items: {', '.join(excluded)}\n"
        elif patient_summary:
            coverage_section += (
                f"Status: {patient_summary.get('status_detail', 'N/A')}\n"
                f"Eligible Amount: Rs. {patient_summary.get('eligible_amount', 'N/A')}\n"
                f"Co-Pay: Rs. {patient_summary.get('co_pay', 'N/A')}\n"
                f"Next Step: {patient_summary.get('next_step', 'N/A')}\n"
            )
        else:
            coverage_section += "Coverage validation has not been run yet.\n"
        sections.append(coverage_section.rstrip())

    if user_role in ("hospital_staff", "insurer", "admin"):
        # Document checklist detail + pre-auth status
        preauth_section = "=== PRE-AUTH & DOCUMENTS ===\n"
        preauth_section += f"Pre-Auth Number: {claim_json.get('pre_auth_number', 'Not available')}\n"

        # Diagnosis codes
        diag_codes = claim_json.get("diagnosis_codes", [])
        if diag_codes:
            preauth_section += "Diagnosis Codes:\n"
            for code in diag_codes:
                if isinstance(code, dict):
                    preauth_section += f"  - {code.get('code', 'N/A')}: {code.get('description', 'N/A')}\n"
                else:
                    preauth_section += f"  - {code}\n"

        # Procedure codes
        proc_codes = claim_json.get("procedure_codes", [])
        if proc_codes:
            preauth_section += "Procedure Codes:\n"
            for code in proc_codes:
                if isinstance(code, dict):
                    preauth_section += f"  - {code.get('code', 'N/A')}: {code.get('description', 'N/A')}\n"
                else:
                    preauth_section += f"  - {code}\n"
        sections.append(preauth_section.rstrip())

    if user_role in ("insurer", "admin"):
        # Full validation results + insurer snapshot
        insurer_section = "=== INSURER DETAILS ===\n"

        insurer_snapshot = claim_json.get("insurer_snapshot", {})
        if insurer_snapshot:
            insurer_section += (
                f"Flags: {', '.join(insurer_snapshot.get('flags', [])) or 'None'}\n"
            )

        # All rule results from coverage
        coverage = claim_json.get("coverage_results", {})
        rule_results = coverage.get("rule_results", [])
        if rule_results:
            insurer_section += "\nRule Validation Results:\n"
            for rule in rule_results:
                if isinstance(rule, dict):
                    passed = "✓ PASS" if rule.get("passed") else "✗ FAIL"
                    insurer_section += f"  {passed} — {rule.get('rule_name', 'N/A')}: {rule.get('message', '')}\n"

        code_validations = coverage.get("code_validations", [])
        if code_validations:
            insurer_section += "\nCode Validations:\n"
            for code_val in code_validations:
                if isinstance(code_val, dict):
                    valid = "✓ Valid" if code_val.get("is_valid") else "✗ Invalid"
                    insurer_section += f"  {valid} — {code_val.get('code', 'N/A')}: {code_val.get('description', '')}\n"
                    warnings = code_val.get("warnings", [])
                    for warn in warnings:
                        insurer_section += f"    ⚠ {warn}\n"

        # Adjudicator summary
        adjudicator = claim_json.get("adjudicator_summary", "")
        if adjudicator:
            insurer_section += f"\nAdjudicator Summary:\n{adjudicator}\n"

        review_reasons = coverage.get("review_reasons", [])
        if review_reasons:
            insurer_section += f"\nHuman Review Reasons: {', '.join(review_reasons)}\n"

        sections.append(insurer_section.rstrip())

    # ── Billing breakdown (all roles) ─────────────────────────────────
    billing = claim_json.get("billing_breakdown", {})
    if billing:
        billing_section = "=== BILLING BREAKDOWN ===\n"
        for key, value in billing.items():
            label = key.replace("_", " ").title()
            billing_section += f"{label}: Rs. {value}\n"
        sections.append(billing_section.rstrip())

    return "\n\n".join(sections)


# ═══════════════════════════════════════════════════════════════════════
# chat
# ═══════════════════════════════════════════════════════════════════════

async def chat(
    claim_id: str,
    user_message: str,
    user_role: str,
    conversation_history: list[dict[str, str]],
    db: AsyncSession,
) -> str:
    """
    Chat about a specific claim, grounded in its actual data.

    The assistant only reports what the pipeline has determined — it
    never re-computes coverage or makes up data.

    Parameters
    ----------
    claim_id : str
        Claim ID to chat about.
    user_message : str
        The user's current message.
    user_role : str
        Current user's role (controls context depth).
    conversation_history : list[dict]
        Previous messages in ``[{"role": "user"|"assistant", "content": "..."}]`` format.
    db : AsyncSession
        Active database session.

    Returns
    -------
    str
        The assistant's response text.
    """
    # 1. Build claim context
    claim_context = await build_claim_context(claim_id, user_role, db)

    # 2. System prompt
    system_prompt = (
        f"You are the ClaimSense.ai assistant helping with insurance claim {claim_id}.\n"
        f"Current user role: {user_role}\n"
        f"\n"
        f"RULES:\n"
        f"1. ONLY answer based on the claim data provided below. Do not make up information.\n"
        f"2. If the data doesn't contain the answer, say: 'I don't have that information for this claim.'\n"
        f"3. Never re-compute or change coverage decisions. Report exactly what the system determined.\n"
        f"4. For patients: use simple, clear language. Explain insurance terms if used.\n"
        f"5. For hospital staff: be professional and specific about document/process status.\n"
        f"6. For insurers: use technical language, reference specific codes and rule results.\n"
        f"7. Be concise. Answer the question directly, then offer to explain more if needed.\n"
        f"\n"
        f"CLAIM DATA:\n"
        f"{claim_context}"
    )

    # 3. Build message list for Gemini
    messages: list[dict[str, str]] = []

    # Add conversation history
    for msg in conversation_history:
        messages.append({
            "role": msg.get("role", "user"),
            "content": msg.get("content", ""),
        })

    # Add current user message
    messages.append({"role": "user", "content": user_message})

    # 4. Call Gemini 2.0 Flash
    try:
        response_text = await _call_gemini(system_prompt, messages)
    except Exception as exc:
        error_str = str(exc).lower()
        logger.error("Gemini API call failed for claim %s: %s", claim_id, exc)

        if "429" in str(exc) or "resource_exhausted" in error_str or "quota" in error_str:
            response_text = (
                "The AI service has temporarily exceeded its usage quota. "
                "Please try again in a minute or two. If this keeps happening, "
                "the API key may need a billing upgrade."
            )
        elif "401" in str(exc) or "403" in str(exc) or "invalid" in error_str or "api_key" in error_str:
            response_text = (
                "The AI service API key appears to be invalid or expired. "
                "Please check the GEMINI_API_KEY configuration."
            )
        elif "not found" in error_str or "404" in str(exc):
            response_text = (
                "The AI model could not be found. Please verify the model name is correct."
            )
        else:
            response_text = (
                f"I'm sorry, I encountered an error connecting to the AI service: "
                f"{type(exc).__name__}. Please try again in a moment."
            )

    return response_text


# ═══════════════════════════════════════════════════════════════════════
# Gemini API call (text model)
# ═══════════════════════════════════════════════════════════════════════

async def _call_gemini(
    system_prompt: str,
    messages: list[dict[str, str]],
) -> str:
    """
    Call Gemini 2.0 Flash with dual-key fallback.
    Tries primary key first, falls back to backup on any error.
    """
    primary_key = settings.GEMINI_API_KEY
    backup_key = getattr(settings, 'GEMINI_API_KEY_BACKUP', '')

    if not primary_key and not backup_key:
        logger.warning("No Gemini API keys configured.")
        return (
            "The AI assistant is not configured yet (missing API key). "
            "Please set the GEMINI_API_KEY environment variable."
        )

    # Try primary first, then backup
    keys_to_try = []
    if primary_key:
        keys_to_try.append(("primary", primary_key))
    if backup_key:
        keys_to_try.append(("backup", backup_key))

    last_error = None
    for key_name, api_key in keys_to_try:
        try:
            result = await _call_gemini_with_key(api_key, system_prompt, messages)
            logger.info("Gemini chat succeeded with %s key", key_name)
            return result
        except Exception as exc:
            logger.warning("Gemini chat failed with %s key: %s", key_name, exc)
            last_error = exc

    logger.error("All Gemini keys failed for chat. Last error: %s", last_error)
    raise last_error or ValueError("No Gemini API keys available")


async def _call_gemini_with_key(
    api_key: str,
    system_prompt: str,
    messages: list[dict[str, str]],
) -> str:
    """Call Gemini with a specific API key."""
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        # Build contents list for Gemini
        contents: list[types.Content] = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            contents.append(
                types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=msg["content"])],
                )
            )

        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.3,
                max_output_tokens=1024,
            ),
        )

        return response.text or "I couldn't generate a response. Please try rephrasing your question."

    except ImportError:
        logger.error("google-genai package not installed — pip install google-genai")
        return (
            "The AI assistant requires the google-genai package. "
            "Please install it: pip install google-genai"
        )

