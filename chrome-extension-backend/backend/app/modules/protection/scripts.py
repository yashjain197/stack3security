"""
Script check. URLs from jsDelivr and unpkg are turned into package ids, then checked against the graph and Socket.

The script source is never uploaded. Socket is skipped, and said so, when SOCKET_API_KEY is not set.

Made by Yash Jain with passion.
"""

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
_SOCKET_SKIP = {"pendingscan", "notfound"}
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
    """Ask Socket about every package in one call. A failure leaves the graph result standing."""
    key = get_settings().socket_api_key
    if key is None:
        return [], True
    try:
        response = await get_http().post(
            _SOCKET,
            params={"alerts": "true"},
            headers={"Authorization": f"Bearer {key.get_secret_value()}"},
            json={"components": [{"purl": purl} for purl in purls]},
        )
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError):
        return [], True
    found = []
    for severity, title, purl in _alerts(body):
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
    return found, False


def _alerts(body: object) -> list[tuple[str, str, str]]:
    """Pull (severity, title, purl) from a batch response or a single package object."""
    artifacts: list[object] = body if isinstance(body, list) else [body]
    pairs = []
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            continue
        purl = str(artifact.get("inputPurl") or artifact.get("purl") or "the package")
        rows = list(artifact.get("alerts") or [])
        for component in artifact.get("components") or []:
            if isinstance(component, dict):
                rows.extend(component.get("alerts") or [])
                if not purl or purl == "the package":
                    purl = str(component.get("purl") or purl)
        for row in rows:
            if not isinstance(row, dict):
                continue
            kind = str(row.get("type") or "").lower()
            if kind in _SOCKET_SKIP:
                continue
            severity = str(row.get("severity") or "").lower()
            title = str(row.get("title") or row.get("type") or "Socket reported an issue")
            if severity:
                pairs.append((severity, title[:200], purl))
    return pairs
