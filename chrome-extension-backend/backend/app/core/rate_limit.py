"""
Fixed-window rate limiting backed by Redis, with an in-memory fallback for local development.

Made by Yash Jain with passion.
"""

import asyncio
import hashlib
import time
from dataclasses import dataclass

from redis.asyncio import Redis

from app.core.config import get_settings
from app.core.errors import RateLimited
from app.core.logging import get_logger

logger = get_logger("rate_limit")


@dataclass(frozen=True)
class Limit:
    """A named budget of `limit` hits per `window_seconds`."""

    name: str
    limit: int
    window_seconds: int


class RateLimiter:
    """Counts hits per (limit, identifier, window) and raises RateLimited when over budget."""

    def __init__(self, redis: Redis | None) -> None:
        self._redis = redis
        self._memory: dict[str, tuple[int, float]] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _key(limit: Limit, identifier: str, window_index: int) -> str:
        """Hash identifiers so emails and IPs never sit in Redis in plain text."""
        digest = hashlib.sha256(identifier.encode()).hexdigest()[:32]
        return f"rl:{limit.name}:{digest}:{window_index}"

    async def hit(self, limit: Limit, identifier: str) -> None:
        """Record one hit; raise RateLimited if the window budget is exhausted."""
        now = time.time()
        window_index = int(now // limit.window_seconds)
        retry_after = int(limit.window_seconds - (now % limit.window_seconds)) + 1
        key = self._key(limit, identifier, window_index)
        count = await self._incr(key, limit.window_seconds)
        if count > limit.limit:
            raise RateLimited(retry_after)

    async def _incr(self, key: str, ttl: int) -> int:
        """Atomic increment with expiry, Redis first and memory as fallback."""
        if self._redis is not None:
            try:
                pipe = self._redis.pipeline(transaction=True)
                pipe.incr(key)
                pipe.expire(key, ttl + 5, nx=True)
                count, _ = await pipe.execute()
                return int(count)
            except Exception:
                logger.warning("rate_limit_redis_unavailable_using_memory")
        async with self._lock:
            now = time.time()
            count, expires_at = self._memory.get(key, (0, now + ttl))
            if expires_at < now:
                count, expires_at = 0, now + ttl
            count += 1
            self._memory[key] = (count, expires_at)
            if len(self._memory) > 50_000:
                self._memory = {k: v for k, v in self._memory.items() if v[1] >= now}
            return count


_limiter: RateLimiter | None = None


def init_rate_limiter(redis: Redis | None) -> RateLimiter:
    """Create the process-wide limiter at startup."""
    global _limiter
    _limiter = RateLimiter(redis)
    if redis is None and get_settings().is_production:
        logger.warning("rate_limit_memory_only_in_production")
    return _limiter


def get_rate_limiter() -> RateLimiter:
    """Limiter dependency; falls back to memory if startup has not run (tests)."""
    global _limiter
    if _limiter is None:
        _limiter = RateLimiter(None)
    return _limiter


class Limits:
    """Every budget in one place so they are easy to review and tune."""

    OTP_REQUEST_IP = Limit("otp_request_ip", get_settings().otp_hourly_limit_per_ip, 3600)
    OTP_REQUEST_EMAIL = Limit("otp_request_email", get_settings().otp_hourly_limit_per_email, 3600)
    OTP_VERIFY_IP = Limit("otp_verify_ip", 30, 600)
    REFRESH_IP = Limit("refresh_ip", 60, 600)
    LINK_START_IP = Limit("link_start_ip", 10, 600)
    LINK_POLL_IP = Limit("link_poll_ip", 300, 600)
    LINK_APPROVE_USER = Limit("link_approve_user", 10, 600)
    BILLING_USER = Limit("billing_user", 20, 600)
    TEAM_INVITE_USER = Limit("team_invite_user", 30, 3600)
