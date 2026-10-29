import { aggregate } from '../engine/verdict';
import type { EngineResult, Indicators, Verdict } from '../engine/types';
import type { Result } from './client';
import type { Finding } from '../engine/types';

export const PACKAGE_SCAN_UNAVAILABLE = 'Package scan unavailable';

/**
 * Local findings plus whatever the server returned. The level is recomputed from the union by
 * `aggregate`, so the server can only add findings (I-4); a failed scan adds a notChecked entry,
 * never "no findings" (I-5).
 */
export function buildVerdict(local: EngineResult, remote: Result<Finding[]>, target: Verdict['target'], indicators: Indicators): Verdict {
  const findings = [...local.findings, ...(remote.ok ? remote.value : [])];
  const notChecked = [...new Set([...local.notChecked, ...(remote.ok ? [] : [PACKAGE_SCAN_UNAVAILABLE])])];
  return aggregate(findings, notChecked, target, indicators);
}

/** Attach AI text to a verdict. The explanation is never read by `aggregate`, so it cannot change the level. */
export function withExplanation(v: Verdict, explanation: string): Verdict {
  return { ...v, explanation };
}
