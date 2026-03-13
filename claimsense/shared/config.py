"""
ClaimSense.ai — Application Configuration.

Loads all environment variables via pydantic-settings.
Single source of truth for every configurable value in the system.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Central configuration loaded from environment variables / .env file."""

    # ── Gemini AI ──────────────────────────────────────────────────────
    GEMINI_API_KEY: str = ""

    # ── Database (SQLite) ──────────────────────────────────────────────
    DATABASE_URL: str = "sqlite+aiosqlite:///./claimsense.db"

    # ── Twilio Notifications ───────────────────────────────────────────
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_WHATSAPP_FROM: str = "whatsapp:+14155238886"
    TWILIO_SMS_FROM: str = ""

    # ── Auth / JWT ─────────────────────────────────────────────────────
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_MINUTES: int = 480  # 8 hours

    # ── Encryption ─────────────────────────────────────────────────────
    ENCRYPTION_KEY: str = ""  # Fernet-compatible base64 key

    # ── Business Rules ─────────────────────────────────────────────────
    HIGH_VALUE_THRESHOLD: int = 500_000  # Rs. 5 lakh — triggers human review

    # ── Demo / Seed ────────────────────────────────────────────────────
    DEMO_PATIENT_PHONE: str = "+919876543210"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


@lru_cache()
def get_settings() -> Settings:
    """Return a cached Settings singleton."""
    return Settings()
