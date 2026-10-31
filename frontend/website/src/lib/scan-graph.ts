import type { Finding, GraphNodeType, ScanKind, ScanRecord, Verdict } from "../types";
import { normalizeNodeInput } from "./graph-model";

// Turns this browser's scan history into a graph: each scanned target on one side, the
// wallets and domains its verdict pointed at on the other, joined where a scan found them.

export type GraphRef = { type: GraphNodeType; id: string };

export type ScanGraphScan = {
  key: string;
  record: ScanRecord;
  /** The scanned target as a threat-graph node, when it maps to one. */
  ref: GraphRef | null;
  counts: Record<Verdict, number>;
};

export type ScanGraphIndicator = {
  key: string;
  ref: GraphRef;
  /** Worst verdict among the scans that point at it. */
  level: Verdict;
  scanKeys: string[];
};

export type ScanGraphFinding = { finding: Finding; record: ScanRecord };

export type ScanGraph = {
  scans: ScanGraphScan[];
  indicators: ScanGraphIndicator[];
  links: { scan: string; indicator: string }[];
  findings: ScanGraphFinding[];
  totals: Record<Verdict, number>;
  hiddenScans: number;
  hiddenIndicators: number;
};

export const severityOrder: Verdict[] = ["critical", "high", "caution", "unknown", "no_known_issues"];
const rank = (level: string) => {
  const index = severityOrder.indexOf(level as Verdict);
  return index === -1 ? severityOrder.indexOf("unknown") : index;
};
export const worse = (a: Verdict, b: Verdict): Verdict => (rank(a) <= rank(b) ? a : b);
const emptyCounts = (): Record<Verdict, number> => ({ critical: 0, high: 0, caution: 0, unknown: 0, no_known_issues: 0 });
export const refKey = (ref: GraphRef) => `${ref.type}:${ref.id}`;

const targetTypes: Partial<Record<ScanKind, GraphNodeType>> = { website: "domain", contract: "wallet", repo: "repo" };

export function scanTargetRef(record: ScanRecord): GraphRef | null {
  const type = targetTypes[record.kind];
  if (!type) return null;
  const parsed = normalizeNodeInput(type, record.target, record.chainId ?? 1);
  return parsed.id ? { type, id: parsed.id } : null;
}

function indicatorRefs(record: ScanRecord): GraphRef[] {
  const { addresses = [], domains = [] } = record.verdict.indicators ?? {};
  const refs: GraphRef[] = [];
  for (const domain of domains) {
    const parsed = normalizeNodeInput("domain", domain);
    if (parsed.id) refs.push({ type: "domain", id: parsed.id });
  }
  for (const address of addresses) {
    const parsed = normalizeNodeInput("wallet", address, record.chainId ?? 1);
    if (parsed.id) refs.push({ type: "wallet", id: parsed.id });
  }
  return refs;
}

/** Records arrive newest first; only the latest scan of each target is drawn. */
export function buildScanGraph(records: ScanRecord[], { maxScans = 14, maxIndicators = 18 } = {}): ScanGraph {
  const seen = new Set<string>();
  const latest = records.filter((record) => {
    const key = `${record.kind}:${record.chainId ?? ""}:${record.target.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const totals = emptyCounts();
  const findings: ScanGraphFinding[] = [];
  for (const record of latest) {
    for (const finding of record.verdict.findings ?? []) {
      totals[severityOrder[rank(finding.severity)]] += 1;
      findings.push({ finding, record });
    }
  }
  findings.sort((a, b) => rank(a.finding.severity) - rank(b.finding.severity));

  const scans = latest.slice(0, maxScans).map((record): ScanGraphScan => {
    const counts = emptyCounts();
    for (const finding of record.verdict.findings ?? []) counts[severityOrder[rank(finding.severity)]] += 1;
    return { key: record.id, record, ref: scanTargetRef(record), counts };
  });

  const indicators = new Map<string, ScanGraphIndicator>();
  for (const scan of scans) {
    const own = scan.ref ? refKey(scan.ref) : null;
    for (const ref of indicatorRefs(scan.record)) {
      const key = refKey(ref);
      if (key === own) continue;
      const existing = indicators.get(key);
      if (existing) {
        if (!existing.scanKeys.includes(scan.key)) existing.scanKeys.push(scan.key);
        existing.level = worse(existing.level, scan.record.verdict.level);
      } else {
        indicators.set(key, { key, ref, level: scan.record.verdict.level, scanKeys: [scan.key] });
      }
    }
  }
  // Indicators shared by several scans, then the riskiest, earn the limited rows.
  const ranked = [...indicators.values()].sort(
    (a, b) => b.scanKeys.length - a.scanKeys.length || rank(a.level) - rank(b.level),
  );
  const shownIndicators = ranked.slice(0, maxIndicators);
  const links = shownIndicators.flatMap((indicator) =>
    indicator.scanKeys.map((scan) => ({ scan, indicator: indicator.key })),
  );

  return {
    scans,
    indicators: shownIndicators,
    links,
    findings,
    totals,
    hiddenScans: latest.length - scans.length,
    hiddenIndicators: ranked.length - shownIndicators.length,
  };
}
