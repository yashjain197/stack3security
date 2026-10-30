"""
Request and response contracts for plans, checkout, portal and subscription status.

Made by Yash Jain with passion.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from app.modules.billing.models import BillingInterval
from app.schemas.base import ApiModel


class PriceOut(ApiModel):
    """One purchasable price."""

    interval: BillingInterval
    amount_cents: int
    currency: str
    per_seat: bool
    included_seats: int
    available: bool


class FeatureOut(ApiModel):
    """A feature included in a plan, with its monthly limit if any."""

    code: str
    description: str
    monthly_limit: int | None


class PlanOut(ApiModel):
    """A plan as shown on the pricing page."""

    code: str
    name: str
    is_paid: bool
    min_seats: int
    trial_days: int
    features: list[FeatureOut]
    prices: list[PriceOut]


class CheckoutIn(ApiModel):
    """Start a Dodo checkout for Pro (personal) or Team (needs teamId and seats)."""

    plan: Literal["pro", "team"]
    interval: BillingInterval = BillingInterval.MONTH
    seats: int = Field(default=1, ge=1, le=500)
    team_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _team_fields(self) -> "CheckoutIn":
        """Team checkout needs a team; Pro checkout must not have one."""
        if self.plan == "team" and self.team_id is None:
            raise ValueError("teamId is required for the team plan")
        if self.plan == "pro" and (self.team_id is not None or self.seats != 1):
            raise ValueError("pro is a single-seat personal plan")
        return self


class CheckoutOut(ApiModel):
    """Where to send the user to pay."""

    checkout_url: str
    session_id: str
    trial_days: int


class PortalOut(ApiModel):
    """Dodo customer portal link."""

    url: str


class SubscriptionOut(ApiModel):
    """One subscription the user pays for."""

    id: uuid.UUID
    plan: str
    interval: BillingInterval
    status: str
    seats: int
    team_id: uuid.UUID | None
    trial_ends_at: datetime | None
    current_period_end: datetime | None
    cancel_at_period_end: bool


class BillingStatusOut(ApiModel):
    """Effective plan plus every subscription billed to the user."""

    plan: str
    status: str
    features: list[str]
    subscriptions: list[SubscriptionOut]
