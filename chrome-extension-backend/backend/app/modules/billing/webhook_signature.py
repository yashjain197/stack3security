"""
Standard Webhooks signature verification for Dodo Payments (HMAC-SHA256 over id.timestamp.body).

Made by Yash Jain with passion.
"""

import base64
import hashlib
import hmac
import time

from app.core.errors import AppError

TOLERANCE_SECONDS = 300


def _signing_key(secret: str) -> bytes:
    """Decode the `whsec_` secret into raw key bytes."""
    return base64.b64decode(secret.removeprefix("whsec_"))


def verify_webhook(secret: str, webhook_id: str, timestamp: str, signature_header: str, body: bytes) -> None:
    """Raise 401 unless one of the v1 signatures matches and the timestamp is fresh (replay protection)."""
    invalid = AppError("invalid_webhook_signature", "Invalid webhook signature", 401)
    if not webhook_id or not timestamp or not signature_header:
        raise invalid
    try:
        sent_at = int(timestamp)
    except ValueError as exc:
        raise invalid from exc
    if abs(time.time() - sent_at) > TOLERANCE_SECONDS:
        raise invalid

    signed = f"{webhook_id}.{timestamp}.".encode() + body
    expected = base64.b64encode(hmac.new(_signing_key(secret), signed, hashlib.sha256).digest())
    for candidate in signature_header.split(" "):
        version, _, value = candidate.partition(",")
        if version == "v1" and hmac.compare_digest(value.encode(), expected):
            return
    raise invalid
