"""
ClaimSense.ai — Demo Seed Data.

Run standalone:  python -m demo.seed_data
  (from the claimsense/ directory)

Seeds:
  1. Three demo users (patient, hospital_staff, insurer)
  2. A sample inpatient reimbursement claim (CS-2026-001)
  3. A pre-cached PolicyCache entry so M2 skips Gemini policy parsing
"""

from __future__ import annotations

import asyncio
import logging
import sys

from passlib.context import CryptContext
from sqlalchemy import select

# Ensure the parent package is importable when run as a script
sys.path.insert(0, ".")

from shared.config import get_settings
from shared.database import AsyncSessionLocal, create_tables
from shared.models import (
    Claim,
    ClaimPath,
    ClaimStatus,
    ClaimType,
    PolicyCache,
    User,
    UserRole,
)

logger = logging.getLogger("claimsense.demo.seed")
logging.basicConfig(level=logging.INFO, format="%(message)s")

settings = get_settings()
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ═══════════════════════════════════════════════════════════════════════
# Demo constants
# ═══════════════════════════════════════════════════════════════════════

DEMO_CLAIM_ID = "CS-2026-001"
DEMO_POLICY = "STAR-HEALTH-2025-001"

DEMO_POLICY_RULES = {
    "room_rent_limit_per_day": 5000,
    "waiting_period_days": 30,
    "excluded_procedures": [
        "Dental treatment",
        "Cosmetic surgery",
        "Fertility treatment",
    ],
    "excluded_conditions": [
        "Pre-existing diabetes for first 2 years",
    ],
    "copay_percentage": 10,
    "sub_limit_icu_per_day": 10000,
    "sub_limit_ot": 50000,
    "is_cashless_eligible": True,
    "requires_pre_auth": True,
    "sum_insured": 1000000,
    "daycare_procedures_covered": [
        "Cataract surgery",
        "Dialysis",
        "Chemotherapy",
    ],
    "policy_start_date": "2025-06-01",
    "policy_end_date": "2026-05-31",
}

DEMO_USERS = [
    {
        "email": "demo_patient@claimsense.ai",
        "password": "demo1234",
        "role": UserRole.PATIENT,
        "phone": settings.DEMO_PATIENT_PHONE,
    },
    {
        "email": "demo_hospital@claimsense.ai",
        "password": "demo1234",
        "role": UserRole.HOSPITAL_STAFF,
        "hospital_id": "HOSP-KIT-001",
    },
    {
        "email": "demo_insurer@claimsense.ai",
        "password": "demo1234",
        "role": UserRole.INSURER,
        "insurer_id": "INS-STAR-001",
    },
]


# ═══════════════════════════════════════════════════════════════════════
# Seed logic
# ═══════════════════════════════════════════════════════════════════════


async def seed() -> None:
    """Run the full seed sequence."""
    await create_tables()
    logger.info("Database tables ready.")

    async with AsyncSessionLocal() as db:
        # ── 1. Seed demo users ────────────────────────────────────────
        patient_id: int | None = None

        for u in DEMO_USERS:
            result = await db.execute(
                select(User).where(User.email == u["email"])
            )
            existing = result.scalar_one_or_none()

            if existing:
                logger.info("  User already exists: %s (id=%d)", u["email"], existing.id)
                if u["role"] == UserRole.PATIENT:
                    patient_id = existing.id
                continue

            user = User(
                email=u["email"],
                hashed_password=pwd_ctx.hash(u["password"]),
                role=u["role"],
                phone=u.get("phone"),
                hospital_id=u.get("hospital_id"),
                insurer_id=u.get("insurer_id"),
            )
            db.add(user)
            await db.flush()
            logger.info("  Created user: %s (id=%d)", u["email"], user.id)

            if u["role"] == UserRole.PATIENT:
                patient_id = user.id

        # ── 2. Seed demo claim ────────────────────────────────────────
        result = await db.execute(
            select(Claim).where(Claim.id == DEMO_CLAIM_ID)
        )
        existing_claim = result.scalar_one_or_none()

        if existing_claim:
            logger.info("  Claim already exists: %s", DEMO_CLAIM_ID)
        else:
            if patient_id is None:
                # Fallback: fetch patient by email
                result = await db.execute(
                    select(User).where(User.email == "demo_patient@claimsense.ai")
                )
                patient = result.scalar_one_or_none()
                patient_id = patient.id if patient else 1

            claim = Claim(
                id=DEMO_CLAIM_ID,
                patient_id=patient_id,
                hospital_id="HOSP-KIT-001",
                insurer_id="INS-STAR-001",
                claim_type=ClaimType.INPATIENT,
                path=ClaimPath.REIMBURSEMENT,
                status=ClaimStatus.DOCUMENTS_MISSING,
                policy_number=DEMO_POLICY,
            )
            db.add(claim)
            await db.flush()
            logger.info("  Created claim: %s (patient_id=%d)", DEMO_CLAIM_ID, patient_id)

        # ── 3. Seed policy cache ──────────────────────────────────────
        result = await db.execute(
            select(PolicyCache).where(PolicyCache.policy_number == DEMO_POLICY)
        )
        existing_policy = result.scalar_one_or_none()

        if existing_policy:
            logger.info("  Policy cache already exists: %s", DEMO_POLICY)
        else:
            policy = PolicyCache(
                policy_number=DEMO_POLICY,
                rules_json=DEMO_POLICY_RULES,
            )
            db.add(policy)
            await db.flush()
            logger.info("  Cached policy rules: %s", DEMO_POLICY)

        await db.commit()
        logger.info("\nDemo seed complete!")


# ═══════════════════════════════════════════════════════════════════════
# CLI entry point
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=== ClaimSense.ai Demo Seed ===\n")
    asyncio.run(seed())
