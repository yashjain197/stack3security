import { collectPurls } from './purls';
import type { EngineResult, Finding, Rule, ScanContext, VirtualFile } from './types';

export const RULES: Rule[] = [];

export const RULE_FAILED = 'A detection rule failed; results may be incomplete';

export function engineScan(files: VirtualFile[], ctx: ScanContext, rules: Rule[] = RULES): EngineResult {
  const findings: Finding[] = [];
  const notChecked = new Set<string>();
  for (const rule of rules) {
    try {
      findings.push(...rule(files, ctx));
    } catch {
      notChecked.add(RULE_FAILED);
    }
  }
  const purls = collectPurls(files);
  for (const n of purls.notChecked) notChecked.add(n);
  return { findings, notChecked: [...notChecked], purls: purls.purls };
}
