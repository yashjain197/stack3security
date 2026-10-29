"""
FastAPI application factory: middleware, CORS, routers, startup and shutdown.

Made by Yash Jain with passion.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from app.api.health import router as health_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.jwt import get_key_manager
from app.core.logging import configure_logging, get_logger
from app.core.middleware import BodySizeLimitMiddleware, RequestContextMiddleware
from app.core.rate_limit import init_rate_limiter
from app.db.session import dispose_engine, get_session_factory
from app.modules.billing.router import router as billing_router
from app.modules.billing.service import sync_product_ids
from app.modules.graph.router import router as graph_router
from app.modules.graph.seed import ensure_seed
from app.modules.graph.tigergraph import close_tigergraph
from app.modules.graph.worker import start_graph_sync, stop_graph_sync
from app.modules.identity.router import jwks_router, me_router
from app.modules.identity.router import router as auth_router
from app.modules.teams.router import router as teams_router

logger = get_logger("app")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Fail fast on bad keys, connect Redis, sync Dodo product IDs; clean up on shutdown."""
    settings = get_settings()
    get_key_manager()
    app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True) if settings.redis_url else None
    init_rate_limiter(app.state.redis)
    async with get_session_factory()() as session:
        await sync_product_ids(session)
        await ensure_seed(session)
    start_graph_sync()
    logger.info("startup_complete", env=settings.env)
    yield
    await stop_graph_sync()
    await close_tigergraph()
    if app.state.redis is not None:
        await app.state.redis.aclose()
    await dispose_engine()


def create_app() -> FastAPI:
    """Build the app with security middleware in the right order (last added runs first)."""
    configure_logging()
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Stack3 Security core API: identity, billing, teams and Chrome extension checks.",
        lifespan=lifespan,
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )
    register_exception_handlers(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After"],
        max_age=600,
    )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)
    app.add_middleware(RequestContextMiddleware)

    app.include_router(health_router)
    app.include_router(jwks_router)
    app.include_router(auth_router)
    app.include_router(me_router)
    app.include_router(billing_router)
    app.include_router(teams_router)
    app.include_router(graph_router)
    return app


app = create_app()
