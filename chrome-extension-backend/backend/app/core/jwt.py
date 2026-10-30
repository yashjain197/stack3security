"""
JWT signing and verification with Ed25519 (EdDSA) keys and a public JWKS for other Stack3 services.

Only this service holds the private key; Imran's VS Code API and any other service verify tokens
through /.well-known/jwks.json, so a compromise of a verifier can never mint tokens.

Made by Yash Jain with passion.
"""

import base64
from functools import lru_cache
from pathlib import Path
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from app.core.config import get_settings
from app.core.errors import Unauthorized

ALGORITHM = "EdDSA"
TOKEN_TYPE = "at+jwt"  # noqa: S105
AUD_CORE = "stack3-core"
AUD_VSCODE = "stack3-vscode"
DEV_KEY_PATH = Path(".dev-keys/jwt_ed25519.pem")
REQUIRED_CLAIMS = ["exp", "iat", "nbf", "iss", "aud", "sub", "sid", "jti"]


def _decode_pem(value: str) -> bytes:
    """Accept PEM text, PEM with escaped newlines, or base64-encoded PEM from env vars."""
    text = value.strip().replace("\\n", "\n")
    if "BEGIN" not in text:
        try:
            text = base64.b64decode(text, validate=True).decode()
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValueError(
                "JWT key is not a PEM or base64-encoded PEM; generate one with: python -m scripts.generate_jwt_key"
            ) from exc
    return text.encode()


def _load_or_create_dev_key() -> Ed25519PrivateKey:
    """Persist a local signing key for development so tokens survive restarts."""
    if DEV_KEY_PATH.exists():
        key = serialization.load_pem_private_key(DEV_KEY_PATH.read_bytes(), password=None)
    else:
        key = Ed25519PrivateKey.generate()
        DEV_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
        DEV_KEY_PATH.write_bytes(
            key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
            )
        )
        DEV_KEY_PATH.chmod(0o600)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("Development key is not Ed25519")
    return key


def _b64url(raw: bytes) -> str:
    """Base64url without padding, as JWK requires."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class KeyManager:
    """Holds the active signing key and every public key still accepted for verification."""

    def __init__(self) -> None:
        settings = get_settings()
        if settings.jwt_private_key is not None:
            key = serialization.load_pem_private_key(
                _decode_pem(settings.jwt_private_key.get_secret_value()), password=None
            )
            if not isinstance(key, Ed25519PrivateKey):
                raise ValueError("JWT_PRIVATE_KEY must be an Ed25519 key")
            self._private_key = key
        elif settings.is_production:
            raise ValueError("JWT_PRIVATE_KEY is required in production")
        else:
            self._private_key = _load_or_create_dev_key()

        self.active_kid = settings.jwt_key_id
        self._issuer = settings.jwt_issuer
        self._public_keys: dict[str, Ed25519PublicKey] = {self.active_kid: self._private_key.public_key()}
        if settings.jwt_previous_public_key and settings.jwt_previous_key_id:
            previous = serialization.load_pem_public_key(_decode_pem(settings.jwt_previous_public_key))
            if not isinstance(previous, Ed25519PublicKey):
                raise ValueError("JWT_PREVIOUS_PUBLIC_KEY must be an Ed25519 key")
            self._public_keys[settings.jwt_previous_key_id] = previous

    def sign(self, claims: dict[str, Any]) -> str:
        """Sign claims with the active key; iss is always set here."""
        payload = {**claims, "iss": self._issuer}
        return jwt.encode(
            payload,
            self._private_key,
            algorithm=ALGORITHM,
            headers={"kid": self.active_kid, "typ": TOKEN_TYPE},
        )

    def verify(self, token: str, audience: str) -> dict[str, Any]:
        """Verify signature, type, issuer, audience and expiry; any failure is a 401."""
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") != ALGORITHM or header.get("typ") != TOKEN_TYPE:
                raise Unauthorized("Invalid token", "invalid_token")
            key = self._public_keys.get(header.get("kid", ""))
            if key is None:
                raise Unauthorized("Invalid token", "invalid_token")
            return jwt.decode(
                token,
                key,
                algorithms=[ALGORITHM],
                audience=audience,
                issuer=self._issuer,
                leeway=30,
                options={"require": REQUIRED_CLAIMS},
            )
        except jwt.ExpiredSignatureError as exc:
            raise Unauthorized("Access token expired", "token_expired") from exc
        except jwt.PyJWTError as exc:
            raise Unauthorized("Invalid token", "invalid_token") from exc

    def jwks(self) -> dict[str, list[dict[str, str]]]:
        """Public keys in JWK format for other services to verify our tokens."""
        keys = []
        for kid, public_key in self._public_keys.items():
            raw = public_key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
            keys.append(
                {
                    "kty": "OKP",
                    "crv": "Ed25519",
                    "x": _b64url(raw),
                    "kid": kid,
                    "use": "sig",
                    "alg": ALGORITHM,
                }
            )
        return {"keys": keys}


@lru_cache
def get_key_manager() -> KeyManager:
    """Process-wide key manager."""
    return KeyManager()
