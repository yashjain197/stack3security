"""
Rules bundle: the brand list, lookalike letters and selectors the extension can apply before the server answers.

The domain list itself is GET /v1/rules/blocklist so this payload stays small.

Made by Yash Jain with passion.
"""

import hashlib

from pydantic import Field

from app.modules.protection.abi import SELECTORS
from app.modules.protection.blocklist import Blocklists, current_blocklist
from app.modules.protection.catalog import BRANDS, HOMOGLYPHS
from app.schemas.base import ApiModel


class BrandOut(ApiModel):
    """One wallet brand and the domains it actually owns."""

    name: str
    domains: list[str]


class RulesBundleOut(ApiModel):
    """Compact rules. `blocklistEtag` matches GET /v1/rules/blocklist."""

    version: str
    ttl_seconds: int = 6 * 60 * 60
    brands: list[BrandOut]
    homoglyphs: dict[str, str]
    selectors: dict[str, str]
    blocklist_count: int
    blocklist_etag: str
    blocklist_path: str = "/v1/rules/blocklist"


class BlocklistOut(ApiModel):
    """The hard-blocked hosts. Subdomains of a listed host are also blocked."""

    version: str
    domains: list[str] = Field(max_length=200_000)


async def rules_bundle() -> RulesBundleOut:
    """The current rules and a fingerprint of the blocklist."""
    lists = await current_blocklist()
    brands = [BrandOut(name=name, domains=list(domains)) for name, domains in BRANDS.items()]
    selectors = {f"0x{selector}": name for selector, name in SELECTORS.items()}
    version = _version(lists)
    return RulesBundleOut(
        version=version,
        brands=brands,
        homoglyphs=dict(HOMOGLYPHS),
        selectors=selectors,
        blocklist_count=len(lists.domains),
        blocklist_etag=lists.etag,
    )


async def blocklist_body() -> BlocklistOut:
    """Every blocked host, sorted so the same list always has the same etag."""
    lists = await current_blocklist()
    return BlocklistOut(version=lists.etag, domains=sorted(lists.domains))


def _version(lists: Blocklists) -> str:
    """Changes when brands, selectors or the blocklist change."""
    raw = lists.etag + "".join(BRANDS) + "".join(SELECTORS)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]
