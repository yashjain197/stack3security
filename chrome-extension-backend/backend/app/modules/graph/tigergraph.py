"""
Async TigerGraph client: exchanges the graph secret for a short-lived token and upserts or reads vertices and edges.

Tokens come from `/gsql/v1/tokens`. The older `/restpp/requesttoken` endpoint returns 400 on Savanna 4.x.

Made by Yash Jain with passion.
"""

import asyncio
import time
from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger

logger = get_logger("tigergraph")

_TOKEN_TTL_SECONDS = 3000


class GraphUnavailable(AppError):
    """TigerGraph rejected the call or could not be reached."""

    def __init__(self, message: str = "Threat graph is unavailable, try again") -> None:
        super().__init__("graph_unavailable", message, 503)


class TigerGraphClient:
    """One shared client. The token is cached and renewed before it expires, and once more after a 401."""

    def __init__(self, http: httpx.AsyncClient | None = None) -> None:
        self._http = http or httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))
        self._owns_http = http is None
        self._token: str | None = None
        self._token_until = 0.0
        self._lock = asyncio.Lock()

    async def aclose(self) -> None:
        """Close the underlying connection pool."""
        if self._owns_http:
            await self._http.aclose()

    def _url(self, path: str) -> str:
        """Absolute URL on the workspace host."""
        return f"{get_settings().tigergraph_host.rstrip('/')}{path}"

    async def _bearer(self) -> str:
        """Return a valid token, requesting a new one when the cached one is near expiry."""
        if self._token and time.monotonic() < self._token_until:
            return self._token
        async with self._lock:
            if self._token and time.monotonic() < self._token_until:
                return self._token
            secret = get_settings().tigergraph_secret
            if secret is None:
                raise GraphUnavailable("Threat graph is not configured")
            try:
                response = await self._http.post(
                    self._url("/gsql/v1/tokens"),
                    json={"secret": secret.get_secret_value(), "lifetime": "3600"},
                )
            except httpx.HTTPError as exc:
                raise GraphUnavailable() from exc
            if response.status_code >= 400 or response.json().get("error"):
                logger.error("tigergraph_token_failed", status=response.status_code)
                raise GraphUnavailable("Threat graph authentication failed")
            self._token = response.json()["token"]
            self._token_until = time.monotonic() + _TOKEN_TTL_SECONDS
            return self._token

    async def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> httpx.Response:
        """Call REST++ with a bearer token, refreshing the token once if it was rejected."""
        response: httpx.Response | None = None
        for attempt in (1, 2):
            try:
                response = await self._http.request(
                    method, self._url(path), json=body, headers={"Authorization": f"Bearer {await self._bearer()}"}
                )
            except httpx.HTTPError as exc:
                raise GraphUnavailable() from exc
            if response.status_code != 401 or attempt == 2:
                return response
            self._token = None
        assert response is not None
        return response

    async def upsert(self, vertices: dict[str, Any], edges: dict[str, Any]) -> None:
        """Insert or overwrite vertices and edges. Repeating the same payload changes nothing."""
        graph = get_settings().tigergraph_graph
        payload = {key: value for key, value in (("vertices", vertices), ("edges", edges)) if value}
        response = await self._request("POST", f"/restpp/graph/{graph}", payload)
        body = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
        if response.status_code >= 400 or body.get("error"):
            logger.error("tigergraph_upsert_failed", status=response.status_code, body=response.text[:300])
            raise GraphUnavailable(f"Threat graph rejected the update ({response.status_code})")

    async def get_vertex(self, vertex_type: str, vertex_id: str) -> dict[str, Any] | None:
        """Return one vertex's attributes, or None when it is not in the graph."""
        graph = get_settings().tigergraph_graph
        response = await self._request(
            "GET", f"/restpp/graph/{graph}/vertices/{vertex_type}/{quote(vertex_id, safe='')}"
        )
        if response.status_code == 404 or response.json().get("error"):
            return None
        results = response.json().get("results") or []
        return results[0] if results else None

    async def get_edges(self, vertex_type: str, vertex_id: str) -> list[dict[str, Any]]:
        """Return every edge that starts at this vertex, including reverse edges (so incoming links are visible)."""
        graph = get_settings().tigergraph_graph
        path = f"/restpp/graph/{graph}/edges/{vertex_type}/{quote(vertex_id, safe='')}?limit=200"
        response = await self._request("GET", path)
        if response.status_code >= 400 or response.json().get("error"):
            raise GraphUnavailable("Threat graph could not return neighbours")
        return list(response.json().get("results") or [])


_client: TigerGraphClient | None = None


def get_tigergraph() -> TigerGraphClient:
    """Process-wide client."""
    global _client
    if _client is None:
        _client = TigerGraphClient()
    return _client


async def close_tigergraph() -> None:
    """Close the shared client at shutdown."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
