"""
Low-level crypto helpers: random tokens, hashing of secrets at rest, constant-time comparison.

Made by Yash Jain with passion.
"""

import hashlib
import hmac
import secrets

from app.core.config import get_settings

USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"


def new_opaque_token(num_bytes: int = 32) -> str:
    """URL-safe random token with 256 bits of entropy by default."""
    return secrets.token_urlsafe(num_bytes)


def sha256_digest(value: str) -> bytes:
    """SHA-256 of a high-entropy token; safe for lookup because the input cannot be brute-forced."""
    return hashlib.sha256(value.encode()).digest()


def peppered_hash(value: str) -> bytes:
    """HMAC-SHA256 with the server pepper; used for low-entropy secrets like 6-digit codes."""
    pepper = get_settings().otp_pepper.get_secret_value().encode()
    return hmac.new(pepper, value.encode(), hashlib.sha256).digest()


def constant_time_equals(a: bytes, b: bytes) -> bool:
    """Compare two digests without leaking timing information."""
    return hmac.compare_digest(a, b)


def new_numeric_code(digits: int = 6) -> str:
    """Uniformly random numeric code, zero-padded."""
    return f"{secrets.randbelow(10**digits):0{digits}d}"


def new_user_code() -> str:
    """Human-friendly device-link code like KQPM-ZXRT, no vowels so it never spells words."""
    raw = "".join(secrets.choice(USER_CODE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_user_code(code: str) -> str:
    """Accept user codes typed in any case, with or without the dash."""
    cleaned = "".join(ch for ch in code.upper() if ch.isalnum())
    return f"{cleaned[:4]}-{cleaned[4:]}" if len(cleaned) == 8 else cleaned
