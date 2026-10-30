"""
Script check. URLs from jsDelivr and unpkg are turned into package ids, then checked against the graph and Socket.

The script source is never uploaded. Socket is skipped, and said so, when SOCKET_API_KEY is not set.

Made by Yash Jain with passion.
"""

import asyncio
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.base import utcnow
from app.modules.graph.catalog import normalize_node
from app.modules.protection.domain import check_domain
from app.modules.protection.http import get_http
from app.modules.protection.lookup import graph_finding, known_nodes
from app.modules.protection.schemas import ScriptCheckIn
from app.modules.protection.verdicts import finding, finish
from app.schemas.verdict import Finding, Indicators, Layer, Level, Source, Target, TargetType, Verdict

_SOCKET = "https://api.socket.dev/v0/purl"
_SOCKET_LEVEL = {"critical": Level.CRITICAL, "high": Level.HIGH, "medium": Level.CAUTION, "middle": Level.CAUTION}
_MAX_SOCKET = 15


@dataclass(frozen=True)
class _Script:
    """One script URL, plus the package id when the URL names an npm package and version."""

    url: str
    endpoint_id: str | None
    purl: str | None


async def check_scripts(db: AsyncSession, body: ScriptCheckIn) -> Verdict:
    """Score the scripts a page loaded. A known-malicious package or URL is critical."""
    checked_at = utcnow()
    found: list[Finding] = []
    skipped: list[str] = []
    domains: list[str] = []
    if body.origin:
        try:
            site = await check_domain(db, body.origin)
        except AppError:
            site = None
        else:
            found.extend(site.findings)
            skipped.extend(site.not_checked)
            domains.extend(site.indicators.domains)

    scripts = [_parse(url) for url in body.scripts]
    keys: list[tuple[str, str]] = []
    for script in scripts:
        if script.endpoint_id:
            keys.append(("endpoint", script.endpoint_id))
        if script.purl:
            keys.append(("package", script.purl))
    nodes = await known_nodes(db, keys)

    for script in scripts:
        if script.endpoint_id:
            row = nodes.get(("endpoint", script.endpoint_id))
            if row is not None:
                hit = graph_finding(row, "script", checked_at)
                if hit is not None:
                    found.append(hit)
        if script.purl:
            row = nodes.get(("package", script.purl))
            if row is not None:
                hit = graph_finding(row, "package", checked_at)
                if hit is not None:
                    found.append(hit)

    purls = [script.purl for script in scripts if script.purl][:_MAX_SOCKET]
    if not get_settings().socket_configured:
        skipped.append("socket")
    elif purls:
        socket_found, socket_failed = await _socket_all(purls, checked_at)
        found.extend(socket_found)
        if socket_failed:
            skipped.append("socket")
    if len([script.purl for script in scripts if script.purl]) > _MAX_SOCKET:
        skipped.append("socket")

    target = scripts[0].endpoint_id or scripts[0].url
    return finish(
        Target(type=TargetType.PACKAGE if any(script.purl for script in scripts) else TargetType.SITE, id=target[:512]),
        found,
        not_checked=skipped,
        indicators=Indicators(domains=list(dict.fromkeys(domains))),
        incomplete=False,
    )


def _parse(url: str) -> _Script:
    """Keep a canonical URL and, for cdn.jsdelivr.net and unpkg.com, the npm package URL."""
    text = url.strip()
    endpoint_id = None
    try:
        endpoint_id = normalize_node("endpoint", text).vertex_id
    except ValueError:
        endpoint_id = None
    return _Script(text, endpoint_id, _purl(text))


def _purl(url: str) -> str | None:
    """pkg:npm name and version from a jsDelivr or unpkg URL. Other hosts have no package id."""
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower().removeprefix("www.")
    if host == "cdn.jsdelivr.net" and parts.path.startswith("/npm/"):
        spec = parts.path[len("/npm/") :]
    elif host == "unpkg.com":
        spec = parts.path.lstrip("/")
    else:
        return None
    if spec.startswith("@"):
        scope, _, rest = spec.partition("/")
        name, sep, tail = rest.partition("@")
        package = f"{scope}/{name}" if sep and name else ""
    else:
        package, sep, tail = spec.partition("@")
    if not sep or not package or package.endswith("/"):
        return None
    version = tail.split("/", 1)[0]
    if not version or "/" in version or len(version) > 80:
        return None
    return f"pkg:npm/{package}@{version}"


async def _socket_all(purls: list[str], checked_at) -> tuple[list[Finding], bool]:
    """Check up to 15 packages at Socket. One failure does not throw away the others."""
    sem = asyncio.Semaphore(5)

    async def one(purl: str) -> list[Finding] | None:
        async with sem:
            return await _socket_one(purl, checked_at)

    results = await asyncio.gather(*(one(purl) for purl in purls))
    found: list[Finding] = []
    failed = False
    for item in results:
        if item is None:
            failed = True
        else:
            found.extend(item)
    return found, failed


async def _socket_one(purl: str, checked_at) -> list[Finding] | None:
    """Findings from Socket for one package. None means Socket did not answer."""
    key = get_settings().socket_api_key
    if key is None:
        return None
    try:
        response = await get_http().get(
            _SOCKET,
            params={"purl": purl},
            headers={"Authorization": f"Bearer {key.get_secret_value()}"},
        )
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    found = []
    for severity, title in _alerts(body):
        level = _SOCKET_LEVEL.get(severity)
        if level is None:
            continue
        found.append(
            finding(
                layer=Layer.DEPENDENCY,
                severity=level,
                title=title,
                evidence=f"Socket.dev reported {severity} on {purl}.",
                source=Source.SOCKET,
                checked_at=checked_at,
            )
        )
    return found


def _alerts(body: object) -> list[tuple[str, str]]:
    """Pull (severity, title) pairs out of the shapes Socket has used for this endpoint."""
    rows: list[object] = []
    if isinstance(body, dict):
        for key in ("alerts", "issues"):
            if isinstance(body.get(key), list):
                rows.extend(body[key])
        for component in body.get("components") or []:
            if isinstance(component, dict) and isinstance(component.get("alerts"), list):
                rows.extend(component["alerts"])
    pairs = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        severity = str(row.get("severity") or "").lower()
        title = str(row.get("title") or row.get("type") or "Socket reported an issue")
        if severity:
            pairs.append((severity, title[:200]))
    return pairs
