"""
Background loop that retries threat-graph syncs TigerGraph did not accept.

Made by Yash Jain with passion.
"""

import asyncio

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.modules.graph.service import sync_pending

logger = get_logger("graph.worker")

_stop: asyncio.Event | None = None
_task: asyncio.Task[None] | None = None


async def _loop(stop: asyncio.Event) -> None:
    """Sync pending reports until shutdown."""
    interval = get_settings().graph_sync_interval_seconds
    while not stop.is_set():
        try:
            async with get_session_factory()() as session:
                synced = await sync_pending(session)
                await session.commit()
            if synced:
                logger.info("graph_sync_batch", synced=synced)
        except Exception:
            logger.exception("graph_sync_loop_failed")
        try:
            await asyncio.wait_for(stop.wait(), interval)
        except TimeoutError:
            continue


def start_graph_sync() -> None:
    """Start the loop when TigerGraph is configured."""
    global _stop, _task
    if not get_settings().tigergraph_configured or _task is not None:
        return
    _stop = asyncio.Event()
    _task = asyncio.create_task(_loop(_stop))


async def stop_graph_sync() -> None:
    """Signal the loop and wait for it to finish."""
    global _stop, _task
    if _stop is not None:
        _stop.set()
    if _task is not None:
        await _task
    _stop, _task = None, None
