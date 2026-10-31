import type { GraphNodeType, GraphRisk } from "../types";

export const nodeTypes: GraphNodeType[] = ["wallet", "domain", "package", "repo", "endpoint"];
export const riskLevels: GraphRisk[] = ["unknown", "caution", "high", "critical"];
export const riskLabels: Record<GraphRisk, string> = {
  critical: "Critical", high: "High risk", caution: "Caution", unknown: "Unknown",
};
export const riskColors: Record<GraphRisk, string> = {
  critical: "#b42318", high: "#b54708", caution: "#315e9b", unknown: "#697586",
};
export const riskFills: Record<GraphRisk, string> = {
  critical: "#fff0ef", high: "#fff4e8", caution: "#edf3fb", unknown: "#eff2f5",
};
export const edgeTypes: [string, string][] = [
  ["package_drains_to", "Package drains to wallet"],
  ["domain_drains_to", "Domain drains to wallet"],
  ["package_sends_to", "Package sends to URL"],
  ["domain_sends_to", "Domain sends to URL"],
  ["loads_script", "Domain loads package"],
  ["depends_on", "Repo depends on package"],
  ["funded", "Wallet funded wallet"],
];
export const edgeShortLabels: Record<string, string> = {
  package_drains_to: "drains to", domain_drains_to: "drains to",
  package_sends_to: "sends to", domain_sends_to: "sends to",
  loads_script: "loads", depends_on: "depends on", funded: "funded",
};
export const nodeTypeLabels: Record<GraphNodeType, string> = {
  wallet: "Wallet", domain: "Domain", package: "Package", repo: "Repo", endpoint: "Endpoint",
};
// What each type accepts. The lookup normalises any of these into the canonical id the API stores.
export const idRules: Record<GraphNodeType, { hint: string; placeholder: string }> = {
  wallet: { hint: "a 0x address, optionally with a chain id (1:0x6587…5c2d)", placeholder: "0x… or 1:0x…" },
  domain: { hint: "a hostname or any URL on it (metamask-verify.io)", placeholder: "example.io or https://example.io/login" },
  package: { hint: "name@version, an npmjs.com link, or a purl (@ledgerhq/connect-kit@1.1.7)", placeholder: "name@1.2.3 or pkg:npm/name@1.2.3" },
  repo: { hint: "owner/name or a github.com link", placeholder: "owner/name or https://github.com/owner/name" },
  endpoint: { hint: "a full http(s) URL with a path (https://collector.example/api)", placeholder: "https://…/path" },
};
export const seedExamples = [
  { type: "wallet" as const, id: "1:0x658729879fca881d9526480b82ae00efc54b5c2d", label: "Seed wallet" },
  { type: "package" as const, id: "pkg:npm/@ledgerhq/connect-kit@1.1.7", label: "connect-kit package" },
];

export function isNodeType(value: string | null | undefined): value is GraphNodeType {
  return (nodeTypes as string[]).includes(value ?? "");
}

export function normalizeRisk(risk: string | undefined): GraphRisk {
  return (riskLevels as string[]).includes(risk ?? "") ? (risk as GraphRisk) : "unknown";
}

const CHAIN_WALLET = /^(\d+):(0x[0-9a-f]{40})$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i;
const NPM_SPEC = /^((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@([\w.+-]+)$/i;
const NPM_URL = /^(?:https?:\/\/)?(?:www\.)?npmjs\.com\/package\/((?:@[^/\s]+\/)?[^/\s@]+)(?:\/v\/([^/\s?#]+))?/i;
const GITHUB_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)/i;
const OWNER_NAME = /^([\w-]+)\/([\w.-]+)$/;
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

function asUrl(text: string): URL | null {
  try {
    return new URL(HAS_SCHEME.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

/** Guesses which node type a pasted value is, or null when it matches none. */
export function detectNodeType(raw: string): GraphNodeType | null {
  const text = raw.trim();
  if (!text) return null;
  if (CHAIN_WALLET.test(text) || ADDRESS.test(text)) return "wallet";
  if (/^pkg:/i.test(text) || NPM_URL.test(text) || NPM_SPEC.test(text)) return "package";
  if (/^github:/i.test(text) || GITHUB_URL.test(text) || OWNER_NAME.test(text)) return "repo";
  const url = asUrl(text);
  if (!url || !HOSTNAME.test(url.hostname)) return null;
  return url.pathname.replace(/\/+$/, "") ? "endpoint" : "domain";
}

export type NodeInputResult = { id: string; error?: undefined } | { id?: undefined; error: string };

/**
 * Turns what someone pasted into the canonical id the API stores for that type
 * (the same rules as the backend's graph catalog), or a readable error.
 */
export function normalizeNodeInput(type: GraphNodeType, raw: string, chainId = 1): NodeInputResult {
  const text = raw.trim();
  const article = type === "endpoint" ? "an" : "a";
  if (!text) return { error: `Enter ${article} ${type}: ${idRules[type].hint}.` };
  const invalid = { error: `That does not look like ${article} ${type}. Expected ${idRules[type].hint}.` };
  switch (type) {
    case "wallet": {
      const withChain = text.match(CHAIN_WALLET);
      if (withChain) return { id: `${Number(withChain[1])}:${withChain[2].toLowerCase()}` };
      return ADDRESS.test(text) ? { id: `${chainId}:${text.toLowerCase()}` } : invalid;
    }
    case "domain": {
      const host = asUrl(text)?.hostname.toLowerCase().replace(/^www\./, "") ?? "";
      return HOSTNAME.test(host) ? { id: host } : invalid;
    }
    case "package": {
      const purl = text.match(/^pkg:([a-z0-9]+)\/(\S+)@(\S+)$/i);
      if (purl) return { id: `pkg:${purl[1].toLowerCase()}/${purl[2]}@${purl[3]}` };
      const npmUrl = text.match(NPM_URL);
      if (npmUrl) {
        return npmUrl[2]
          ? { id: `pkg:npm/${npmUrl[1]}@${npmUrl[2]}` }
          : { error: "Add the version: open a version from the package's Versions tab, or type name@1.2.3." };
      }
      const spec = text.match(NPM_SPEC);
      if (spec) return { id: `pkg:npm/${spec[1]}@${spec[2]}` };
      return /^(?:@[\w.-]+\/)?[\w.-]+$/.test(text)
        ? { error: `Add the version, e.g. ${text}@1.0.0. Threat reports are tracked per version.` }
        : invalid;
    }
    case "repo": {
      const match = text.replace(/^github:/i, "").match(OWNER_NAME) ?? text.match(GITHUB_URL);
      if (!match) return invalid;
      return { id: `github:${match[1].toLowerCase()}/${match[2].replace(/\.git$/i, "").toLowerCase()}` };
    }
    case "endpoint": {
      const url = asUrl(text);
      if (!url || !["http:", "https:"].includes(url.protocol) || !HOSTNAME.test(url.hostname)) return invalid;
      return { id: `${url.protocol}//${url.hostname}${url.pathname.replace(/\/+$/, "")}` };
    }
  }
}

export const shorten = (value: string, max = 24): string =>
  value.length <= max ? value : `${value.slice(0, max - 8)}…${value.slice(-7)}`;

export const formatDate = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString() : "Not recorded";
