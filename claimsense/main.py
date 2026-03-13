"""
ClaimSense.ai — FastAPI Application Entry Point.

Responsibilities:
    1. CORS middleware (allow React dev server on localhost:5173)
    2. Lifespan handler — create DB tables + seed demo users on startup
    3. Mount all module routers with try/except (missing modules don't crash)
    4. Health-check endpoint at GET /
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from passlib.context import CryptContext
from sqlalchemy import select

from shared.config import get_settings
from shared.database import AsyncSessionLocal, create_tables
from shared.models import User, UserRole
from shared.schemas import HealthResponse

logger = logging.getLogger("claimsense")
logging.basicConfig(level=logging.INFO)

settings = get_settings()
pwd_ctx = CryptContext(schemes=["sha256_crypt"], deprecated="auto")


# ═══════════════════════════════════════════════════════════════════════
# Lifespan — startup & shutdown logic
# ═══════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Run DB setup and demo user seeding on startup."""
    logger.info("🚀 ClaimSense.ai starting up …")
    await create_tables()
    logger.info("✅ Database tables ready.")

    await _seed_demo_users()
    logger.info("✅ Demo users seeded.")

    yield  # app is running

    logger.info("👋 ClaimSense.ai shutting down.")


async def _seed_demo_users() -> None:
    """Insert demo users if the users table is empty."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).limit(1))
        if result.scalar_one_or_none() is not None:
            return  # already seeded

        demo_users = [
            User(
                email="demo_patient@claimsense.ai",
                hashed_password=pwd_ctx.hash("demo1234"),
                role=UserRole.PATIENT.value,
                phone=settings.DEMO_PATIENT_PHONE,
            ),
            User(
                email="demo_hospital@claimsense.ai",
                hashed_password=pwd_ctx.hash("demo1234"),
                role=UserRole.HOSPITAL_STAFF.value,
                hospital_id="HOSP-KIT-001",
            ),
            User(
                email="demo_insurer@claimsense.ai",
                hashed_password=pwd_ctx.hash("demo1234"),
                role=UserRole.INSURER.value,
                insurer_id="INS-STAR-001",
            ),
        ]
        db.add_all(demo_users)
        await db.commit()
        logger.info("  → Created 3 demo users (password: demo1234)")


# ═══════════════════════════════════════════════════════════════════════
# FastAPI app
# ═══════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="ClaimSense.ai",
    description="AI-powered neutral middleware for Indian health insurance claims.",
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health check ──────────────────────────────────────────────────────

@app.get("/", response_model=HealthResponse, tags=["Health"])
async def health_check() -> dict:
    """Return service health status."""
    return {"status": "healthy", "version": "0.1.0", "service": "ClaimSense.ai"}


@app.get("/health/gemini", tags=["Health"])
async def gemini_health() -> dict:
    """Check Gemini API connectivity."""
    api_key = settings.GEMINI_API_KEY
    if not api_key:
        return {"status": "unavailable", "reason": "GEMINI_API_KEY not set"}
    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        return {"status": "connected", "model": "gemini-2.0-flash"}
    except Exception as exc:
        return {"status": "error", "reason": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Router mounting (try/except so missing modules don't crash the app)
# ═══════════════════════════════════════════════════════════════════════

_routers = [
    ("auth.router",          "auth_router",          "/auth",          "Auth"),
    ("m1.router",            "m1_router",             "/m1",            "M1 DocTriage"),
    ("doc_check.router",     "doc_check_router",      "/doc-check",     "Doc Check"),
    ("pipeline.router",      "pipeline_router",        "/pipeline",      "Pipeline"),
    ("m2.router",            "m2_router",              "/m2",            "M2 Validation"),
    ("review.router",        "review_router",          "/review",        "Review"),
    ("m3.router",            "m3_router",              "/m3",            "M3 Clean Claim"),
    ("notifications.router", "notifications_router",   "/notifications", "Notifications"),
    ("dashboard.router",     "dashboard_router",       "/dashboard",     "Dashboard"),
    ("assistant.router",     "assistant_router",        "/assistant",     "Assistant"),
]

for module_path, var_name, prefix, tag in _routers:
    try:
        # Dynamic import
        import importlib
        mod = importlib.import_module(module_path)
        rtr = getattr(mod, "router", None)
        if rtr is not None:
            app.include_router(rtr, prefix=prefix, tags=[tag])
            logger.info(f"  ✅ Mounted {module_path} → {prefix}")
        else:
            logger.warning(f"  ⚠️  {module_path} has no 'router' attribute — skipped")
    except ImportError as exc:
        logger.warning(f"  ⚠️  Could not import {module_path}: {exc} — skipped")
    except Exception as exc:
        logger.error(f"  ❌ Error mounting {module_path}: {exc}")
