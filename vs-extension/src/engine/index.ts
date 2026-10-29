import { collectPurls } from './purls';
import { depRules } from './rules/deps';
import { gitConfigRules } from './rules/gitConfig';
import { installScriptRules } from './rules/installScripts';
import { pmConfigRules } from './rules/pmConfig';
import { secretRules } from './rules/secrets';
import { sourceRules } from './rules/source';
import { textTrickRules } from './rules/textTricks';
import { vscodeFileRules } from './rules/vscodeFiles';
import type { EngineResult, Finding, Rule, ScanContext, VirtualFile } from './types';

export const RULES: Rule[] = [...vscodeFileRules, ...pmConfigRules, ...gitConfigRules, ...textTrickRules, ...installScriptRules, ...sourceRules, ...depRules, ...secretRules];

/**
 * The quick scan (Flow 2, a folder opened directly): only what runs by itself when a folder is opened or used. Auto-run
 * tasks and settings, dev containers, package-manager config, install scripts, git config and hooks, and hidden text.
 * Source patterns, secrets and dependencies are left to the full scan: they do not start by themselves, and skipping
 * them is what keeps this fast.
 */
export const QUICK_RULES: Rule[] = [...vscodeFileRules, ...pmConfigRules, ...gitConfigRules, ...textTrickRules, ...installScriptRules];

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
