"""
Entitlement resolution: turns a user's personal and team subscriptions into one plan plus feature list.

The result is embedded in every access token so other services (VS Code API) can gate features without a DB call.

Made by Yash Jain with passion.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.modules.billing.models import Feature, Plan, PlanFeature, PlanPrice, Subscription
from app.modules.teams.models import Team, TeamMember

FREE_PLAN_CODE = "free"
ENTITLED_STATUSES = ("active", "past_due")


@dataclass(frozen=True)
class TeamInfo:
    """The team a user belongs to and their role in it."""

    id: uuid.UUID
    name: str
    role: str


@dataclass(frozen=True)
class Entitlements:
    """Effective plan for one user at one moment."""

    plan: str
    status: str
    features: tuple[str, ...]
    limits: dict[str, int] = field(default_factory=dict)
    team: TeamInfo | None = None
    trial_ends_at: datetime | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False

    def to_claims(self) -> dict:
        """Compact JWT claims: plan, status, features, team."""
        return {
            "plan": self.plan,
            "status": self.status,
            "ent": list(self.features),
            "team_id": str(self.team.id) if self.team else None,
            "role": self.team.role if self.team else None,
        }


async def _plan_features(db: AsyncSession, plan_id: int) -> tuple[tuple[str, ...], dict[str, int]]:
    """Feature codes and monthly limits granted by a plan."""
    rows = (
        await db.execute(
            select(Feature.code, PlanFeature.monthly_limit)
            .join(PlanFeature, PlanFeature.feature_id == Feature.id)
            .where(PlanFeature.plan_id == plan_id)
            .order_by(Feature.code)
        )
    ).all()
    features = tuple(code for code, _ in rows)
    limits = {code: limit for code, limit in rows if limit is not None}
    return features, limits


async def resolve_entitlements(db: AsyncSession, user_id: uuid.UUID) -> Entitlements:
    """Pick the highest-ranked entitled subscription (personal or team), else the free plan."""
    membership = (
        await db.execute(
            select(TeamMember.team_id, TeamMember.role, Team.name)
            .join(Team, Team.id == TeamMember.team_id)
            .where(TeamMember.user_id == user_id)
        )
    ).first()
    team = TeamInfo(id=membership.team_id, name=membership.name, role=str(membership.role)) if membership else None

    ownership = and_(Subscription.team_id.is_(None), Subscription.billing_user_id == user_id)
    if team is not None:
        ownership = or_(ownership, Subscription.team_id == team.id)

    best = (
        await db.execute(
            select(Subscription, Plan)
            .join(PlanPrice, PlanPrice.id == Subscription.plan_price_id)
            .join(Plan, Plan.id == PlanPrice.plan_id)
            .where(ownership, Subscription.status.in_(ENTITLED_STATUSES))
            .order_by(Plan.rank.desc(), Subscription.created_at.desc())
            .limit(1)
        )
    ).first()

    if best is None:
        free_plan = (await db.execute(select(Plan).where(Plan.code == FREE_PLAN_CODE))).scalar_one()
        features, limits = await _plan_features(db, free_plan.id)
        return Entitlements(plan=free_plan.code, status="free", features=features, limits=limits, team=team)

    subscription, plan = best
    features, limits = await _plan_features(db, plan.id)
    trialing = subscription.trial_ends_at is not None and subscription.trial_ends_at > utcnow()
    return Entitlements(
        plan=plan.code,
        status="trialing" if trialing and subscription.status == "active" else subscription.status,
        features=features,
        limits=limits,
        team=team,
        trial_ends_at=subscription.trial_ends_at,
        current_period_end=subscription.current_period_end,
        cancel_at_period_end=subscription.cancel_at_period_end,
    )
