"""
Registration date from the public RDAP service. A young lookalike is a stronger warning than the name alone.

Made by Yash Jain with passion.
"""

import time
from datetime import datetime

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.base import utcnow
from app.modules.protection.age import age_phrase
from app.modules.protection.catalog import registrable
from app.modules.protection.http import get_http

logger = get_logger("protection.rdap")

_RDAP = "https://rdap.org/domain/"
_TTL = 12 * 60 * 60
_overrides: dict[str, datetime | None] = {}
_cache: dict[str, tuple[float, datetime | None]] = {}


def set_registration(host: str, when: datetime | None) -> None:
    """Pin a registration time. Tests use this instead of the public lookup."""
    _overrides[registrable(host)] = when


def reset_rdap() -> None:
    """Drop pinned dates and the cache."""
    _overrides.clear()
    _cache.clear()


async def domain_age(host: str) -> tuple[str | None, bool]:
    """(phrase, missed). `missed` is true when the live lookup was needed and did not answer."""
    registered = registrable(host)
    if registered in _overrides:
        return age_phrase(_overrides[registered], utcnow(), within_days=30), False
    if not get_settings().rdap_remote:
        return None, False
    when, missed = await _cached(registered)
    return age_phrase(when, utcnow(), within_days=30), missed


async def _cached(registered: str) -> tuple[datetime | None, bool]:
    """Reuse a recent answer. A failure is not cached, so the next check can try again."""
    cached = _cache.get(registered)
    if cached is not None and time.monotonic() - cached[0] < _TTL:
        return cached[1], False
    try:
        when = await _fetch(registered)
    except (httpx.HTTPError, ValueError):
        logger.warning("rdap_failed", domain=registered)
        return None, True
    _cache[registered] = (time.monotonic(), when)
    if len(_cache) > 2000:
        oldest = sorted(_cache, key=lambda key: _cache[key][0])[:500]
        for key in oldest:
            _cache.pop(key, None)
    return when, False


async def _fetch(registered: str) -> datetime | None:
    """Follow RDAP redirects to the registry and read the registration event."""
    response = await get_http().get(f"{_RDAP}{registered}", follow_redirects=True)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return _registration(response.json())


def _registration(body: object) -> datetime | None:
    """The registration timestamp from an RDAP domain object."""
    if not isinstance(body, dict):
        return None
    for event in body.get("events") or []:
        if not isinstance(event, dict):
            continue
        if str(event.get("eventAction") or "").lower() not in {"registration", "registered"}:
            continue
        raw = str(event.get("eventDate") or "")
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None
