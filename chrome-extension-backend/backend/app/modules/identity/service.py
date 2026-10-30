"""
Identity business logic: email OTP login and device linking for Chrome, VS Code and the CLI.

Made by Yash Jain with passion.
"""

import uuid
from datetime import timedelta
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, Forbidden, NotFound
from app.core.rate_limit import Limits, RateLimiter
from app.core.security import (
    constant_time_equals,
    new_numeric_code,
    new_opaque_token,
    new_user_code,
    normalize_user_code,
    peppered_hash,
    sha256_digest,
)
from app.db.base import utcnow
from app.modules.identity.email import send_login_code
from app.modules.identity.models import ClientType, EmailOtp, LinkRequest, User
from app.modules.identity.schemas import LinkStartOut, OtpRequestOut
from app.modules.identity.tokens import IssuedTokens, create_session

LinkStatus = Literal["pending", "approved", "denied", "expired", "consumed"]


def _otp_hash(email: str, code: str) -> bytes:
    """Bind the code to the email so a code for one address is useless for another."""
    return peppered_hash(f"otp:{email}:{code}")


async def request_otp(db: AsyncSession, limiter: RateLimiter, email: str, ip: str) -> OtpRequestOut:
    """Email a fresh login code; within the cooldown, silently reuse the existing one."""
    settings = get_settings()
    await limiter.hit(Limits.OTP_REQUEST_IP, ip)
    await limiter.hit(Limits.OTP_REQUEST_EMAIL, email)
    now = utcnow()

    latest = (
        await db.execute(select(EmailOtp).where(EmailOtp.email == email).order_by(EmailOtp.created_at.desc()).limit(1))
    ).scalar_one_or_none()
    if latest is not None and latest.consumed_at is None and latest.expires_at > now:
        elapsed = (now - latest.created_at).total_seconds()
        if elapsed < settings.otp_resend_cooldown_seconds:
            return OtpRequestOut(
                expires_in_seconds=int((latest.expires_at - now).total_seconds()),
                retry_after_seconds=int(settings.otp_resend_cooldown_seconds - elapsed) + 1,
            )

    await db.execute(
        update(EmailOtp).where(EmailOtp.email == email, EmailOtp.consumed_at.is_(None)).values(consumed_at=now)
    )
    code = new_numeric_code()
    db.add(
        EmailOtp(
            email=email,
            code_hash=_otp_hash(email, code),
            expires_at=now + timedelta(seconds=settings.otp_ttl_seconds),
            requested_ip=ip,
            created_at=now,
        )
    )
    await db.flush()
    await send_login_code(email, code, settings.otp_ttl_seconds // 60)
    await db.commit()
    return OtpRequestOut(
        expires_in_seconds=settings.otp_ttl_seconds, retry_after_seconds=settings.otp_resend_cooldown_seconds
    )


async def _get_or_create_user(db: AsyncSession, email: str) -> User:
    """Race-safe upsert of a user by email."""
    await db.execute(insert(User).values(id=uuid.uuid4(), email=email).on_conflict_do_nothing(index_elements=["email"]))
    return (await db.execute(select(User).where(User.email == email))).scalar_one()


async def verify_otp(
    db: AsyncSession,
    limiter: RateLimiter,
    email: str,
    code: str,
    client: ClientType,
    device_name: str | None,
    ip: str,
    user_agent: str | None,
) -> IssuedTokens:
    """Check the code (max attempts, single use, constant time) and open a session."""
    settings = get_settings()
    await limiter.hit(Limits.OTP_VERIFY_IP, ip)
    now = utcnow()
    invalid = AppError("invalid_code", "Invalid or expired code", 400)

    otp = (
        await db.execute(
            select(EmailOtp)
            .where(EmailOtp.email == email, EmailOtp.consumed_at.is_(None))
            .order_by(EmailOtp.created_at.desc())
            .limit(1)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if otp is None or otp.expires_at <= now:
        raise invalid

    if not constant_time_equals(_otp_hash(email, code), otp.code_hash):
        otp.attempts += 1
        remaining = max(settings.otp_max_attempts - otp.attempts, 0)
        if remaining == 0:
            otp.consumed_at = now
        await db.commit()
        raise AppError("invalid_code", "Invalid or expired code", 400, details={"attemptsRemaining": remaining})

    otp.consumed_at = now
    user = await _get_or_create_user(db, email)
    if user.disabled_at is not None:
        await db.commit()
        raise Forbidden("This account is disabled", "account_disabled")
    user.last_login_at = now
    issued = await create_session(db, user, client, device_name, ip, user_agent)
    await db.commit()
    return issued


def link_status(link: LinkRequest) -> LinkStatus:
    """Derive the state of a link request from its timestamps."""
    if link.consumed_at is not None:
        return "consumed"
    if link.denied_at is not None:
        return "denied"
    if link.expires_at <= utcnow():
        return "expired"
    if link.approved_at is not None:
        return "approved"
    return "pending"


async def start_link(
    db: AsyncSession,
    limiter: RateLimiter,
    client: ClientType,
    device_name: str | None,
    ip: str,
    user_agent: str | None,
) -> LinkStartOut:
    """Create a device-link request and return the codes the client shows and polls with."""
    settings = get_settings()
    await limiter.hit(Limits.LINK_START_IP, ip)
    device_code = new_opaque_token()
    user_code = new_user_code()
    while (await db.execute(select(LinkRequest.id).where(LinkRequest.user_code == user_code))).first():
        user_code = new_user_code()

    db.add(
        LinkRequest(
            device_code_hash=sha256_digest(device_code),
            user_code=user_code,
            client_type=client,
            device_name=device_name,
            requested_ip=ip,
            user_agent=(user_agent or "")[:300] or None,
            expires_at=utcnow() + timedelta(seconds=settings.link_ttl_seconds),
        )
    )
    await db.commit()
    verification_uri = f"{settings.web_app_url.rstrip('/')}/link"
    return LinkStartOut(
        device_code=device_code,
        user_code=user_code,
        verification_uri=verification_uri,
        verification_uri_complete=f"{verification_uri}?code={user_code}",
        expires_in=settings.link_ttl_seconds,
        interval=settings.link_poll_interval_seconds,
    )


async def get_link_by_user_code(db: AsyncSession, user_code: str, for_update: bool = False) -> LinkRequest:
    """Find a link request by the code the user typed."""
    query = select(LinkRequest).where(LinkRequest.user_code == normalize_user_code(user_code))
    if for_update:
        query = query.with_for_update()
    link = (await db.execute(query)).scalar_one_or_none()
    if link is None:
        raise NotFound("Unknown or expired code", "link_not_found")
    return link


async def decide_link(db: AsyncSession, user_id: uuid.UUID, user_code: str, approve: bool) -> LinkStatus:
    """The signed-in website user approves or denies a pending link request."""
    link = await get_link_by_user_code(db, user_code, for_update=True)
    if link_status(link) != "pending":
        raise AppError("link_not_pending", "This code was already used or has expired", 409)
    now = utcnow()
    if approve:
        link.approved_by_user_id = user_id
        link.approved_at = now
    else:
        link.denied_at = now
    await db.commit()
    return link_status(link)


async def poll_link(
    db: AsyncSession, limiter: RateLimiter, device_code: str, ip: str, user_agent: str | None
) -> IssuedTokens:
    """Client polling; returns tokens once approved, otherwise an RFC 8628 error code."""
    settings = get_settings()
    await limiter.hit(Limits.LINK_POLL_IP, ip)
    link = (
        await db.execute(
            select(LinkRequest).where(LinkRequest.device_code_hash == sha256_digest(device_code)).with_for_update()
        )
    ).scalar_one_or_none()
    if link is None:
        raise AppError("invalid_device_code", "Unknown device code", 400)

    now = utcnow()
    too_fast = (
        link.last_polled_at is not None
        and (now - link.last_polled_at).total_seconds() < settings.link_poll_interval_seconds - 1
    )
    link.last_polled_at = now
    status = link_status(link)

    if too_fast and status == "pending":
        await db.commit()
        raise AppError(
            "slow_down",
            "Polling too fast",
            400,
            details={"interval": settings.link_poll_interval_seconds + 5},
        )
    if status in ("expired", "consumed"):
        await db.commit()
        raise AppError("expired_token", "This link request has expired, start again", 400)
    if status == "denied":
        await db.commit()
        raise AppError("access_denied", "The request was denied", 400)
    if status == "pending":
        await db.commit()
        raise AppError("authorization_pending", "Waiting for approval on the website", 400)

    user = await db.get(User, link.approved_by_user_id)
    if user is None or user.disabled_at is not None:
        link.consumed_at = now
        await db.commit()
        raise AppError("access_denied", "The request was denied", 400)

    issued = await create_session(db, user, link.client_type, link.device_name, ip, user_agent)
    link.consumed_at = now
    link.session_id = issued.session.id
    await db.commit()
    return issued
