import type { Level } from '../engine/types';

export interface StatsSnapshot {
  reposScanned: number;
  /** Scans whose verdict was critical or high. */
  threatsFound: number;
  byLevel: Record<Level, number>;
  /** When counting began: the counters are in memory and start again at zero when the service restarts. */
  since: string;
}

export interface Stats {
  record(level: Level): void;
  snapshot(): StatsSnapshot;
}

/** Counters for the website's live numbers. Counts, never repository names, so nothing a user scanned is kept. */
export function createStats(now: () => number = Date.now): Stats {
  const since = new Date(now()).toISOString();
  const byLevel: Record<Level, number> = { critical: 0, high: 0, caution: 0, unknown: 0, no_known_issues: 0 };
  let reposScanned = 0;
  return {
    record(level) {
      reposScanned++;
      byLevel[level]++;
    },
    snapshot: () => ({ reposScanned, threatsFound: byLevel.critical + byLevel.high, byLevel: { ...byLevel }, since }),
  };
}
