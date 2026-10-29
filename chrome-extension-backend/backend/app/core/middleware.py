"""
Pure ASGI middleware: request IDs, security headers, request body size cap and access logs.

Pure ASGI (not BaseHTTPMiddleware) so streaming responses like NDJSON keep working.

Made by Yash Jain with passion.
"""

import re
import time
import uuid

import structlog
from fastapi import HTTPException
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings

logger = structlog.get_logger("access")
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9\-]{8,64}$")


class RequestContextMiddleware:
    """Assigns a request ID, binds it to logs, adds security headers and logs one line per request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.is_production = get_settings().is_production

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = dict(scope["headers"]).get(b"x-request-id", b"").decode(errors="ignore")
        request_id = incoming if _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        started = time.perf_counter()
        status_holder = {"status": 500}
        path = scope["path"]

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = "no-referrer"
                headers["Cross-Origin-Resource-Policy"] = "same-site"
                headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
                if not path.startswith(("/docs", "/redoc", "/openapi.json")):
                    headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
                if path.startswith(("/v1/auth", "/v1/me", "/v1/billing", "/v1/teams")):
                    headers["Cache-Control"] = "no-store"
                if self.is_production:
                    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            logger.info(
                "request",
                method=scope["method"],
                path=path,
                status=status_holder["status"],
                duration_ms=round((time.perf_counter() - started) * 1000, 1),
            )


class BodySizeLimitMiddleware:
    """Rejects bodies over the limit, both by Content-Length and by counting streamed chunks."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > self.max_bytes):
            await self._reject(send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _BodyTooLarge:
            await self._reject(send)

    @staticmethod
    async def _reject(send: Send) -> None:
        """Send a 413 with the standard error envelope."""
        body = b'{"error":{"code":"payload_too_large","message":"Request body too large"}}'
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


class _BodyTooLarge(HTTPException):
    """Internal signal used to abort oversized streamed bodies; an HTTPException so FastAPI keeps the 413."""

    def __init__(self) -> None:
        super().__init__(status_code=413, detail="Request body too large")
