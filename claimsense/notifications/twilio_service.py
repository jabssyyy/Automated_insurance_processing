"""
ClaimSense.ai — Twilio WhatsApp / SMS Notification Service.

Priority chain
--------------
1. **WhatsApp** via Twilio — try first (near-universal in India)
2. **SMS** via Twilio — fallback if WhatsApp fails
3. **In-app** notification panel — always stored, becomes only channel if both fail

This module is outgoing-only — it does NOT handle conversational replies.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.config import get_settings

logger = logging.getLogger("claimsense.notifications")
settings = get_settings()


def _get_twilio_client():
    """
    Lazily create and return a Twilio REST client.

    Returns None if Twilio credentials are not configured,
    allowing graceful degradation in dev environments.
    """
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
        logger.warning(
            "Twilio credentials not configured — "
            "WhatsApp/SMS will be skipped."
        )
        return None

    try:
        from twilio.rest import Client
        return Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    except ImportError:
        logger.error("twilio package not installed — pip install twilio")
        return None
    except Exception as exc:
        logger.error("Failed to create Twilio client: %s", exc)
        return None


# ═══════════════════════════════════════════════════════════════════════
# send_whatsapp
# ═══════════════════════════════════════════════════════════════════════

def send_whatsapp(to_number: str, message: str) -> bool:
    """
    Send a WhatsApp message via Twilio.

    Parameters
    ----------
    to_number : str
        Recipient in ``whatsapp:+91XXXXXXXXXX`` format.
    message : str
        Message body.

    Returns
    -------
    bool
        ``True`` on success, ``False`` on any failure (never raises).
    """
    client = _get_twilio_client()
    if client is None:
        logger.info("WhatsApp skipped — no Twilio client available.")
        return False

    try:
        # Ensure the 'whatsapp:' prefix
        if not to_number.startswith("whatsapp:"):
            to_number = f"whatsapp:{to_number}"

        msg = client.messages.create(
            body=message,
            from_=settings.TWILIO_WHATSAPP_FROM,
            to=to_number,
        )
        logger.info(
            "WhatsApp sent: sid=%s to=%s status=%s",
            msg.sid, to_number, msg.status,
        )
        return True
    except Exception as exc:
        logger.error("WhatsApp send failed to %s: %s", to_number, exc)
        return False


# ═══════════════════════════════════════════════════════════════════════
# send_sms
# ═══════════════════════════════════════════════════════════════════════

def send_sms(to_number: str, message: str) -> bool:
    """
    Send an SMS message via Twilio.

    Parameters
    ----------
    to_number : str
        Recipient phone number (e.g. ``+91XXXXXXXXXX``).
    message : str
        Message body.

    Returns
    -------
    bool
        ``True`` on success, ``False`` on any failure (never raises).
    """
    client = _get_twilio_client()
    if client is None:
        logger.info("SMS skipped — no Twilio client available.")
        return False

    if not settings.TWILIO_SMS_FROM:
        logger.warning("TWILIO_SMS_FROM not configured — SMS skipped.")
        return False

    try:
        # Strip 'whatsapp:' prefix if present
        clean_number = to_number.replace("whatsapp:", "")

        msg = client.messages.create(
            body=message,
            from_=settings.TWILIO_SMS_FROM,
            to=clean_number,
        )
        logger.info(
            "SMS sent: sid=%s to=%s status=%s",
            msg.sid, clean_number, msg.status,
        )
        return True
    except Exception as exc:
        logger.error("SMS send failed to %s: %s", to_number, exc)
        return False


# ═══════════════════════════════════════════════════════════════════════
# send_with_priority
# ═══════════════════════════════════════════════════════════════════════

def send_with_priority(to_number: str, message: str) -> dict[str, Any]:
    """
    Attempt to deliver a message using the priority chain:
    WhatsApp → SMS → none (in-app fallback handled by caller).

    Parameters
    ----------
    to_number : str
        Recipient phone number (``+91XXXXXXXXXX``).
    message : str
        Message body.

    Returns
    -------
    dict
        ``{channel: str, delivered: bool}``
        - ``channel`` is ``"whatsapp"``, ``"sms"``, or ``"none"``
        - ``delivered`` is ``True`` if any channel succeeded
    """
    # Step 1: Try WhatsApp
    logger.info("Attempting WhatsApp delivery to %s", to_number)
    whatsapp_number = f"whatsapp:{to_number}" if not to_number.startswith("whatsapp:") else to_number
    if send_whatsapp(whatsapp_number, message):
        logger.info("✅ WhatsApp delivery succeeded to %s", to_number)
        return {"channel": "whatsapp", "delivered": True}

    # Step 2: Fallback to SMS
    logger.info("WhatsApp failed — attempting SMS delivery to %s", to_number)
    clean_number = to_number.replace("whatsapp:", "")
    if send_sms(clean_number, message):
        logger.info("✅ SMS delivery succeeded to %s", clean_number)
        return {"channel": "sms", "delivered": True}

    # Step 3: Both failed
    logger.warning(
        "❌ Both WhatsApp and SMS failed for %s — in-app fallback only",
        to_number,
    )
    return {"channel": "none", "delivered": False}
