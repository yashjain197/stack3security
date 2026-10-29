"""
Session and token lifecycle: create sessions, mint 30-minute access JWTs, rotate refresh tokens, detect theft.

Refresh rotation: every refresh token works once. Presenting a used token again (outside a short grace window
for parallel tabs) means it was stolen, so the whole session is revoked.

Made by Yash Jain with passion.
"""

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import Unauthorized
from app.core.jwt import AUD_CORE, AUD_VSCODE, get_key_manager
from app.core.logging import get_logger
from app.core.security import new_opaque_token, sha256_digest
from app.db.base import utcnow
from app.modules.billing.entitlements import resolve_entitlements
from app.modules.identity.models import AuthSession, ClientType, RefreshToken, User

logger = get_logger("tokens")


@dataclass(frozen=True)
class IssuedTokens:
    """Everything a client needs after login or refresh."""

    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_in: int
    session: AuthSession
    user: User


def audiences_for(client: ClientType) -> list[str]:
    """Least privilege: Chrome tokens only work on this API; web, VS Code and CLI tokens also work on Imran's API."""
    return [AUD_CORE] if client == ClientType.CHROME else [AUD_CORE, AUD_VSCODE]


async def _new_refresh_token(db: AsyncSession, session: AuthSession) -> tuple[RefreshToken, str]:
    """Create one refresh token for a session, capped by the session's absolute expiry."""
    settings = get_settings()
    raw = new_opaque_token()
    expires_at = min(utcnow() + timedelta(days=settings.refresh_token_idle_ttl_days), session.expires_at)
    token = RefreshToken(id=uuid.uuid4(), session_id=session.id, token_hash=sha256_digest(raw), expires_at=expires_at)
    db.add(token)
    await db.flush()
    return token, raw


async def _mint(db: AsyncSession, user: User, session: AuthSession, refresh: RefreshToken, raw: str) -> IssuedTokens:
    """Sign an access token carrying the user's current entitlements."""
    settings = get_settings()
    entitlements = await resolve_entitlements(db, user.id)
    now = utcnow()
    ttl = settings.access_token_ttl_seconds
    claims = {
        "sub": str(user.id),
        "sid": str(session.id),
        "jti": uuid.uuid4().hex,
        "aud": audiences_for(session.client_type),
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(now.timestamp()) + ttl,
        "cid": session.client_type.value,
        "email": user.email,
        **entitlements.to_claims(),
    }
    return IssuedTokens(
        access_token=get_key_manager().sign(claims),
        expires_in=ttl,
        refresh_token=raw,
        refresh_expires_in=int((refresh.expires_at - now).total_seconds()),
        session=session,
        user=user,
    )


async def create_session(
    db: AsyncSession,
    user: User,
    client: ClientType,
    device_name: str | None,
    ip: str | None,
    user_agent: str | None,
) -> IssuedTokens:
    """Start a new signed-in device and issue its first token pair (caller commits)."""
    settings = get_settings()
    now = utcnow()
    session = AuthSession(
        id=uuid.uuid4(),
        user_id=user.id,
        client_type=client,
        device_name=device_name,
        created_ip=ip,
        user_agent=(user_agent or "")[:300] or None,
        last_used_at=now,
        expires_at=now + timedelta(days=settings.session_absolute_ttl_days),
    )
    db.add(session)
    await db.flush()
    refresh, raw = await _new_refresh_token(db, session)
    return await _mint(db, user, session, refresh, raw)


async def rotate_refresh_token(db: AsyncSession, raw: str) -> IssuedTokens:
    """Exchange a refresh token for a new pair (caller commits); reuse outside the grace window revokes the session."""
    settings = get_settings()
    now = utcnow()
    token = (
        await db.execute(select(RefreshToken).where(RefreshToken.token_hash == sha256_digest(raw)).with_for_update())
    ).scalar_one_or_none()
    if token is None:
        raise Unauthorized("Invalid refresh token", "invalid_refresh_token")

    session = (
        await db.execute(select(AuthSession).where(AuthSession.id == token.session_id).with_for_update())
    ).scalar_one()
    if session.revoked_at is not None or session.expires_at <= now:
        raise Unauthorized("Session has ended, sign in again", "session_revoked")

    user = await db.get(User, session.user_id)
    if user is None or user.disabled_at is not None:
        await revoke_session(db, session, "user_disabled")
        await db.commit()
        raise Unauthorized("Account disabled", "account_disabled")

    if token.used_at is not None:
        if (now - token.used_at).total_seconds() > settings.refresh_reuse_grace_seconds:
            await revoke_session(db, session, "refresh_reuse")
            await db.commit()
            logger.warning("refresh_token_reuse_detected", session_id=str(session.id), user_id=str(user.id))
            raise Unauthorized("Session has ended, sign in again", "session_revoked")
    elif token.expires_at <= now:
        raise Unauthorized("Refresh token expired, sign in again", "refresh_token_expired")

    new_token, new_raw = await _new_refresh_token(db, session)
    if token.used_at is None:
        token.used_at = now
        token.replaced_by_id = new_token.id
    session.last_used_at = now
    return await _mint(db, user, session, new_token, new_raw)


async def revoke_session(db: AsyncSession, session: AuthSession, reason: str) -> None:
    """Mark a session revoked; its refresh tokens stop working immediately (caller commits)."""
    if session.revoked_at is None:
        session.revoked_at = utcnow()
        session.revoke_reason = reason


async def revoke_all_sessions(db: AsyncSession, user_id: uuid.UUID, reason: str) -> int:
    """Revoke every active session of a user (caller commits); returns how many were revoked."""
    result = await db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=utcnow(), revoke_reason=reason)
    )
    return result.rowcount or 0
