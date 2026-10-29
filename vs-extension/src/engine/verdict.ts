import type { Finding, Indicators, Level, Verdict } from './types';

/** Lowest to highest. */
export const LEVEL_ORDER: readonly Level[] = ['no_known_issues', 'unknown', 'caution', 'high', 'critical'];

const ACTIONS: Record<Level, string[]> = {
  critical: ['Do not open this folder in VS Code'],
  high: ['Open with auto-run disabled'],
  caution: ['Review before running'],
  unknown: ['Could not check fully'],
  no_known_issues: [],
};

export function maxLevel(a: Level, b: Level): Level {
  return LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b;
}

/** The only place a level is computed: max severity, floored at unknown when anything went unchecked (I-3, I-5). */
export function aggregate(findings: Finding[], notChecked: string[], target: Verdict['target'], indicators: Indicators): Verdict {
  let level: Level = notChecked.length > 0 ? 'unknown' : 'no_known_issues';
  for (const f of findings) level = maxLevel(level, f.severity);
  return { level, target, findings, indicators, notChecked, actions: [...ACTIONS[level]] };
}
