import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { buildVerdict, PACKAGE_SCAN_UNAVAILABLE, withExplanation } from '../../src/api/merge';
import { createClient } from '../../src/api/client';
import { aggregate, LEVEL_ORDER } from '../../src/engine/verdict';
import type { EngineResult, Finding, Severity } from '../../src/engine/types';
import { f, I, T } from '../engine/helpers';
import { recorder, reply } from './helpers';

const local = (findings: Finding[] = [], notChecked: string[] = []): EngineResult => ({ findings, notChecked, purls: [] });
const ok = (findings: Finding[]) => ({ ok: true as const, value: findings });
const down = { ok: false as const, reason: 'Network error' };
const rank = (l: string) => LEVEL_ORDER.indexOf(l as never);

describe('buildVerdict (I-4, I-5)', () => {
  test('remote level is ignored: the server says no_known_issues, local is critical → critical', async () => {
    const r = recorder(reply({ level: 'no_known_issues', findings: [] }));
    const remote = await createClient({ baseUrl: 'https://api.stack3.example', allowLocalhost: false, fetchImpl: r.fetch }).scanPackage(['pkg:npm/a@1.0.0']);
    expect(buildVerdict(local([f('critical')]), remote, T, I).level).toBe('critical');
  });
  test('network error → unknown, with the package scan marked unavailable', () => {
    const v = buildVerdict(local(), down, T, I);
    expect(v.level).toBe('unknown');
    expect(v.notChecked).toEqual([PACKAGE_SCAN_UNAVAILABLE]);
    expect(PACKAGE_SCAN_UNAVAILABLE).toBe('Package scan unavailable');
    expect(v.actions).toEqual(['Could not check fully']);
  });
  test('a failed scan never lowers a local finding', () => {
    expect(buildVerdict(local([f('critical')]), down, T, I).level).toBe('critical');
    expect(buildVerdict(local([f('high')]), down, T, I).level).toBe('high');
  });
  test('remote findings can raise the level', () => {
    expect(buildVerdict(local([f('caution')]), ok([{ ...f('critical', 'socket.malware'), source: 'socket' }]), T, I).level).toBe('critical');
  });
  test('an empty successful scan and a clean local result → no_known_issues', () => {
    expect(buildVerdict(local(), ok([]), T, I).level).toBe('no_known_issues');
  });
  test('local notChecked is kept, and a duplicate is listed once', () => {
    const v = buildVerdict(local([], ['x', PACKAGE_SCAN_UNAVAILABLE]), down, T, I);
    expect(v.notChecked).toEqual(['x', PACKAGE_SCAN_UNAVAILABLE]);
  });
  test('findings are local first, then remote; target and indicators pass through', () => {
    const ind = { addresses: ['0x' + '1'.repeat(40)], domains: ['bad.example'] };
    const v = buildVerdict(local([f('high', 'a')]), ok([{ ...f('caution', 'b'), source: 'socket' }]), T, ind);
    expect(v.findings.map((x) => x.ruleId)).toEqual(['a', 'b']);
    expect(v.target).toEqual(T);
    expect(v.indicators).toEqual(ind);
  });
  test('does not mutate its inputs', () => {
    const l = local([f('high')], ['n']);
    const before = JSON.stringify(l);
    buildVerdict(l, down, T, I);
    expect(JSON.stringify(l)).toBe(before);
  });
  test('property: merging never produces a lower level than the local result alone', () => {
    const sev = fc.constantFrom<Severity>('critical', 'high', 'caution');
    fc.assert(
      fc.property(fc.array(sev), fc.array(sev), fc.array(fc.string()), fc.boolean(), (a, b, nc, remoteOk) => {
        const l = local(a.map((s) => f(s)), nc);
        const alone = aggregate(l.findings, l.notChecked, T, I).level;
        const merged = buildVerdict(l, remoteOk ? ok(b.map((s) => f(s))) : down, T, I).level;
        expect(rank(merged)).toBeGreaterThanOrEqual(rank(alone));
      }),
    );
  });
});

describe('withExplanation', () => {
  test('attaches text and leaves the level, findings and actions alone', async () => {
    const v = buildVerdict(local([f('critical')]), ok([]), T, I);
    const r = recorder(reply({ explanation: 'text', fix: 'fix', level: 'no_known_issues' }));
    const res = await createClient({ baseUrl: 'https://api.stack3.example', allowLocalhost: false, fetchImpl: r.fetch }).explain(v.level, []);
    if (!res.ok) throw new Error('explain failed');
    const out = withExplanation(v, res.value.explanation);
    expect(out.explanation).toBe('text');
    expect(out.level).toBe('critical');
    expect(out.findings).toEqual(v.findings);
    expect(out.actions).toEqual(v.actions);
    expect(v.explanation).toBeUndefined();
  });
});
