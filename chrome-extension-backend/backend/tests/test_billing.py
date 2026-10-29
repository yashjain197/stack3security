"""
Tests for plans, Dodo checkout (trial once), signed webhooks (idempotent, ordered) and team seats.

Made by Yash Jain with passion.
"""

import base64
import hashlib
import hmac
import json
import time
import uuid

import httpx
import jwt
import respx

from app.core.config import get_settings
from tests.conftest import bearer, login


def _signed_headers(body: bytes, webhook_id: str | None = None, timestamp: int | None = None) -> dict[str, str]:
    """Sign a payload exactly like Dodo (Standard Webhooks)."""
    secret = get_settings().dodo_webhook_secret.get_secret_value()
    key = base64.b64decode(secret.removeprefix("whsec_"))
    webhook_id = webhook_id or f"msg_{uuid.uuid4().hex}"
    ts = str(timestamp or int(time.time()))
    signature = base64.b64encode(hmac.new(key, f"{webhook_id}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
    return {
        "webhook-id": webhook_id,
        "webhook-timestamp": ts,
        "webhook-signature": f"v1,{signature}",
        "content-type": "application/json",
    }


def _subscription_event(
    user_id: str,
    email: str,
    status: str = "active",
    event_ts: str = "2026-10-30T10:00:00Z",
    product: str = "pdt_pro_monthly",
    team_id: str = "",
    extra_seats: int = 0,
) -> bytes:
    """Build a subscription webhook payload."""
    return json.dumps(
        {
            "business_id": "bus_test",
            "type": f"subscription.{status}",
            "timestamp": event_ts,
            "data": {
                "subscription_id": f"sub_{user_id[:8]}{team_id[:4]}",
                "status": status,
                "product_id": product,
                "quantity": 1,
                "addons": [{"addon_id": "adn_team_seat_monthly", "quantity": extra_seats}] if extra_seats else [],
                "trial_period_days": 30,
                "created_at": "2026-10-30T09:59:00Z",
                "next_billing_date": "2026-11-29T09:59:00Z",
                "cancel_at_next_billing_date": False,
                "customer": {"customer_id": f"cus_{user_id[:8]}", "email": email},
                "metadata": {"stack3_user_id": user_id, "stack3_team_id": team_id},
            },
        }
    ).encode()


async def test_plans_catalog(client):
    """Free, Pro and Team with correct features and availability."""
    plans = {p["code"]: p for p in (await client.get("/v1/billing/plans")).json()}
    assert list(plans) == ["free", "pro", "team"]
    assert plans["pro"]["trialDays"] == 30
    assert plans["team"]["minSeats"] == 3
    pro_monthly = next(p for p in plans["pro"]["prices"] if p["interval"] == "month")
    assert pro_monthly["amountCents"] == 900 and pro_monthly["available"] is True


@respx.mock
async def test_checkout_grants_trial_first_time(client, captured_codes):
    """First checkout gets a 30-day trial and carries our user ID in metadata."""
    route = respx.post("https://test.dodopayments.com/checkouts").mock(
        return_value=httpx.Response(200, json={"session_id": "cks_1", "checkout_url": "https://checkout.dodo/cks_1"})
    )
    web = (await login(client, captured_codes, "buyer@example.com")).json()
    response = await client.post("/v1/billing/checkout", json={"plan": "pro"}, headers=bearer(web["accessToken"]))
    assert response.status_code == 200, response.text
    assert response.json()["trialDays"] == 30
    sent = json.loads(route.calls.last.request.content)
    assert sent["subscription_data"]["trial_period_days"] == 30
    assert sent["metadata"]["stack3_user_id"] == web["user"]["id"]
    assert sent["customer"] == {"email": "buyer@example.com"}


@respx.mock
async def test_team_checkout_sends_extra_seats_as_addon(client, captured_codes):
    """5 seats on Team = base product (3 included) + 2 units of the seat add-on."""
    route = respx.post("https://test.dodopayments.com/checkouts").mock(
        return_value=httpx.Response(200, json={"session_id": "cks_2", "checkout_url": "https://checkout.dodo/cks_2"})
    )
    web = (await login(client, captured_codes, "teamlead@example.com")).json()
    team = (await client.post("/v1/teams", json={"name": "Red Team"}, headers=bearer(web["accessToken"]))).json()

    too_few = await client.post(
        "/v1/billing/checkout",
        json={"plan": "team", "seats": 2, "teamId": team["id"]},
        headers=bearer(web["accessToken"]),
    )
    assert too_few.status_code == 400

    response = await client.post(
        "/v1/billing/checkout",
        json={"plan": "team", "seats": 5, "teamId": team["id"]},
        headers=bearer(web["accessToken"]),
    )
    assert response.status_code == 200, response.text
    item = json.loads(route.calls.last.request.content)["product_cart"][0]
    assert item == {
        "product_id": "pdt_team_monthly",
        "quantity": 1,
        "addons": [{"addon_id": "adn_team_seat_monthly", "quantity": 2}],
    }


async def test_checkout_is_web_only(client, captured_codes):
    """Extensions cannot start purchases."""
    chrome = (await login(client, captured_codes, "ext@example.com", "chrome")).json()
    response = await client.post("/v1/billing/checkout", json={"plan": "pro"}, headers=bearer(chrome["accessToken"]))
    assert response.status_code == 403


async def test_webhook_activates_pro_trial_and_is_idempotent(client, captured_codes):
    """Signed webhook upgrades the user; replaying the same webhook ID is a no-op."""
    web = (await login(client, captured_codes, "pro@example.com")).json()
    body = _subscription_event(web["user"]["id"], "pro@example.com")
    headers = _signed_headers(body)

    first = await client.post("/v1/billing/webhooks/dodo", content=body, headers=headers)
    assert first.status_code == 200, first.text
    assert first.json() == {"received": True, "duplicate": False}
    duplicate = await client.post("/v1/billing/webhooks/dodo", content=body, headers=headers)
    assert duplicate.json()["duplicate"] is True

    me = (await client.get("/v1/me", headers=bearer(web["accessToken"]))).json()
    assert me["plan"] == "pro"
    assert "socket_scan" in me["features"]

    refreshed = await client.post("/v1/auth/refresh", headers={"Origin": "http://localhost:3000"})
    assert jwt.decode(refreshed.json()["accessToken"], options={"verify_signature": False})["plan"] == "pro"


async def test_webhook_rejects_bad_signature_and_old_timestamp(client):
    """Forged or replayed webhooks are refused."""
    body = _subscription_event(str(uuid.uuid4()), "x@example.com")
    forged = _signed_headers(body)
    forged["webhook-signature"] = "v1,AAAA"
    assert (await client.post("/v1/billing/webhooks/dodo", content=body, headers=forged)).status_code == 401
    old = _signed_headers(body, timestamp=int(time.time()) - 3600)
    assert (await client.post("/v1/billing/webhooks/dodo", content=body, headers=old)).status_code == 401


async def test_stale_webhook_does_not_overwrite_newer_state(client, captured_codes):
    """An older 'active' event arriving after 'cancelled' is ignored."""
    web = (await login(client, captured_codes, "order@example.com")).json()
    uid = web["user"]["id"]
    newer = _subscription_event(uid, "order@example.com", "cancelled", "2026-10-30T12:00:00Z")
    older = _subscription_event(uid, "order@example.com", "active", "2026-10-30T11:00:00Z")
    await client.post("/v1/billing/webhooks/dodo", content=newer, headers=_signed_headers(newer))
    await client.post("/v1/billing/webhooks/dodo", content=older, headers=_signed_headers(older))
    me = (await client.get("/v1/me", headers=bearer(web["accessToken"]))).json()
    assert me["plan"] == "free"


async def test_team_invites_need_subscription_and_respect_seats(client, captured_codes, monkeypatch):
    """No invites without a Team subscription; members get Team features once subscribed."""
    sent: list[str] = []

    async def fake_invite(to, team_name, inviter_email, link):
        sent.append(link)

    monkeypatch.setattr("app.modules.teams.service.send_team_invite", fake_invite)
    owner = (await login(client, captured_codes, "lead@example.com")).json()
    team = (await client.post("/v1/teams", json={"name": "Audit Shop"}, headers=bearer(owner["accessToken"]))).json()

    blocked = await client.post(
        f"/v1/teams/{team['id']}/invites",
        json={"email": "dev@example.com"},
        headers=bearer(owner["accessToken"]),
    )
    assert blocked.status_code == 402

    body = _subscription_event(
        owner["user"]["id"], "lead@example.com", product="pdt_team_monthly", team_id=team["id"], extra_seats=2
    )
    await client.post("/v1/billing/webhooks/dodo", content=body, headers=_signed_headers(body))

    invite = await client.post(
        f"/v1/teams/{team['id']}/invites",
        json={"email": "dev@example.com"},
        headers=bearer(owner["accessToken"]),
    )
    assert invite.status_code == 201, invite.text
    token = sent[-1].split("token=")[1]

    stranger = (await login(client, captured_codes, "stranger@example.com")).json()
    mismatch = await client.post(
        "/v1/teams/invites/accept", json={"token": token}, headers=bearer(stranger["accessToken"])
    )
    assert mismatch.status_code == 403

    dev = (await login(client, captured_codes, "dev@example.com")).json()
    joined = await client.post("/v1/teams/invites/accept", json={"token": token}, headers=bearer(dev["accessToken"]))
    assert joined.status_code == 200, joined.text
    assert joined.json()["seatsUsed"] == 2
    assert joined.json()["seats"] == 5

    me = (await client.get("/v1/me", headers=bearer(dev["accessToken"]))).json()
    assert me["plan"] == "team" and me["team"]["role"] == "member"
    assert "team_alerts" in me["features"]
