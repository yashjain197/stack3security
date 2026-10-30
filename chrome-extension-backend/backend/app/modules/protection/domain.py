"""
Domain check: public blocklists, the threat graph, and lookalike wallet names.

Made by Yash Jain with passion.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.db.base import utcnow
from app.modules.graph.catalog import normalize_node
from app.modules.protection.age import is_very_recent
from app.modules.protection.blocklist import current_blocklist
from app.modules.protection.catalog import canonical_host, lookalike, official_brand
from app.modules.protection.lookup import graph_finding, known_nodes
from app.modules.protection.rdap import domain_age
from app.modules.protection.verdicts import finding, finish
from app.schemas.verdict import Indicators, Layer, Level, Source, Target, TargetType, Verdict

_LEVEL = {"caution": Level.CAUTION, "high": Level.HIGH, "critical": Level.CRITICAL}


async def check_domain(db: AsyncSession, raw: str) -> Verdict:
    """Score one host. A listed site is critical; a lookalike is a warning even when no list has it yet."""
    try:
        host = canonical_host(raw)
        node_id = normalize_node("domain", host).vertex_id
    except ValueError as exc:
        raise AppError("invalid_domain", str(exc)) from exc

    checked_at = utcnow()
    lists = await current_blocklist()
    nodes = await known_nodes(db, [("domain", host)])
    found = []
    skipped: list[str] = []
    listed = lists.source(host)
    if listed:
        found.append(
            finding(
                layer=Layer.SITE,
                severity=Level.CRITICAL,
                title="This site is on a phishing blocklist",
                evidence=f"{host} is listed by {listed}.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        )
    elif lists.fuzzy_hit(host):
        found.append(
            finding(
                layer=Layer.SITE,
                severity=Level.CAUTION,
                title="This site is on a suspicious-domain list",
                evidence=f"{host} is in the MetaMask fuzzy list, which is not a hard block.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        )

    graph = nodes.get(("domain", node_id))
    if graph is not None:
        hit = graph_finding(graph, "site", checked_at)
        if hit is not None:
            found.append(hit)

    similar = lookalike(host, whitelisted=lists.allowed(host))
    suspicious = bool(listed or lists.fuzzy_hit(host) or similar is not None)
    phrase = None
    if suspicious and official_brand(host) is None:
        phrase, missed = await domain_age(host)
        if missed:
            skipped.append("rdap")
    if similar is not None and official_brand(host) is None:
        severity = _LEVEL[similar.severity]
        if phrase and is_very_recent(phrase):
            severity = Level.CRITICAL
        elif phrase and severity == Level.CAUTION:
            severity = Level.HIGH
        evidence = _lookalike_evidence(host, similar.brand, similar.kind)
        if phrase:
            evidence = f"{evidence} The domain was registered {phrase}."
        found.append(
            finding(
                layer=Layer.SITE,
                severity=severity,
                title=f"This name imitates {similar.brand}",
                evidence=evidence,
                source=Source.RULES,
                checked_at=checked_at,
            )
        )
    if phrase:
        found.append(
            finding(
                layer=Layer.SITE,
                severity=Level.CRITICAL if is_very_recent(phrase) else Level.HIGH,
                title=f"This domain was registered {phrase}",
                evidence=f"{host} is only that old, and it already matches a wallet brand or a blocklist.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        )

    if not lists.remote_ok:
        skipped.append("blocklist")
    indicators = Indicators(domains=[host] if found else [])
    return finish(
        Target(type=TargetType.SITE, id=host),
        found,
        not_checked=skipped,
        indicators=indicators,
        incomplete=not lists.remote_ok and not found,
    )


def _lookalike_evidence(host: str, brand: str, kind: str) -> str:
    """Why this hostname was compared with a brand."""
    reasons = {
        "wrong-tld": f"{host} uses the {brand} name on a domain {brand} does not own.",
        "homoglyph": f"{host} swaps in letters that look like the {brand} name.",
        "punycode": f"{host} uses international letters to look like {brand}.",
        "edit": f"{host} is one letter away from {brand}.",
        "prefix": f"{host} starts with the {brand} name and adds a few characters.",
        "subdomain": f"{host} puts the {brand} name in front of a different site.",
        "contains": f"{host} contains the {brand} name.",
    }
    return reasons.get(kind, f"{host} resembles {brand}.")
