import { clip } from '../engine/rules/evidence';
import { findIndicatorsInText } from '../engine/indicators';
import type { Finding } from '../engine/types';

// The report format of the Stack3 API's POST /v1/internal/report (written by Yash). Everything here follows that contract:
// ids, edge kinds and the 40-node / 80-edge limits. The API has the last word; this refuses to send what it would refuse.

export type NodeRisk = 'unknown' | 'caution' | 'high' | 'critical';
export type NodeType = 'wallet' | 'package' | 'domain' | 'repo' | 'endpoint';
export type EdgeType = 'package_drains_to' | 'domain_drains_to' | 'package_sends_to' | 'domain_sends_to' | 'loads_script' | 'depends_on' | 'funded';

export interface GraphNode {
  type: NodeType;
  id: string;
  risk: NodeRisk;
  category?: string;
  label?: string;
  impersonates?: string;
}
export interface GraphEdge {
  type: EdgeType;
  fromId: string;
  toId: string;
  txHash?: string;
}
export interface GraphReport {
  source: 'vscode' | 'cli';
  reporter: string;
  reason: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const MAX_NODES = 40;
export const MAX_EDGES = 80;

const EDGE_KINDS: Record<EdgeType, [NodeType, NodeType]> = {
  package_drains_to: ['package', 'wallet'],
  domain_drains_to: ['domain', 'wallet'],
  package_sends_to: ['package', 'endpoint'],
  domain_sends_to: ['domain', 'endpoint'],
  loads_script: ['domain', 'package'],
  depends_on: ['repo', 'package'],
  funded: ['wallet', 'wallet'],
};

const ID: Record<NodeType, RegExp> = {
  wallet: /^\d{1,10}:0x[0-9a-f]{40}$/,
  package: /^pkg:npm\/(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+@[A-Za-z0-9.+_-]+$/,
  domain: /^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/,
  repo: /^github:[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/,
  endpoint: /^https?:\/\/[^\s?#]{1,300}$/,
};
const RISKS = new Set<string>(['unknown', 'caution', 'high', 'critical']);
const CATEGORY = /^[a-z][a-z0-9_-]{0,39}$/;

/** `chainId:0xaddress`, lowercase. A repository gives no chain, so an EVM address is reported on chain 1 unless told otherwise. */
export const walletId = (address: string, chainId = 1): string => `${chainId}:${address.toLowerCase()}`;
/** A purl with a plain `@` for scopes (`pkg:npm/@scope/name@1.2.3`), as the API documents it. */
export const packageId = (name: string, version: string): string => `pkg:npm/${name}@${version}`;

/** Why this report would be refused, or undefined when it is acceptable. */
export function validateGraphReport(r: GraphReport): string | undefined {
  if (r.source !== 'vscode' && r.source !== 'cli') return 'unknown source';
  if (!/^[a-z0-9-]{1,40}$/.test(r.reporter)) return 'bad reporter';
  if (!r.reason || r.reason.length > 300) return 'reason must be one sentence of 1 to 300 characters';
  if (r.nodes.length === 0 || r.nodes.length > MAX_NODES) return `a report needs 1 to ${MAX_NODES} nodes`;
  if (r.edges.length > MAX_EDGES) return `at most ${MAX_EDGES} edges`;
  const byId = new Map<string, GraphNode>();
  for (const n of r.nodes) {
    if (!ID[n.type]?.test(n.id)) return `bad ${n.type} id`;
    if (byId.has(n.id)) return 'duplicate node id';
    if (!RISKS.has(n.risk)) return 'bad risk';
    if (n.category !== undefined && !CATEGORY.test(n.category)) return 'bad category';
    if (n.label !== undefined && (n.type !== 'wallet' || n.label.length > 60)) return 'label is only for wallets';
    if (n.impersonates !== undefined && n.type !== 'domain') return 'impersonates is only for domains';
    byId.set(n.id, n);
  }
  for (const e of r.edges) {
    const kind = EDGE_KINDS[e.type];
    if (!kind) return 'unknown edge type';
    const from = byId.get(e.fromId);
    const to = byId.get(e.toId);
    if (!from || !to) return 'an edge points at a node that was not sent';
    if (from.type !== kind[0] || to.type !== kind[1]) return `${e.type} must go from a ${kind[0]} to a ${kind[1]}`;
    if (e.txHash !== undefined && (e.type !== 'funded' || !/^0x[0-9a-f]{64}$/.test(e.txHash))) return 'txHash is only for funded edges';
  }
  return undefined;
}

export interface PackageRef {
  name: string;
  version: string;
  /** true for the repository's own top-level package. */
  root: boolean;
}

export interface GraphReportInput {
  owner: string;
  repo: string;
  findings: Finding[];
  /** The package a flagged file belongs to (its nearest package.json), if any. */
  packageFor(file: string): PackageRef | undefined;
  reporter?: string;
  source?: 'vscode' | 'cli';
}

/**
 * Turn what a scan found into a graph report: the package, the wallets and endpoints its code names, and how they link.
 * Deliberately conservative, because a wrong report puts a real wallet or package on a warning list: only CRITICAL
 * findings count, a wallet or endpoint is reported only next to hidden decode-and-run code that reads secrets, and a
 * well-known contract is never a wallet. Returns undefined when there is nothing worth reporting.
 */
export function buildGraphReport(input: GraphReportInput): GraphReport | undefined {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const addNode = (n: GraphNode): boolean => {
    if (nodes.has(n.id)) return true;
    if (nodes.size >= MAX_NODES) return false;
    nodes.set(n.id, n);
    return true;
  };
  const addEdge = (e: GraphEdge): void => {
    if (edges.length < MAX_EDGES && !edges.some((x) => x.type === e.type && x.fromId === e.fromId && x.toId === e.toId)) edges.push(e);
  };
  let reason: string | undefined;

  for (const f of input.findings) {
    if (f.severity !== 'critical') continue;
    const decodeExec = f.ruleId === 'source.decode-exec-secret';
    if (!decodeExec && f.ruleId !== 'scripts.lifecycle') continue;
    const pkg = input.packageFor(f.location?.file ?? '');
    if (!pkg || !/^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/.test(pkg.name) || !/^[A-Za-z0-9.+_-]{1,64}$/.test(pkg.version)) continue;

    const found = decodeExec ? findIndicatorsInText(f.evidence) : { addresses: [], domains: [], endpoints: [] };
    const pid = packageId(pkg.name, pkg.version);
    if (!addNode({ type: 'package', id: pid, risk: 'critical', category: found.addresses.length > 0 ? 'drainer' : 'malware' })) continue;

    for (const a of found.addresses) {
      const wid = walletId(a);
      if (addNode({ type: 'wallet', id: wid, risk: 'critical', category: 'drainer', label: 'address in flagged code' })) addEdge({ type: 'package_drains_to', fromId: pid, toId: wid });
    }
    for (const url of found.endpoints) {
      if (addNode({ type: 'endpoint', id: url, risk: 'high', category: 'exfiltration' })) addEdge({ type: 'package_sends_to', fromId: pid, toId: url });
    }
    if (!pkg.root) {
      const rid = `github:${input.owner}/${input.repo}`;
      if (addNode({ type: 'repo', id: rid, risk: 'caution' })) addEdge({ type: 'depends_on', fromId: rid, toId: pid });
    }
    reason ??= decodeExec
      ? `Code in ${clip(pkg.name, 80)} decodes hidden text, runs it and reads secret locations${found.addresses.length > 0 ? ', next to a wallet address' : ''}.`
      : `An install script in ${clip(pkg.name, 80)} downloads and runs code.`;
  }

  if (nodes.size === 0 || !reason) return undefined;
  const report: GraphReport = { source: input.source ?? 'vscode', reporter: input.reporter ?? 'scan-repo', reason, nodes: [...nodes.values()], edges };
  return validateGraphReport(report) === undefined ? report : undefined; // never send what the API would refuse
}
