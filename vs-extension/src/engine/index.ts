import { collectPurls } from './purls';
import { vscodeFileRules } from './rules/vscodeFiles';
import type { EngineResult, Finding, Rule, ScanContext, VirtualFile } from './types';

export const RULES: Rule[] = [...vscodeFileRules];

export const RULE_FAILED = 'A detection rule failed; results may be incomplete';

/** A rule only returns findings, so a file it could not parse is reported as unchecked here (I-5). */
const UNPARSEABLE = 'config.unparseable';

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
  for (const f of findings) if (f.ruleId === UNPARSEABLE) notChecked.add(`Could not parse ${f.location?.file ?? 'a config file'}`);
  const purls = collectPurls(files);
  for (const n of purls.notChecked) notChecked.add(n);
  return { findings, notChecked: [...notChecked], purls: purls.purls };
}
