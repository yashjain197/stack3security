"""
Brand list, lookalike letters and hostname checks. Pure functions: no network, so the same rules run in tests.

A hit here is a warning about the name. The blocklist and the threat graph decide known-bad sites.

Made by Yash Jain with passion.
"""

from dataclasses import dataclass
from urllib.parse import urlsplit

# Official sites only. A name that matches the brand but not one of these domains is impersonation.
BRANDS: dict[str, tuple[str, ...]] = {
    "metamask": ("metamask.io",),
    "ledger": ("ledger.com",),
    "trezor": ("trezor.io",),
    "uniswap": ("uniswap.org",),
    "opensea": ("opensea.io",),
    "phantom": ("phantom.app", "phantom.com"),
    "coinbase": ("coinbase.com",),
    "rainbow": ("rainbow.me",),
    "rabby": ("rabby.io",),
    "walletconnect": ("walletconnect.com", "walletconnect.org"),
    "1inch": ("1inch.io",),
    "pancakeswap": ("pancakeswap.finance",),
    "zapper": ("zapper.xyz",),
    "revoke": ("revoke.cash",),
    "etherscan": ("etherscan.io",),
    "blur": ("blur.io",),
}

# Letters that look like ASCII. Digits are included so c0inbase collapses to coinbase.
HOMOGLYPHS: dict[str, str] = {
    "а": "a",
    "ɑ": "a",
    "α": "a",
    "е": "e",
    "ε": "e",
    "о": "o",
    "ο": "o",
    "р": "p",
    "ρ": "p",
    "с": "c",
    "ϲ": "c",
    "х": "x",
    "χ": "x",
    "у": "y",
    "і": "i",
    "ι": "i",
    "ӏ": "l",
    "ⅼ": "l",
    "һ": "h",
    "ѕ": "s",
    "ј": "j",
    "ɡ": "g",
    "τ": "t",
    "ν": "v",
    "0": "o",
    "1": "l",
    "3": "e",
    "4": "a",
    "5": "s",
    "7": "t",
}

_MULTI_SUFFIX = (
    "co.uk",
    "org.uk",
    "ac.uk",
    "com.au",
    "net.au",
    "co.nz",
    "com.br",
    "co.jp",
    "com.tr",
    "co.in",
    "com.sg",
    "co.za",
)


@dataclass(frozen=True)
class Lookalike:
    """Why a hostname resembles a wallet brand, or nothing if it does not."""

    brand: str
    kind: str
    severity: str


def canonical_host(raw: str) -> str:
    """Lowercase hostname from a URL or a bare host, without a leading www."""
    text = raw.strip()
    if not text or len(text) > 512 or any(ord(ch) < 32 for ch in text):
        raise ValueError("domain must be a hostname or an http(s) URL")
    host = urlsplit(text if "://" in text else f"//{text}").hostname or ""
    host = host.lower().removeprefix("www.").rstrip(".")
    if not host or "." not in host or len(host) > 253 or " " in host:
        raise ValueError("domain must be a hostname such as metamask.io")
    return host


def registrable(host: str) -> str:
    """The registered domain: example.com, or example.co.uk where the suffix is shared."""
    for suffix in _MULTI_SUFFIX:
        if host.endswith("." + suffix):
            label = host[: -(len(suffix) + 1)].rsplit(".", 1)[-1]
            return f"{label}.{suffix}" if label else host
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def official_brand(host: str) -> str | None:
    """The brand whose real domain this host belongs to, including its subdomains."""
    registered = registrable(host)
    for brand, domains in BRANDS.items():
        if registered in domains or host in domains:
            return brand
    return None


def skeleton(text: str) -> str:
    """Fold lookalike letters into plain ASCII so a fake name can be compared with a brand."""
    return "".join(HOMOGLYPHS.get(ch, ch) for ch in text.lower())


def host_suffixes(host: str) -> tuple[str, ...]:
    """The host and each parent that still has a dot, so a listed parent covers its subdomains."""
    parts = host.split(".")
    return tuple(".".join(parts[i:]) for i in range(len(parts) - 1))


def lookalike(host: str, *, whitelisted: bool) -> Lookalike | None:
    """Compare the name with wallet brands. Official domains and allow-listed dapps are left alone."""
    if whitelisted or official_brand(host) is not None:
        return None
    raw_label = registrable(host).split(".", 1)[0]
    label = skeleton(raw_label)
    labels = [skeleton(part) for part in host.split(".")[:-1]]
    best: Lookalike | None = None
    for brand in BRANDS:
        kind = _match_brand(brand, raw_label, label, labels)
        if kind is None:
            continue
        if kind in {"homoglyph", "wrong-tld", "punycode"}:
            severity = "critical"
        elif kind == "contains":
            severity = "caution"
        else:
            severity = "high"
        if best is None or _SEVERITY_RANK[severity] > _SEVERITY_RANK[best.severity]:
            best = Lookalike(brand, kind, severity)
    if best is not None and best.kind == "homoglyph" and _was_idn(host):
        return Lookalike(best.brand, "punycode", "critical")
    return best


_SEVERITY_RANK = {"caution": 1, "high": 2, "critical": 3}


def _was_idn(host: str) -> bool:
    """True when the hostname uses letters outside plain ASCII, which is how punycode shows up after decoding."""
    return any(ord(ch) > 127 for ch in host)


def _match_brand(brand: str, raw_label: str, label: str, labels: list[str]) -> str | None:
    """The closest way this domain imitates one brand. `label` is the registrable name after folding letters."""
    folded = skeleton(brand)
    if label == folded:
        return "homoglyph" if raw_label.lower() != brand else "wrong-tld"
    if _distance(label, folded) == 1 and len(folded) >= 7:
        return "edit"
    if len(folded) >= 6 and label.startswith(folded) and 0 < len(label) - len(folded) <= 4:
        return "prefix"
    if folded in labels:
        return "subdomain"
    if len(folded) >= 6 and folded in label and len(label) <= len(folded) + 8:
        return "contains"
    return None


def _distance(left: str, right: str) -> int:
    """Edit distance, capped so a long unrelated name stops early."""
    if abs(len(left) - len(right)) > 1:
        return 2
    previous = list(range(len(right) + 1))
    for i, ch in enumerate(left, start=1):
        current = [i]
        for j, other in enumerate(right, start=1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (ch != other)))
        previous = current
    return previous[-1]
