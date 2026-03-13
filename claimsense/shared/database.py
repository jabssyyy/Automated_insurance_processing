"""
ClaimSense.ai — Async Database Engine & Session Factory.

Uses SQLAlchemy 2.0 async API with aiosqlite driver for SQLite.
Provides:
    - ``engine``          – shared async engine
    - ``AsyncSessionLocal`` – async session factory
    - ``get_db()``        – FastAPI dependency that yields a session
    - ``create_tables()`` – startup helper that creates all ORM tables
"""

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from typing import AsyncGenerator

from shared.config import get_settings

settings = get_settings()

# ── Engine ────────────────────────────────────────────────────────────
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)

# ── Session Factory ───────────────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# ── Declarative Base ─────────────────────────────────────────────────
class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


# ── FastAPI Dependency ────────────────────────────────────────────────
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async DB session and ensure it is closed afterwards."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── Startup Helper ────────────────────────────────────────────────────
async def create_tables() -> None:
    """Create all tables defined by ORM models (idempotent)."""
    # Import models so they register with Base.metadata
    import shared.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
