"""
FastAPI dependencies for authentication: bearer JWT, live session check, web-only routes, internal service key.

Made by Yash Jain with passion.
"""

import uuid
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import Forbidden, Unauthorized
from app.core.jwt import AUD_CORE, get_key_manager
from app.core.rate_limit import RateLimiter, get_rate_limiter
from app.core.security import constant_time_equals
from app.db.base import utcnow
from app.db.session import get_db
from app.modules.identity.models import AuthSession, ClientType, User

DbSession = Annotated[AsyncSession, Depends(get_db)]
Limiter = Annotated[RateLimiter, Depends(get_rate_limiter)]


@dataclass(frozen=True)
class Principal:
    """The authenticated caller: user, session and token claims."""

    user: User
    session_id: uuid.UUID
    client: ClientType
    claims: dict[str, Any]


def client_ip(request: Request) -> str:
    """Caller IP; uvicorn resolves X-Forwarded-For only from the trusted proxy."""
    return request.client.host if request.client else "unknown"


def _bearer_token(authorization: str | None) -> str:
    """Extract the token from an `Authorization: Bearer` header."""
    if not authorization:
        raise Unauthorized()
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token or len(token) > 4096:
        raise Unauthorized("Invalid authorization header", "invalid_token")
    return token.strip()


async def get_principal(db: DbSession, authorization: Annotated[str | None, Header()] = None) -> Principal:
    """Verify the access token and confirm its session is still alive, so logout is instant on this API."""
    claims = get_key_manager().verify(_bearer_token(authorization), AUD_CORE)
    try:
        session_id, user_id = uuid.UUID(claims["sid"]), uuid.UUID(claims["sub"])
    except (ValueError, KeyError) as exc:
        raise Unauthorized("Invalid token", "invalid_token") from exc

    row = (
        await db.execute(
            select(AuthSession, User)
            .join(User, User.id == AuthSession.user_id)
            .where(AuthSession.id == session_id, AuthSession.user_id == user_id)
        )
    ).first()
    if row is None:
        raise Unauthorized("Session not found", "session_revoked")
    session, user = row
    if session.revoked_at is not None or session.expires_at <= utcnow():
        raise Unauthorized("Session has ended, sign in again", "session_revoked")
    if user.disabled_at is not None:
        raise Forbidden("This account is disabled", "account_disabled")
    return Principal(user=user, session_id=session.id, client=session.client_type, claims=claims)


CurrentPrincipal = Annotated[Principal, Depends(get_principal)]


async def get_web_principal(principal: CurrentPrincipal) -> Principal:
    """Only website sessions may approve device links and manage billing or teams."""
    if principal.client != ClientType.WEB:
        raise Forbidden("This action is only available on the Stack3 website", "web_session_required")
    return principal


WebPrincipal = Annotated[Principal, Depends(get_web_principal)]


async def require_internal_service(x_service_key: Annotated[str | None, Header()] = None) -> None:
    """Service-to-service auth for /internal routes (Imran's VS Code API); the proxy also blocks them publicly."""
    expected = get_settings().internal_service_key.get_secret_value().encode()
    if not x_service_key or not constant_time_equals(x_service_key.encode(), expected):
        raise Unauthorized("Invalid service key", "invalid_service_key")
