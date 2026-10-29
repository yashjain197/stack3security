"""
Tests for device linking: Chrome / VS Code / CLI sign in by approving a code on the website.

Made by Yash Jain with passion.
"""

from sqlalchemy import update

from app.db.session import get_session_factory
from app.modules.identity.models import LinkRequest
from tests.conftest import bearer, login


async def _rewind_last_poll() -> None:
    """Pretend the poll interval has passed so tests don't sleep."""
    async with get_session_factory()() as session:
        await session.execute(update(LinkRequest).values(last_polled_at=None))
        await session.commit()


async def test_full_link_flow(client, captured_codes):
    """Start, pending, approve on the website, receive tokens once, then the code is spent."""
    started = await client.post("/v1/auth/link/start", json={"client": "chrome", "deviceName": "Chrome on MacBook"})
    assert started.status_code == 201
    link = started.json()
    assert link["verificationUriComplete"].endswith(link["userCode"])

    pending = await client.post("/v1/auth/link/token", json={"deviceCode": link["deviceCode"]})
    assert pending.json()["error"]["code"] == "authorization_pending"

    web = (await login(client, captured_codes, "owner@example.com")).json()
    details = await client.get(f"/v1/auth/link/requests/{link['userCode'].lower()}", headers=bearer(web["accessToken"]))
    assert details.json()["deviceName"] == "Chrome on MacBook"
    assert details.json()["status"] == "pending"

    approved = await client.post(
        "/v1/auth/link/approve",
        json={"userCode": link["userCode"], "approve": True},
        headers=bearer(web["accessToken"]),
    )
    assert approved.json()["status"] == "approved"

    await _rewind_last_poll()
    tokens = await client.post("/v1/auth/link/token", json={"deviceCode": link["deviceCode"]})
    assert tokens.status_code == 200, tokens.text
    assert tokens.json()["refreshToken"]
    assert tokens.json()["user"]["email"] == "owner@example.com"

    sessions = await client.get("/v1/auth/sessions", headers=bearer(web["accessToken"]))
    assert {s["client"] for s in sessions.json()} == {"web", "chrome"}

    await _rewind_last_poll()
    again = await client.post("/v1/auth/link/token", json={"deviceCode": link["deviceCode"]})
    assert again.json()["error"]["code"] == "expired_token"


async def test_polling_too_fast_gets_slow_down(client):
    """Clients that ignore the interval are told to slow down."""
    link = (await client.post("/v1/auth/link/start", json={"client": "vscode"})).json()
    await client.post("/v1/auth/link/token", json={"deviceCode": link["deviceCode"]})
    fast = await client.post("/v1/auth/link/token", json={"deviceCode": link["deviceCode"]})
    assert fast.json()["error"]["code"] == "slow_down"


async def test_only_web_sessions_can_approve(client, captured_codes):
    """A Chrome token cannot approve links; the website is the trust anchor."""
    link = (await client.post("/v1/auth/link/start", json={"client": "cli"})).json()
    chrome = (await login(client, captured_codes, "x@example.com", "chrome")).json()
    response = await client.post(
        "/v1/auth/link/approve",
        json={"userCode": link["userCode"], "approve": True},
        headers=bearer(chrome["accessToken"]),
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "web_session_required"


async def test_denied_link_never_issues_tokens(client, captured_codes):
    """Denied requests return access_denied."""
    link = (await client.post("/v1/auth/link/start", json={"client": "chrome"})).json()
    web = (await login(client, captured_codes, "y@example.com")).json()
    await client.post(
        "/v1/auth/link/approve",
        json={"userCode": link["userCode"], "approve": False},
        headers=bearer(web["accessToken"]),
    )
    response = await client.post("/v1/auth/link/token", json={"deviceCode": link["deviceCode"]})
    assert response.json()["error"]["code"] == "access_denied"


async def test_web_cannot_start_a_link(client):
    """Link requests are only for non-web clients."""
    response = await client.post("/v1/auth/link/start", json={"client": "web"})
    assert response.status_code == 422
