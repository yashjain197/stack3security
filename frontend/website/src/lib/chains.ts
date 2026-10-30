// EVM chains offered in the contract and transaction forms.

type Chain = { id: number; name: string; symbol: string; explorer: string };

export const chains: Chain[] = [
  { id: 1, name: "Ethereum", symbol: "ETH", explorer: "https://etherscan.io" },
  { id: 8453, name: "Base", symbol: "ETH", explorer: "https://basescan.org" },
  { id: 42161, name: "Arbitrum One", symbol: "ETH", explorer: "https://arbiscan.io" },
  { id: 10, name: "Optimism", symbol: "ETH", explorer: "https://optimistic.etherscan.io" },
  { id: 137, name: "Polygon", symbol: "POL", explorer: "https://polygonscan.com" },
  { id: 56, name: "BNB Chain", symbol: "BNB", explorer: "https://bscscan.com" },
  { id: 43114, name: "Avalanche C-Chain", symbol: "AVAX", explorer: "https://snowtrace.io" },
  { id: 59144, name: "Linea", symbol: "ETH", explorer: "https://lineascan.build" },
  { id: 534352, name: "Scroll", symbol: "ETH", explorer: "https://scrollscan.com" },
  { id: 11155111, name: "Sepolia testnet", symbol: "ETH", explorer: "https://sepolia.etherscan.io" },
];

const byId = new Map(chains.map((chain) => [chain.id, chain]));

export const chainName = (id: number) => byId.get(id)?.name ?? `Chain ${id}`;
export const nativeSymbol = (id: number) => byId.get(id)?.symbol ?? "native token";

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const chain = byId.get(chainId);
  return chain ? `${chain.explorer}/address/${address}` : null;
}
