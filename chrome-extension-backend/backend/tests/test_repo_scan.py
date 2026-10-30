"""
The website calls our API. We call Imran's repo-scan service with the service key and pass his answer back.

Made by Yash Jain with passion.
"""

import json

import httpx
import respx

from app.core.config import get_settings

_SCAN = "https://vs-ext-backend.stack3security.workers.dev"


async def test_scan_repo_forwards_the_verdict(client):
    """A public repo scan reaches Imran with the service key and returns his verdict unchanged."""
    verdict = {
        "level": "high",
        "target": {"type": "repo", "id": "github.com/acme/demo"},
        "findings": [],
        "indicators": {"addresses": [], "domains": []},
        "notChecked": [],
        "actions": [],
        "explanation": None,
    }
    with respx.mock(assert_all_called=True) as mock:
        route = mock.post(f"{_SCAN}/v1/internal/scan-repo").mock(return_value=httpx.Response(200, json=verdict))
        response = await client.post("/v1/scan-repo", json={"repoUrl": "https://github.com/acme/demo"})
    assert response.status_code == 200, response.text
    assert response.json() == verdict
    sent = route.calls[0].request
    key = get_settings().internal_service_key.get_secret_value()
    assert sent.headers["x-service-key"] == key
    assert json.loads(sent.content) == {"repoUrl": "https://github.com/acme/demo"}


async def test_stats_and_a_failed_clone(client):
    """Stats are public. A clone failure from Imran keeps his code and becomes our error envelope."""
    stats = {"reposScanned": 2, "threatsFound": 1, "byLevel": {}, "since": "2026-10-30T00:00:00Z"}
    with respx.mock(assert_all_called=True) as mock:
        mock.get(f"{_SCAN}/v1/internal/stats").mock(return_value=httpx.Response(200, json=stats))
        ok = await client.get("/v1/stats")
    assert ok.status_code == 200, ok.text
    assert ok.json()["reposScanned"] == 2
    with respx.mock(assert_all_called=True) as mock:
        mock.post(f"{_SCAN}/v1/internal/scan-repo").mock(
            return_value=httpx.Response(502, json={"error": {"code": "clone_failed", "message": "not found"}})
        )
        failed = await client.post("/v1/scan-repo", json={"repoUrl": "https://github.com/acme/missing"})
    assert failed.status_code == 502
    assert failed.json()["error"]["code"] == "clone_failed"
