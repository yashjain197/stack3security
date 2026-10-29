"""
Request and response contracts for login, tokens, sessions and device linking.

Made by Yash Jain with passion.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import EmailStr, Field, field_validator

from app.modules.identity.models import ClientType
from app.schemas.base import ApiModel

LinkClient = Literal[ClientType.CHROME, ClientType.VSCODE, ClientType.CLI]


class OtpRequestIn(ApiModel):
    """Ask for a login code to be emailed."""

    email: EmailStr = Field(max_length=320)

    @field_validator("email")
    @classmethod
    def _lower(cls, value: str) -> str:
        """Emails are case-insensitive for login."""
        return value.lower()


class OtpRequestOut(ApiModel):
    """Same answer whether or not the account exists, so emails cannot be enumerated."""

    status: Literal["sent"] = "sent"
    expires_in_seconds: int
    retry_after_seconds: int


class OtpVerifyIn(ApiModel):
    """Exchange the emailed code for tokens."""

    email: EmailStr = Field(max_length=320)
    code: str = Field(pattern=r"^\d{6}$")
    client: ClientType = ClientType.WEB
    device_name: str | None = Field(default=None, max_length=100)

    @field_validator("email")
    @classmethod
    def _lower(cls, value: str) -> str:
        """Emails are case-insensitive for login."""
        return value.lower()


class UserOut(ApiModel):
    """Public view of a user."""

    id: uuid.UUID
    email: str
    created_at: datetime


class TokenPairOut(ApiModel):
    """Tokens returned on login, refresh and device linking; web clients get the refresh token as a cookie."""

    access_token: str
    token_type: Literal["Bearer"] = "Bearer"  # noqa: S105
    expires_in: int
    refresh_token: str | None = None
    refresh_expires_in: int
    session_id: uuid.UUID
    user: UserOut


class RefreshIn(ApiModel):
    """Refresh token in the body (extensions, CLI); web uses the httpOnly cookie instead."""

    refresh_token: str | None = Field(default=None, min_length=20, max_length=200)


class LinkStartIn(ApiModel):
    """A non-web client asks to be linked to the user's website login."""

    client: LinkClient
    device_name: str | None = Field(default=None, max_length=100)


class LinkStartOut(ApiModel):
    """Codes the client shows and polls with (RFC 8628 field meanings)."""

    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    expires_in: int
    interval: int


class LinkDetailsOut(ApiModel):
    """What the website shows before the user approves, so they can spot a phishing attempt."""

    user_code: str
    client: ClientType
    device_name: str | None
    requested_ip: str | None
    created_at: datetime
    expires_at: datetime
    status: Literal["pending", "approved", "denied", "expired", "consumed"]


class LinkDecisionIn(ApiModel):
    """The logged-in website user approves or denies a link request."""

    user_code: str = Field(min_length=8, max_length=9)
    approve: bool


class LinkTokenIn(ApiModel):
    """The client polls with its secret device code."""

    device_code: str = Field(min_length=20, max_length=200)


class SessionOut(ApiModel):
    """One signed-in device in the account's session list."""

    id: uuid.UUID
    client: ClientType
    device_name: str | None
    created_ip: str | None
    created_at: datetime
    last_used_at: datetime
    current: bool


class TeamOut(ApiModel):
    """The user's team summary."""

    id: uuid.UUID
    name: str
    role: str


class MeOut(ApiModel):
    """Current user with their effective plan; what every client renders in its account area."""

    user: UserOut
    plan: str
    status: str
    features: list[str]
    limits: dict[str, int]
    team: TeamOut | None
    trial_ends_at: datetime | None
    current_period_end: datetime | None
    cancel_at_period_end: bool
