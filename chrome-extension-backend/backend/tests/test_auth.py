"""
Tests for email OTP login, cookies, refresh rotation with theft detection, logout, audiences and JWKS.

Made by Yash Jain with passion.
"""

import jwt
import pytest
from jwt import PyJWK

from app.core.config import get_settings
from tests.conftest import WEB_ORIGIN, bearer, login


async def test_web_login_sets_httponly_cookie_and_me_shows_free_plan(client, captured_codes):
    """Web login returns an access token, keeps the refresh token out of the body, and /me works."""
    response = await login(client, captured_codes, "Yash@Example.com")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["refreshToken"] is None
    assert body["user"]["email"] == "yash@example.com"
    cookie_header = response.headers["set-cookie"]
    assert "HttpOnly" in cookie_header and "Secure" in cookie_header and "SameSite=strict" in cookie_header

    me = await client.get("/v1/me", headers=bearer(body["accessToken"]))
    assert me.status_code == 200
    assert me.json()["plan"] == "free"
    assert me.json()["limits"] == {"repo_scan_basic": 20}


async def test_otp_request_is_identical_for_unknown_emails(client, captured_codes):
    """No account enumeration: same status and shape for any email."""
    first = await client.post("/v1/auth/otp/request", json={"email": "new@example.com"})
    second = await client.post("/v1/auth/otp/request", json={"email": "new@example.com"})
    assert first.status_code == second.status_code == 202
    assert set(first.json()) == set(second.json()) == {"status", "expiresInSeconds", "retryAfterSeconds"}


async def test_wrong_code_attempts_are_limited(client, captured_codes):
    """Five wrong codes burn the OTP, even the correct code then fails."""
    await client.post("/v1/auth/otp/request", json={"email": "a@example.com"})
    real = captured_codes["a@example.com"]
    wrong = "000000" if real != "000000" else "111111"
    for expected_remaining in (4, 3, 2, 1, 0):
        response = await client.post(
            "/v1/auth/otp/verify", json={"email": "a@example.com", "code": wrong, "client": "chrome"}
        )
        assert response.status_code == 400
        assert response.json()["error"]["details"]["attemptsRemaining"] == expected_remaining
    response = await client.post(
        "/v1/auth/otp/verify", json={"email": "a@example.com", "code": real, "client": "chrome"}
    )
    assert response.status_code == 400


async def test_web_verify_requires_trusted_origin(client, captured_codes):
    """Cookie-issuing login must come from our website origin."""
    await client.post("/v1/auth/otp/request", json={"email": "b@example.com"})
    response = await client.post(
        "/v1/auth/otp/verify",
        json={"email": "b@example.com", "code": captured_codes["b@example.com"], "client": "web"},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "untrusted_origin"


async def test_web_refresh_via_cookie_rotates(client, captured_codes):
    """Cookie refresh needs the trusted Origin and returns a new access token."""
    await login(client, captured_codes, "c@example.com")
    blocked = await client.post("/v1/auth/refresh")
    assert blocked.status_code == 403
    refreshed = await client.post("/v1/auth/refresh", headers={"Origin": WEB_ORIGIN})
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["refreshToken"] is None
    assert "set-cookie" in refreshed.headers


async def test_refresh_token_reuse_revokes_session(client, captured_codes, monkeypatch: pytest.MonkeyPatch):
    """A rotated refresh token presented again kills the whole session (stolen token defence)."""
    monkeypatch.setattr(get_settings(), "refresh_reuse_grace_seconds", -1)
    tokens = (await login(client, captured_codes, "d@example.com", "chrome")).json()
    first_refresh = tokens["refreshToken"]

    rotated = await client.post("/v1/auth/refresh", json={"refreshToken": first_refresh})
    assert rotated.status_code == 200
    new_pair = rotated.json()
    assert new_pair["refreshToken"] != first_refresh

    replay = await client.post("/v1/auth/refresh", json={"refreshToken": first_refresh})
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "session_revoked"

    after = await client.post("/v1/auth/refresh", json={"refreshToken": new_pair["refreshToken"]})
    assert after.status_code == 401
    me = await client.get("/v1/me", headers=bearer(new_pair["accessToken"]))
    assert me.status_code == 401


async def test_refresh_reuse_inside_grace_window_is_tolerated(client, captured_codes):
    """Two tabs refreshing at once must not log the user out."""
    tokens = (await login(client, captured_codes, "e@example.com", "vscode")).json()
    first = await client.post("/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]})
    second = await client.post("/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]})
    assert first.status_code == second.status_code == 200


async def test_logout_revokes_immediately(client, captured_codes):
    """After logout the access token stops working on this API right away."""
    tokens = (await login(client, captured_codes, "f@example.com", "chrome")).json()
    assert (await client.post("/v1/auth/logout", headers=bearer(tokens["accessToken"]))).status_code == 204
    assert (await client.get("/v1/me", headers=bearer(tokens["accessToken"]))).status_code == 401
    assert (await client.post("/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]})).status_code == 401


async def test_audiences_follow_least_privilege(client, captured_codes):
    """Chrome tokens only work on the core API; VS Code tokens also work on Imran's API."""
    chrome = (await login(client, captured_codes, "g@example.com", "chrome")).json()["accessToken"]
    vscode = (await login(client, captured_codes, "h@example.com", "vscode")).json()["accessToken"]
    assert jwt.decode(chrome, options={"verify_signature": False})["aud"] == ["stack3-core"]
    assert jwt.decode(vscode, options={"verify_signature": False})["aud"] == ["stack3-core", "stack3-vscode"]


async def test_other_services_can_verify_with_jwks(client, captured_codes):
    """Simulates Imran's API: fetch JWKS, verify signature, issuer and audience."""
    token = (await login(client, captured_codes, "i@example.com", "vscode")).json()["accessToken"]
    jwks = (await client.get("/.well-known/jwks.json")).json()
    kid = jwt.get_unverified_header(token)["kid"]
    key = PyJWK(next(k for k in jwks["keys"] if k["kid"] == kid))
    claims = jwt.decode(
        token, key.key, algorithms=["EdDSA"], audience="stack3-vscode", issuer=get_settings().jwt_issuer
    )
    assert claims["plan"] == "free"
    assert "chrome_protection" in claims["ent"]
    assert claims["exp"] - claims["iat"] == 30 * 60


async def test_tampered_token_is_rejected(client, captured_codes):
    """Any change to the token invalidates it."""
    token = (await login(client, captured_codes, "j@example.com", "chrome")).json()["accessToken"]
    tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    response = await client.get("/v1/me", headers=bearer(tampered))
    assert response.status_code == 401


async def test_body_size_limit(client):
    """Oversized bodies are rejected before parsing."""
    response = await client.post(
        "/v1/auth/otp/request", content=b"x" * (300 * 1024), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413


async def test_security_headers_present(client):
    """Every response carries the hardening headers and a request ID."""
    response = await client.get("/health")
    for header in ("x-content-type-options", "x-frame-options", "referrer-policy", "x-request-id"):
        assert header in response.headers
