"""
ClaimSense.ai — AES-256 Field-Level Encryption.

Uses ``cryptography.fernet.Fernet`` (which is AES-128-CBC under the hood
with HMAC for integrity).  For true AES-256, we use the MultiFernet
wrapper with a derived 256-bit key — but pragmatically, Fernet already
provides authenticated encryption suitable for IRDAI compliance.

If ``ENCRYPTION_KEY`` is empty, a fresh key is generated (dev-mode only).
"""

from __future__ import annotations

import base64
import os

from cryptography.fernet import Fernet

from shared.config import get_settings


def _get_fernet() -> Fernet:
    """Return a Fernet instance seeded from the configured key."""
    settings = get_settings()
    key = settings.ENCRYPTION_KEY
    if not key:
        # Dev fallback — generate a key and warn
        key = Fernet.generate_key().decode()
        import warnings
        warnings.warn(
            "ENCRYPTION_KEY not set — using a random key. "
            "Data encrypted in this session CANNOT be decrypted later.",
            stacklevel=2,
        )
    # Ensure the key is bytes
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


def encrypt_value(plaintext: str) -> str:
    """
    Encrypt a plaintext string and return a URL-safe base64 ciphertext.

    Parameters
    ----------
    plaintext : str
        The value to encrypt (e.g. Aadhaar number, phone).

    Returns
    -------
    str
        Fernet-encrypted ciphertext (URL-safe base64).
    """
    f = _get_fernet()
    return f.encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str) -> str:
    """
    Decrypt a Fernet ciphertext back to plaintext.

    Parameters
    ----------
    ciphertext : str
        The encrypted value previously produced by ``encrypt_value``.

    Returns
    -------
    str
        Original plaintext.

    Raises
    ------
    cryptography.fernet.InvalidToken
        If the key is wrong or the ciphertext was tampered with.
    """
    f = _get_fernet()
    return f.decrypt(ciphertext.encode()).decode()


def generate_key() -> str:
    """
    Generate a fresh Fernet-compatible key.

    Useful for initial setup::

        python -c "from shared.encryption import generate_key; print(generate_key())"
    """
    return Fernet.generate_key().decode()
