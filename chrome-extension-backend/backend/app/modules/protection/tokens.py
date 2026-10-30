"""
Well-known Ethereum tokens, so an approval can name USDC instead of "a token".

Made by Yash Jain with passion.
"""

# address -> (symbol, decimals). Mainnet contracts people actually approve.
TOKENS: dict[str, tuple[str, int]] = {
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": ("USDC", 6),
    "0xdac17f958d2ee523a2206206994597c13d831ec7": ("USDT", 6),
    "0x6b175474e89094c44da98b954eedeac495271d0f": ("DAI", 18),
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": ("WETH", 18),
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": ("WBTC", 8),
}


def token_of(address: str | None) -> tuple[str, int] | None:
    """Symbol and decimals for a known token contract, or nothing."""
    if not address:
        return None
    return TOKENS.get(address.lower())


def format_amount(amount: int, decimals: int) -> str:
    """A token amount with its decimals, trimmed so 500.0 USDC reads as 500."""
    scale = 10**decimals
    whole, frac = divmod(amount, scale)
    if frac == 0:
        return str(whole)
    text = f"{whole}.{frac:0{decimals}d}".rstrip("0")
    return text
