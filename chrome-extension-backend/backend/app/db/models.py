"""
Imports every ORM model so Alembic and the app see the full schema in one place.

Made by Yash Jain with passion.
"""

from app.db.base import Base
from app.modules.billing.models import (
    BillingCustomer,
    Feature,
    Plan,
    PlanFeature,
    PlanPrice,
    Subscription,
    WebhookEvent,
)
from app.modules.identity.models import AuthSession, EmailOtp, LinkRequest, RefreshToken, User
from app.modules.teams.models import Team, TeamInvite, TeamMember

__all__ = [
    "AuthSession",
    "Base",
    "BillingCustomer",
    "EmailOtp",
    "Feature",
    "LinkRequest",
    "Plan",
    "PlanFeature",
    "PlanPrice",
    "RefreshToken",
    "Subscription",
    "Team",
    "TeamInvite",
    "TeamMember",
    "User",
    "WebhookEvent",
]
