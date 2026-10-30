"""
Call Imran's repo-scan service and pass the verdict through. The service key stays on this server.

Made by Yash Jain with passion.
"""

import httpx
from fastapi.responses import Response

from app.core.config import get_settings
from app.core.errors import AppError
from app.modules.protection.http import get_http
from app.modules.protection.schemas import RepoScanIn

_SCAN_TIMEOUT = httpx.Timeout(100.0, connect=4.0)


async def scan_repo(body: RepoScanIn) -> Response:
    """Clone and score one public GitHub repository. A slow scan is allowed up to Imran's limit."""
    payload = body.model_dump(by_alias=True, exclude_none=True)
    return await _forward("POST", "/v1/internal/scan-repo", payload)


async def scan_stats() -> Response:
    """Live scan counters for the website. They reset when Imran's service restarts."""
    return await _forward("GET", "/v1/internal/stats", None)


async def _forward(method: str, path: str, payload: dict | None) -> Response:
    """Send the service key to Imran and return his JSON. His 401 becomes our 502."""
    settings = get_settings()
    url = f"{settings.repo_scan_url.rstrip('/')}{path}"
    headers = {"X-Service-Key": settings.internal_service_key.get_secret_value()}
    try:
        response = await get_http().request(method, url, headers=headers, json=payload, timeout=_SCAN_TIMEOUT)
    except httpx.HTTPError as exc:
        raise AppError("scan_unavailable", "The repo scan service did not respond", 502) from exc
    if response.status_code == 401:
        raise AppError("scan_unavailable", "The repo scan service rejected the request", 502)
    if response.status_code >= 400:
        code, message = _remote_error(response)
        retry = response.headers.get("retry-after")
        raise AppError(code, message, response.status_code, headers={"Retry-After": retry} if retry else None)
    return Response(content=response.content, media_type="application/json")


def _remote_error(response: httpx.Response) -> tuple[str, str]:
    """Read Imran's error envelope. A body we cannot parse still becomes a scan failure."""
    try:
        body = response.json()
    except ValueError:
        body = None
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        code = str(error.get("code") or "scan_failed")
        message = str(error.get("message") or "Repo scan failed")
        return code[:80], message[:300]
    return "scan_failed", "Repo scan failed"
