"""
Async SQLAlchemy engine, session factory and the per-request session dependency.

Made by Yash Jain with passion.
"""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """Lazily create the shared connection pool."""
    global _engine, _session_factory
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_pre_ping=True,
            pool_recycle=1800,
            connect_args={"server_settings": {"application_name": "stack3-core-api"}},
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False, autoflush=False)
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Session factory bound to the shared engine."""
    get_engine()
    assert _session_factory is not None
    return _session_factory


async def dispose_engine() -> None:
    """Close all pooled connections at shutdown."""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine, _session_factory = None, None


async def get_db() -> AsyncIterator[AsyncSession]:
    """One session per request; rolled back automatically if the handler raises."""
    async with get_session_factory()() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
