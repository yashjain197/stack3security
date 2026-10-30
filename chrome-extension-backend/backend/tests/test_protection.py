"""
Chrome checks: blocklists and lookalikes, transaction decode, page signals, contract facts and script URLs.

Chain providers are mocked. The phishing lists are not downloaded.

Made by Yash Jain with passion.
"""

import time
from datetime import UTC, datetime, timedelta

import httpx
import respx
from pydantic import SecretStr

from app.core.config import get_settings
from app.modules.protection.abi import parse_calldata
from app.modules.protection.blocklist import set_blocklist
from app.modules.protection.catalog import canonical_host, lookalike
from app.modules.protection.rdap import set_registration
from tests.conftest import bearer, login

SPENDER = "0x658729879fca881d9526480b82ae00efc54b5c2d"
USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
OWNER = "0x1111111111111111111111111111111111111111"
TOKEN = "0x2222222222222222222222222222222222222222"
CONTRACT = "0x3333333333333333333333333333333333333333"


def _word(value: int) -> str:
    """One ABI word."""
    return value.to_bytes(32, "big").hex()


def _approve(spender: str, amount: int) -> str:
    """approve(address,uint256) calldata."""
    return "0x095ea7b3" + _word(int(spender, 16)) + _word(amount)


async def _auth(client, captured_codes, email="chrome@example.com") -> dict[str, str]:
    """A Chrome session. Protection is on every plan, including this free one."""
    logged = await login(client, captured_codes, email, client_type="chrome")
    assert logged.status_code == 200, logged.text
    return bearer(logged.json()["accessToken"])


def test_lookalike_names_and_real_domains():
    """Official domains are left alone. A wrong ending, a one-letter change and a fake letter are not."""
    assert canonical_host("https://www.MetaMask.io/path") == "metamask.io"
    assert lookalike("metamask.io", whitelisted=False) is None
    assert lookalike("login.metamask.io", whitelisted=False) is None
    wrong = lookalike("metamask.com", whitelisted=False)
    assert wrong is not None and wrong.severity == "critical"
    close = lookalike("metamaskk.io", whitelisted=False)
    assert close is not None and close.brand == "metamask" and close.severity == "high"
    fake = lookalike("met\u0430mask.io", whitelisted=False)
    assert fake is not None and fake.severity == "critical"
    assert lookalike("metamask.com", whitelisted=True) is None


def test_unlimited_approve_is_decoded():
    """The spender and the max uint256 allowance come out of the calldata."""
    decoded = parse_calldata(_approve(SPENDER, 2**256 - 1))
    assert decoded is not None
    assert decoded.name == "approve"
    assert decoded.spender == SPENDER
    assert decoded.unlimited


async def test_checks_require_login(client):
    """Every Chrome route rejects a caller with no token."""
    response = await client.post("/v1/check-domain", json={"domain": "metamask.io"})
    assert response.status_code == 401


async def test_rules_bundle_and_blocklist_etag(client, captured_codes):
    """The bundle stays small and the blocklist download can be skipped with its etag."""
    headers = await _auth(client, captured_codes)
    set_blocklist(metamask={"phish.example"})
    bundle = await client.get("/v1/rules/bundle", headers=headers)
    assert bundle.status_code == 200, bundle.text
    body = bundle.json()
    assert body["brands"][0]["domains"]
    assert body["selectors"]["0x095ea7b3"] == "approve"
    assert "0" in body["homoglyphs"]
    assert body["blocklistCount"] >= 1
    listed = await client.get("/v1/rules/blocklist", headers=headers)
    assert listed.status_code == 200
    assert "phish.example" in listed.json()["domains"]
    again = await client.get("/v1/rules/blocklist", headers={**headers, "If-None-Match": listed.headers["etag"]})
    assert again.status_code == 304


async def test_domain_blocklist_lookalike_and_graph(client, captured_codes):
    """A listed host is critical, a parent listing covers subdomains, and a graph report is included."""
    headers = await _auth(client, captured_codes)
    set_blocklist(metamask={"evil.example"}, fuzzy={"maybe.example"})
    listed = await client.post("/v1/check-domain", json={"domain": "https://login.evil.example/a"}, headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()["level"] == "critical"
    assert listed.json()["target"]["id"] == "login.evil.example"

    fuzzy = await client.post("/v1/check-domain", json={"domain": "maybe.example"}, headers=headers)
    assert fuzzy.json()["level"] == "caution"

    real = await client.post("/v1/check-domain", json={"domain": "https://metamask.io"}, headers=headers)
    assert real.json()["level"] == "no_known_issues"

    imitate = await client.post("/v1/check-domain", json={"domain": "metamask.com"}, headers=headers)
    assert imitate.json()["level"] == "critical"

    seeded = await client.post("/v1/check-domain", json={"domain": "v3-trezorsuite.com"}, headers=headers)
    assert seeded.json()["level"] == "critical"

    reported = await client.post(
        "/v1/report",
        json={
            "reason": "asked for a seed phrase",
            "nodes": [{"type": "domain", "id": "reported-phish.example", "risk": "high", "category": "phishing"}],
        },
        headers=headers,
    )
    assert reported.status_code == 201, reported.text
    graph = await client.post("/v1/check-domain", json={"domain": "reported-phish.example"}, headers=headers)
    assert graph.json()["level"] == "high"
    assert any(item["source"] == "graph" for item in graph.json()["findings"])


async def test_review_flags_drainer_approval_and_ignores_a_login(client, captured_codes):
    """Unlimited approval to a reported wallet is critical. A readable login signature is not."""
    headers = await _auth(client, captured_codes, "tx@example.com")
    reported = await client.post(
        "/v1/report",
        json={
            "reason": "ledger connect kit collector",
            "nodes": [{"type": "wallet", "id": f"1:{SPENDER}", "risk": "critical", "category": "drainer"}],
        },
        headers=headers,
    )
    assert reported.status_code == 201, reported.text

    with respx.mock(assert_all_called=False) as mock:
        mock.get(url__startswith="https://sourcify.dev/").mock(return_value=httpx.Response(404))
        approval = await client.post(
            "/v1/review-tx",
            json={
                "chainId": 1,
                "method": "eth_sendTransaction",
                "origin": "https://metamask.io",
                "from": "0xabcabcabcabcabcabcabcabcabcabcabcabcabca",
                "to": TOKEN,
                "value": "0x0",
                "data": _approve(SPENDER, 2**256 - 1),
            },
            headers=headers,
        )
    assert approval.status_code == 200, approval.text
    body = approval.json()
    assert body["level"] == "critical"
    assert any(item["severity"] == "high" and "unlimited" in item["title"].lower() for item in body["findings"])
    assert f"1:{SPENDER}" in body["indicators"]["addresses"]

    nft = "0xa22cb465" + _word(int(SPENDER, 16)) + _word(1)
    with respx.mock(assert_all_called=False) as mock:
        mock.get(url__startswith="https://sourcify.dev/").mock(return_value=httpx.Response(404))
        drain = await client.post(
            "/v1/review-tx",
            json={"chainId": 1, "method": "eth_sendTransaction", "to": TOKEN, "data": nft},
            headers=headers,
        )
    assert drain.json()["level"] == "critical"

    login_sign = await client.post(
        "/v1/review-tx",
        json={"chainId": 1, "method": "personal_sign", "message": "Sign in to Stack3"},
        headers=headers,
    )
    assert login_sign.json()["level"] == "no_known_issues"

    blind = await client.post(
        "/v1/review-tx",
        json={"chainId": 1, "method": "eth_sign", "message": "0x" + "ab" * 32},
        headers=headers,
    )
    assert blind.json()["level"] == "critical"

    accounts = await client.post(
        "/v1/review-tx",
        json={"chainId": 1, "method": "eth_requestAccounts"},
        headers=headers,
    )
    assert accounts.json()["level"] == "no_known_issues"


async def test_page_seed_phrase_is_critical_even_on_a_real_domain(client, captured_codes):
    """Asking for a recovery phrase is the threat. A quiet official page is not."""
    headers = await _auth(client, captured_codes, "page@example.com")
    bad = await client.post(
        "/v1/scan-page",
        json={"origin": "https://metamask.io", "signals": {"seedPhraseField": True, "recoveryWordCount": 12}},
        headers=headers,
    )
    assert bad.status_code == 200, bad.text
    assert bad.json()["level"] == "critical"

    quiet = await client.post(
        "/v1/scan-page",
        json={"origin": "https://app.uniswap.org", "signals": {"walletConnect": True}},
        headers=headers,
    )
    assert quiet.json()["level"] == "no_known_issues"

    titled = await client.post(
        "/v1/scan-page",
        json={"origin": "https://evil.example", "signals": {"brandInTitle": "MetaMask"}},
        headers=headers,
    )
    assert titled.json()["level"] == "high"


async def test_contract_scan_unverified_owner_and_graph(client, captured_codes, monkeypatch):
    """An unverified contract with one owner wallet is high. A reported contract is critical on its own."""
    headers = await _auth(client, captured_codes, "contract@example.com")
    settings = get_settings()
    monkeypatch.setattr(settings, "etherscan_api_key", SecretStr("test-etherscan"))
    monkeypatch.setattr(settings, "rpc_url_ethereum", SecretStr("https://rpc.test"))

    def etherscan(request: httpx.Request) -> httpx.Response:
        action = request.url.params["action"]
        if action == "getsourcecode":
            result = [{"SourceCode": "", "ContractName": "", "Proxy": "0", "Implementation": ""}]
        else:
            result = [{"timestamp": str(int(time.time()) - 3 * 24 * 3600)}]
        return httpx.Response(200, json={"status": "1", "message": "OK", "result": result})

    def rpc(request: httpx.Request) -> httpx.Response:
        calls = request.read()
        import json

        body = json.loads(calls)
        if isinstance(body, dict):
            body = [body]
        rows = []
        for item in body:
            method = item["method"]
            if method == "eth_getCode":
                code = "0x" if item["params"][0].lower() == OWNER else "0x60806040"
                rows.append({"jsonrpc": "2.0", "id": item["id"], "result": code})
            elif method == "eth_call":
                rows.append({"jsonrpc": "2.0", "id": item["id"], "result": "0x" + _word(int(OWNER, 16))})
            else:
                rows.append({"jsonrpc": "2.0", "id": item["id"], "result": "0x" + "0" * 64})
        return httpx.Response(200, json=rows)

    with respx.mock(assert_all_called=False) as mock:
        mock.get(url__startswith="https://sourcify.dev/").mock(return_value=httpx.Response(404))
        mock.get(url__startswith="https://api.etherscan.io/").mock(side_effect=etherscan)
        mock.post("https://rpc.test").mock(side_effect=rpc)
        scanned = await client.get(f"/v1/scan-contract/1/{CONTRACT}", headers=headers)
    assert scanned.status_code == 200, scanned.text
    assert scanned.json()["level"] == "high"
    assert any(item["layer"] == "contract" for item in scanned.json()["findings"])

    reported = await client.post(
        "/v1/report",
        json={
            "reason": "drainer contract",
            "nodes": [{"type": "wallet", "id": f"1:{CONTRACT}", "risk": "critical", "category": "drainer"}],
        },
        headers=headers,
    )
    assert reported.status_code == 201, reported.text
    with respx.mock(assert_all_called=False) as mock:
        mock.get(url__startswith="https://sourcify.dev/").mock(return_value=httpx.Response(404))
        mock.get(url__startswith="https://api.etherscan.io/").mock(side_effect=etherscan)
        mock.post("https://rpc.test").mock(side_effect=rpc)
        known = await client.get(f"/v1/scan-contract/1/{CONTRACT}", headers=headers)
    assert known.json()["level"] == "critical"


async def test_script_graph_and_socket(client, captured_codes, monkeypatch):
    """A script URL in the graph is critical. Socket adds its own finding when the key is set."""
    headers = await _auth(client, captured_codes, "scripts@example.com")
    url = "https://cdn.jsdelivr.net/npm/@ledgerhq/connect-kit@1.1.7/index.js"
    reported = await client.post(
        "/v1/report",
        json={
            "reason": "connect kit",
            "nodes": [
                {
                    "type": "package",
                    "id": "pkg:npm/@ledgerhq/connect-kit@1.1.7",
                    "risk": "critical",
                    "category": "drainer",
                }
            ],
        },
        headers=headers,
    )
    assert reported.status_code == 201, reported.text
    graph = await client.post("/v1/check-scripts", json={"scripts": [url]}, headers=headers)
    assert graph.status_code == 200, graph.text
    assert graph.json()["level"] == "critical"
    assert "socket" in graph.json()["notChecked"]

    monkeypatch.setattr(get_settings(), "socket_api_key", SecretStr("socket-test"))
    with respx.mock(assert_all_called=False) as mock:
        mock.post("https://api.socket.dev/v0/purl").mock(
            return_value=httpx.Response(
                200,
                json=[
                    {
                        "inputPurl": "pkg:npm/left-pad@1.0.0",
                        "alerts": [{"severity": "critical", "type": "malware"}],
                    }
                ],
            )
        )
        socket = await client.post(
            "/v1/check-scripts",
            json={"scripts": ["https://unpkg.com/left-pad@1.0.0/index.js"]},
            headers=headers,
        )
    assert socket.status_code == 200, socket.text
    assert socket.json()["level"] == "critical"
    assert any(item["source"] == "socket" for item in socket.json()["findings"])


async def test_young_lookalike_is_stronger_than_the_name(client, captured_codes):
    """A MetaMask lookalike registered yesterday is critical and says when it was registered."""
    headers = await _auth(client, captured_codes, "young@example.com")
    set_registration("metamaskk.io", datetime.now(UTC) - timedelta(hours=30))
    response = await client.post("/v1/check-domain", json={"domain": "metamaskk.io"}, headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["level"] == "critical"
    text = " ".join(item["title"] + " " + item["evidence"] for item in body["findings"]).lower()
    assert "yesterday" in text
    assert "metamask" in text


async def test_approval_names_usdc_and_a_new_spender(client, captured_codes, monkeypatch):
    """An unlimited USDC approval says so, and a spender deployed yesterday is named."""
    headers = await _auth(client, captured_codes, "usdc@example.com")
    settings = get_settings()
    monkeypatch.setattr(settings, "etherscan_api_key", SecretStr("test-etherscan"))

    def etherscan(request: httpx.Request) -> httpx.Response:
        action = request.url.params["action"]
        if action == "getsourcecode":
            result = [{"SourceCode": "contract X {}", "ContractName": "Spender", "Proxy": "0", "Implementation": ""}]
        else:
            result = [{"timestamp": str(int(time.time()) - 30 * 3600)}]
        return httpx.Response(200, json={"status": "1", "message": "OK", "result": result})

    with respx.mock(assert_all_called=False) as mock:
        mock.get(url__startswith="https://sourcify.dev/").mock(return_value=httpx.Response(404))
        mock.get(url__startswith="https://api.etherscan.io/").mock(side_effect=etherscan)
        response = await client.post(
            "/v1/review-tx",
            json={
                "chainId": 1,
                "method": "eth_sendTransaction",
                "to": USDC,
                "data": _approve(SPENDER, 2**256 - 1),
            },
            headers=headers,
        )
    assert response.status_code == 200, response.text
    titles = " ".join(item["title"] for item in response.json()["findings"])
    evidence = " ".join(item["evidence"] for item in response.json()["findings"])
    assert "entire USDC balance" in titles
    assert "yesterday" in titles + evidence


async def test_payment_names_the_package_that_drains_to_the_same_wallet(client, captured_codes):
    """A transaction that pays a wallet a reported package drains to says both in one finding."""
    headers = await _auth(client, captured_codes, "drain@example.com")
    package = "pkg:npm/@ledgerhq/connect-kit@1.1.7"
    reported = await client.post(
        "/v1/report",
        json={
            "reason": "connect kit drains here",
            "nodes": [
                {"type": "package", "id": package, "risk": "critical", "category": "drainer"},
                {"type": "wallet", "id": f"1:{SPENDER}", "risk": "critical", "category": "drainer"},
            ],
            "edges": [{"type": "package_drains_to", "fromId": package, "toId": f"1:{SPENDER}"}],
        },
        headers=headers,
    )
    assert reported.status_code == 201, reported.text
    with respx.mock(assert_all_called=False) as mock:
        mock.get(url__startswith="https://sourcify.dev/").mock(return_value=httpx.Response(404))
        response = await client.post(
            "/v1/review-tx",
            json={
                "chainId": 1,
                "method": "eth_sendTransaction",
                "to": USDC,
                "data": _approve(SPENDER, 2**256 - 1),
            },
            headers=headers,
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["level"] == "critical"
    linked = next(item for item in body["findings"] if "same wallet" in item["evidence"])
    assert package in linked["evidence"]
    assert SPENDER in linked["evidence"]


async def test_imran_scans_packages_with_socket(client, monkeypatch):
    """The service key scans npm package ids. A user token is not accepted."""
    body = {"purls": ["pkg:npm/evil@1.0.0"]}
    denied = await client.post("/v1/internal/scan-packages", json=body)
    assert denied.status_code == 401
    monkeypatch.setattr(get_settings(), "socket_api_key", SecretStr("socket-test"))
    key = get_settings().internal_service_key.get_secret_value()
    with respx.mock(assert_all_called=False) as mock:
        mock.post("https://api.socket.dev/v0/purl").mock(
            return_value=httpx.Response(
                200,
                json=[{"inputPurl": "pkg:npm/evil@1.0.0", "alerts": [{"severity": "critical", "type": "malware"}]}],
            )
        )
        accepted = await client.post("/v1/internal/scan-packages", json=body, headers={"X-Service-Key": key})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["level"] == "critical"
    assert any(item["source"] == "socket" for item in accepted.json()["findings"])
    bad = await client.post(
        "/v1/internal/scan-packages",
        json={"purls": ["not-a-package"]},
        headers={"X-Service-Key": key},
    )
    assert bad.status_code == 422
