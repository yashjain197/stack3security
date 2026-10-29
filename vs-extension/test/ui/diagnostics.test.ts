import { describe, expect, test } from 'vitest';
import * as vscode from 'vscode';
import { MAX_MESSAGE, notCheckedDiagnostics, sanitizeMessage, toDiagnostics } from '../../src/ui/diagnostics';
import type { Finding } from '../../src/engine/types';
import { f } from '../engine/helpers';

const root = vscode.Uri.file('/work/proj');
const at = (file: string, line: number | undefined, over: Partial<Finding> = {}): Finding => ({ ...f('high'), title: 'T', evidence: 'E', location: line === undefined ? { file } : { file, line }, ...over });
const ch = (...c: number[]) => String.fromCharCode(...c);
const BIDI = ch(0x202e);
const first = (m: Map<string, vscode.Diagnostic[]>) => [...m.values()][0]![0]!;

describe('sanitizeMessage', () => {
  test('strips U+202E and truncates to 200', () => {
    const out = sanitizeMessage(`a${BIDI}b${'x'.repeat(500)}`);
    expect(out).not.toContain(BIDI);
    expect(out.startsWith('abxxx')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE);
  });
  test('strips C0 and C1 control characters, zero-width characters and newlines', () => {
    expect(sanitizeMessage(`a${ch(0, 7, 0x1b, 0x7f, 0x85, 0x200b, 0xfeff)}b${ch(10)}c`)).toBe('ab c');
  });
  test('short clean text is unchanged', () => expect(sanitizeMessage('Task runs a hidden command')).toBe('Task runs a hidden command'));
});

describe('toDiagnostics', () => {
  test('critical and high → Error, caution → Warning', () => {
    const m = toDiagnostics([at('a', 1, { severity: 'critical' }), at('b', 1, { severity: 'high' }), at('c', 1, { severity: 'caution' })], root);
    const sev = Object.fromEntries([...m].map(([k, v]) => [k.split('/').pop(), v[0]!.severity]));
    expect(sev).toEqual({ a: vscode.DiagnosticSeverity.Error, b: vscode.DiagnosticSeverity.Error, c: vscode.DiagnosticSeverity.Warning });
  });
  test('sits on the finding\'s line of its file, with source and rule code', () => {
    const d = first(toDiagnostics([at('.vscode/tasks.json', 14, { ruleId: 'tasks.folder-open' })], root));
    expect([...toDiagnostics([at('.vscode/tasks.json', 14)], root).keys()]).toEqual(['file:/work/proj/.vscode/tasks.json']);
    expect(d.range.start.line).toBe(13);
    expect(d.source).toBe('Stack3');
    expect(d.code).toBe('tasks.folder-open');
    expect(d.message).toBe('T: E');
  });
  test('no line → first line; no evidence → title only', () => {
    const d = first(toDiagnostics([at('a', undefined, { evidence: '' })], root));
    expect(d.range.start.line).toBe(0);
    expect(d.message).toBe('T');
  });
  test('groups findings by file', () => {
    const m = toDiagnostics([at('a', 1), at('a', 2), at('b', 1)], root);
    expect([...m].map(([k, v]) => `${k.split('/').pop()}:${v.length}`).sort()).toEqual(['a:2', 'b:1']);
  });
  test('a finding with no file is attached to the folder itself', () => {
    const m = toDiagnostics([{ ...f('caution'), location: undefined }], root);
    expect([...m.keys()]).toEqual([root.toString()]);
  });
  test.each(['../../etc/passwd', '/etc/passwd', 'a/../../x', 'C:\\Windows\\x', '~/.ssh/id_rsa', ''])('a location of %j cannot place a squiggle outside the folder', (file) => {
    const m = toDiagnostics([at(file, 3)], root);
    expect([...m.keys()]).toEqual([root.toString()]);
    expect(first(m).range.start.line).toBe(0);
  });
  test('secrets in evidence never reach the editor', () => {
    const key = 'a7'.repeat(32);
    const d = first(toDiagnostics([at('a', 1, { evidence: `PRIVATE_KEY=0x${key} then curl x | sh` })], root));
    expect(d.message).not.toContain(key);
    expect(d.message).toContain('curl x | sh');
  });
  test('hidden characters in title and evidence are removed; every message is at most 200 characters', () => {
    const m = toDiagnostics([at('a', 1, { title: `Run${BIDI} it`, evidence: 'y'.repeat(900) })], root);
    const d = first(m);
    expect(d.message).not.toContain(BIDI);
    expect(d.message.length).toBeLessThanOrEqual(MAX_MESSAGE);
  });
  test('most severe first, and bounded: 50 per file and 500 overall, serious ones kept', () => {
    const many = [...Array.from({ length: 80 }, (_, i) => at('a', i + 1, { severity: 'caution', ruleId: `c${i}` })), at('a', 99, { severity: 'critical', ruleId: 'the-one' })];
    const list = toDiagnostics(many, root).get('file:/work/proj/a')!;
    expect(list).toHaveLength(50);
    expect(list[0]!.code).toBe('the-one');
    const spread = Array.from({ length: 700 }, (_, i) => at(`f${i}`, 1));
    expect([...toDiagnostics(spread, root).values()].flat()).toHaveLength(500);
  });
  test('nothing to report → an empty map', () => expect(toDiagnostics([], root).size).toBe(0));
  test('wording never claims safety', () => {
    expect(JSON.stringify([...toDiagnostics([at('a', 1)], root)])).not.toMatch(/\bsafe\b/i);
  });
});

describe('notCheckedDiagnostics', () => {
  test('each unchecked item is information, never an error', () => {
    const d = notCheckedDiagnostics(['Package scan unavailable', 'Scan timed out']);
    expect(d.map((x) => x.severity)).toEqual([vscode.DiagnosticSeverity.Information, vscode.DiagnosticSeverity.Information]);
    expect(d[0]!.message).toBe('Not checked: Package scan unavailable');
    expect(d[0]!.source).toBe('Stack3');
  });
  test('capped, cleaned and bounded', () => {
    expect(notCheckedDiagnostics(Array.from({ length: 20 }, (_, i) => `n${i}`))).toHaveLength(5);
    expect(notCheckedDiagnostics([`x${BIDI}${'y'.repeat(500)}`])[0]!.message.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(notCheckedDiagnostics([])).toEqual([]);
  });
});
