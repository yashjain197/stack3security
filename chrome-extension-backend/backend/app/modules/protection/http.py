"""
Shared HTTP client for blocklists, Etherscan, the Ethereum RPC and Socket.

Made by Yash Jain with passion.
"""

import httpx

_client: httpx.AsyncClient | None = None


def get_http() -> httpx.AsyncClient:
    """One client for every outbound check, with a short timeout so a slow provider cannot stall the extension."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(8.0, connect=4.0),
            headers={"User-Agent": "Stack3Security/1.0"},
            follow_redirects=False,
        )
    return _client


async def close_http() -> None:
    """Close the client on shutdown."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
