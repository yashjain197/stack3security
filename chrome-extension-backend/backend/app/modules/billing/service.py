"""
Billing business logic: plan catalog, Dodo checkout with a one-time 30-day trial, portal, and webhook sync.

Made by Yash Jain with passion.
"""

import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import exists, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, Forbidden, NotFound
from app.core.logging import get_logger
from app.db.base import utcnow
from app.modules.billing.catalog import product_ids_from_settings, seat_addon_ids_from_settings
from app.modules.billing.dodo_client import DodoClient
from app.modules.billing.entitlements import ENTITLED_STATUSES
from app.modules.billing.models import (
    SUBSCRIPTION_STATUSES,
    BillingCustomer,
    Feature,
    Plan,
    PlanFeature,
    PlanPrice,
    Subscription,
    WebhookEvent,
)
from app.modules.billing.schemas import CheckoutIn, CheckoutOut, FeatureOut, PlanOut, PriceOut
from app.modules.identity.models import User
from app.modules.teams.models import Team, TeamMember, TeamRole

logger = get_logger("billing")


async def sync_product_ids(db: AsyncSession) -> None:
    """Attach Dodo product and seat add-on IDs from env vars to the seeded prices (idempotent, runs at startup)."""
    settings = get_settings()
    for price_id, product_id in product_ids_from_settings(settings).items():
        await db.execute(update(PlanPrice).where(PlanPrice.id == price_id).values(dodo_product_id=product_id))
    for price_id, addon_id in seat_addon_ids_from_settings(settings).items():
        await db.execute(update(PlanPrice).where(PlanPrice.id == price_id).values(dodo_seat_addon_id=addon_id))
    await db.commit()


def _seat_count(price: PlanPrice, data: dict[str, Any]) -> int:
    """Seats on a subscription: included seats plus units of our seat add-on (non-seat plans are 1)."""
    if not price.per_seat:
        return 1
    extra = sum(
        int(addon.get("quantity") or 0)
        for addon in data.get("addons") or []
        if addon.get("addon_id") == price.dodo_seat_addon_id
    )
    return price.included_seats + max(extra, 0)


async def list_plans(db: AsyncSession) -> list[PlanOut]:
    """Pricing-page catalog with features and prices."""
    settings = get_settings()
    plans = (await db.execute(select(Plan).order_by(Plan.rank))).scalars().all()
    feature_rows = (
        await db.execute(
            select(PlanFeature.plan_id, Feature.code, Feature.description, PlanFeature.monthly_limit)
            .join(Feature, Feature.id == PlanFeature.feature_id)
            .order_by(Feature.id)
        )
    ).all()
    prices = (await db.execute(select(PlanPrice).where(PlanPrice.is_active).order_by(PlanPrice.id))).scalars().all()
    return [
        PlanOut(
            code=plan.code,
            name=plan.name,
            is_paid=plan.is_paid,
            min_seats=plan.min_seats,
            trial_days=settings.dodo_trial_days if plan.is_paid else 0,
            features=[
                FeatureOut(code=code, description=desc, monthly_limit=limit)
                for plan_id, code, desc, limit in feature_rows
                if plan_id == plan.id
            ],
            prices=[
                PriceOut(
                    interval=p.interval,
                    amount_cents=p.amount_cents,
                    currency=p.currency,
                    per_seat=p.per_seat,
                    included_seats=p.included_seats,
                    available=p.dodo_product_id is not None,
                )
                for p in prices
                if p.plan_id == plan.id
            ],
        )
        for plan in plans
    ]


async def _assert_team_billing_admin(db: AsyncSession, user_id: uuid.UUID, team_id: uuid.UUID) -> None:
    """Only a team owner or admin may buy seats for the team."""
    role = (
        await db.execute(select(TeamMember.role).where(TeamMember.team_id == team_id, TeamMember.user_id == user_id))
    ).scalar_one_or_none()
    if role not in (TeamRole.OWNER, TeamRole.ADMIN):
        raise Forbidden("Only a team owner or admin can manage billing", "team_admin_required")


async def create_checkout(db: AsyncSession, user: User, body: CheckoutIn, dodo: DodoClient) -> CheckoutOut:
    """Create a Dodo checkout; the 30-day trial is granted only to people who never subscribed before."""
    settings = get_settings()
    price = (
        await db.execute(
            select(PlanPrice, Plan)
            .join(Plan, Plan.id == PlanPrice.plan_id)
            .where(Plan.code == body.plan, PlanPrice.interval == body.interval, PlanPrice.is_active)
        )
    ).first()
    if price is None or price.PlanPrice.dodo_product_id is None:
        raise AppError("billing_not_configured", "This plan is not available for purchase yet", 503)
    plan_price, plan = price.PlanPrice, price.Plan

    if body.plan == "team":
        assert body.team_id is not None
        await _assert_team_billing_admin(db, user.id, body.team_id)
        if body.seats < max(plan.min_seats, plan_price.included_seats):
            raise AppError("too_few_seats", f"The team plan needs at least {plan.min_seats} seats", 400)
        scope = Subscription.team_id == body.team_id
    else:
        scope = (Subscription.billing_user_id == user.id) & Subscription.team_id.is_(None)

    already = await db.scalar(select(exists().where(scope, Subscription.status.in_(ENTITLED_STATUSES))))
    if already:
        raise AppError("already_subscribed", "You already have an active subscription; manage it in the portal", 409)

    addons = None
    if plan_price.per_seat:
        extra_seats = body.seats - plan_price.included_seats
        if extra_seats > 0:
            if plan_price.dodo_seat_addon_id is None:
                raise AppError("billing_not_configured", "Extra seats are not available for purchase yet", 503)
            addons = [{"addon_id": plan_price.dodo_seat_addon_id, "quantity": extra_seats}]

    had_any_subscription = await db.scalar(select(exists().where(Subscription.billing_user_id == user.id)))
    trial_days = 0 if had_any_subscription else settings.dodo_trial_days

    customer_id = await db.scalar(select(BillingCustomer.dodo_customer_id).where(BillingCustomer.user_id == user.id))
    session = await dodo.create_checkout_session(
        product_id=plan_price.dodo_product_id,
        quantity=1,
        addons=addons,
        customer={"customer_id": customer_id} if customer_id else {"email": user.email},
        return_url=f"{settings.web_app_url.rstrip('/')}/billing/return",
        metadata={
            "stack3_user_id": str(user.id),
            "stack3_team_id": str(body.team_id) if body.team_id else "",
            "stack3_plan_price_id": str(plan_price.id),
        },
        trial_period_days=trial_days,
    )
    if not session.get("checkout_url"):
        raise AppError("billing_provider_error", "Payment provider did not return a checkout link", 502)
    return CheckoutOut(checkout_url=session["checkout_url"], session_id=session["session_id"], trial_days=trial_days)


async def create_portal(db: AsyncSession, user: User, dodo: DodoClient) -> str:
    """Customer portal link for the user's Dodo customer."""
    customer_id = await db.scalar(select(BillingCustomer.dodo_customer_id).where(BillingCustomer.user_id == user.id))
    if customer_id is None:
        raise NotFound("No billing account yet; start a subscription first", "no_billing_account")
    return await dodo.create_portal_session(customer_id, f"{get_settings().web_app_url.rstrip('/')}/account/billing")


def _parse_dt(value: Any) -> datetime | None:
    """Parse Dodo ISO-8601 timestamps."""
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


async def _resolve_owner(db: AsyncSession, data: dict[str, Any]) -> User | None:
    """Find the Stack3 user from checkout metadata, falling back to the customer email."""
    metadata = data.get("metadata") or {}
    raw_user_id = metadata.get("stack3_user_id")
    if raw_user_id:
        try:
            user = await db.get(User, uuid.UUID(str(raw_user_id)))
            if user is not None:
                return user
        except ValueError:
            pass
    email = ((data.get("customer") or {}).get("email") or "").lower()
    if email:
        return (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    return None


async def _resolve_team_id(db: AsyncSession, data: dict[str, Any]) -> uuid.UUID | None:
    """Team from checkout metadata, only if the team still exists."""
    raw = (data.get("metadata") or {}).get("stack3_team_id")
    if not raw:
        return None
    try:
        team_id = uuid.UUID(str(raw))
    except ValueError:
        return None
    return team_id if await db.get(Team, team_id) is not None else None


async def _upsert_subscription(db: AsyncSession, data: dict[str, Any], event_at: datetime) -> None:
    """Mirror a Dodo subscription payload into our table, ignoring stale out-of-order events."""
    dodo_id = data.get("subscription_id")
    status = data.get("status")
    if not dodo_id or status not in SUBSCRIPTION_STATUSES:
        logger.warning("webhook_subscription_unusable", subscription_id=dodo_id, status=status)
        return

    price = (
        await db.execute(select(PlanPrice).where(PlanPrice.dodo_product_id == data.get("product_id")))
    ).scalar_one_or_none()
    if price is None:
        logger.warning("webhook_unknown_product", product_id=data.get("product_id"))
        return

    user = await _resolve_owner(db, data)
    if user is None:
        logger.warning("webhook_unknown_customer", subscription_id=dodo_id)
        return

    customer_id = (data.get("customer") or {}).get("customer_id")
    if customer_id:
        await db.execute(
            insert(BillingCustomer).values(user_id=user.id, dodo_customer_id=customer_id).on_conflict_do_nothing()
        )

    created_at = _parse_dt(data.get("created_at")) or event_at
    trial_days = int(data.get("trial_period_days") or 0)
    values = {
        "status": status,
        "plan_price_id": price.id,
        "quantity": _seat_count(price, data),
        "trial_ends_at": created_at + timedelta(days=trial_days) if trial_days > 0 else None,
        "current_period_end": _parse_dt(data.get("next_billing_date")),
        "cancel_at_period_end": bool(data.get("cancel_at_next_billing_date")),
        "last_event_at": event_at,
        "updated_at": utcnow(),
    }

    existing = (
        await db.execute(select(Subscription).where(Subscription.dodo_subscription_id == dodo_id).with_for_update())
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            Subscription(
                dodo_subscription_id=dodo_id,
                billing_user_id=user.id,
                team_id=await _resolve_team_id(db, data),
                **values,
            )
        )
    elif existing.last_event_at <= event_at:
        for key, value in values.items():
            setattr(existing, key, value)
    else:
        logger.info("webhook_stale_event_ignored", subscription_id=dodo_id)


async def process_webhook(db: AsyncSession, webhook_id: str, payload: dict[str, Any]) -> bool:
    """Apply one verified webhook exactly once; returns False for duplicates."""
    event_type = str(payload.get("type", ""))[:60]
    event_at = _parse_dt(payload.get("timestamp")) or utcnow()

    inserted = await db.execute(
        insert(WebhookEvent)
        .values(webhook_id=webhook_id[:100], event_type=event_type, event_timestamp=event_at)
        .on_conflict_do_nothing()
        .returning(WebhookEvent.webhook_id)
    )
    if inserted.scalar_one_or_none() is None:
        already_done = await db.scalar(
            select(WebhookEvent.processed_at).where(WebhookEvent.webhook_id == webhook_id[:100])
        )
        if already_done is not None:
            return False

    data = payload.get("data") or {}
    if event_type.startswith("subscription."):
        await _upsert_subscription(db, data, event_at)
    else:
        logger.info("webhook_event_acknowledged", event_type=event_type)

    await db.execute(
        update(WebhookEvent).where(WebhookEvent.webhook_id == webhook_id[:100]).values(processed_at=utcnow())
    )
    await db.commit()
    return True
