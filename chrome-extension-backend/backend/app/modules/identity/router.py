"""
HTTP routes for login, token refresh, logout, sessions, device linking, /me and the public JWKS.

Website clients receive the refresh token as an httpOnly cookie; Chrome, VS Code and the CLI receive it in the body.

Made by Yash Jain with passion.
"""

import uuid

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import Forbidden, NotFound, Unauthorized
from app.core.jwt import get_key_manager
from app.core.rate_limit import Limits
from app.db.base import utcnow
from app.modules.billing.entitlements import resolve_entitlements
from app.modules.identity import service
from app.modules.identity.dependencies import CurrentPrincipal, DbSession, Limiter, WebPrincipal, client_ip
from app.modules.identity.models import AuthSession, ClientType
from app.modules.identity.schemas import (
    LinkDecisionIn,
    LinkDetailsOut,
    LinkStartIn,
    LinkStartOut,
    LinkTokenIn,
    MeOut,
    OtpRequestIn,
    OtpRequestOut,
    OtpVerifyIn,
    RefreshIn,
    SessionOut,
    TeamOut,
    TokenPairOut,
    UserOut,
)
from app.modules.identity.tokens import (
    IssuedTokens,
    revoke_all_sessions,
    revoke_session,
    rotate_refresh_token,
)

router = APIRouter(prefix="/v1/auth", tags=["auth"])
me_router = APIRouter(prefix="/v1", tags=["auth"])
jwks_router = APIRouter(tags=["auth"])


def _cookie_name() -> str:
    """The __Secure- prefix is only valid on Secure cookies."""
    settings = get_settings()
    name = settings.refresh_cookie_name
    return name if settings.cookie_secure else name.removeprefix("__Secure-")


def _set_refresh_cookie(response: Response, issued: IssuedTokens) -> None:
    """Store the web refresh token where JavaScript cannot read it."""
    settings = get_settings()
    response.set_cookie(
        key=_cookie_name(),
        value=issued.refresh_token,
        max_age=issued.refresh_expires_in,
        path=settings.refresh_cookie_path,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="strict",
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Remove the web refresh cookie."""
    settings = get_settings()
    response.delete_cookie(
        key=_cookie_name(),
        path=settings.refresh_cookie_path,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="strict",
    )


def _require_trusted_origin(request: Request) -> None:
    """CSRF guard for cookie-authenticated calls: the Origin must be our website."""
    origin = request.headers.get("origin")
    if origin is None or origin not in get_settings().cors_origins:
        raise Forbidden("Untrusted origin", "untrusted_origin")


def _token_response(response: Response, issued: IssuedTokens) -> TokenPairOut:
    """Shape tokens per client: cookie for web, body for everything else."""
    is_web = issued.session.client_type == ClientType.WEB
    if is_web:
        _set_refresh_cookie(response, issued)
    return TokenPairOut(
        access_token=issued.access_token,
        expires_in=issued.expires_in,
        refresh_token=None if is_web else issued.refresh_token,
        refresh_expires_in=issued.refresh_expires_in,
        session_id=issued.session.id,
        user=UserOut.model_validate(issued.user),
    )


@router.post("/otp/request", response_model=OtpRequestOut, status_code=status.HTTP_202_ACCEPTED)
async def request_otp(body: OtpRequestIn, request: Request, db: DbSession, limiter: Limiter) -> OtpRequestOut:
    """Email a 6-digit login code."""
    return await service.request_otp(db, limiter, body.email, client_ip(request))


@router.post("/otp/verify", response_model=TokenPairOut)
async def verify_otp(
    body: OtpVerifyIn, request: Request, response: Response, db: DbSession, limiter: Limiter
) -> TokenPairOut:
    """Exchange the code for an access token and refresh token."""
    if body.client == ClientType.WEB:
        _require_trusted_origin(request)
    issued = await service.verify_otp(
        db,
        limiter,
        body.email,
        body.code,
        body.client,
        body.device_name,
        client_ip(request),
        request.headers.get("user-agent"),
    )
    return _token_response(response, issued)


@router.post("/refresh", response_model=TokenPairOut)
async def refresh(
    request: Request, response: Response, db: DbSession, limiter: Limiter, body: RefreshIn | None = None
) -> TokenPairOut:
    """Rotate the refresh token and get a new 30-minute access token."""
    await limiter.hit(Limits.REFRESH_IP, client_ip(request))
    raw = body.refresh_token if body and body.refresh_token else None
    from_cookie = raw is None
    if from_cookie:
        _require_trusted_origin(request)
        raw = request.cookies.get(_cookie_name())
    if not raw:
        raise Unauthorized("Missing refresh token", "invalid_refresh_token")
    issued = await rotate_refresh_token(db, raw)
    if from_cookie != (issued.session.client_type == ClientType.WEB):
        await db.rollback()
        raise Unauthorized("Invalid refresh token", "invalid_refresh_token")
    await db.commit()
    return _token_response(response, issued)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(principal: CurrentPrincipal, response: Response, db: DbSession) -> Response:
    """End the current session on this device."""
    session = await db.get(AuthSession, principal.session_id)
    if session is not None:
        await revoke_session(db, session, "logout")
        await db.commit()
    response.status_code = status.HTTP_204_NO_CONTENT
    _clear_refresh_cookie(response)
    return response


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(principal: CurrentPrincipal, response: Response, db: DbSession) -> Response:
    """End every session of this user on every device."""
    await revoke_all_sessions(db, principal.user.id, "logout_all")
    await db.commit()
    response.status_code = status.HTTP_204_NO_CONTENT
    _clear_refresh_cookie(response)
    return response


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(principal: CurrentPrincipal, db: DbSession) -> list[SessionOut]:
    """Active sessions so the user can see every signed-in device."""
    sessions = (
        await db.execute(
            select(AuthSession)
            .where(
                AuthSession.user_id == principal.user.id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > utcnow(),
            )
            .order_by(AuthSession.last_used_at.desc())
        )
    ).scalars()
    return [
        SessionOut(
            id=s.id,
            client=s.client_type,
            device_name=s.device_name,
            created_ip=s.created_ip,
            created_at=s.created_at,
            last_used_at=s.last_used_at,
            current=s.id == principal.session_id,
        )
        for s in sessions
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_one_session(session_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession) -> Response:
    """Sign out one specific device."""
    session = await db.get(AuthSession, session_id)
    if session is None or session.user_id != principal.user.id:
        raise NotFound("Session not found")
    await revoke_session(db, session, "revoked_by_user")
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/link/start", response_model=LinkStartOut, status_code=status.HTTP_201_CREATED)
async def link_start(body: LinkStartIn, request: Request, db: DbSession, limiter: Limiter) -> LinkStartOut:
    """Chrome, VS Code or CLI asks to be linked to the website login."""
    return await service.start_link(
        db,
        limiter,
        ClientType(body.client),
        body.device_name,
        client_ip(request),
        request.headers.get("user-agent"),
    )


@router.get("/link/requests/{user_code}", response_model=LinkDetailsOut)
async def link_details(user_code: str, principal: WebPrincipal, db: DbSession, limiter: Limiter) -> LinkDetailsOut:
    """Website shows which device is asking before the user approves."""
    await limiter.hit(Limits.LINK_APPROVE_USER, str(principal.user.id))
    link = await service.get_link_by_user_code(db, user_code)
    return LinkDetailsOut(
        user_code=link.user_code,
        client=link.client_type,
        device_name=link.device_name,
        requested_ip=link.requested_ip,
        created_at=link.created_at,
        expires_at=link.expires_at,
        status=service.link_status(link),
    )


@router.post("/link/approve", response_model=LinkDetailsOut)
async def link_decide(body: LinkDecisionIn, principal: WebPrincipal, db: DbSession, limiter: Limiter) -> LinkDetailsOut:
    """Website user approves or denies the device."""
    await limiter.hit(Limits.LINK_APPROVE_USER, str(principal.user.id))
    await service.decide_link(db, principal.user.id, body.user_code, body.approve)
    link = await service.get_link_by_user_code(db, body.user_code)
    return LinkDetailsOut(
        user_code=link.user_code,
        client=link.client_type,
        device_name=link.device_name,
        requested_ip=link.requested_ip,
        created_at=link.created_at,
        expires_at=link.expires_at,
        status=service.link_status(link),
    )


@router.post("/link/token", response_model=TokenPairOut)
async def link_token(
    body: LinkTokenIn, request: Request, response: Response, db: DbSession, limiter: Limiter
) -> TokenPairOut:
    """Device polls until approved, then receives its own token pair."""
    issued = await service.poll_link(
        db, limiter, body.device_code, client_ip(request), request.headers.get("user-agent")
    )
    return _token_response(response, issued)


@me_router.get("/me", response_model=MeOut, tags=["account"])
async def me(principal: CurrentPrincipal, db: DbSession) -> MeOut:
    """Current user with live plan and features (fresher than the token claims)."""
    ent = await resolve_entitlements(db, principal.user.id)
    return MeOut(
        user=UserOut.model_validate(principal.user),
        plan=ent.plan,
        status=ent.status,
        features=list(ent.features),
        limits=ent.limits,
        team=TeamOut(id=ent.team.id, name=ent.team.name, role=ent.team.role) if ent.team else None,
        trial_ends_at=ent.trial_ends_at,
        current_period_end=ent.current_period_end,
        cancel_at_period_end=ent.cancel_at_period_end,
    )


@jwks_router.get("/.well-known/jwks.json", include_in_schema=False)
async def jwks(response: Response) -> dict:
    """Public signing keys for Imran's API and any other verifier."""
    response.headers["Cache-Control"] = "public, max-age=300"
    return get_key_manager().jwks()
