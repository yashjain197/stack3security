import type { Finding, Indicators } from './types';

const MAX_LINE = 4096;
const MAX_EACH = 5;
const MAX_TOTAL = 20;

/** Contracts everyone uses (routers, wrapped ether, stablecoins, the burn addresses). Never an attacker indicator. */
export const WELL_KNOWN_ADDRESSES: ReadonlySet<string> = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2 router
  '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3 router
  '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b', // Uniswap universal router
  '0x000000000022d473030f116ddee9f6b43ac78ba3', // Permit2
  '0x1111111254eeb25477b68fb85ed929f73a960582', // 1inch v5 router
]);

// Hosts that are ordinary parts of a project. A match is by whole domain or subdomain, never by substring.
const BENIGN_HOSTS = [
  'github.com', 'githubusercontent.com', 'githubassets.com', 'npmjs.org', 'npmjs.com', 'yarnpkg.com', 'nodejs.org', 'w3.org',
  'example.com', 'example.org', 'example.net', 'schemastore.org', 'json-schema.org', 'mozilla.org', 'microsoft.com', 'visualstudio.com',
  'vscode.dev', 'apache.org', 'creativecommons.org', 'shields.io', 'opensource.org', 'wikipedia.org', 'python.org', 'pypi.org', 'docker.com',
];

export const INDICATOR_REGEXES = {
  address: /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g,
  url: /\b(https?):\/\/([A-Za-z0-9.-]{1,253})(?::\d{1,5})?(\/[^\s'"`<>)]{0,200})?/gi,
} as const;

export interface IndicatorDetail {
  addresses: string[];
  /** Hosts, plus `host/bot<id>` for a Telegram bot and `host/api/webhooks/<id>` for a Discord webhook (never the secret). */
  domains: string[];
  /** Full URLs with no query, no fragment, and any bot token or webhook secret removed. */
  endpoints: string[];
}

function privateOrLocal(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

const benign = (host: string): boolean => BENIGN_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
const validHost = (host: string): boolean => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host);

function endpointFor(scheme: string, host: string, path: string): { domain: string; endpoint: string } {
  const clean = path.split(/[?#]/)[0] ?? '';
  const telegram = host === 'api.telegram.org' ? /^\/bot(\d{5,12})(?::|\/|$)/.exec(clean) : null;
  if (telegram) return { domain: `${host}/bot${telegram[1]}`, endpoint: `${scheme}://${host}/bot${telegram[1]}` };
  const discord = host === 'discord.com' || host === 'discordapp.com' ? /^\/api\/webhooks\/(\d{5,25})(?:\/|$)/.exec(clean) : null;
  if (discord) return { domain: `${host}/api/webhooks/${discord[1]}`, endpoint: `${scheme}://${host}/api/webhooks/${discord[1]}` };
  return { domain: host, endpoint: `${scheme}://${host}${clean.replace(/[.,;:]+$/, '').slice(0, 100)}` };
}

/** Wallet addresses and endpoints named in a piece of text. Bounded, and never returns a secret from a URL. */
export function findIndicatorsInText(text: string): IndicatorDetail {
  const addresses = new Set<string>();
  const domains = new Set<string>();
  const endpoints = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.slice(0, MAX_LINE);
    for (const m of line.matchAll(INDICATOR_REGEXES.address)) {
      const a = m[0].toLowerCase();
      if (!WELL_KNOWN_ADDRESSES.has(a) && addresses.size < MAX_EACH) addresses.add(a);
    }
    for (const m of line.matchAll(INDICATOR_REGEXES.url)) {
      const host = (m[2] ?? '').toLowerCase().replace(/\.$/, '');
      if (!validHost(host) || privateOrLocal(host) || benign(host)) continue;
      const e = endpointFor((m[1] ?? 'https').toLowerCase(), host, m[3] ?? '');
      if (domains.size < MAX_EACH) domains.add(e.domain);
      if (endpoints.size < MAX_EACH) endpoints.add(e.endpoint);
    }
  }
  return { addresses: [...addresses], domains: [...domains], endpoints: [...endpoints] };
}

/**
 * Attacker wallets and domains from the findings that matter (high and critical), read from the finding's own title and
 * evidence only, never from the whole repository (S13). The shared Indicators shape.
 */
export function extractIndicators(findings: Finding[]): Indicators {
  const addresses = new Set<string>();
  const domains = new Set<string>();
  for (const f of findings) {
    if (f.severity !== 'high' && f.severity !== 'critical') continue;
    const found = findIndicatorsInText(`${f.title}\n${f.evidence}`);
    for (const a of found.addresses) if (addresses.size < MAX_TOTAL) addresses.add(a);
    for (const d of found.domains) if (domains.size < MAX_TOTAL) domains.add(d);
  }
  return { addresses: [...addresses], domains: [...domains] };
}
