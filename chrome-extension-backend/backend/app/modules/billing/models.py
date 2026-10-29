"""
Billing tables (3NF): plans, features, plan features, prices, Dodo customers, subscriptions and webhook events.

Made by Yash Jain with passion.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin

SUBSCRIPTION_STATUSES = (
    "pending",
    "active",
    "on_hold",
    "paused",
    "cancelled",
    "failed",
    "expired",
    "past_due",
)


class BillingInterval(enum.StrEnum):
    """How often a price is charged."""

    MONTH = "month"
    YEAR = "year"


class Plan(Base):
    """A product tier: free, pro or team."""

    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    rank: Mapped[int] = mapped_column(SmallInteger, unique=True, nullable=False)
    is_paid: Mapped[bool] = mapped_column(Boolean, nullable=False)
    min_seats: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("1"))


class Feature(Base):
    """A capability that can be granted by a plan."""

    __tablename__ = "features"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(200), nullable=False)


class PlanFeature(Base):
    """Grants a feature to a plan, with an optional monthly usage limit (NULL means unlimited)."""

    __tablename__ = "plan_features"
    __table_args__ = (CheckConstraint("monthly_limit IS NULL OR monthly_limit > 0", name="limit_positive"),)

    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), primary_key=True)
    feature_id: Mapped[int] = mapped_column(ForeignKey("features.id", ondelete="CASCADE"), primary_key=True)
    monthly_limit: Mapped[int | None] = mapped_column(Integer)


class PlanPrice(Base):
    """A purchasable price for a plan: one Dodo subscription product, plus a seat add-on for per-seat plans.

    Per-seat plans: the base product includes `included_seats`; each extra seat is one unit of the seat add-on.
    """

    __tablename__ = "plan_prices"
    __table_args__ = (
        UniqueConstraint("plan_id", "interval", "currency"),
        CheckConstraint("amount_cents >= 0", name="amount_non_negative"),
        CheckConstraint("included_seats >= 1", name="included_seats_positive"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso"),
    )

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="RESTRICT"), nullable=False)
    interval: Mapped[BillingInterval] = mapped_column(
        Enum(
            BillingInterval,
            name="billing_interval",
            native_enum=False,
            create_constraint=True,
            length=8,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    per_seat: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    included_seats: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("1"))
    dodo_product_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    dodo_seat_addon_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class BillingCustomer(CreatedAtMixin, Base):
    """Link between a Stack3 user and their Dodo customer record."""

    __tablename__ = "billing_customers"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    dodo_customer_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)


class Subscription(CreatedAtMixin, Base):
    """Mirror of a Dodo subscription; team_id is set when the subscription covers a whole team."""

    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint(f"status IN {SUBSCRIPTION_STATUSES}", name="status_known"),
        CheckConstraint("quantity >= 1", name="quantity_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    dodo_subscription_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    billing_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    team_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), index=True)
    plan_price_id: Mapped[int] = mapped_column(ForeignKey("plan_prices.id", ondelete="RESTRICT"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("1"))
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    last_event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"), nullable=False)


class WebhookEvent(Base):
    """Every Dodo webhook ID we have seen, so retries are processed exactly once."""

    __tablename__ = "webhook_events"

    webhook_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    event_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
