"""
Threat graph: ID normalisation, reports from users and the VS Code service, sync to TigerGraph, neighbourhood reads.

Made by Yash Jain with passion.
"""

import httpx
import pytest
import respx
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.modules.graph.catalog import normalize_node
from app.modules.graph.models import GraphNode, GraphReport
from app.modules.graph.seed import SEED_REPORT_ID, ensure_seed
from app.modules.graph.tigergraph import close_tigergraph
from tests.conftest import bearer, login

COLLECTOR = "1:0x658729879fca881d9526480b82ae00efc54b5c2d"
PACKAGE = "pkg:npm/@ledgerhq/connect-kit@1.1.7"


def test_ids_are_canonical():
    """Wallets, purls, repos and URLs collapse to one spelling."""
    assert normalize_node("wallet", "1:0xABCD" + "ab" * 18).vertex_id == "1:0xabcd" + "ab" * 18
    package = normalize_node("package", PACKAGE)
    assert package.attributes["pkg_name"] == "@ledgerhq/connect-kit"
    assert normalize_node("repo", "https://github.com/LedgerHQ/connect-kit").vertex_id == "github:ledgerhq/connect-kit"
    endpoint = normalize_node("endpoint", "HTTPS://CDN.JSDELIVR.NET/npm/evil.js?x=1")
    assert endpoint.vertex_id == "https://cdn.jsdelivr.net/npm/evil.js"
    with pytest.raises(ValueError):
        normalize_node("wallet", "0x" + "ab" * 20)


def _enable_tigergraph(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point the client at a fake TigerGraph without touching the real workspace."""
    settings = get_settings()
    monkeypatch.setattr(settings, "tigergraph_host", "https://tg.test")
    monkeypatch.setattr(settings, "tigergraph_secret", SecretStr("tg-secret"))
    monkeypatch.setattr(settings, "tigergraph_graph", "stack3")


def _mock_tigergraph(upsert_status: int = 200) -> respx.Router:
    """Token plus upsert. The router is the upsert call, so a test can read what was sent."""
    respx.post("https://tg.test/gsql/v1/tokens").mock(
        return_value=httpx.Response(200, json={"error": False, "token": "tok"})
    )
    return respx.post("https://tg.test/restpp/graph/stack3").mock(
        return_value=httpx.Response(upsert_status, json={"error": upsert_status >= 400, "results": []})
    )


async def test_user_report_is_stored_and_synced(client, captured_codes, monkeypatch):
    """A report lands in Postgres and is upserted to TigerGraph with an absolute report count."""
    _enable_tigergraph(monkeypatch)
    web = (await login(client, captured_codes, "reporter@example.com")).json()
    with respx.mock:
        upsert = _mock_tigergraph()
        response = await client.post(
            "/v1/report",
            json={
                "reason": "this site asked for my seed phrase",
                "nodes": [
                    {
                        "type": "domain",
                        "id": "https://www.MetaMask-Verify.io/login",
                        "risk": "high",
                        "category": "phishing",
                        "impersonates": "MetaMask",
                    }
                ],
                "edges": [],
            },
            headers=bearer(web["accessToken"]),
        )
    assert response.status_code == 201, response.text
    assert response.json()["synced"] is True
    sent = upsert.calls.last.request.read().decode()
    assert "metamask-verify.io" in sent
    assert '"report_count":{"value":1}' in sent
    monkeypatch.setattr(get_settings(), "tigergraph_host", None)

    view = await client.get("/v1/graph/domain/metamask-verify.io", headers=bearer(web["accessToken"]))
    assert view.status_code == 200, view.text
    body = view.json()
    assert body["node"]["risk"] == "high"
    assert body["node"]["attributes"]["impersonates"] == "metamask"
    assert body["source"] == "database"


async def test_a_later_report_cannot_downgrade_risk(client, captured_codes):
    """Critical stays critical, and each report counts once."""
    web = (await login(client, captured_codes, "again@example.com")).json()
    headers = bearer(web["accessToken"])
    for risk in ("critical", "unknown"):
        response = await client.post(
            "/v1/report",
            json={
                "reason": f"report as {risk}",
                "nodes": [{"type": "domain", "id": "phish.example", "risk": risk, "category": "phishing"}],
            },
            headers=headers,
        )
        assert response.status_code == 201, response.text
    view = await client.get("/v1/graph/domain/phish.example", headers=headers)
    assert view.json()["node"]["risk"] == "critical"
    assert view.json()["node"]["reportCount"] == 2


async def test_internal_report_needs_the_service_key(client):
    """Imran's route rejects a missing key and accepts the real one."""
    body = {
        "source": "vscode",
        "reporter": "scan-repo",
        "reason": "install script drains funds",
        "nodes": [
            {"type": "package", "id": "pkg:npm/evil-kit@1.0.0", "risk": "critical", "category": "drainer"},
            {"type": "wallet", "id": "1:0x" + "ab" * 20, "risk": "critical", "category": "drainer"},
        ],
        "edges": [{"type": "package_drains_to", "fromId": "pkg:npm/evil-kit@1.0.0", "toId": "1:0x" + "AB" * 20}],
    }
    denied = await client.post("/v1/internal/report", json=body)
    assert denied.status_code == 401
    key = get_settings().internal_service_key.get_secret_value()
    accepted = await client.post("/v1/internal/report", json=body, headers={"X-Service-Key": key})
    assert accepted.status_code == 201, accepted.text


async def test_graph_read_requires_login(client):
    """Neighbours are not public."""
    assert (await client.get("/v1/graph/domain/phish.example")).status_code == 401


async def test_bad_ids_and_dangling_edges_are_rejected(client, captured_codes):
    """A wallet without a chain, and an edge to a node the report never mentioned, are both 400."""
    web = (await login(client, captured_codes, "bad@example.com")).json()
    headers = bearer(web["accessToken"])
    bad_wallet = await client.post(
        "/v1/report",
        json={"reason": "no chain", "nodes": [{"type": "wallet", "id": "0x" + "ab" * 20}]},
        headers=headers,
    )
    assert bad_wallet.status_code == 400
    dangling = await client.post(
        "/v1/report",
        json={
            "reason": "edge goes nowhere",
            "nodes": [{"type": "domain", "id": "only.example"}],
            "edges": [{"type": "domain_drains_to", "fromId": "only.example", "toId": "1:0x" + "cd" * 20}],
        },
        headers=headers,
    )
    assert dangling.status_code == 400


async def test_tigergraph_outage_keeps_the_report(client, captured_codes, monkeypatch):
    """When TigerGraph rejects the write, the report stays and is marked for retry."""
    _enable_tigergraph(monkeypatch)
    web = (await login(client, captured_codes, "retry@example.com")).json()
    with respx.mock:
        _mock_tigergraph(upsert_status=500)
        response = await client.post(
            "/v1/report",
            json={"reason": "graph is down", "nodes": [{"type": "domain", "id": "later.example", "risk": "caution"}]},
            headers=bearer(web["accessToken"]),
        )
    assert response.status_code == 201, response.text
    assert response.json()["synced"] is False
    async with get_session_factory()() as session:
        report = await session.scalar(select(GraphReport).where(GraphReport.reason == "graph is down"))
    assert report is not None
    assert report.synced_at is None
    assert report.sync_attempts == 1


async def test_seed_loads_once_and_links_the_drainer(client, captured_codes):
    """The public seed is idempotent, and the collector wallet points back at the malicious package."""
    async with get_session_factory()() as session:
        await ensure_seed(session)
        await ensure_seed(session)
        reports = await session.scalar(
            select(func.count()).select_from(GraphReport).where(GraphReport.id == SEED_REPORT_ID)
        )
        nodes = await session.scalar(select(func.count()).select_from(GraphNode))
    assert reports == 1
    assert nodes == 12
    web = (await login(client, captured_codes, "viewer@example.com")).json()
    view = await client.get(f"/v1/graph/wallet/{COLLECTOR}", headers=bearer(web["accessToken"]))
    assert view.status_code == 200, view.text
    peers = {edge["peerId"] for edge in view.json()["edges"]}
    assert PACKAGE in peers
    assert all(edge["direction"] == "in" and edge["type"] == "package_drains_to" for edge in view.json()["edges"])


async def test_live_read_uses_tigergraph_edges(client, captured_codes, monkeypatch):
    """When TigerGraph has the vertex, its edges are what the page shows."""
    web = (await login(client, captured_codes, "live@example.com")).json()
    wallet = "1:0x" + "11" * 20
    created = await client.post(
        "/v1/report",
        json={"reason": "known wallet", "nodes": [{"type": "wallet", "id": wallet, "risk": "high"}]},
        headers=bearer(web["accessToken"]),
    )
    assert created.status_code == 201, created.text
    _enable_tigergraph(monkeypatch)
    await close_tigergraph()
    with respx.mock:
        respx.post("https://tg.test/gsql/v1/tokens").mock(
            return_value=httpx.Response(200, json={"error": False, "token": "tok"})
        )
        respx.get(url__regex=r"/vertices/").mock(
            return_value=httpx.Response(200, json={"error": False, "results": [{"v_id": wallet}]})
        )
        respx.get(url__regex=r"/edges/").mock(
            return_value=httpx.Response(
                200,
                json={
                    "error": False,
                    "results": [
                        {
                            "e_type": "WALLET_DRAINED_BY_PACKAGE",
                            "to_type": "SoftwarePackage",
                            "to_id": PACKAGE,
                            "attributes": {},
                        }
                    ],
                },
            )
        )
        view = await client.get(f"/v1/graph/wallet/{wallet}", headers=bearer(web["accessToken"]))
    assert view.status_code == 200, view.text
    assert view.json()["source"] == "tigergraph"
    assert view.json()["edges"] == [
        {"type": "package_drains_to", "direction": "in", "peerType": "package", "peerId": PACKAGE, "txHash": None}
    ]
