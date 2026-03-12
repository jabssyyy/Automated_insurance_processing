"""
M2 — Coverage Engine: Deterministic Python policy validation (Step 2b).

╔══════════════════════════════════════════════════════════════════════╗
║  CRITICAL DESIGN RULE:                                              ║
║  This module contains ZERO LLM calls.  Every pass/fail decision is  ║
║  pure Python if-else logic.  LLMs hallucinate — a wrong coverage    ║
║  decision has real financial and regulatory consequences.            ║
╚══════════════════════════════════════════════════════════════════════╝

Each check is independent and returns a ``RuleResult``.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from shared.schemas import ClaimJSON, RuleResult

logger = logging.getLogger("claimsense.m2.coverage_engine")


# ═══════════════════════════════════════════════════════════════════════
# Helper — safe date parsing
# ═══════════════════════════════════════════════════════════════════════


def _parse_date(date_str: str) -> Optional[date]:
    """Parse an ISO date string, returning None on failure."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


# ═══════════════════════════════════════════════════════════════════════
# Individual rule checks — each returns a RuleResult
# ═══════════════════════════════════════════════════════════════════════


def _policy_active_check(
    claim: ClaimJSON, rules: dict[str, Any]
) -> RuleResult:
    """Check that the admission date falls within the policy validity period."""
    admission = _parse_date(claim.admission_date)
    policy_start = _parse_date(rules.get("policy_start_date", ""))
    policy_end = _parse_date(rules.get("policy_end_date", ""))

    if not admission:
        return RuleResult(
            rule_name="policy_active_check",
            passed=False,
            message="Cannot parse admission date",
            details={"admission_date": claim.admission_date},
        )
    if not policy_start or not policy_end:
        return RuleResult(
            rule_name="policy_active_check",
            passed=True,
            message="Policy dates not specified — assumed active",
            details={},
        )
    if policy_start <= admission <= policy_end:
        return RuleResult(
            rule_name="policy_active_check",
            passed=True,
            message=f"Policy active: admission {admission} is between {policy_start} and {policy_end}",
            details={
                "admission_date": str(admission),
                "policy_start": str(policy_start),
                "policy_end": str(policy_end),
            },
        )
    return RuleResult(
        rule_name="policy_active_check",
        passed=False,
        message=f"Policy NOT active on admission date {admission} (valid {policy_start} to {policy_end})",
        details={
            "admission_date": str(admission),
            "policy_start": str(policy_start),
            "policy_end": str(policy_end),
        },
    )


def _waiting_period_check(
    claim: ClaimJSON, rules: dict[str, Any]
) -> RuleResult:
    """Check the waiting period has elapsed since policy start."""
    admission = _parse_date(claim.admission_date)
    policy_start = _parse_date(rules.get("policy_start_date", ""))
    waiting_days = rules.get("waiting_period_days", 0) or 0

    if not admission or not policy_start:
        return RuleResult(
            rule_name="waiting_period_check",
            passed=True,
            message="Cannot verify waiting period — dates missing, assumed ok",
            details={},
        )

    elapsed = (admission - policy_start).days
    if elapsed >= waiting_days:
        return RuleResult(
            rule_name="waiting_period_check",
            passed=True,
            message=f"Waiting period satisfied: {elapsed} days elapsed (required: {waiting_days})",
            details={"elapsed_days": elapsed, "required_days": waiting_days},
        )
    return RuleResult(
        rule_name="waiting_period_check",
        passed=False,
        message=f"Waiting period NOT met: only {elapsed} days elapsed (required: {waiting_days})",
        details={"elapsed_days": elapsed, "required_days": waiting_days},
    )


def _exclusion_check(
    claim: ClaimJSON, rules: dict[str, Any]
) -> RuleResult:
    """Check that no diagnosis or procedure is in the policy exclusion lists."""
    excluded_procedures = [p.lower() for p in rules.get("excluded_procedures", [])]
    excluded_conditions = [c.lower() for c in rules.get("excluded_conditions", [])]

    excluded_found: list[str] = []

    # Check diagnosis descriptions against excluded conditions
    for diag in claim.diagnosis_codes:
        desc_lower = diag.description.lower()
        for exc in excluded_conditions:
            if exc in desc_lower or desc_lower in exc:
                excluded_found.append(f"Condition: {diag.description} (matched '{exc}')")

    # Check procedure descriptions against excluded procedures
    for proc in claim.procedure_codes:
        desc_lower = proc.description.lower()
        for exc in excluded_procedures:
            if exc in desc_lower or desc_lower in exc:
                excluded_found.append(f"Procedure: {proc.description} (matched '{exc}')")

    if not excluded_found:
        return RuleResult(
            rule_name="exclusion_check",
            passed=True,
            message="No excluded conditions or procedures found",
            details={"excluded_count": 0},
        )
    return RuleResult(
        rule_name="exclusion_check",
        passed=False,
        message=f"Found {len(excluded_found)} excluded item(s)",
        details={"excluded_items": excluded_found},
    )


def _room_rent_check(
    claim: ClaimJSON, rules: dict[str, Any]
) -> RuleResult:
    """Check room charges against per-day room rent limit."""
    limit = rules.get("room_rent_limit_per_day")
    if not limit:
        return RuleResult(
            rule_name="room_rent_check",
            passed=True,
            message="No room rent limit specified in policy",
            details={},
        )

    limit = Decimal(str(limit))
    room_charges = claim.billing_breakdown.room_charges

    # Calculate length of stay
    admission = _parse_date(claim.admission_date)
    discharge = _parse_date(claim.discharge_date)
    if not admission or not discharge:
        return RuleResult(
            rule_name="room_rent_check",
            passed=True,
            message="Cannot calculate LOS — dates missing",
            details={},
        )

    los_days = max((discharge - admission).days, 1)
    daily_room_cost = room_charges / los_days
    max_allowed = limit * los_days

    if daily_room_cost <= limit:
        return RuleResult(
            rule_name="room_rent_check",
            passed=True,
            message=f"Room rent within limit: ₹{daily_room_cost:.0f}/day vs ₹{limit:.0f}/day limit",
            details={
                "daily_cost_inr": float(daily_room_cost),
                "limit_per_day_inr": float(limit),
                "los_days": los_days,
                "total_room_charges_inr": float(room_charges),
            },
        )
    excess = room_charges - max_allowed
    return RuleResult(
        rule_name="room_rent_check",
        passed=False,  # WARNING — over limit, excess is patient's liability
        message=f"Room rent EXCEEDS limit: ₹{daily_room_cost:.0f}/day vs ₹{limit:.0f}/day. Excess ₹{excess:.0f} is patient liability.",
        details={
            "daily_cost_inr": float(daily_room_cost),
            "limit_per_day_inr": float(limit),
            "los_days": los_days,
            "excess_inr": float(excess),
            "total_room_charges_inr": float(room_charges),
        },
    )


def _copay_calculation(
    claim: ClaimJSON, rules: dict[str, Any]
) -> RuleResult:
    """Calculate co-pay amount — always returns the amounts."""
    copay_pct = Decimal(str(rules.get("copay_percentage", 0) or 0))
    total = claim.billing_breakdown.total

    copay_amount = total * copay_pct / Decimal("100")
    insurer_liability = total - copay_amount

    return RuleResult(
        rule_name="copay_calculation",
        passed=True,  # Informational — co-pay is not a failure
        message=f"Co-pay: {copay_pct}% = ₹{copay_amount:.0f} patient liability. Insurer pays ₹{insurer_liability:.0f}.",
        details={
            "copay_percentage": float(copay_pct),
            "total_bill_inr": float(total),
            "copay_amount_inr": float(copay_amount),
            "insurer_liability_inr": float(insurer_liability),
        },
    )


def _sub_limit_icu_check(
    claim: ClaimJSON, rules: dict[str, Any]
) -> RuleResult:
    """Check ICU charges against per-day ICU sub-limit."""
    limit = rules.get("sub_limit_icu_per_day")
    icu_charges = claim.billing_breakdown.icu_charges

    if icu_charges == 0:
        return RuleResult(
            rule_name="sub_limit_icu_check",
            passed=True,
            message="No ICU charges claimed",
            details={},
        )
    if not limit:
        return RuleResult(
            rule_name="sub_limit_icu_check",
            passed=True,
            message="No ICU sub-limit in policy",
            details={"icu_charges_inr": float(icu_charges)},
        )

    limit = Decimal(str(limit))

    # Estimate ICU days from admission/discharge (rough — M1 should provide this)
    admission = _parse_date(claim.admission_date)
    discharge = _parse_date(claim.discharge_date)
    los_days = max((discharge - admission).days, 1) if admission and discharge else 1
    max_allowed = limit * los_days

    if icu_charges <= max_allowed:
        return RuleResult(
            rule_name="sub_limit_icu_check",
            passed=True,
            message=f"ICU charges ₹{icu_charges:.0f} within sub-limit (₹{limit:.0f}/day × {los_days} days = ₹{max_allowed:.0f})",
            details={
                "icu_charges_inr": float(icu_charges),
                "limit_per_day_inr": float(limit),
                "max_allowed_inr": float(max_allowed),
            },
        )
    excess = icu_charges - max_allowed
    return RuleResult(
        rule_name="sub_limit_icu_check",
        passed=False,
        message=f"ICU charges ₹{icu_charges:.0f} EXCEED sub-limit ₹{max_allowed:.0f}. Excess ₹{excess:.0f} is patient liability.",
        details={
            "icu_charges_inr": float(icu_charges),
            "max_allowed_inr": float(max_allowed),
            "excess_inr": float(excess),
        },
    )


def _sub_limit_ot_check(
    claim: ClaimJSON, rules: dict[str, Any]
) -> RuleResult:
    """Check OT (operating theatre) charges against OT sub-limit."""
    limit = rules.get("sub_limit_ot")
    ot_charges = claim.billing_breakdown.ot_charges

    if ot_charges == 0:
        return RuleResult(
            rule_name="sub_limit_ot_check",
            passed=True,
            message="No OT charges claimed",
            details={},
        )
    if not limit:
        return RuleResult(
            rule_name="sub_limit_ot_check",
            passed=True,
            message="No OT sub-limit in policy",
            details={"ot_charges_inr": float(ot_charges)},
        )

    limit = Decimal(str(limit))
    if ot_charges <= limit:
        return RuleResult(
            rule_name="sub_limit_ot_check",
            passed=True,
            message=f"OT charges ₹{ot_charges:.0f} within sub-limit ₹{limit:.0f}",
            details={"ot_charges_inr": float(ot_charges), "limit_inr": float(limit)},
        )
    excess = ot_charges - limit
    return RuleResult(
        rule_name="sub_limit_ot_check",
        passed=False,
        message=f"OT charges ₹{ot_charges:.0f} EXCEED sub-limit ₹{limit:.0f}. Excess ₹{excess:.0f} is patient liability.",
        details={
            "ot_charges_inr": float(ot_charges),
            "limit_inr": float(limit),
            "excess_inr": float(excess),
        },
    )


def _pre_auth_check(
    claim: ClaimJSON, rules: dict[str, Any]
) -> RuleResult:
    """If the policy requires pre-authorization, check that a pre-auth number exists."""
    requires = rules.get("requires_pre_auth", False)
    if not requires:
        return RuleResult(
            rule_name="pre_auth_check",
            passed=True,
            message="Policy does not require pre-authorization",
            details={},
        )
    if claim.pre_auth_number:
        return RuleResult(
            rule_name="pre_auth_check",
            passed=True,
            message=f"Pre-authorization present: {claim.pre_auth_number}",
            details={"pre_auth_number": claim.pre_auth_number},
        )
    return RuleResult(
        rule_name="pre_auth_check",
        passed=False,
        message="Pre-authorization REQUIRED but not provided",
        details={},
    )


def _sum_insured_check(
    claim: ClaimJSON, rules: dict[str, Any]
) -> RuleResult:
    """Check total bill against sum insured (coverage cap)."""
    sum_insured = rules.get("sum_insured")
    if not sum_insured:
        return RuleResult(
            rule_name="sum_insured_check",
            passed=True,
            message="No sum insured specified — assumed unlimited",
            details={},
        )

    sum_insured = Decimal(str(sum_insured))
    total = claim.billing_breakdown.total

    if total <= sum_insured:
        return RuleResult(
            rule_name="sum_insured_check",
            passed=True,
            message=f"Total bill ₹{total:.0f} within sum insured ₹{sum_insured:.0f}",
            details={
                "total_bill_inr": float(total),
                "sum_insured_inr": float(sum_insured),
                "utilization_pct": float(total / sum_insured * 100) if sum_insured else 0,
            },
        )
    excess = total - sum_insured
    return RuleResult(
        rule_name="sum_insured_check",
        passed=False,
        message=f"Total bill ₹{total:.0f} EXCEEDS sum insured ₹{sum_insured:.0f}. Excess ₹{excess:.0f} is patient liability.",
        details={
            "total_bill_inr": float(total),
            "sum_insured_inr": float(sum_insured),
            "excess_inr": float(excess),
        },
    )


# ═══════════════════════════════════════════════════════════════════════
# Main entry point
# ═══════════════════════════════════════════════════════════════════════


def validate_coverage(
    claim_json: ClaimJSON,
    policy_rules: dict[str, Any],
) -> list[RuleResult]:
    """
    Run all deterministic policy coverage checks.

    Every check is independent — none depends on the outcome of another.
    This makes the engine fully auditable: each rule produces its own
    PASS/FAIL/WARNING with a human-readable message and INR amounts.

    Parameters
    ----------
    claim_json : ClaimJSON
        The structured claim data (backbone schema).
    policy_rules : dict
        Parsed policy rules from ``policy_parser.parse_policy()``.

    Returns
    -------
    list[RuleResult]
        One result per rule, in execution order.
    """
    results: list[RuleResult] = [
        _policy_active_check(claim_json, policy_rules),
        _waiting_period_check(claim_json, policy_rules),
        _exclusion_check(claim_json, policy_rules),
        _room_rent_check(claim_json, policy_rules),
        _copay_calculation(claim_json, policy_rules),
        _sub_limit_icu_check(claim_json, policy_rules),
        _sub_limit_ot_check(claim_json, policy_rules),
        _pre_auth_check(claim_json, policy_rules),
        _sum_insured_check(claim_json, policy_rules),
    ]

    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if not r.passed)
    logger.info("Coverage validation: %d passed, %d failed/warning", passed, failed)

    return results
