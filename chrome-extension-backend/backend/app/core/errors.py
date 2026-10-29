"""
Uniform error envelope and exception handlers so every failure looks the same and never leaks internals.

Made by Yash Jain with passion.
"""

from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = structlog.get_logger("errors")


class AppError(Exception):
    """Expected business error with a stable machine-readable code."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        self.headers = headers


class Unauthorized(AppError):
    """Missing, invalid or expired credentials."""

    def __init__(self, message: str = "Authentication required", code: str = "unauthorized") -> None:
        super().__init__(code, message, 401, headers={"WWW-Authenticate": "Bearer"})


class Forbidden(AppError):
    """Authenticated but not allowed."""

    def __init__(self, message: str = "Not allowed", code: str = "forbidden") -> None:
        super().__init__(code, message, 403)


class NotFound(AppError):
    """Resource does not exist or is not visible to the caller."""

    def __init__(self, message: str = "Not found", code: str = "not_found") -> None:
        super().__init__(code, message, 404)


class RateLimited(AppError):
    """Too many requests for this key and window."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(
            "rate_limited",
            "Too many requests, try again later",
            429,
            details={"retryAfterSeconds": retry_after},
            headers={"Retry-After": str(retry_after)},
        )


def _request_id(request: Request) -> str | None:
    """Request ID set by the request-ID middleware."""
    return request.scope.get("state", {}).get("request_id")


def _envelope(request: Request, code: str, message: str, details: dict[str, Any] | None = None) -> dict:
    """Build the standard error body."""
    body: dict[str, Any] = {"code": code, "message": message, "requestId": _request_id(request)}
    if details:
        body["details"] = details
    return {"error": body}


def register_exception_handlers(app: FastAPI) -> None:
    """Attach handlers for business, validation, HTTP and unexpected errors."""

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            _envelope(request, exc.code, exc.message, exc.details), exc.status_code, headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [
            {"field": ".".join(str(p) for p in err["loc"] if p != "body"), "message": err["msg"]}
            for err in exc.errors()
        ]
        return JSONResponse(_envelope(request, "validation_error", "Invalid request", {"fields": fields}), 422)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed", 413: "payload_too_large"}.get(
            exc.status_code, "http_error"
        )
        return JSONResponse(
            _envelope(request, code, str(exc.detail)), exc.status_code, headers=getattr(exc, "headers", None)
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_error", path=request.url.path)
        return JSONResponse(_envelope(request, "internal_error", "Something went wrong"), 500)
