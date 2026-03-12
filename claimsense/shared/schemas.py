"""
ClaimSense.ai — Pydantic v2 Schemas.

``ClaimJSON`` is the **backbone** data structure — every module in the
pipeline reads from it.  All other schemas derive from or reference it.

Convention
----------
* *Request* schemas end in ``Request``.
* *Response* schemas end in ``Response``.
* Internal transfer objects have descriptive names (``RuleResult``, etc.).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field


# ═══════════════════════════════════════════════════════════════════════
# Core sub-structures (used inside ClaimJSON)
# ═══════════════════════════════════════════════════════════════════════

class DiagnosisCode(BaseModel):
    """ICD-10 diagnosis code extracted from documents."""
    code: str = Field(..., description="ICD-10 code, e.g. 'K35.80'")
    description: str = Field(..., description="Human-readable diagnosis name")


class ProcedureCode(BaseModel):
    """Medical procedure code extracted from documents."""
    code: str = Field(..., description="Procedure code")
    description: str = Field(..., description="Human-readable procedure name")


class BillingBreakdown(BaseModel):
    """Itemised billing from the hospital."""
    room_charges: Decimal = Field(default=Decimal("0"), ge=0)
    icu_charges: Decimal = Field(default=Decimal("0"), ge=0)
    ot_charges: Decimal = Field(default=Decimal("0"), ge=0)
    medicines: Decimal = Field(default=Decimal("0"), ge=0)
    diagnostics: Decimal = Field(default=Decimal("0"), ge=0)
    other: Decimal = Field(default=Decimal("0"), ge=0)
    total: Decimal = Field(default=Decimal("0"), ge=0)


# ═══════════════════════════════════════════════════════════════════════
# ClaimJSON — THE core data structure
# ═══════════════════════════════════════════════════════════════════════

class ClaimJSON(BaseModel):
    """
    Structured representation of a health-insurance claim.

    Produced by **M1 DocTriage** (Gemini extraction) and consumed by every
    downstream module (M2 validation, M3 packaging, dashboard, assistant).
    """

    # ── Patient ────────────────────────────────────────────────────────
    patient_name: str
    patient_id: str
    date_of_birth: str  # ISO date string
    gender: str

    # ── Hospital ───────────────────────────────────────────────────────
    hospital_name: str
    hospital_id: str

    # ── Stay dates ─────────────────────────────────────────────────────
    admission_date: str  # ISO date string
    discharge_date: str  # ISO date string

    # ── Clinical ───────────────────────────────────────────────────────
    diagnosis_codes: list[DiagnosisCode] = Field(default_factory=list)
    procedure_codes: list[ProcedureCode] = Field(default_factory=list)

    # ── Financial ──────────────────────────────────────────────────────
    billing_breakdown: BillingBreakdown = Field(default_factory=BillingBreakdown)

    # ── Documents ──────────────────────────────────────────────────────
    document_status: dict[str, str] = Field(
        default_factory=dict,
        description="Maps doc_type → 'present' | 'missing'",
    )

    # ── Policy / Auth ──────────────────────────────────────────────────
    policy_number: str
    pre_auth_number: Optional[str] = None

    # ── Doctor ─────────────────────────────────────────────────────────
    doctor_name: str
    doctor_registration_number: str

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════════════════
# Module transfer objects
# ═══════════════════════════════════════════════════════════════════════

class DocumentExtraction(BaseModel):
    """Result from Gemini document-reading in M1."""
    doc_type: str
    raw_text: str = ""
    extracted_fields: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    language_detected: str = "en"


class RuleResult(BaseModel):
    """Single pass/fail result from a deterministic policy rule."""
    rule_name: str
    passed: bool
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class CodeValidationResult(BaseModel):
    """Result from ICD-10 / procedure code validation."""
    code: str
    is_valid: bool
    description: str = ""
    warnings: list[str] = Field(default_factory=list)


class CoverageResults(BaseModel):
    """Aggregate output of M2 coverage engine."""
    overall_eligible: bool
    eligible_amount: Decimal = Decimal("0")
    co_pay_amount: Decimal = Decimal("0")
    excluded_items: list[str] = Field(default_factory=list)
    rule_results: list[RuleResult] = Field(default_factory=list)
    code_validations: list[CodeValidationResult] = Field(default_factory=list)
    requires_human_review: bool = False
    review_reasons: list[str] = Field(default_factory=list)


class PatientSummary(BaseModel):
    """Human-readable summary shown to the patient."""
    claim_id: str
    status: str
    status_detail: str
    eligible_amount: Optional[Decimal] = None
    co_pay: Optional[Decimal] = None
    next_step: str = ""


class InsurerSnapshot(BaseModel):
    """Aggregated view of a claim for the insurer dashboard."""
    claim_id: str
    patient_name: str
    hospital_name: str
    claim_type: str
    total_amount: Decimal
    status: str
    flags: list[str] = Field(default_factory=list)
    submitted_at: Optional[datetime] = None


# ═══════════════════════════════════════════════════════════════════════
# Review & Notifications
# ═══════════════════════════════════════════════════════════════════════

class ReviewDecision(BaseModel):
    """Payload submitted by a reviewer (insurer)."""
    claim_id: str
    decision: str = Field(..., description="'approved' or 'rejected'")
    notes: Optional[str] = None
    denial_reason: Optional[str] = None


class NotificationRequest(BaseModel):
    """Internal request to send a notification."""
    claim_id: str
    user_id: int
    message: str
    channel: str = "whatsapp"  # whatsapp | sms | in_app


# ═══════════════════════════════════════════════════════════════════════
# API request / response wrappers
# ═══════════════════════════════════════════════════════════════════════

class UserCreateRequest(BaseModel):
    """Registration payload."""
    email: str
    password: str
    role: str = "patient"
    phone: Optional[str] = None
    hospital_id: Optional[str] = None
    insurer_id: Optional[str] = None


class UserLoginRequest(BaseModel):
    """Login payload."""
    email: str
    password: str


class TokenResponse(BaseModel):
    """JWT token response."""
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: int


class UserResponse(BaseModel):
    """Safe user representation (no password hash)."""
    id: int
    email: str
    role: str
    phone: Optional[str] = None
    hospital_id: Optional[str] = None
    insurer_id: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ClaimCreateRequest(BaseModel):
    """Payload to initiate a new claim."""
    claim_type: str  # inpatient / daycare / icu
    path: str  # cashless / reimbursement
    policy_number: str
    hospital_id: Optional[str] = None
    insurer_id: Optional[str] = None


class ClaimResponse(BaseModel):
    """API response for a single claim."""
    id: str
    patient_id: int
    hospital_id: Optional[str] = None
    insurer_id: Optional[str] = None
    claim_type: str
    path: str
    status: str
    claim_json: Optional[dict] = None
    policy_number: Optional[str] = None
    total_amount: Optional[Decimal] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class StatusUpdateResponse(BaseModel):
    """API response for a status update event."""
    id: int
    claim_id: str
    status: str
    detail: Optional[str] = None
    role_visibility: Optional[list[str]] = None
    timestamp: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DocumentUploadResponse(BaseModel):
    """Response after uploading a document."""
    id: int
    claim_id: str
    doc_type: str
    file_path: str
    is_verified: bool
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class HealthResponse(BaseModel):
    """Simple health-check response."""
    status: str = "healthy"
    version: str = "0.1.0"
    service: str = "ClaimSense.ai"
