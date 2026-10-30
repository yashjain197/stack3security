"""
Public phishing lists, cached in memory. A failed refresh keeps the previous list.

Made by Yash Jain with passion.
"""

import asyncio
import hashlib
import time
from dataclasses import dataclass, field

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger
from app.modules.protection.http import get_http

logger = get_logger("protection.blocklist")

_METAMASK_URL = "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json"
_SCAMSNIFFER_URL = "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json"
_TTL_SECONDS = 6 * 60 * 60

# Real domains from the public seed. They stay listed even when the remote lists cannot be fetched.
_ALWAYS = frozenset(
    {
        "metamaskaku.azurewebsites.net",
        "ldegerwallet.azurewebsites.net",
        "v3-trezorsuite.com",
    }
)


@dataclass(frozen=True)
class Blocklists:
    """Hosts to treat as known-bad, plus MetaMask's fuzzylist (suspicious) and whitelist (do not lookalike-flag)."""

    metamask: frozenset[str] = field(default_factory=frozenset)
    scamsniffer: frozenset[str] = field(default_factory=frozenset)
    fuzzy: frozenset[str] = field(default_factory=frozenset)
    whitelist: frozenset[str] = field(default_factory=frozenset)
    remote_ok: bool = True

    def source(self, host: str) -> str | None:
        """Which list contains this host or one of its parents, if any."""
        names = []
        if _hit(host, self.metamask):
            names.append("the MetaMask phishing list")
        if _hit(host, self.scamsniffer):
            names.append("the ScamSniffer list")
        if not names and _hit(host, _ALWAYS):
            names.append("the Stack3 phishing seed")
        if not names:
            return None
        return " and ".join(names)

    def fuzzy_hit(self, host: str) -> bool:
        """True when MetaMask's fuzzylist contains this host. That list is suspicious, not a hard block."""
        return _hit(host, self.fuzzy)

    def allowed(self, host: str) -> bool:
        """True when MetaMask's whitelist contains this host, so lookalike rules stay quiet."""
        return _hit(host, self.whitelist)

    @property
    def domains(self) -> frozenset[str]:
        """Every hard-blocked host, for the bundle the extension caches."""
        return self.metamask | self.scamsniffer | _ALWAYS

    @property
    def etag(self) -> str:
        """Changes when the list changes, so the extension can skip a download it already has."""
        digest = hashlib.sha256("\n".join(sorted(self.domains)).encode()).hexdigest()
        return f'"{digest[:32]}"'


_cache: Blocklists | None = None
_loaded_at = 0.0
_lock = asyncio.Lock()


def set_blocklist(
    metamask: set[str] | None = None,
    scamsniffer: set[str] | None = None,
    fuzzy: set[str] | None = None,
    whitelist: set[str] | None = None,
) -> None:
    """Replace the cached lists. Tests use this instead of GitHub."""
    global _cache, _loaded_at
    _cache = Blocklists(
        frozenset(metamask or ()),
        frozenset(scamsniffer or ()),
        frozenset(fuzzy or ()),
        frozenset(whitelist or ()),
        remote_ok=True,
    )
    _loaded_at = time.monotonic()


def reset_blocklist() -> None:
    """Drop the cache so the next check loads it again."""
    global _cache, _loaded_at
    _cache = None
    _loaded_at = 0.0


async def current_blocklist() -> Blocklists:
    """The lists, refreshing in the background interval. Serves the previous copy when a refresh fails."""
    if not get_settings().rules_remote:
        return _cache or Blocklists()
    now = time.monotonic()
    if _cache is not None and now - _loaded_at < _TTL_SECONDS:
        return _cache
    async with _lock:
        now = time.monotonic()
        if _cache is not None and now - _loaded_at < _TTL_SECONDS:
            return _cache
        try:
            fresh = await _fetch()
        except Exception:
            logger.warning("blocklist_refresh_failed")
            if _cache is not None:
                return _cache
            fresh = Blocklists(remote_ok=False)
        _store(fresh)
        return fresh


def _store(lists: Blocklists) -> None:
    """Remember a fetch and when it happened."""
    global _cache, _loaded_at
    _cache = lists
    _loaded_at = time.monotonic()


async def _fetch() -> Blocklists:
    """Download both public lists. Either one failing still keeps the other."""
    client = get_http()
    metamask_raw, sniffer_raw = await asyncio.gather(
        _get_json(client, _METAMASK_URL), _get_json(client, _SCAMSNIFFER_URL)
    )
    if metamask_raw is None and sniffer_raw is None:
        raise RuntimeError("both blocklists failed")
    metamask: set[str] = set()
    fuzzy: set[str] = set()
    whitelist: set[str] = set()
    if isinstance(metamask_raw, dict):
        metamask = _hosts(metamask_raw.get("blacklist"))
        fuzzy = _hosts(metamask_raw.get("fuzzylist"))
        whitelist = _hosts(metamask_raw.get("whitelist"))
    sniffer = _hosts(sniffer_raw.get("domains") if isinstance(sniffer_raw, dict) else sniffer_raw)
    return Blocklists(frozenset(metamask), frozenset(sniffer), frozenset(fuzzy), frozenset(whitelist), remote_ok=True)


async def _get_json(client: httpx.AsyncClient, url: str) -> object | None:
    """GET one list. A bad response is a miss, not an exception, so the other list can still land."""
    try:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError):
        logger.warning("blocklist_fetch_failed", url=url)
        return None


def _hosts(value: object) -> set[str]:
    """Keep plain hostnames. Wildcards and URLs are dropped so a bad row cannot match everything."""
    if isinstance(value, dict):
        value = list(value.keys())
    if not isinstance(value, list):
        return set()
    hosts: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        host = item.strip().lower().removeprefix("www.").rstrip(".")
        if host and "." in host and "*" not in host and "/" not in host and len(host) <= 253 and " " not in host:
            hosts.add(host)
    return hosts


def _hit(host: str, hosts: frozenset[str]) -> bool:
    """True when the host or a parent domain is in the set."""
    parts = host.split(".")
    return any(".".join(parts[i:]) in hosts for i in range(len(parts) - 1))
