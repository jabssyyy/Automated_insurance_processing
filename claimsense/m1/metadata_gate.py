"""
M1 DocTriage — Metadata Gate.

Pre-Gemini quality gate that rejects duplicates, blank files, corrupt files,
and password-protected PDFs BEFORE wasting a Gemini API call.

Checks (in order):
    1. Blank file      — < 1 KB
    2. Duplicate        — SHA-256 hash matches existing Document
    3. Corrupt file     — cannot be opened / parsed
    4. Password-protect — PDF is encrypted
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import Document

logger = logging.getLogger("claimsense.m1.gate")

MIN_FILE_SIZE = 1024  # 1 KB


# ── Individual checks ─────────────────────────────────────────────────────────

def check_blank(file_bytes: bytes) -> bool:
    """Return True if the file is blank (< 1 KB)."""
    return len(file_bytes) < MIN_FILE_SIZE


def compute_hash(file_bytes: bytes) -> str:
    """Return the SHA-256 hex digest of the file."""
    return hashlib.sha256(file_bytes).hexdigest()


async def check_duplicate(file_bytes: bytes, db: AsyncSession) -> tuple[str, bool]:
    """
    Compute SHA-256 hash and check against the Document table.

    Returns
    -------
    (hash_hex, is_duplicate)
    """
    file_hash = compute_hash(file_bytes)
    result = await db.execute(
        select(Document).where(Document.file_hash == file_hash).limit(1)
    )
    existing = result.scalar_one_or_none()
    return file_hash, existing is not None


def check_corrupt(file_path: str, mime_type: str) -> bool:
    """
    Try to open / parse the file. Return True if corrupt.

    - PDF: attempt to read with PyPDF2
    - Images: attempt to open with Pillow
    - Others: just check the file can be read
    """
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        return True

    try:
        if mime_type == "application/pdf":
            from PyPDF2 import PdfReader
            reader = PdfReader(str(path))
            _ = len(reader.pages)
        elif mime_type.startswith("image/"):
            from PIL import Image
            with Image.open(str(path)) as img:
                img.verify()
        else:
            # Generic: just make sure we can read some bytes
            with open(path, "rb") as f:
                data = f.read(1024)
                if not data:
                    return True
        return False
    except Exception as exc:
        logger.warning("File appears corrupt (%s): %s", file_path, exc)
        return True


def check_password_protected(file_path: str) -> bool:
    """Return True if the PDF is encrypted / password-protected."""
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(str(file_path))
        return reader.is_encrypted
    except Exception:
        return False


# ── Combined gate ──────────────────────────────────────────────────────────────

async def run_gate(
    file_path: str,
    file_bytes: bytes,
    mime_type: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """
    Run all metadata checks in order. Returns on first failure.

    Returns
    -------
    dict
        ``{"passed": True/False, "rejection_reason": str|None, "file_hash": str}``
    """
    # 1. Blank check
    if check_blank(file_bytes):
        return {
            "passed": False,
            "rejection_reason": "File is blank or too small (< 1 KB).",
            "file_hash": compute_hash(file_bytes),
        }

    # 2. Duplicate check
    file_hash, is_dup = await check_duplicate(file_bytes, db)
    if is_dup:
        return {
            "passed": False,
            "rejection_reason": "Duplicate file — this document has already been uploaded.",
            "file_hash": file_hash,
        }

    # 3. Corrupt check
    if check_corrupt(file_path, mime_type):
        return {
            "passed": False,
            "rejection_reason": "File appears corrupt and cannot be read.",
            "file_hash": file_hash,
        }

    # 4. Password-protected check (PDFs only)
    if mime_type == "application/pdf" and check_password_protected(file_path):
        return {
            "passed": False,
            "rejection_reason": "PDF is password-protected. Please upload an unlocked version.",
            "file_hash": file_hash,
        }

    return {"passed": True, "rejection_reason": None, "file_hash": file_hash}
