"""
Thin async client for the Dodo Payments REST API (checkout sessions and customer portal).

Made by Yash Jain with passion.
"""

from typing import Any

import httpx

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger

logger = get_logger("dodo")


class DodoClient:
    """Calls Dodo with the secret API key; every failure becomes a clean 502 for the client."""

    def __init__(self, http: httpx.AsyncClient | None = None) -> None:
        settings = get_settings()
        if settings.dodo_api_key is None:
            raise AppError("billing_not_configured", "Payments are not configured yet", 503)
        self._http = http or httpx.AsyncClient(
            base_url=settings.dodo_base_url,
            timeout=httpx.Timeout(15.0, connect=5.0),
            headers={"Authorization": f"Bearer {settings.dodo_api_key.get_secret_value()}"},
        )

    async def _post(self, path: str, json: dict[str, Any] | None = None, params: dict[str, Any] | None = None) -> dict:
        """POST to Dodo and return the JSON body."""
        try:
            response = await self._http.post(path, json=json, params=params)
        except httpx.HTTPError as exc:
            logger.error("dodo_network_error", path=path, error=type(exc).__name__)
            raise AppError("billing_provider_error", "Payment provider is unreachable, try again", 502) from exc
        if response.status_code >= 400:
            logger.error("dodo_api_error", path=path, status=response.status_code, body=response.text[:500])
            raise AppError("billing_provider_error", "Payment provider rejected the request", 502)
        return response.json()

    async def create_checkout_session(
        self,
        product_id: str,
        quantity: int,
        customer: dict[str, str],
        return_url: str,
        metadata: dict[str, str],
        trial_period_days: int,
        addons: list[dict[str, Any]] | None = None,
    ) -> dict:
        """Create a hosted checkout; returns session_id and checkout_url. Seats are passed as add-ons."""
        item: dict[str, Any] = {"product_id": product_id, "quantity": quantity}
        if addons:
            item["addons"] = addons
        return await self._post(
            "/checkouts",
            json={
                "product_cart": [item],
                "customer": customer,
                "return_url": return_url,
                "metadata": metadata,
                "subscription_data": {"trial_period_days": trial_period_days},
            },
        )

    async def create_portal_session(self, customer_id: str, return_url: str) -> str:
        """Create a customer-portal link for managing card, plan and cancellation."""
        data = await self._post(f"/customers/{customer_id}/customer-portal/session", params={"return_url": return_url})
        return data["link"]

    async def aclose(self) -> None:
        """Close the underlying HTTP connection pool."""
        await self._http.aclose()
