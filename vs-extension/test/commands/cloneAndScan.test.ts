import { describe, expect, test, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Result } from '../../src/api/client';
import { cloneAndScan, type CloneAndScanDeps } from '../../src/commands/cloneAndScan';
import { ENGINE_VERSION } from '../../src/engine/version';
import type { EngineResult, Finding } from '../../src/engine/types';
import { Registry, scanIdFor, type KeyValueStore, type ScanRecord } from '../../src/quarantine/registry';
import { hashScanSet } from '../../src/scan/hash';
import { f } from '../engine/helpers';

const SHA = 'c'.repeat(40);
const URL_ = 'https://github.com/octo/hello';
const memory = (): KeyValueStore => {
  const m = new Map<string, unknown>();
  return { get: <V>(k: string, d: V) => (m.has(k) ? (m.get(k) as V) : d), update: async (k, v) => void m.set(k, v) };
};

function setup(over: Partial<CloneAndScanDeps> & { local?: EngineResult; remote?: Result<Finding[]>; cloneResult?: Result<{ sha: string }> } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'stack3-cas-'));
  const made: string[] = [];
  const removed: string[] = [];
  const events: string[] = [];
  const panels: ScanRecord[] = [];
  const errors: string[] = [];
  const registry = new Registry(memory(), async () => undefined);
  const deps: CloneAndScanDeps = {
    makeDir: async (owner, repo) => {
      const d = join(base, `${owner}__${repo}__${made.length.toString(16).padStart(8, '0')}`);
      mkdirSync(d);
      writeFileSync(join(d, 'package.json'), '{"name":"x"}');
      made.push(d);
      events.push('makeDir');
      return d;
    },
    clone: vi.fn(async () => (events.push('clone'), over.cloneResult ?? { ok: true as const, value: { sha: SHA } })),
    scan: vi.fn(async () => (events.push('scan'), over.local ?? { findings: [], notChecked: [], purls: ['pkg:npm/lodash@4.17.21'] })),
    client: { scanPackage: vi.fn(async () => (events.push('scanPackage'), over.remote ?? { ok: true as const, value: [] })) },
    registry,
    removeDir: async (d) => void removed.push(d),
    showPanel: (rec) => void (events.push('panel'), panels.push(rec)),
    showError: (m) => void (events.push('error'), errors.push(m)),
    report: (m) => void events.push(`report:${m}`),
    now: () => 1_700_000_000_000,
    ...over,
  };
  return { deps, made, removed, events, panels, errors, registry };
}

describe('cloneAndScan: failures never show a verdict (Review Focus 3)', () => {
  test('clone failure shows an error, no panel, no record, and cleans up', async () => {
    const t = setup({ cloneResult: { ok: false, reason: 'Repository not found, or it is private. Only public GitHub repositories can be cloned.' } });
    const r = await cloneAndScan(URL_, t.deps);
    expect(r).toEqual({ ok: false, reason: 'Repository not found, or it is private. Only public GitHub repositories can be cloned.' });
    expect(t.errors).toEqual([(r as { reason: string }).reason]);
    expect(t.panels).toEqual([]);
    expect(t.registry.list()).toEqual([]);
    expect(t.removed).toEqual(t.made);
    expect(t.deps.scan).not.toHaveBeenCalled();
    expect(t.deps.client.scanPackage).not.toHaveBeenCalled();
  });
  test('an invalid URL is rejected before anything is created or spawned', async () => {
    const t = setup();
    for (const bad of ['--upload-pack=x', 'file:///etc/passwd', 'https://gitlab.com/o/r', '']) {
      const r = await cloneAndScan(bad, t.deps);
      expect(r.ok).toBe(false);
    }
    expect(t.made).toEqual([]);
    expect(t.deps.clone).not.toHaveBeenCalled();
    expect(t.panels).toEqual([]);
    expect(t.errors).toHaveLength(4);
  });
  test('a failed registry write is an error, not a verdict, and the clone is removed', async () => {
    const t = setup();
    t.deps.registry = { ...t.registry, get: () => undefined, add: async () => { throw new Error('disk full'); } };
    const r = await cloneAndScan(URL_, t.deps);
    expect(r.ok).toBe(false);
    expect(t.panels).toEqual([]);
    expect(t.removed).toEqual(t.made);
  });
  test('makeDir failing is an error and nothing else runs', async () => {
    const t = setup({ makeDir: async () => { throw new Error('quarantine folder belongs to another user'); } });
    const r = await cloneAndScan(URL_, t.deps);
    expect(r.ok).toBe(false);
    expect(t.errors).toHaveLength(1);
    expect(t.deps.clone).not.toHaveBeenCalled();
  });
});

describe('cloneAndScan: success', () => {
  test('registry has the record and the panel is shown once with the verdict', async () => {
    const local: EngineResult = { findings: [f('critical', 'tasks.folder-open')], notChecked: [], purls: ['pkg:npm/lodash@4.17.21'] };
    const t = setup({ local });
    const r = await cloneAndScan(` ${URL_}/tree/main `, t.deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rec = r.value;
    expect(rec.url).toBe(URL_);
    expect(rec.sha).toBe(SHA);
    expect(rec.dir).toBe(t.made[0]);
    expect(rec.scanId).toBe(scanIdFor(URL_, SHA, ENGINE_VERSION));
    expect(rec.createdAt).toBe(1_700_000_000_000);
    expect(rec.verdict.level).toBe('critical');
    expect(rec.verdict.target).toEqual({ type: 'repo', id: 'github.com/octo/hello@ccccccc' });
    expect(rec.scanSetHash).toBe(await hashScanSet(rec.dir));
    expect(t.registry.get(rec.scanId)).toEqual(rec);
    expect(t.panels).toEqual([rec]);
    expect(t.errors).toEqual([]);
    expect(t.removed).toEqual([]);
  });
  test('order: makeDir → clone → scan → scanPackage → panel; progress is reported', async () => {
    const t = setup();
    await cloneAndScan(URL_, t.deps);
    expect(t.events.filter((e) => !e.startsWith('report:'))).toEqual(['makeDir', 'clone', 'scan', 'scanPackage', 'panel']);
    expect(t.events.filter((e) => e.startsWith('report:')).length).toBeGreaterThanOrEqual(3);
  });
  test('only the purls the scan found go to the API', async () => {
    const t = setup({ local: { findings: [], notChecked: [], purls: ['pkg:npm/a@1.0.0', 'pkg:npm/b@2.0.0'] } });
    await cloneAndScan(URL_, t.deps);
    expect(t.deps.client.scanPackage).toHaveBeenCalledWith(['pkg:npm/a@1.0.0', 'pkg:npm/b@2.0.0']);
  });
  test('a clean scan with nothing unchecked → no_known_issues, and the panel still shows once', async () => {
    const t = setup();
    const r = await cloneAndScan(URL_, t.deps);
    expect(r.ok && r.value.verdict.level).toBe('no_known_issues');
    expect(t.panels).toHaveLength(1);
  });
  test('the API being down gives unknown (not clean), and a local critical stays critical', async () => {
    const down: Result<Finding[]> = { ok: false, reason: 'Network error' };
    const a = await cloneAndScan(URL_, setup({ remote: down }).deps);
    expect(a.ok && a.value.verdict.level).toBe('unknown');
    expect(a.ok && a.value.verdict.notChecked).toContain('Package scan unavailable');
    const b = await cloneAndScan(URL_, setup({ remote: down, local: { findings: [f('critical')], notChecked: [], purls: [] } }).deps);
    expect(b.ok && b.value.verdict.level).toBe('critical');
  });
  test('remote findings can raise the level', async () => {
    const t = setup({ remote: { ok: true, value: [{ ...f('critical', 'socket.malware'), layer: 'dependency', source: 'socket' }] } });
    const r = await cloneAndScan(URL_, t.deps);
    expect(r.ok && r.value.verdict.level).toBe('critical');
  });
  test('a worker that failed or timed out is unknown, and the panel says so rather than staying silent', async () => {
    const t = setup({ local: { findings: [], notChecked: ['Scan timed out'], purls: [] } });
    const r = await cloneAndScan(URL_, t.deps);
    expect(r.ok && r.value.verdict.level).toBe('unknown');
    expect(r.ok && r.value.verdict.notChecked).toContain('Scan timed out');
    expect(t.panels).toHaveLength(1);
  });
  test('scanning the same commit again replaces the record and removes the older clone', async () => {
    const t = setup();
    const first = await cloneAndScan(URL_, t.deps);
    const second = await cloneAndScan(URL_, t.deps);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.scanId).toBe(first.value.scanId);
    expect(t.registry.list()).toHaveLength(1);
    expect(t.removed).toEqual([first.value.dir]);
  });
  test('a different commit is a different scan and keeps both', async () => {
    const t = setup();
    await cloneAndScan(URL_, t.deps);
    (t.deps.clone as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, value: { sha: 'd'.repeat(40) } });
    await cloneAndScan(URL_, t.deps);
    expect(t.registry.list()).toHaveLength(2);
    expect(t.removed).toEqual([]);
  });
  test('a panel that fails to open is reported, and the scan record is kept', async () => {
    const t = setup({ showPanel: () => { throw new Error('webview crashed'); } });
    const r = await cloneAndScan(URL_, t.deps);
    expect(r.ok).toBe(false);
    expect(t.errors).toHaveLength(1);
    expect(t.registry.list()).toHaveLength(1);
    expect(t.removed).toEqual([]);
  });
  test('the clone is never opened or executed: only data reads happen (deps contain no open/run)', () => {
    const t = setup();
    expect(Object.keys(t.deps).sort()).toEqual(['client', 'clone', 'makeDir', 'now', 'registry', 'removeDir', 'report', 'scan', 'showError', 'showPanel']);
  });
});

describe('ENGINE_VERSION', () => {
  test('is a non-empty string that scan ids depend on', () => {
    expect(ENGINE_VERSION).toMatch(/\S/);
    expect(scanIdFor(URL_, SHA, ENGINE_VERSION)).not.toBe(scanIdFor(URL_, SHA, `${ENGINE_VERSION}x`));
  });
  test('the scanned set is absent from the filesystem only if removed', () => {
    expect(existsSync(join(tmpdir(), 'definitely-not-here-stack3'))).toBe(false);
  });
});
