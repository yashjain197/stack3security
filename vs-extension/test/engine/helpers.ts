import type { Finding, Indicators, Severity, Verdict } from '../../src/engine/types';

export const T: Verdict['target'] = { type: 'repo', id: 'github.com/x/y@abc' };
export const I: Indicators = { addresses: [], domains: [] };

export function f(severity: Severity, ruleId = 'test.rule'): Finding {
  return { ruleId, layer: 'repo-file', severity, title: 't', evidence: 'e', source: 'rules', checkedAt: '2026-10-29T18:00:00+05:30' };
}
