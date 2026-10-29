import { describe, expect, test } from 'vitest';
import { buildReport, buildView, MAX_FINDINGS_SHOWN } from '../../src/ui/view';
import type { Finding } from '../../src/engine/types';
import { f } from '../engine/helpers';
import { makeRec } from './helpers';

const KEY = 'f6'.repeat(32);
const BIDI = String.fromCharCode(0x202e);

describe('buildView', () => {
  test('labels, headline, target and the D-3 button set with the first as primary', () => {
    const v = buildView(makeRec('critical'));
    expect(v).toMatchObject({ level: 'critical', label: 'Critical risk', headline: 'Do not open this folder in VS Code.', target: 'github.com/octo/hello@ccccccc' });
    expect(v.buttons.map((b) => b.action)).toEqual(['delete', 'openNeutralized', 'copyReport']);
    expect(v.buttons.map((b) => b.primary)).toEqual([true, false, false]);
  });
  test('a plain Open at high risk is labelled for what it is', () => {
    const labels = Object.fromEntries(buildView(makeRec('high')).buttons.map((b) => [b.action, b.label]));
    expect(labels).toMatchObject({ open: 'Open anyway', openNeutralized: 'Open with auto-run disabled', delete: 'Delete clone' });
    expect(Object.fromEntries(buildView(makeRec('caution')).buttons.map((b) => [b.action, b.label])).open).toBe('Open');
  });
  test('findings are ordered most severe first and carry file and line', () => {
    const rec = makeRec('critical', {}, [
      { ...f('caution', 'c'), location: { file: 'a', line: 1 } },
      { ...f('critical', 'x'), location: { file: '.vscode/tasks.json', line: 14 } },
      f('high', 'h'),
    ]);
    const v = buildView(rec);
    expect(v.findings.map((x) => x.severity)).toEqual(['critical', 'high', 'caution']);
    expect(v.findings[0]).toMatchObject({ file: '.vscode/tasks.json', line: 14, canView: true });
    expect(v.findings[1]).not.toHaveProperty('file');
    expect(v.findings[1]!.canView).toBe(false);
  });
  test('a finding whose file path is not safely viewable cannot be viewed', () => {
    const rec = makeRec('high', {}, [{ ...f('high'), location: { file: '../../etc/passwd' } }]);
    expect(buildView(rec).findings[0]!.canView).toBe(false);
  });
  test('secrets are removed and hidden characters stripped before anything is shown', () => {
    const rec = makeRec('high', {}, [{ ...f('high'), title: `Run${BIDI} it`, evidence: `PRIVATE_KEY=0x${KEY} ${BIDI}` }]);
    const json = JSON.stringify(buildView(rec));
    expect(json).not.toContain(KEY);
    expect(json).not.toContain(BIDI);
  });
  test('shows at most 200 findings and says how many are hidden', () => {
    const many: Finding[] = Array.from({ length: 260 }, (_, i) => f('caution', `r${i}`));
    const v = buildView(makeRec('caution', {}, many));
    expect(v.findings).toHaveLength(MAX_FINDINGS_SHOWN);
    expect(v.hiddenFindings).toBe(60);
  });
  test('notChecked and guidance are carried; explanation only when present and bounded', () => {
    const v = buildView(makeRec('unknown'));
    expect(v.notChecked).toEqual(['Package scan unavailable']);
    expect(v.guidance).toEqual(['Review before running']);
    expect(v).not.toHaveProperty('explanation');
    const rec = makeRec('high');
    rec.verdict.explanation = 'x'.repeat(9000);
    expect(buildView(rec).explanation!.length).toBeLessThanOrEqual(4000);
  });
  test('the view is plain data that survives postMessage (JSON round trip)', () => {
    const v = buildView(makeRec('high'));
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});

describe('buildReport', () => {
  test('lists the result, each finding with its location, and what was not checked', () => {
    const rec = makeRec('unknown', {}, [{ ...f('high', 'x'), title: 'T', evidence: 'E', location: { file: 'a.js', line: 2 } }]);
    const r = buildReport(rec);
    expect(r).toContain('Stack3 report');
    expect(r).toContain('Target: github.com/octo/hello@ccccccc');
    expect(r).toContain('[high] T (a.js:2)');
    expect(r).toContain('Not checked:');
    expect(r).toContain('Not a guarantee.');
  });
  test('contains no secret and no hidden characters', () => {
    const rec = makeRec('high', {}, [{ ...f('high'), evidence: `k=0x${KEY}${BIDI}` }]);
    const r = buildReport(rec);
    expect(r).not.toContain(KEY);
    expect(r).not.toContain(BIDI);
  });
});
