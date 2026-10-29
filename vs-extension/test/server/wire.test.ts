import { describe, expect, test } from 'vitest';
import { toWireVerdict } from '../../src/server/wire';
import type { Verdict } from '../../src/engine/types';
import { f } from '../engine/helpers';

const KEY = 'a8'.repeat(32);
const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  level: 'critical',
  target: { type: 'repo', id: 'github.com/octo/hostile@ccccccc' },
  findings: [{ ...f('critical', 'tasks.folder-open'), layer: 'repo-file', title: 'Task runs a hidden command when the folder opens', evidence: '.vscode/tasks.json:14 runOn: folderOpen', location: { file: '.vscode/tasks.json', line: 14 }, checkedAt: '2026-10-30T00:00:00Z' }],
  indicators: { addresses: ['0x9f00000000000000000000000000000000000001'], domains: ['api.telegram.org/bot123456'] },
  notChecked: ['Package scan unavailable'],
  actions: ['Do not open this folder in VS Code'],
  ...over,
});

describe('toWireVerdict: the shape the Stack3 API documents', () => {
  const w = toWireVerdict(verdict(), { owner: 'octo', repo: 'hostile' });
  test('exactly the documented top-level keys', () => expect(Object.keys(w).sort()).toEqual(['actions', 'explanation', 'findings', 'indicators', 'level', 'notChecked', 'target']));
  test('target is github.com/owner/name', () => expect(w.target).toEqual({ type: 'repo', id: 'github.com/octo/hostile' }));
  test('findings carry the documented fields and no rule id', () => {
    expect(w.findings[0]).toEqual({
      layer: 'repo-file', severity: 'critical', title: 'Task runs a hidden command when the folder opens',
      evidence: '.vscode/tasks.json:14 runOn: folderOpen', location: { file: '.vscode/tasks.json', line: 14 }, source: 'rules', checkedAt: '2026-10-30T00:00:00Z',
    });
  });
  test('wallet addresses are chainId:address; domains pass through', () => expect(w.indicators).toEqual({ addresses: ['1:0x9f00000000000000000000000000000000000001'], domains: ['api.telegram.org/bot123456'] }));
  test('explanation is null, not missing', () => {
    expect(w.explanation).toBeNull();
    expect(JSON.stringify(w)).toContain('"explanation":null');
  });
  test('a finding with no location has no location key', () => {
    expect(toWireVerdict(verdict({ findings: [{ ...f('high'), location: undefined }] }), { owner: 'o', repo: 'r' }).findings[0]).not.toHaveProperty('location');
  });
  test('the level is the verdict\'s, and is never the word "safe"', () => {
    for (const level of ['critical', 'high', 'caution', 'unknown', 'no_known_issues'] as const) {
      const out = toWireVerdict(verdict({ level }), { owner: 'o', repo: 'r' });
      expect(out.level).toBe(level);
      expect(JSON.stringify(out)).not.toMatch(/"level":"safe"/);
    }
  });
  test('secrets in evidence never leave the server', () => {
    const out = toWireVerdict(verdict({ findings: [{ ...f('critical'), evidence: `PRIVATE_KEY=0x${KEY}` }] }), { owner: 'o', repo: 'r' });
    expect(JSON.stringify(out)).not.toContain(KEY);
  });
  test('findings are capped at 200', () => {
    const many = Array.from({ length: 300 }, (_, i) => f('caution', `r${i}`));
    expect(toWireVerdict(verdict({ findings: many }), { owner: 'o', repo: 'r' }).findings).toHaveLength(200);
  });
  test('most severe findings come first when capped', () => {
    const many = [...Array.from({ length: 250 }, (_, i) => f('caution', `c${i}`)), { ...f('critical', 'the-one'), title: 'the one' }];
    expect(toWireVerdict(verdict({ findings: many }), { owner: 'o', repo: 'r' }).findings[0]!.title).toBe('the one');
  });
});
