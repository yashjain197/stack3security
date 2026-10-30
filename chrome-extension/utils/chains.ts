// Display names, native currency symbols and block explorers for common EVM chains.

type ChainInfo = { name: string; symbol: string; explorer?: string };

const CHAINS: Record<number, ChainInfo> = {
  1: { name: "Ethereum", symbol: "ETH", explorer: "https://etherscan.io" },
  10: { name: "Optimism", symbol: "ETH", explorer: "https://optimistic.etherscan.io" },
  56: { name: "BNB Chain", symbol: "BNB", explorer: "https://bscscan.com" },
  100: { name: "Gnosis", symbol: "xDAI", explorer: "https://gnosisscan.io" },
  137: { name: "Polygon", symbol: "POL", explorer: "https://polygonscan.com" },
  250: { name: "Fantom", symbol: "FTM", explorer: "https://ftmscan.com" },
  324: { name: "zkSync Era", symbol: "ETH", explorer: "https://explorer.zksync.io" },
  5000: { name: "Mantle", symbol: "MNT", explorer: "https://mantlescan.xyz" },
  8453: { name: "Base", symbol: "ETH", explorer: "https://basescan.org" },
  42161: { name: "Arbitrum One", symbol: "ETH", explorer: "https://arbiscan.io" },
  43114: { name: "Avalanche C-Chain", symbol: "AVAX", explorer: "https://snowtrace.io" },
  59144: { name: "Linea", symbol: "ETH", explorer: "https://lineascan.build" },
  81457: { name: "Blast", symbol: "ETH", explorer: "https://blastscan.io" },
  534352: { name: "Scroll", symbol: "ETH", explorer: "https://scrollscan.com" },
  17000: { name: "Holesky testnet", symbol: "ETH", explorer: "https://holesky.etherscan.io" },
  84532: { name: "Base Sepolia testnet", symbol: "ETH", explorer: "https://sepolia.basescan.org" },
  11155111: { name: "Sepolia testnet", symbol: "ETH", explorer: "https://sepolia.etherscan.io" },
};

export const chainName = (chainId: number) => CHAINS[chainId]?.name ?? `Chain ${chainId}`;

export const nativeSymbol = (chainId: number) => CHAINS[chainId]?.symbol ?? "native token";

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const explorer = CHAINS[chainId]?.explorer;
  return explorer ? `${explorer}/address/${address}` : null;
}
