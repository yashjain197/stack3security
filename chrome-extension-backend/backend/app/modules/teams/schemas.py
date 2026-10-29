"""
Request and response contracts for teams, members and invites.

Made by Yash Jain with passion.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import EmailStr, Field, field_validator

from app.modules.teams.models import TeamRole
from app.schemas.base import ApiModel


class TeamCreateIn(ApiModel):
    """Create a team; the caller becomes its owner."""

    name: str = Field(min_length=1, max_length=80)


class InviteCreateIn(ApiModel):
    """Invite someone by email."""

    email: EmailStr = Field(max_length=320)
    role: Literal[TeamRole.ADMIN, TeamRole.MEMBER] = TeamRole.MEMBER

    @field_validator("email")
    @classmethod
    def _lower(cls, value: str) -> str:
        """Invites match the login email case-insensitively."""
        return value.lower()


class InviteAcceptIn(ApiModel):
    """Token from the invite link."""

    token: str = Field(min_length=20, max_length=200)


class MemberOut(ApiModel):
    """A team member."""

    user_id: uuid.UUID
    email: str
    role: TeamRole
    joined_at: datetime


class InviteOut(ApiModel):
    """A pending invite."""

    id: uuid.UUID
    email: str
    role: TeamRole
    expires_at: datetime


class TeamDetailOut(ApiModel):
    """Full team view for its members."""

    id: uuid.UUID
    name: str
    my_role: TeamRole
    seats: int | None
    seats_used: int
    subscription_status: str | None
    members: list[MemberOut]
    invites: list[InviteOut]
