"""
Request bodies for the Chrome checks. Page scan accepts signals only: never HTML, text the user typed, or a seed phrase.

Made by Yash Jain with passion.
"""

from typing import Any, Literal

from pydantic import Field

from app.schemas.base import ApiModel

_METHODS = Literal[
    "eth_sendTransaction",
    "eth_signTransaction",
    "personal_sign",
    "eth_sign",
    "eth_signTypedData",
    "eth_signTypedData_v3",
    "eth_signTypedData_v4",
    "wallet_sendCalls",
    "wallet_switchEthereumChain",
    "eth_requestAccounts",
]


class DomainCheckIn(ApiModel):
    """A site the extension is looking at. A full URL is accepted; only the host is checked."""

    domain: str = Field(min_length=1, max_length=512)


class PageSignals(ApiModel):
    """Facts the content script counted. The words a person typed never come here."""

    seed_phrase_field: bool = False
    recovery_word_count: int | None = Field(default=None, ge=0, le=24)
    asks_for_private_key: bool = False
    password_field: bool = False
    wallet_connect: bool = False
    external_script_hosts: list[str] = Field(default_factory=list, max_length=20)
    brand_in_title: str | None = Field(default=None, max_length=40)
    hidden_iframe: bool = False
    clipboard_read: bool = False
    fullscreen_overlay: bool = False


class PageScanIn(ApiModel):
    """The page origin plus the signals above."""

    origin: str = Field(min_length=1, max_length=512)
    signals: PageSignals = Field(default_factory=PageSignals)


class CallIn(ApiModel):
    """One call inside a batched wallet request."""

    to: str | None = Field(default=None, max_length=42)
    value: str | None = Field(default=None, max_length=78)
    data: str | None = Field(default=None, max_length=48_000)


class TxReviewIn(ApiModel):
    """What the wallet is about to ask the user to sign. `sender` is the JSON field `from`."""

    chain_id: int = Field(ge=1, le=2**32 - 1)
    method: _METHODS
    origin: str | None = Field(default=None, max_length=512)
    sender: str | None = Field(default=None, alias="from", max_length=42)
    to: str | None = Field(default=None, max_length=42)
    value: str | None = Field(default=None, max_length=78)
    data: str | None = Field(default=None, max_length=48_000)
    message: str | None = Field(default=None, max_length=8000)
    typed_data: dict[str, Any] | None = None
    calls: list[CallIn] = Field(default_factory=list, max_length=8)


class ScriptCheckIn(ApiModel):
    """Script URLs the page loaded. The extension does not send the script source."""

    origin: str | None = Field(default=None, max_length=512)
    scripts: list[str] = Field(min_length=1, max_length=40)
