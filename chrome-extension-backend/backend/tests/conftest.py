"""
Test fixtures: isolated Postgres test database, migrated once, cleaned between tests; HTTP client; login helpers.

Made by Yash Jain with passion.
"""

import os

os.environ.setdefault("ENV", "test")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/stack3_test")
os.environ.setdefault("CORS_ORIGINS", '["http://localhost:3000"]')
os.environ.setdefault("DODO_API_KEY", "test_dodo_key")
os.environ.setdefault("DODO_WEBHOOK_SECRET", "whsec_dGVzdC13ZWJob29rLXNlY3JldC0wMTIzNDU2Nzg5")
os.environ.setdefault("DODO_PRODUCT_PRO_MONTHLY", "pdt_pro_monthly")
os.environ.setdefault("DODO_PRODUCT_TEAM_MONTHLY", "pdt_team_monthly")
os.environ.setdefault("DODO_ADDON_TEAM_SEAT_MONTHLY", "adn_team_seat_monthly")
os.environ.setdefault("REDIS_URL", "")
os.environ["COOKIE_SECURE"] = "true"
os.environ["JWT_PRIVATE_KEY"] = ""
os.environ["SMTP_HOST"] = ""
os.environ["RESEND_API_KEY"] = ""
os.environ["TIGERGRAPH_HOST"] = ""
os.environ["TIGERGRAPH_SECRET"] = ""
os.environ["TIGERGRAPH_PASSWORD"] = ""
os.environ["TIGERGRAPH_API_KEY"] = ""

import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from sqlalchemy import text

from app.core.rate_limit import init_rate_limiter
from app.db.session import dispose_engine, get_session_factory
from app.main import app
from app.modules.billing.service import sync_product_ids

WEB_ORIGIN = "http://localhost:3000"
BACKEND_DIR = Path(__file__).resolve().parents[1]
USER_TABLES = [
    "graph_report_edges",
    "graph_report_nodes",
    "graph_edges",
    "graph_node_attributes",
    "graph_reports",
    "graph_nodes",
    "webhook_events",
    "subscriptions",
    "billing_customers",
    "team_invites",
    "team_members",
    "teams",
    "link_requests",
    "refresh_tokens",
    "auth_sessions",
    "email_otps",
    "users",
]


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Bring the test database to the latest migration once per run."""
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        check=True,
        env=os.environ.copy(),
    )


@pytest.fixture(autouse=True)
async def clean_state() -> AsyncIterator[None]:
    """Empty user data, reset rate limits and attach Dodo product IDs before each test."""
    async with get_session_factory()() as session:
        await session.execute(text(f"TRUNCATE {', '.join('chrome.' + t for t in USER_TABLES)} CASCADE"))
        await session.commit()
        await sync_product_ids(session)
    init_rate_limiter(None)
    yield
    await dispose_engine()


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    """In-process HTTPS client against the ASGI app."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as http:
        yield http


@pytest.fixture
def captured_codes(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """Capture emailed OTP codes instead of sending them."""
    codes: dict[str, str] = {}

    async def fake_send(to: str, code: str, ttl_minutes: int) -> None:
        codes[to] = code

    monkeypatch.setattr("app.modules.identity.service.send_login_code", fake_send)
    return codes


async def login(
    client: httpx.AsyncClient, codes: dict[str, str], email: str, client_type: str = "web"
) -> httpx.Response:
    """Full OTP login; returns the verify response."""
    response = await client.post("/v1/auth/otp/request", json={"email": email})
    assert response.status_code == 202, response.text
    headers = {"Origin": WEB_ORIGIN} if client_type == "web" else {}
    return await client.post(
        "/v1/auth/otp/verify",
        json={"email": email, "code": codes[email.lower()], "client": client_type},
        headers=headers,
    )


def bearer(token: str) -> dict[str, str]:
    """Authorization header."""
    return {"Authorization": f"Bearer {token}"}
