"""
Threat-graph vocabulary and ID normalisation. API names stay short; TigerGraph names match graph/schema.gsql.

Made by Yash Jain with passion.
"""

import re
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

RISKS = ("unknown", "caution", "high", "critical")
RISK_RANK = {name: rank for rank, name in enumerate(RISKS)}

VERTEX_TYPES = {
    "wallet": "Wallet",
    "domain": "Domain",
    "package": "SoftwarePackage",
    "repo": "Repo",
    "endpoint": "Endpoint",
}
SHORT_TYPE = {tg: short for short, tg in VERTEX_TYPES.items()}

_WALLET = re.compile(r"^(?P<chain>\d+):(?P<address>0x[0-9a-fA-F]{40})$")
_TX = re.compile(r"^0x[0-9a-fA-F]{64}$")
_CATEGORY = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")


@dataclass(frozen=True)
class EdgeSpec:
    """One edge kind: its API name, TigerGraph name, reverse name, and the vertex types it connects."""

    api_name: str
    tg_name: str
    reverse_tg: str
    from_type: str
    to_type: str


EDGES: dict[str, EdgeSpec] = {
    spec.api_name: spec
    for spec in (
        EdgeSpec("package_drains_to", "PACKAGE_DRAINS_TO", "WALLET_DRAINED_BY_PACKAGE", "package", "wallet"),
        EdgeSpec("domain_drains_to", "DOMAIN_DRAINS_TO", "WALLET_DRAINED_BY_DOMAIN", "domain", "wallet"),
        EdgeSpec("package_sends_to", "PACKAGE_SENDS_TO", "ENDPOINT_FED_BY_PACKAGE", "package", "endpoint"),
        EdgeSpec("domain_sends_to", "DOMAIN_SENDS_TO", "ENDPOINT_FED_BY_DOMAIN", "domain", "endpoint"),
        EdgeSpec("loads_script", "LOADS_SCRIPT", "SCRIPT_LOADED_BY", "domain", "package"),
        EdgeSpec("depends_on", "DEPENDS_ON", "DEPENDED_ON_BY", "repo", "package"),
        EdgeSpec("funded", "FUNDED", "FUNDED_BY", "wallet", "wallet"),
    )
}
EDGE_BY_TG = {spec.tg_name: spec for spec in EDGES.values()}
EDGE_BY_REVERSE = {spec.reverse_tg: spec for spec in EDGES.values()}


@dataclass(frozen=True)
class NormalizedNode:
    """A node after its ID and stored attributes have been canonicalised."""

    short_type: str
    vertex_type: str
    vertex_id: str
    attributes: dict[str, str]


def stronger_risk(current: str, incoming: str) -> str:
    """Keep the higher severity; reports never downgrade a node."""
    return current if RISK_RANK[current] >= RISK_RANK[incoming] else incoming


def check_category(category: str | None) -> str | None:
    """Accept a short lowercase category or nothing."""
    if category is None or category == "":
        return None
    if _CATEGORY.fullmatch(category) is None:
        raise ValueError("category must be lowercase words, digits, _ or -")
    return category


def normalize_tx_hash(tx_hash: str | None) -> str | None:
    """Lowercase a 32-byte transaction hash."""
    if tx_hash is None or tx_hash == "":
        return None
    if _TX.fullmatch(tx_hash) is None:
        raise ValueError("txHash must be a 0x-prefixed 32-byte hex hash")
    return tx_hash.lower()


def normalize_node(short_type: str, raw_id: str) -> NormalizedNode:
    """Turn a caller-supplied ID into the canonical vertex ID and its derived attributes."""
    if short_type not in VERTEX_TYPES:
        raise ValueError(f"unknown node type {short_type!r}")
    raw_id = raw_id.strip()
    if not raw_id or len(raw_id) > 512:
        raise ValueError("node id is empty or too long")
    parser = _PARSERS[short_type]
    vertex_id, attributes = parser(raw_id)
    return NormalizedNode(short_type, VERTEX_TYPES[short_type], vertex_id, attributes)


def _wallet(raw: str) -> tuple[str, dict[str, str]]:
    """Require `chainId:0xaddress` and lowercase the address."""
    match = _WALLET.fullmatch(raw)
    if match is None:
        raise ValueError("wallet id must look like 1:0xabc... (chain id, colon, 20-byte address)")
    address = match.group("address").lower()
    return f"{int(match.group('chain'))}:{address}", {"chain_id": str(int(match.group("chain")))}


def _domain(raw: str) -> tuple[str, dict[str, str]]:
    """Reduce a URL or host to its lowercase hostname without a leading www."""
    host = urlsplit(raw if "://" in raw else f"//{raw}").hostname or ""
    host = host.lower().removeprefix("www.")
    if "." not in host or len(host) > 253 or " " in host:
        raise ValueError("domain id must be a hostname such as metamask-verify.io")
    return host, {}


def _package(raw: str) -> tuple[str, dict[str, str]]:
    """Require a purl and split out ecosystem, name and version."""
    if not raw.startswith("pkg:"):
        raise ValueError("package id must be a purl like pkg:npm/@scope/name@1.2.3")
    ecosystem, _, name_version = raw[4:].partition("/")
    name, separator, version = name_version.rpartition("@")
    ecosystem = ecosystem.lower()
    if not ecosystem or separator == "" or not name or not version or len(raw) > 512:
        raise ValueError("package id must be a purl like pkg:npm/@scope/name@1.2.3")
    purl = f"pkg:{ecosystem}/{name}@{version}"
    return purl, {"ecosystem": ecosystem, "pkg_name": name, "pkg_version": version}


def _repo(raw: str) -> tuple[str, dict[str, str]]:
    """Accept github:owner/name or a github.com URL."""
    text = raw.strip().removesuffix(".git")
    if text.startswith("github:"):
        owner_name = text[len("github:") :]
    else:
        parts = urlsplit(text if "://" in text else f"https://{text}")
        if parts.hostname not in {"github.com", "www.github.com"}:
            raise ValueError("repo id must be github:owner/name or a github.com URL")
        owner_name = parts.path.strip("/")
    owner, _, name = owner_name.partition("/")
    if not owner or not name or "/" in name:
        raise ValueError("repo id must be github:owner/name")
    return f"github:{owner.lower()}/{name.lower()}", {}


def _endpoint(raw: str) -> tuple[str, dict[str, str]]:
    """Keep scheme, host and path; drop query, fragment and a trailing slash."""
    parts = urlsplit(raw)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ValueError("endpoint id must be an http(s) URL")
    path = parts.path.rstrip("/")
    canonical = urlunsplit((parts.scheme.lower(), parts.hostname.lower(), path, "", ""))
    return canonical, {"host": parts.hostname.lower()}


_PARSERS = {"wallet": _wallet, "domain": _domain, "package": _package, "repo": _repo, "endpoint": _endpoint}
