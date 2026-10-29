"""
HTTP routes for plans, checkout, customer portal, billing status and the Dodo webhook.

Made by Yash Jain with passion.
"""

import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.rate_limit import Limits
from app.modules.billing import service
from app.modules.billing.dodo_client import DodoClient
from app.modules.billing.entitlements import resolve_entitlements
from app.modules.billing.models import Plan, PlanPrice, Subscription
from app.modules.billing.schemas import (
    BillingStatusOut,
    CheckoutIn,
    CheckoutOut,
    PlanOut,
    PortalOut,
    SubscriptionOut,
)
from app.modules.billing.webhook_signature import verify_webhook
from app.modules.identity.dependencies import CurrentPrincipal, DbSession, Limiter, WebPrincipal

router = APIRouter(prefix="/v1/billing", tags=["billing"])


async def get_dodo_client() -> AsyncIterator[DodoClient]:
    """Per-request Dodo client, closed afterwards."""
    client = DodoClient()
    try:
        yield client
    finally:
        await client.aclose()


Dodo = Annotated[DodoClient, Depends(get_dodo_client)]


@router.get("/plans", response_model=list[PlanOut])
async def plans(db: DbSession) -> list[PlanOut]:
    """Public pricing catalog."""
    return await service.list_plans(db)


@router.post("/checkout", response_model=CheckoutOut)
async def checkout(
    body: CheckoutIn, principal: WebPrincipal, db: DbSession, limiter: Limiter, dodo: Dodo
) -> CheckoutOut:
    """Start a Dodo checkout for Pro or Team."""
    await limiter.hit(Limits.BILLING_USER, str(principal.user.id))
    return await service.create_checkout(db, principal.user, body, dodo)


@router.post("/portal", response_model=PortalOut)
async def portal(principal: WebPrincipal, db: DbSession, limiter: Limiter, dodo: Dodo) -> PortalOut:
    """Open the Dodo customer portal to change card, plan or cancel."""
    await limiter.hit(Limits.BILLING_USER, str(principal.user.id))
    return PortalOut(url=await service.create_portal(db, principal.user, dodo))


@router.get("/subscription", response_model=BillingStatusOut)
async def subscription(principal: CurrentPrincipal, db: DbSession) -> BillingStatusOut:
    """Effective plan and every subscription billed to this user."""
    ent = await resolve_entitlements(db, principal.user.id)
    rows = (
        await db.execute(
            select(Subscription, PlanPrice, Plan)
            .join(PlanPrice, PlanPrice.id == Subscription.plan_price_id)
            .join(Plan, Plan.id == PlanPrice.plan_id)
            .where(Subscription.billing_user_id == principal.user.id)
            .order_by(Subscription.created_at.desc())
        )
    ).all()
    return BillingStatusOut(
        plan=ent.plan,
        status=ent.status,
        features=list(ent.features),
        subscriptions=[
            SubscriptionOut(
                id=sub.id,
                plan=plan.code,
                interval=price.interval,
                status=sub.status,
                seats=sub.quantity,
                team_id=sub.team_id,
                trial_ends_at=sub.trial_ends_at,
                current_period_end=sub.current_period_end,
                cancel_at_period_end=sub.cancel_at_period_end,
            )
            for sub, price, plan in rows
        ],
    )


@router.post("/webhooks/dodo", include_in_schema=False)
async def dodo_webhook(request: Request, db: DbSession) -> dict:
    """Receive Dodo events; signature is verified on the raw body before anything is parsed."""
    secret = get_settings().dodo_webhook_secret
    if secret is None:
        raise AppError("billing_not_configured", "Webhooks are not configured", 503)
    body = await request.body()
    webhook_id = request.headers.get("webhook-id", "")
    verify_webhook(
        secret.get_secret_value(),
        webhook_id,
        request.headers.get("webhook-timestamp", ""),
        request.headers.get("webhook-signature", ""),
        body,
    )
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise AppError("invalid_payload", "Webhook body is not JSON", 400) from exc
    processed = await service.process_webhook(db, webhook_id, payload)
    return {"received": True, "duplicate": not processed}
