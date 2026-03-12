"""
ClaimSense.ai — ORM Models.

Every table in the system is defined here.  Models use SQLAlchemy 2.0
Mapped-Column style and Python ``enum.Enum`` for type-safe status tracking.

Key design decisions
--------------------
* **Claim.id** is auto-generated as ``CS-2026-XXXX`` via a DB default using
  a PostgreSQL sequence wrapped in a trigger-free helper column.
* **JSONB** columns store semi-structured data (Claim JSON, extracted data,
  policy rules, trigger reasons, role visibility).
* All timestamps default to ``func.now()`` (server-side UTC).
"""

from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    Sequence,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.database import Base


# ═══════════════════════════════════════════════════════════════════════
# Enumerations
# ═══════════════════════════════════════════════════════════════════════

class UserRole(str, enum.Enum):
    """Roles governing RBAC across the platform."""
    PATIENT = "patient"
    HOSPITAL_STAFF = "hospital_staff"
    INSURER = "insurer"
    ADMIN = "admin"


class ClaimType(str, enum.Enum):
    """Type of hospital stay."""
    INPATIENT = "inpatient"
    DAYCARE = "daycare"
    ICU = "icu"


class ClaimPath(str, enum.Enum):
    """Hospital-initiated (cashless) vs patient-initiated (reimbursement)."""
    CASHLESS = "cashless"
    REIMBURSEMENT = "reimbursement"


class ClaimStatus(str, enum.Enum):
    """
    Lifecycle status of a claim.  Ordered roughly by pipeline stage.
    """
    DOCUMENTS_MISSING = "DOCUMENTS_MISSING"
    DOCUMENTS_COMPLETE = "DOCUMENTS_COMPLETE"
    POLICY_VALIDATING = "POLICY_VALIDATING"
    ICD_CHECK_RUNNING = "ICD_CHECK_RUNNING"
    UNDER_HUMAN_REVIEW = "UNDER_HUMAN_REVIEW"
    ASSEMBLING_PACKAGE = "ASSEMBLING_PACKAGE"
    SUBMITTED = "SUBMITTED"
    UNDER_INSURER_REVIEW = "UNDER_INSURER_REVIEW"
    QUERY_RAISED = "QUERY_RAISED"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    ESCALATED_TO_IRDAI = "ESCALATED_TO_IRDAI"


class ReviewStatus(str, enum.Enum):
    """Status of a human-review item."""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class NotificationChannel(str, enum.Enum):
    """Delivery channel for a notification."""
    WHATSAPP = "whatsapp"
    SMS = "sms"
    IN_APP = "in_app"


class DeliveryStatus(str, enum.Enum):
    """Delivery outcome of a notification."""
    SENT = "sent"
    FAILED = "failed"
    PENDING = "pending"


# ═══════════════════════════════════════════════════════════════════════
# Sequence for auto-generated Claim IDs  (CS-2026-0001, CS-2026-0002 …)
# ═══════════════════════════════════════════════════════════════════════
claim_id_seq = Sequence("claim_id_seq", start=1, increment=1)


# ═══════════════════════════════════════════════════════════════════════
# ORM Models
# ═══════════════════════════════════════════════════════════════════════

class User(Base):
    """Platform user — can be a patient, hospital staff, insurer, or admin."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    hospital_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    insurer_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    notifications: Mapped[list["Notification"]] = relationship(
        back_populates="user", lazy="selectin"
    )


class Claim(Base):
    """
    Central claim record.

    ``id`` is a human-readable string like ``CS-2026-0042``, built from
    a PostgreSQL sequence.  The ``_seq`` column holds the raw integer;
    ``id`` is a computed property.
    """

    __tablename__ = "claims"

    _seq: Mapped[int] = mapped_column(
        Integer, claim_id_seq, server_default=claim_id_seq.next_value(), unique=True
    )
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    hospital_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    insurer_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    claim_type: Mapped[ClaimType] = mapped_column(Enum(ClaimType), nullable=False)
    path: Mapped[ClaimPath] = mapped_column(Enum(ClaimPath), nullable=False)
    status: Mapped[ClaimStatus] = mapped_column(
        Enum(ClaimStatus), default=ClaimStatus.DOCUMENTS_MISSING
    )
    claim_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    policy_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    total_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    documents: Mapped[list["Document"]] = relationship(
        back_populates="claim", lazy="selectin"
    )
    review_items: Mapped[list["ReviewItem"]] = relationship(
        back_populates="claim", lazy="selectin"
    )
    status_updates: Mapped[list["StatusUpdate"]] = relationship(
        back_populates="claim", lazy="selectin"
    )


class Document(Base):
    """A single document attached to a claim (discharge summary, bill, etc.)."""

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    claim_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("claims.id"), nullable=False
    )
    doc_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    extracted_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    claim: Mapped["Claim"] = relationship(back_populates="documents")


class PolicyCache(Base):
    """Cached, parsed policy rules keyed by policy number."""

    __tablename__ = "policy_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    policy_number: Mapped[str] = mapped_column(
        String(100), unique=True, nullable=False, index=True
    )
    rules_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AuditLog(Base):
    """Immutable log of every automated and manual action in the pipeline."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    claim_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("claims.id"), nullable=True
    )
    actor: Mapped[str] = mapped_column(String(255), nullable=False)
    action_type: Mapped[str] = mapped_column(String(100), nullable=False)
    module: Mapped[str] = mapped_column(String(100), nullable=False)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ReviewItem(Base):
    """An item in the human-review queue, triggered when a claim is flagged."""

    __tablename__ = "review_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    claim_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("claims.id"), nullable=False
    )
    trigger_reasons: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    reviewer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    status: Mapped[ReviewStatus] = mapped_column(
        Enum(ReviewStatus), default=ReviewStatus.PENDING
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    denial_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    claim: Mapped["Claim"] = relationship(back_populates="review_items")


class Notification(Base):
    """Record of every notification sent (WhatsApp / SMS / in-app)."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    claim_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("claims.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    channel: Mapped[NotificationChannel] = mapped_column(
        Enum(NotificationChannel), nullable=False
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    delivery_status: Mapped[DeliveryStatus] = mapped_column(
        Enum(DeliveryStatus), default=DeliveryStatus.PENDING
    )
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="notifications")


class StatusUpdate(Base):
    """
    Granular status-change log for real-time SSE broadcast.

    ``role_visibility`` controls which user roles see this update
    (e.g. ``["patient", "hospital_staff"]``).
    """

    __tablename__ = "status_updates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    claim_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("claims.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    role_visibility: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    claim: Mapped["Claim"] = relationship(back_populates="status_updates")
