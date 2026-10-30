"""
Contract facts from Etherscan, Sourcify and an Ethereum RPC. Results are cached so a review and a scan share one lookup.

Bytecode and ownership need the mainnet RPC. Source and age work on any chain Etherscan supports.

Made by Yash Jain with passion.
"""

import asyncio
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.modules.protection.http import get_http
from app.modules.protection.lookup import graph_finding, known_nodes
from app.modules.protection.verdicts import finding, finish
from app.schemas.verdict import Finding, Indicators, Layer, Level, Source, Target, TargetType, Verdict

logger = get_logger("protection.chain")

_ETHERSCAN = "https://api.etherscan.io/v2/api"
_SOURCIFY = "https://sourcify.dev/server/v2/contract"
_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"
_OWNER_CALL = "0x8da5cb5b"
_ZERO = "0x" + "0" * 40
_CACHE_TTL = 600
_cache: dict[tuple[int, str], tuple[float, "ContractFacts"]] = {}


@dataclass(frozen=True)
class ContractFacts:
    """What the chain told us. None means that part was not answered, which is different from a clean answer."""

    address: str
    chain_id: int
    is_contract: bool | None
    verified: bool | None
    name: str | None
    proxy: bool | None
    implementation: str | None
    owner: str | None
    owner_is_eoa: bool | None
    created_at: datetime | None
    not_checked: tuple[str, ...]


_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")


async def scan_contract(db: AsyncSession, chain_id: int, address: str) -> Verdict:
    """Verdict for one contract: graph, source, proxy, owner and age."""
    if chain_id < 1 or chain_id > 2**32 - 1 or _ADDRESS.fullmatch(address) is None:
        raise AppError("invalid_address", "chainId and address must be a chain id and a 0x 20-byte address")
    checked_at = utcnow()
    facts = await assess_contract(chain_id, address.lower())
    found = contract_findings(facts, checked_at)
    nodes = await known_nodes(db, [("wallet", f"{chain_id}:{address.lower()}")])
    row = next(iter(nodes.values()), None)
    if row is not None:
        hit = graph_finding(row, "contract", checked_at)
        if hit is not None:
            found.append(hit)
    return finish(
        Target(type=TargetType.CONTRACT, id=f"{chain_id}:{address.lower()}"),
        found,
        not_checked=list(facts.not_checked),
        indicators=Indicators(addresses=[f"{chain_id}:{address.lower()}"] if found else []),
        incomplete=not found and bool(facts.not_checked),
    )


def reset_chain_cache() -> None:
    """Forget cached contracts. Tests call this between cases."""
    _cache.clear()


async def assess_contract(chain_id: int, address: str) -> ContractFacts:
    """Load contract facts, using the cache when it is younger than ten minutes."""
    address = address.lower()
    key = (chain_id, address)
    cached = _cache.get(key)
    if cached is not None and time.monotonic() - cached[0] < _CACHE_TTL:
        return cached[1]
    facts = await _load(chain_id, address)
    _cache[key] = (time.monotonic(), facts)
    if len(_cache) > 400:
        for old in sorted(_cache, key=lambda item: _cache[item][0])[:100]:
            _cache.pop(old, None)
    return facts


def contract_findings(facts: ContractFacts, checked_at: datetime) -> list[Finding]:
    """Turn contract facts into findings. A verified, renounced contract adds nothing."""
    if facts.is_contract is False:
        return []
    found: list[Finding] = []
    age_hours = _age_hours(facts.created_at, checked_at)
    new = age_hours is not None and age_hours < 24
    week = age_hours is not None and age_hours < 24 * 7
    # Without bytecode, an empty Etherscan page is just as likely to be a wallet as an unverified contract.
    unverified = facts.verified is False and facts.is_contract is True
    single_owner = facts.owner_is_eoa is True and facts.owner is not None

    if facts.proxy and single_owner:
        found.append(
            _contract(
                Level.HIGH,
                "One wallet can change the code this contract runs",
                f"Proxy {facts.address} is controlled by {facts.owner}.",
                checked_at,
            )
        )
    elif single_owner and unverified:
        found.append(
            _contract(
                Level.HIGH,
                "An unverified contract is controlled by one wallet",
                f"{facts.address} has no published source and is owned by {facts.owner}.",
                checked_at,
            )
        )
    elif unverified and new:
        found.append(
            _contract(
                Level.HIGH,
                "This contract was deployed in the last day and its source is not published",
                f"{facts.address} was created {int(age_hours or 0)} hours ago.",
                checked_at,
            )
        )
    elif unverified:
        found.append(
            _contract(
                Level.CAUTION,
                "This contract's source code is not published",
                f"Neither Etherscan nor Sourcify has verified source for {facts.address}.",
                checked_at,
                source=Source.SOURCIFY,
            )
        )
    elif single_owner:
        found.append(
            _contract(
                Level.CAUTION,
                "A single wallet owns this contract",
                f"{facts.address} is owned by {facts.owner}.",
                checked_at,
            )
        )
    elif facts.proxy:
        found.append(
            _contract(
                Level.CAUTION,
                "This contract is a proxy, so the code it runs can be replaced",
                f"Implementation {facts.implementation or 'unknown'}.",
                checked_at,
            )
        )

    if week and not new and not any(item.severity == Level.HIGH for item in found):
        days = max(int((age_hours or 0) / 24), 1)
        found.append(
            _contract(
                Level.CAUTION,
                f"This contract was deployed {days} days ago",
                f"{facts.address} is still new.",
                checked_at,
            )
        )
    return found


async def _load(chain_id: int, address: str) -> ContractFacts:
    """Ask every configured source at once and merge what comes back."""
    settings = get_settings()
    skipped: list[str] = []
    if not settings.etherscan_configured:
        skipped.append("etherscan")
    if chain_id != 1 or not settings.rpc_configured:
        skipped.append("rpc")

    sourcify = _sourcify(chain_id, address)
    etherscan = _etherscan(chain_id, address) if settings.etherscan_configured else _empty()
    rpc = _rpc(address) if settings.rpc_configured and chain_id == 1 else _empty()
    verified_sourcify, scan, chain = await asyncio.gather(sourcify, etherscan, rpc)

    name = None
    proxy = None
    implementation = None
    created_at = None
    scan_verified = None
    if isinstance(scan, dict) and scan:
        if scan.get("failed"):
            skipped.append("etherscan")
        else:
            scan_verified = scan.get("verified")
            name = scan.get("name")
            proxy = scan.get("proxy")
            implementation = scan.get("implementation")
            created_at = scan.get("created_at")
    if verified_sourcify is True or scan_verified is True:
        verified = True
    elif scan_verified is False:
        verified = False
    else:
        verified = None
    if verified_sourcify is None:
        skipped.append("sourcify")

    is_contract = None
    owner = None
    owner_is_eoa = None
    if isinstance(chain, dict) and chain:
        if chain.get("failed"):
            skipped.append("rpc")
        else:
            is_contract = chain.get("is_contract")
            owner = chain.get("owner")
            owner_is_eoa = chain.get("owner_is_eoa")
            if chain.get("proxy"):
                proxy = True
                implementation = chain.get("implementation") or implementation

    return ContractFacts(
        address=address,
        chain_id=chain_id,
        is_contract=is_contract,
        verified=verified,
        name=name,
        proxy=proxy,
        implementation=implementation,
        owner=owner,
        owner_is_eoa=owner_is_eoa,
        created_at=created_at,
        not_checked=tuple(dict.fromkeys(skipped)),
    )


async def _empty() -> dict:
    """Placeholder gather arm when a provider is not configured."""
    return {}


async def _sourcify(chain_id: int, address: str) -> bool | None:
    """True when Sourcify has a match. False on 404. None when Sourcify cannot be reached."""
    try:
        response = await get_http().get(f"{_SOURCIFY}/{chain_id}/{address}")
    except httpx.HTTPError:
        logger.warning("sourcify_unreachable")
        return None
    if response.status_code == 404:
        return False
    if response.status_code != 200:
        return None
    try:
        body = response.json()
    except ValueError:
        return None
    match = body.get("match") if isinstance(body, dict) else None
    return bool(match)


async def _etherscan(chain_id: int, address: str) -> dict:
    """Source, proxy and creation time. `failed` means the call itself did not succeed."""
    key = get_settings().etherscan_api_key
    assert key is not None
    secret = key.get_secret_value()
    source, creation = await asyncio.gather(
        _etherscan_action(chain_id, address, "getsourcecode", secret),
        _etherscan_action(chain_id, address, "getcontractcreation", secret),
    )
    if source is None and creation is None:
        return {"failed": True}
    row = source[0] if isinstance(source, list) and source and isinstance(source[0], dict) else {}
    created = None
    created_row = creation[0] if isinstance(creation, list) and creation and isinstance(creation[0], dict) else {}
    if str(created_row.get("timestamp") or "").isdigit():
        created = datetime.fromtimestamp(int(created_row["timestamp"]), tz=UTC)
    implementation = _clean_address(row.get("Implementation"))
    verified = bool(row.get("SourceCode")) if row else None
    return {
        "failed": False,
        "verified": verified,
        "name": row.get("ContractName") or None,
        "proxy": row.get("Proxy") == "1" or implementation is not None,
        "implementation": implementation,
        "created_at": created,
    }


async def _etherscan_action(chain_id: int, address: str, action: str, secret: str) -> object | None:
    """One Etherscan call. Errors return None so the rest of the check still finishes."""
    try:
        response = await get_http().get(
            _ETHERSCAN,
            params={
                "chainid": chain_id,
                "module": "contract",
                "action": action,
                "address": address,
                "apikey": secret,
            },
        )
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError):
        logger.warning("etherscan_failed", action=action)
        return None
    result = body.get("result") if isinstance(body, dict) else None
    if body.get("status") == "0" and isinstance(result, str):
        logger.warning("etherscan_rejected", action=action)
        return None
    return result


async def _rpc(address: str) -> dict:
    """Code, proxy slots and owner in one batch, plus one follow-up to see if the owner is a wallet."""
    url = get_settings().rpc_url_ethereum
    assert url is not None
    batch = [
        {"jsonrpc": "2.0", "id": 1, "method": "eth_getCode", "params": [address, "latest"]},
        {"jsonrpc": "2.0", "id": 2, "method": "eth_getStorageAt", "params": [address, _IMPL_SLOT, "latest"]},
        {"jsonrpc": "2.0", "id": 3, "method": "eth_getStorageAt", "params": [address, _ADMIN_SLOT, "latest"]},
        {"jsonrpc": "2.0", "id": 4, "method": "eth_call", "params": [{"to": address, "data": _OWNER_CALL}, "latest"]},
    ]
    rows = await _rpc_batch(url.get_secret_value(), batch)
    if rows is None:
        return {"failed": True}
    code = rows.get(1)
    is_contract = isinstance(code, str) and code not in {"0x", "0x0"}
    implementation = _slot_address(rows.get(2))
    admin = _slot_address(rows.get(3))
    owner = _slot_address(rows.get(4)) or admin
    owner_is_eoa = None
    if owner is not None:
        owner_code = await _rpc_batch(
            url.get_secret_value(),
            [{"jsonrpc": "2.0", "id": 1, "method": "eth_getCode", "params": [owner, "latest"]}],
        )
        if owner_code is None:
            return {"failed": True, "is_contract": is_contract}
        raw = owner_code.get(1)
        owner_is_eoa = not (isinstance(raw, str) and raw not in {"0x", "0x0"})
    return {
        "failed": False,
        "is_contract": is_contract,
        "proxy": implementation is not None,
        "implementation": implementation,
        "owner": owner,
        "owner_is_eoa": owner_is_eoa,
    }


async def _rpc_batch(url: str, batch: list[dict]) -> dict[int, str] | None:
    """POST a JSON-RPC batch. The URL is never logged because it can contain the provider key."""
    try:
        response = await get_http().post(url, json=batch)
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError):
        logger.warning("rpc_failed")
        return None
    if isinstance(body, dict):
        body = [body]
    if not isinstance(body, list):
        return None
    parsed: dict[int, str] = {}
    for item in body:
        if not isinstance(item, dict) or "error" in item or "result" not in item:
            continue
        try:
            parsed[int(item["id"])] = str(item["result"])
        except (TypeError, ValueError):
            continue
    return parsed


def _slot_address(word: str | None) -> str | None:
    """An address from a 32-byte hex word, or None for empty and the zero address."""
    if not isinstance(word, str) or not word.startswith("0x"):
        return None
    try:
        if int(word, 16) == 0:
            return None
    except ValueError:
        return None
    return _clean_address("0x" + word[-40:])


def _clean_address(value: object) -> str | None:
    """Lowercase a 20-byte address, dropping the zero address."""
    if not isinstance(value, str) or len(value) != 42 or not value.startswith("0x"):
        return None
    address = value.lower()
    return None if address == _ZERO else address


def _age_hours(created_at: datetime | None, now: datetime) -> float | None:
    """Hours since deployment, ignoring a timestamp that is in the future."""
    if created_at is None:
        return None
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    seconds = (now - created_at).total_seconds()
    if seconds < 0:
        return None
    return seconds / 3600


def _contract(
    severity: Level, title: str, evidence: str, checked_at: datetime, source: Source = Source.RULES
) -> Finding:
    """A contract-layer finding."""
    return finding(
        layer=Layer.CONTRACT,
        severity=severity,
        title=title,
        evidence=evidence,
        source=source,
        checked_at=checked_at,
    )
