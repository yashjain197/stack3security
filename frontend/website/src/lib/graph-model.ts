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
export const idRules: Record<GraphNodeType, { pattern: RegExp; hint: string; placeholder: string }> = {
  wallet: { pattern: /^\d+:0x[0-9a-fA-F]{40}$/, hint: "chainId:0x + 40 hex characters, e.g. 1:0x658729879fca881d9526480b82ae00efc54b5c2d", placeholder: "1:0x…" },
  domain: { pattern: /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i, hint: "a hostname, e.g. metamask-verify.io", placeholder: "example.io" },
  package: { pattern: /^pkg:npm\/\S+@\S+$/, hint: "pkg:npm/name@version, e.g. pkg:npm/@ledgerhq/connect-kit@1.1.7", placeholder: "pkg:npm/name@1.2.3" },
  repo: { pattern: /^github:[^/\s]+\/[^/\s]+$/, hint: "github:owner/name", placeholder: "github:owner/name" },
  endpoint: { pattern: /^https:\/\/\S+$/, hint: "an https:// URL", placeholder: "https://…" },
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

export function validateNodeId(type: string, id: string): string | null {
  const rule = isNodeType(type) ? idRules[type] : undefined;
  if (!rule) return "Choose a node type.";
  if (!id) return `Enter a ${type} id (${rule.hint}).`;
  return rule.pattern.test(id) ? null : `That does not look like a ${type} id. Expected ${rule.hint}.`;
}

export const shorten = (value: string, max = 24): string =>
  value.length <= max ? value : `${value.slice(0, max - 8)}…${value.slice(-7)}`;

export const formatDate = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString() : "Not recorded";
