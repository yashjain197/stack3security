"""
Decode the start of an Ethereum transaction. Only well-known calls are named; anything else stays unknown.

Made by Yash Jain with passion.
"""

import re
from dataclasses import dataclass

_HEX = re.compile(r"^0x[0-9a-fA-F]*$")
_UNLIMITED = 1 << 248

# 4-byte selectors. The bundle sends these to the extension so it can name a call before the server answers.
SELECTORS: dict[str, str] = {
    "095ea7b3": "approve",
    "39509351": "increaseAllowance",
    "a22cb465": "setApprovalForAll",
    "a9059cbb": "transfer",
    "23b872dd": "transferFrom",
    "42842e0e": "safeTransferFrom",
    "b88d4fde": "safeTransferFrom",
    "d505accf": "permit",
    "ac9650d8": "multicall",
}


@dataclass(frozen=True)
class DecodedCall:
    """The part of a call that decides where assets can move."""

    selector: str
    name: str | None
    spender: str | None = None
    recipient: str | None = None
    amount: int | None = None
    approval_for_all: bool | None = None

    @property
    def unlimited(self) -> bool:
        """True for the usual unlimited allowance, which is the maximum integer or anything close to it."""
        return self.amount is not None and self.amount >= _UNLIMITED


def parse_quantity(value: str | None) -> int:
    """Wei from a hex quantity or a decimal string."""
    if value is None or value == "":
        return 0
    text = value.strip()
    if len(text) > 78:
        raise ValueError("value is too long")
    try:
        parsed = int(text, 16) if text[:2].lower() == "0x" else int(text, 10)
    except ValueError as exc:
        raise ValueError("value must be a hex or decimal amount") from exc
    if parsed < 0:
        raise ValueError("value cannot be negative")
    return parsed


def parse_calldata(data: str | None) -> DecodedCall | None:
    """Name a call and pull out the spender, recipient and amount when the layout is fixed."""
    if data is None or data in {"", "0x"}:
        return None
    if _HEX.fullmatch(data) is None or len(data) % 2 != 0 or len(data) < 10:
        raise ValueError("data must be 0x-prefixed hex")
    raw = bytes.fromhex(data[2:])
    selector = raw[:4].hex()
    name = SELECTORS.get(selector)
    words = [raw[i : i + 32] for i in range(4, len(raw) - 31, 32)]
    decoded = DecodedCall(selector=selector, name=name)
    if name in {"approve", "increaseAllowance"} and len(words) >= 2:
        decoded = DecodedCall(selector, name, spender=_address(words[0]), amount=_uint(words[1]))
    elif name == "setApprovalForAll" and len(words) >= 2:
        decoded = DecodedCall(selector, name, spender=_address(words[0]), approval_for_all=_uint(words[1]) == 1)
    elif name == "transfer" and len(words) >= 2:
        decoded = DecodedCall(selector, name, recipient=_address(words[0]), amount=_uint(words[1]))
    elif name in {"transferFrom", "safeTransferFrom"} and len(words) >= 3:
        decoded = DecodedCall(selector, name, recipient=_address(words[1]), amount=_uint(words[2]))
    elif name == "permit" and len(words) >= 3:
        decoded = DecodedCall(selector, name, spender=_address(words[1]), amount=_uint(words[2]))
    return decoded


def _address(word: bytes) -> str:
    """The address packed into the last 20 bytes of a 32-byte word."""
    return "0x" + word[-20:].hex()


def _uint(word: bytes) -> int:
    """An unsigned integer from one ABI word."""
    return int.from_bytes(word, "big")
