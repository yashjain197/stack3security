"""
Generate a new Ed25519 JWT signing key, printed base64-encoded for the JWT_PRIVATE_KEY secret.

Rotation: move the current public key to JWT_PREVIOUS_PUBLIC_KEY, set the new private key and a new JWT_KEY_ID.

Made by Yash Jain with passion.
"""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def main() -> None:
    """Print a fresh private key and its public key, both base64-encoded PEM."""
    key = Ed25519PrivateKey.generate()
    private_pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    public_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    print("JWT_PRIVATE_KEY=" + base64.b64encode(private_pem).decode())
    print("# public key (for JWT_PREVIOUS_PUBLIC_KEY during rotation):")
    print("# " + base64.b64encode(public_pem).decode())


if __name__ == "__main__":
    main()
