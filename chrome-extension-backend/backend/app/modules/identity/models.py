"""
Identity tables (3NF): users, email OTPs, sessions, refresh tokens and device-link requests.

Secrets are never stored in plain text: OTPs are HMAC-peppered, refresh tokens and device codes are SHA-256.

Made by Yash Jain with passion.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    LargeBinary,
    SmallInteger,
    String,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin


class ClientType(enum.StrEnum):
    """Which Stack3 surface a session belongs to."""

    WEB = "web"
    CHROME = "chrome"
    VSCODE = "vscode"
    CLI = "cli"


def client_type_column() -> Enum:
    """VARCHAR + CHECK instead of a native Postgres enum, so adding values never needs a type migration."""
    return Enum(
        ClientType,
        name="client_type",
        native_enum=False,
        create_constraint=True,
        length=16,
        values_callable=lambda e: [m.value for m in e],
    )


class User(CreatedAtMixin, Base):
    """A person, identified by a verified email address."""

    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email = lower(email)", name="email_lowercase"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EmailOtp(CreatedAtMixin, Base):
    """One-time login code sent to an email; keyed by email because the user may not exist yet."""

    __tablename__ = "email_otps"
    __table_args__ = (
        Index("ix_email_otps_email_created_at", "email", "created_at"),
        CheckConstraint("attempts >= 0", name="attempts_non_negative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    code_hash: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    requested_ip: Mapped[str | None] = mapped_column(String(45))


class AuthSession(CreatedAtMixin, Base):
    """One signed-in device (website, Chrome, VS Code or CLI); revoking it kills all its refresh tokens."""

    __tablename__ = "auth_sessions"
    __table_args__ = (Index("ix_auth_sessions_user_id_active", "user_id", postgresql_where=text("revoked_at IS NULL")),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    client_type: Mapped[ClientType] = mapped_column(client_type_column(), nullable=False)
    device_name: Mapped[str | None] = mapped_column(String(100))
    created_ip: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[str | None] = mapped_column(String(40))

    user: Mapped[User] = relationship(lazy="raise")


class RefreshToken(CreatedAtMixin, Base):
    """One link in a session's rotation chain; a used token presented again means theft."""

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("auth_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("refresh_tokens.id", ondelete="SET NULL"))

    session: Mapped[AuthSession] = relationship(lazy="raise")


class LinkRequest(CreatedAtMixin, Base):
    """Device authorization request (RFC 8628 style) used by Chrome, VS Code and the CLI to sign in via the website."""

    __tablename__ = "link_requests"
    __table_args__ = (
        CheckConstraint("client_type <> 'web'", name="not_web"),
        CheckConstraint("NOT (approved_at IS NOT NULL AND denied_at IS NOT NULL)", name="single_decision"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    device_code_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True, nullable=False)
    user_code: Mapped[str] = mapped_column(String(9), unique=True, nullable=False)
    client_type: Mapped[ClientType] = mapped_column(client_type_column(), nullable=False)
    device_name: Mapped[str | None] = mapped_column(String(100))
    requested_ip: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    denied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("auth_sessions.id", ondelete="SET NULL"))
