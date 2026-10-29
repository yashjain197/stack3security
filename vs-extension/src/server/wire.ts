import type { Finding, Layer, Severity, Level, Verdict } from '../engine/types';
import { redact } from '../verdict/redact';

const MAX_FINDINGS = 200;
const RANK: Record<Severity, number> = { critical: 2, high: 1, caution: 0 };

/** The verdict JSON of the Stack3 API (written by Yash): no rule id, wallets as chainId:address, explanation null. */
export interface WireFinding {
  layer: Layer;
  severity: Severity;
  title: string;
  evidence: string;
  location?: { file: string; line?: number };
  source: Finding['source'];
  checkedAt: string;
}
export interface WireVerdict {
  level: Level;
  target: { type: 'repo'; id: string };
  findings: WireFinding[];
  indicators: { addresses: string[]; domains: string[] };
  notChecked: string[];
  actions: string[];
  explanation: null;
}

/**
 * Everything leaving the server goes through the egress redactor, so a secret that slipped into a finding's text is
 * removed here too. A repository gives no chain, so wallets are reported on chain 1 (Ethereum mainnet).
 */
export function toWireVerdict(v: Verdict, repo: { owner: string; repo: string }): WireVerdict {
  const findings = [...v.findings]
    .sort((a, b) => RANK[b.severity] - RANK[a.severity])
    .slice(0, MAX_FINDINGS)
    .map((f): WireFinding => {
      const s = redact(f);
      return {
        layer: s.layer,
        severity: s.severity,
        title: s.title,
        evidence: s.evidence,
        ...(s.location ? { location: s.location } : {}),
        source: s.source,
        checkedAt: s.checkedAt,
      };
    });
  return {
    level: v.level,
    target: { type: 'repo', id: `github.com/${repo.owner}/${repo.repo}` },
    findings,
    indicators: { addresses: v.indicators.addresses.map((a) => `1:${a}`), domains: v.indicators.domains },
    notChecked: v.notChecked,
    actions: v.actions,
    explanation: null,
  };
}
