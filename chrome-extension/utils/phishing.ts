// Local phishing heuristics for web3 pages. They run on every captured page with no
// network access; the API's domain and page checks add to them when the device is linked.

import { WEBSITE_URL } from "./api";
import { worstLevel } from "./decode";
import type { Level, PageSignals } from "./types";

type Brand = { name: string; keywords: string[]; domains: string[] };

// Brands that phishing kits impersonate most, with the domains they really use.
export const BRANDS: Brand[] = [
  { name: "MetaMask", keywords: ["metamask"], domains: ["metamask.io", "consensys.io"] },
  { name: "Uniswap", keywords: ["uniswap"], domains: ["uniswap.org"] },
  { name: "OpenSea", keywords: ["opensea"], domains: ["opensea.io"] },
  { name: "PancakeSwap", keywords: ["pancakeswap"], domains: ["pancakeswap.finance"] },
  { name: "Coinbase", keywords: ["coinbase"], domains: ["coinbase.com"] },
  { name: "Ledger", keywords: ["ledger"], domains: ["ledger.com"] },
  { name: "Trezor", keywords: ["trezor"], domains: ["trezor.io"] },
  { name: "Phantom", keywords: ["phantom"], domains: ["phantom.app", "phantom.com"] },
  { name: "Trust Wallet", keywords: ["trustwallet"], domains: ["trustwallet.com"] },
  { name: "Rabby", keywords: ["rabby"], domains: ["rabby.io"] },
  { name: "WalletConnect", keywords: ["walletconnect"], domains: ["walletconnect.com", "walletconnect.org", "reown.com"] },
  { name: "Etherscan", keywords: ["etherscan"], domains: ["etherscan.io"] },
  { name: "Binance", keywords: ["binance"], domains: ["binance.com"] },
  { name: "Aave", keywords: ["aave"], domains: ["aave.com"] },
  { name: "Lido", keywords: ["lidofinance"], domains: ["lido.fi"] },
  { name: "Arbitrum", keywords: ["arbitrum"], domains: ["arbitrum.io", "arbitrum.foundation"] },
  { name: "LayerZero", keywords: ["layerzero"], domains: ["layerzero.network"] },
  { name: "Blur", keywords: ["blurio"], domains: ["blur.io"] },
];

export const BRAND_NAMES = BRANDS.map((brand) => brand.name);

const LURE_WORDS = /(airdrop|claim|reward|giveaway|bonus|whitelist|rectify|validate|sync-?wallet|dapp-?fix|wallet-?connect|restore|migrat|unlock|eligib)/i;

// Stack3's own website: its threat reports and docs talk about seed phrases without asking for one.
const TRUSTED_HOSTS = new Set([new URL(WEBSITE_URL).hostname]);

const officialFor = (host: string, brand: Brand) =>
  brand.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

/** Roughly the registrable label: "app.uniswap.org" → "uniswap". */
function mainLabel(host: string): string {
  const labels = host.split(".");
  return labels.length >= 2 ? labels[labels.length - 2] : host;
}

/** Undo common look-alike substitutions so "un1swap" and "rnetamask" match their brand. */
function skeleton(value: string): string {
  return value
    .toLowerCase()
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/0/g, "o")
    .replace(/[1l|]/g, "i")
    .replace(/3/g, "e")
    .replace(/5/g, "s")
    .replace(/-/g, "");
}

/** Edit distance where swapping two neighbouring letters ("opensae") counts as one edit. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

export function isWeb3Page(signals: PageSignals): boolean {
  return signals.walletConnect || signals.seedPhraseField || signals.asksForPrivateKey || signals.brandInTitle !== null;
}

export type PageAssessment = { level: Level; reasons: string[] };

export function assessPage(
  rawHost: string,
  signals: PageSignals,
  extra: { blocklisted: boolean } = { blocklisted: false },
): PageAssessment {
  const host = rawHost.toLowerCase().replace(/^www\./, "");
  if (TRUSTED_HOSTS.has(host) || TRUSTED_HOSTS.has(rawHost.toLowerCase())) return { level: "no_known_issues", reasons: [] };
  // Official wallet and dapp domains can mention recovery phrases in support or settings forms.
  const officialDomain = BRANDS.some((brand) => officialFor(host, brand));
  const reasons: string[] = [];
  const levels: Level[] = [];
  const flag = (level: Level, reason: string) => {
    levels.push(level);
    reasons.push(reason);
  };
  const web3 = isWeb3Page(signals);
  const asksForSecrets = signals.seedPhraseField || signals.asksForPrivateKey || (signals.recoveryWordCount ?? 0) >= 12;

  if (extra.blocklisted) flag("critical", `${host} is on the Stack3 phishing blocklist.`);

  if ((signals.recoveryWordCount ?? 0) >= 12) {
    flag("critical", `This page has ${signals.recoveryWordCount} recovery-word inputs. No legitimate site or dapp ever asks for your recovery phrase.`);
  } else if (signals.seedPhraseField) {
    flag(officialDomain ? "caution" : "high", "This page asks for a seed / recovery phrase. Anyone who gets it can empty your wallet.");
  }
  if (signals.asksForPrivateKey) flag("high", "This page asks for a private key. Never paste it into a website.");

  const titleBrand = BRANDS.find((brand) => brand.name === signals.brandInTitle);
  if (titleBrand && !officialFor(host, titleBrand)) {
    flag(
      asksForSecrets ? "critical" : signals.walletConnect ? "high" : "caution",
      `The page presents itself as ${titleBrand.name}, but ${host} is not an official ${titleBrand.name} domain (${titleBrand.domains[0]}).`,
    );
  }

  const labelSkeleton = skeleton(mainLabel(host));
  for (const brand of BRANDS) {
    if (officialFor(host, brand)) continue;
    const containsBrand = brand.keywords.some((keyword) => skeleton(host).includes(skeleton(keyword)));
    const nearMiss = brand.domains.some((domain) => {
      const official = skeleton(mainLabel(domain));
      return official.length >= 5 && labelSkeleton !== official && editDistance(labelSkeleton, official) <= (official.length >= 8 ? 2 : 1);
    });
    if (containsBrand || nearMiss) {
      flag(
        web3 ? "high" : "caution",
        `${host} looks like ${brand.name} (${brand.domains[0]}) but is a different domain.`,
      );
      break;
    }
  }

  if (host.split(".").some((part) => part.startsWith("xn--"))) {
    flag(web3 ? "high" : "caution", `${host} uses look-alike international characters (punycode). Check the address carefully.`);
  }

  if (web3 && LURE_WORDS.test(host)) {
    flag("caution", `The address uses a common lure word ("${host.match(LURE_WORDS)?.[0]}") seen on wallet-drainer sites.`);
  }

  if (web3 && signals.hiddenIframe && signals.walletConnect) {
    flag("caution", "The page loads a hidden frame next to a wallet connect button.");
  }

  return { level: worstLevel(...levels), reasons };
}
