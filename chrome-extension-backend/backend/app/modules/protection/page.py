"""
Page scan. The extension sends signals it counted itself. Page text and anything the user typed stay on the device.

Made by Yash Jain with passion.
"""

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.db.base import utcnow
from app.modules.protection.catalog import BRANDS, canonical_host, official_brand, skeleton
from app.modules.protection.domain import check_domain
from app.modules.protection.schemas import PageScanIn
from app.modules.protection.verdicts import finding, finish
from app.schemas.verdict import Layer, Level, Source, Target, TargetType, Verdict

_WORD = re.compile(r"[^a-z0-9]+")


async def scan_page(db: AsyncSession, body: PageScanIn) -> Verdict:
    """Score a page from its signals and the reputation of its host."""
    try:
        host = canonical_host(body.origin)
    except ValueError as exc:
        raise AppError("invalid_domain", str(exc)) from exc

    checked_at = utcnow()
    site = await check_domain(db, host)
    found = list(site.findings)
    skipped = list(site.not_checked)
    signals = body.signals

    if signals.asks_for_private_key:
        found.append(
            finding(
                layer=Layer.INTENT,
                severity=Level.CRITICAL,
                title="This page asks for a private key",
                evidence="A wallet never asks you to type a private key into a website.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        )
    if signals.seed_phrase_field or (signals.recovery_word_count or 0) >= 12:
        count = signals.recovery_word_count or 0
        detail = f" It shows {count} word fields." if count else ""
        found.append(
            finding(
                layer=Layer.INTENT,
                severity=Level.CRITICAL,
                title="This page asks for a secret recovery phrase",
                evidence=f"No real wallet site asks for the recovery phrase.{detail}",
                source=Source.RULES,
                checked_at=checked_at,
            )
        )

    brand = _title_brand(host, signals.brand_in_title)
    if brand is not None:
        found.append(
            finding(
                layer=Layer.SITE,
                severity=Level.HIGH,
                title=f"The page title says {brand}, but the site is not {brand}",
                evidence=f"{host} is not an official {brand} domain.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        )

    for script_host in signals.external_script_hosts[:8]:
        try:
            extra = await check_domain(db, script_host)
        except AppError:
            continue
        found.extend(extra.findings)
        skipped.extend(extra.not_checked)

    # Login and 2FA modals pair a full-screen overlay with a hidden captcha frame; only a wallet prompt makes it risky.
    if signals.hidden_iframe and signals.wallet_connect:
        found.append(
            finding(
                layer=Layer.SITE,
                severity=Level.CAUTION,
                title="This page hides a frame while connecting a wallet",
                evidence="A hidden frame can show a different prompt than the page you see.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        )
    if signals.clipboard_read:
        found.append(
            finding(
                layer=Layer.INTENT,
                severity=Level.CAUTION,
                title="This page reads the clipboard",
                evidence="Wallet drainers read a copied address and swap it for their own.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        )

    return finish(
        Target(type=TargetType.SITE, id=host),
        found,
        not_checked=skipped,
        indicators=site.indicators,
        incomplete=site.level == Level.UNKNOWN and not found,
    )


def _title_brand(host: str, title: str | None) -> str | None:
    """The wallet brand named in the title when this host is not that brand's real site."""
    if not title:
        return None
    token = skeleton(_WORD.sub("", title.lower()))
    if len(token) < 4:
        return None
    for brand in BRANDS:
        folded = skeleton(brand)
        if len(folded) < 6:
            continue
        if token == folded or token.startswith(folded):
            return None if official_brand(host) == brand else brand
    return None
