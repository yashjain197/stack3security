"""
Transaction review: decode the call, then check the origin, the threat graph and the contract being trusted.

Made by Yash Jain with passion.
"""

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.db.base import utcnow
from app.modules.protection.abi import DecodedCall, parse_calldata, parse_quantity
from app.modules.protection.age import age_phrase
from app.modules.protection.chain import assess_contract, contract_findings
from app.modules.protection.domain import check_domain
from app.modules.protection.lookup import drain_sources, graph_finding, known_nodes
from app.modules.protection.schemas import CallIn, TxReviewIn
from app.modules.protection.tokens import format_amount, token_of
from app.modules.protection.verdicts import finding, finish
from app.schemas.verdict import Finding, Indicators, Layer, Level, Source, Target, TargetType, Verdict

_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_BENIGN_METHODS = {"wallet_switchEthereumChain", "eth_requestAccounts"}
_TYPED_METHODS = {"eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4"}


async def review_tx(db: AsyncSession, body: TxReviewIn) -> Verdict:
    """Decide whether a wallet prompt should be rejected, warned on, or left alone."""
    checked_at = utcnow()
    found: list[Finding] = []
    skipped: list[str] = []
    addresses: list[str] = []
    domains: list[str] = []

    if body.origin:
        site = await check_domain(db, body.origin)
        found.extend(site.findings)
        domains.extend(site.indicators.domains)
        skipped.extend(site.not_checked)

    if body.method in _BENIGN_METHODS:
        return finish(
            Target(type=TargetType.TX, id=_target_id(body)),
            found,
            not_checked=skipped,
            indicators=Indicators(addresses=addresses, domains=domains),
            explanation="This request does not move assets.",
        )

    if body.method == "eth_sign":
        found.append(
            finding(
                layer=Layer.INTENT,
                severity=Level.CRITICAL,
                title="eth_sign can approve a transaction you cannot read",
                evidence="This method signs a raw hash. A site can use it to move assets without showing the call.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        )
    elif body.method == "personal_sign":
        found.extend(_personal_sign(body.message or body.data, checked_at))
    elif body.method in _TYPED_METHODS:
        found.extend(await _typed(db, body, checked_at, addresses))

    calls = list(body.calls)
    if body.method in {"eth_sendTransaction", "eth_signTransaction"}:
        if not body.to and body.data not in {None, "", "0x"}:
            found.append(
                finding(
                    layer=Layer.TX,
                    severity=Level.CAUTION,
                    title="This publishes a new contract",
                    evidence="The transaction has no destination, so the data is contract creation code.",
                    source=Source.RULES,
                    checked_at=checked_at,
                )
            )
        calls.insert(0, CallIn(to=body.to, value=body.value, data=body.data))

    try:
        for call in calls[:8]:
            await _review_call(db, body.chain_id, call, checked_at, found, skipped, addresses)
    except ValueError as exc:
        raise AppError("invalid_transaction", str(exc)) from exc

    return finish(
        Target(type=TargetType.TX, id=_target_id(body)),
        found,
        not_checked=skipped,
        indicators=Indicators(addresses=_unique(addresses), domains=_unique(domains)),
        incomplete=not found and any(name in {"etherscan", "rpc", "blocklist"} for name in skipped),
    )


async def _review_call(
    db: AsyncSession,
    chain_id: int,
    call: CallIn,
    checked_at,
    found: list[Finding],
    skipped: list[str],
    addresses: list[str],
) -> None:
    """Score one call: where the assets go, and whether the approval is unlimited."""
    _check_address(call.to, "to")
    decoded = parse_calldata(call.data)
    value = parse_quantity(call.value)
    spent_age = None
    approvals = {"approve", "increaseAllowance", "permit", "setApprovalForAll"}
    if decoded is not None and decoded.spender and decoded.name in approvals:
        spent_age = await _spender_age(db, chain_id, decoded.spender, checked_at, found, skipped)
    if decoded is not None:
        found.extend(_decoded_findings(decoded, checked_at, token_of(call.to), spent_age))
        for address in (decoded.spender, decoded.recipient):
            if address:
                addresses.append(f"{chain_id}:{address}")
                noun = "spender" if address == decoded.spender else "recipient"
                await _wallet(db, chain_id, address, noun, checked_at, found)
    if call.to:
        addresses.append(f"{chain_id}:{call.to.lower()}")
        kind = "contract" if decoded is not None else "recipient"
        await _wallet(db, chain_id, call.to, kind, checked_at, found)
        plain_transfer = decoded is None and call.data in {None, "", "0x"} and value > 0
        if plain_transfer:
            await _contract_side(db, chain_id, call.to, checked_at, found, skipped)


def _decoded_findings(
    decoded: DecodedCall, checked_at, token: tuple[str, int] | None, age: str | None
) -> list[Finding]:
    """Findings that come from the call itself. The token name and the spender's age are included when we know them."""
    age_note = f" The spender contract was deployed {age}." if age else ""
    if decoded.approval_for_all is True:
        return [
            finding(
                layer=Layer.INTENT,
                severity=Level.CRITICAL,
                title="This grants permission to move every NFT in the collection",
                evidence="setApprovalForAll(true) lets the spender transfer every NFT in the collection." + age_note,
                source=Source.RULES,
                checked_at=checked_at,
            )
        ]
    if decoded.unlimited and decoded.name in {"approve", "increaseAllowance", "permit"}:
        if token is not None:
            symbol = token[0]
            title = f"This approval can take the entire {symbol} balance"
            evidence = f"The spender can move all of the {symbol} in this wallet, now or later.{age_note}"
        else:
            title = "This is an unlimited token approval"
            evidence = f"{decoded.name} allows the spender to take the entire token balance, now or later.{age_note}"
        return [
            finding(
                layer=Layer.INTENT,
                severity=Level.HIGH,
                title=title,
                evidence=evidence,
                source=Source.RULES,
                checked_at=checked_at,
            )
        ]
    if (
        decoded.name in {"approve", "increaseAllowance", "permit"}
        and token is not None
        and decoded.amount is not None
    ):
        symbol, decimals = token
        shown = format_amount(decoded.amount, decimals)
        return [
            finding(
                layer=Layer.INTENT,
                severity=Level.CAUTION,
                title=f"This approval lets the spender move {shown} {symbol}",
                evidence=f"{decoded.name} sets an allowance of {shown} {symbol}.{age_note}",
                source=Source.RULES,
                checked_at=checked_at,
            )
        ]
    if decoded.name == "multicall":
        return [
            finding(
                layer=Layer.TX,
                severity=Level.CAUTION,
                title="This batches several actions into one confirmation",
                evidence="A multicall can hide an approval inside other calls.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        ]
    return []


def _personal_sign(message: str | None, checked_at) -> list[Finding]:
    """A readable login message is normal. A raw 32-byte hash is a blind signature."""
    if not message:
        return []
    text = message.strip()
    hex_body = text[2:] if text[:2].lower() == "0x" else ""
    if hex_body and len(hex_body) == 64 and all(ch in "0123456789abcdefABCDEF" for ch in hex_body):
        return [
            finding(
                layer=Layer.INTENT,
                severity=Level.HIGH,
                title="This is a blind signature of a raw hash",
                evidence="personal_sign of 32 bytes can authorize an action the wallet cannot explain.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        ]
    return []


async def _typed(
    db: AsyncSession, body: TxReviewIn, checked_at, addresses: list[str]
) -> list[Finding]:
    """Permit typed data is an approval. Other typed data is left to the domain and graph checks."""
    data = body.typed_data or {}
    primary = str(data.get("primaryType") or "")
    if "permit" not in primary.lower():
        return []
    message = data.get("message") if isinstance(data.get("message"), dict) else {}
    spender = _find_key(message, "spender")
    amount = _find_amount(message)
    found = []
    if isinstance(spender, str) and _ADDRESS.fullmatch(spender):
        addresses.append(f"{body.chain_id}:{spender.lower()}")
        await _wallet(db, body.chain_id, spender, "spender", checked_at, found)
    if amount is not None and amount >= (1 << 248):
        found.append(
            finding(
                layer=Layer.INTENT,
                severity=Level.HIGH,
                title="This signature is an unlimited permit",
                evidence="Signing it lets the spender move the tokens without another confirmation.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        )
    elif spender:
        found.append(
            finding(
                layer=Layer.INTENT,
                severity=Level.CAUTION,
                title="This signature lets a spender move tokens",
                evidence=f"Typed data {primary} names spender {spender}.",
                source=Source.RULES,
                checked_at=checked_at,
            )
        )
    return found


async def _wallet(db, chain_id: int, address: str, noun: str, checked_at, found: list[Finding]) -> None:
    """Add a graph finding when this address was reported before."""
    if not _ADDRESS.fullmatch(address):
        return
    nodes = await known_nodes(db, [("wallet", f"{chain_id}:{address.lower()}")])
    row = next(iter(nodes.values()), None)
    if row is not None:
        hit = graph_finding(row, noun, checked_at)
        if hit is not None:
            found.append(hit)
    peers = await drain_sources(db, chain_id, address)
    if peers:
        found.append(_drain_finding(peers, chain_id, address, checked_at))


async def _spender_age(
    db, chain_id: int, address: str, checked_at, found: list[Finding], skipped: list[str]
) -> str | None:
    """How recently the spender contract was deployed, after its other contract findings are recorded."""
    if not _ADDRESS.fullmatch(address):
        return None
    facts = await assess_contract(chain_id, address.lower())
    skipped.extend(facts.not_checked)
    found.extend(contract_findings(facts, checked_at))
    return age_phrase(facts.created_at, checked_at, within_days=14)


def _drain_finding(peers: list, chain_id: int, address: str, checked_at) -> Finding:
    """One finding that names the package or site and the wallet this transaction pays."""
    bits = []
    for peer in peers:
        if peer.vertex_type == "SoftwarePackage":
            bits.append(f"the package {peer.vertex_id}")
        elif peer.vertex_type == "Domain":
            bits.append(f"the site {peer.vertex_id}")
    who = " and ".join(bits) or "a reported threat"
    severe = any(peer.risk == "critical" for peer in peers)
    return finding(
        layer=Layer.GRAPH,
        severity=Level.CRITICAL if severe else Level.HIGH,
        title="This payment goes to a wallet a reported threat already drains to",
        evidence=f"{who} drains to {chain_id}:{address.lower()}, and this transaction pays that same wallet.",
        source=Source.GRAPH,
        checked_at=checked_at,
    )


async def _contract_side(db, chain_id: int, address: str, checked_at, found: list[Finding], skipped: list[str]) -> None:
    """Contract age, source and ownership for the address the user is about to trust."""
    if not _ADDRESS.fullmatch(address):
        return
    facts = await assess_contract(chain_id, address.lower())
    skipped.extend(facts.not_checked)
    found.extend(contract_findings(facts, checked_at))
    nodes = await known_nodes(db, [("wallet", f"{chain_id}:{address.lower()}")])
    row = next(iter(nodes.values()), None)
    if row is not None:
        hit = graph_finding(row, "contract", checked_at)
        if hit is not None and all(item.evidence != hit.evidence for item in found):
            found.append(hit)


def _check_address(value: str | None, field: str) -> None:
    """Reject a destination that is not a 20-byte address. Empty is allowed for contract creation."""
    if value is None or value == "":
        return
    if _ADDRESS.fullmatch(value) is None:
        raise ValueError(f"{field} must be a 0x-prefixed 20-byte address")


def _find_key(value: object, key: str, depth: int = 0) -> object | None:
    """First nested value under this key, a few levels down."""
    if depth > 4 or not isinstance(value, dict):
        return None
    if key in value:
        return value[key]
    for child in value.values():
        found = _find_key(child, key, depth + 1)
        if found is not None:
            return found
    return None


def _find_amount(message: dict) -> int | None:
    """The allowance hidden in a permit message, under amount, value, or a hex quantity."""
    for key in ("amount", "value"):
        raw = _find_key(message, key)
        if isinstance(raw, int):
            return raw
        if isinstance(raw, str):
            try:
                return parse_quantity(raw)
            except ValueError:
                continue
    return None


def _target_id(body: TxReviewIn) -> str:
    """A short id for the verdict: chain, method and destination."""
    destination = (body.to or "creation").lower()
    return f"{body.chain_id}:{body.method}:{destination}"[:512]


def _unique(values: list[str]) -> list[str]:
    """Keep order, drop duplicates."""
    return list(dict.fromkeys(values))
