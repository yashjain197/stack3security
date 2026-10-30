import { describe, expect, test } from 'vitest';
import { createStats } from '../../src/server/stats';

describe('stats', () => {
  test('starts at zero and says when it started', () => {
    const s = createStats(() => Date.UTC(2026, 9, 30, 6, 0, 0));
    expect(s.snapshot()).toEqual({
      reposScanned: 0,
      threatsFound: 0,
      byLevel: { critical: 0, high: 0, caution: 0, unknown: 0, no_known_issues: 0 },
      since: '2026-10-30T06:00:00.000Z',
    });
  });
  test('counts every scan, and a threat is a critical or high verdict', () => {
    const s = createStats();
    for (const level of ['critical', 'high', 'high', 'caution', 'unknown', 'no_known_issues', 'no_known_issues'] as const) s.record(level);
    expect(s.snapshot()).toMatchObject({ reposScanned: 7, threatsFound: 3, byLevel: { critical: 1, high: 2, caution: 1, unknown: 1, no_known_issues: 2 } });
  });
  test('a snapshot is a copy: changing it does not change the counters', () => {
    const s = createStats();
    s.record('critical');
    const snap = s.snapshot();
    snap.byLevel.critical = 99;
    snap.reposScanned = 99;
    expect(s.snapshot()).toMatchObject({ reposScanned: 1, byLevel: { critical: 1 } });
  });
});
