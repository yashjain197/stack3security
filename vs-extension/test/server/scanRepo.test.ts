import { describe, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Result } from '../../src/api/client';
import { createLimiter } from '../../src/server/limiter';
import { createRepoScanner, type ScanRepoDeps } from '../../src/server/scanRepo';
import type { EngineResult, Finding } from '../../src/engine/types';
import type { GraphReport } from '../../src/report/graphReport';
import { f } from '../engine/helpers';

const SHA = 'c'.repeat(40);
const ADDR = '0x9f00000000000000000000000000000000000001';
const KEY = 'b7'.repeat(32);
const decodeExec: Finding = {
  ...f('critical', 'source.decode-exec-secret'),
  title: 'Code decodes hidden text, runs it, and reads a secret location',
  evidence: `Signals: eval, base64-exec, secret-path-read; wallets: ${ADDR}; endpoints: https://api.telegram.org/bot123456`,
  location: { file: 'scripts/.cache/setup.js', line: 3 },
};

function setup(over: Partial<ScanRepoDeps> & { local?: EngineResult | (() => Promise<EngineResult>); cloneResult?: Result<{ sha: string }>; opts?: { cacheTtlMs?: number } } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'stack3-srv-'));
  const made: string[] = [];
  const removed: string[] = [];
  const reports: GraphReport[] = [];
  const order: string[] = [];
  let clock = 1_000_000;
  const deps: ScanRepoDeps = {
    makeDir: async (owner, repo) => {
      const d = join(base, `${owner}__${repo}__${made.length.toString(16).padStart(8, '0')}`);
      mkdirSync(d);
      writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'interview-task', version: '1.0.0' }));
      made.push(d);
      order.push('makeDir');
      return d;
    },
    clone: vi.fn(async () => (order.push('clone'), over.cloneResult ?? { ok: true as const, value: { sha: SHA } })),
    removeDir: async (d) => void (order.push('removeDir'), removed.push(d)),
    scan: vi.fn(async () => {
      order.push('scan');
      const l = over.local ?? { findings: [], notChecked: [], purls: [] };
      return typeof l === 'function' ? l() : l;
    }),
    scanPackages: vi.fn(async (): Promise<Result<Finding[]>> => ({ ok: true, value: [] })),
    report: vi.fn(async (r: GraphReport) => (reports.push(r), { ok: true as const, value: { id: 'u', synced: true } })),
    limiter: createLimiter(2, 8),
    now: () => clock,
    ...over,
  };
  delete (deps as Partial<typeof over>).local;
  delete (deps as Partial<typeof over>).cloneResult;
  delete (deps as Partial<typeof over>).opts;
  const scanner = createRepoScanner(deps, { cacheTtlMs: over.opts?.cacheTtlMs ?? 60_000, maxCache: 50 });
  return { scanner, deps, made, removed, reports, order, tick: (ms: number) => void (clock += ms) };
}
const URL_ = 'https://github.com/octo/hostile';

describe('input', () => {
  test.each([['--upload-pack=x'], ['file:///etc/passwd'], ['https://gitlab.com/o/r'], [''], ['https://github.com/o/../r']])('a bad repo url (%j) is refused before anything is created', async (repoUrl) => {
    const t = setup();
    const r = await t.scanner.scan({ repoUrl });
    expect(r).toMatchObject({ ok: false, code: 'invalid_repo_url' });
    expect(t.made).toEqual([]);
    expect(t.deps.clone).not.toHaveBeenCalled();
  });
  test.each([['zzz'], ['--help'], ['../x'], ['a'.repeat(41)], ['abc'], ['main']])('a bad ref (%j) is refused', async (ref) => {
    const t = setup();
    expect(await t.scanner.scan({ repoUrl: URL_, ref })).toMatchObject({ ok: false, code: 'invalid_ref' });
    expect(t.made).toEqual([]);
  });
  test('the url is normalized, so pasted forms share one result', async () => {
    const t = setup();
    await t.scanner.scan({ repoUrl: 'github.com/octo/hostile/tree/main' });
    await t.scanner.scan({ repoUrl: 'https://github.com/octo/hostile.git' });
    expect(t.deps.clone).toHaveBeenCalledTimes(1);
  });
});

describe('the scan', () => {
  test('clones into a fresh quarantine dir, scans it, and ALWAYS removes it afterwards', async () => {
    const t = setup();
    const r = await t.scanner.scan({ repoUrl: URL_ });
    expect(r.ok).toBe(true);
    expect(t.order).toEqual(['makeDir', 'clone', 'scan', 'removeDir']);
    expect(t.removed).toEqual(t.made);
  });
  test('a failed clone is a clone failure with the clone\'s own short message, and the dir is removed', async () => {
    const t = setup({ cloneResult: { ok: false, reason: 'Repository not found, or it is private. Only public GitHub repositories can be cloned.' } });
    const r = await t.scanner.scan({ repoUrl: URL_ });
    expect(r).toEqual({ ok: false, code: 'clone_failed', message: 'Repository not found, or it is private. Only public GitHub repositories can be cloned.' });
    expect(t.removed).toEqual(t.made);
    expect(t.deps.scan).not.toHaveBeenCalled();
  });
  test('a scan that throws is an internal error, and the dir is still removed', async () => {
    const t = setup({ local: () => Promise.reject(new Error('worker exploded with /home/secret/path')) });
    const r = await t.scanner.scan({ repoUrl: URL_ });
    expect(r).toMatchObject({ ok: false, code: 'internal_error' });
    expect(JSON.stringify(r)).not.toContain('/home/secret');
    expect(t.removed).toEqual(t.made);
  });
  test('the verdict is in the API\'s shape, with the repo as the target', async () => {
    const t = setup({ local: { findings: [f('high', 'settings.shell-override')], notChecked: [], purls: [] } });
    const r = await t.scanner.scan({ repoUrl: URL_ });
    if (!r.ok) throw new Error('expected ok');
    expect(r.verdict.level).toBe('high');
    expect(r.verdict.target).toEqual({ type: 'repo', id: 'github.com/octo/hostile' });
    expect(r.verdict.explanation).toBeNull();
    expect(r.verdict.findings[0]).not.toHaveProperty('ruleId');
  });
  test('no packages and nothing found → no_known_issues; the word "safe" is never a level', async () => {
    const r = await setup().scanner.scan({ repoUrl: URL_ });
    expect(r.ok && r.verdict.level).toBe('no_known_issues');
  });
  test('packages that could not be checked make the verdict unknown, not clean', async () => {
    const t = setup({ local: { findings: [], notChecked: [], purls: ['pkg:npm/a@1.0.0'] }, scanPackages: vi.fn(async () => ({ ok: false as const, reason: 'Package scan is not configured on this server.' })) });
    const r = await t.scanner.scan({ repoUrl: URL_ });
    expect(r.ok && r.verdict.level).toBe('unknown');
    expect(r.ok && r.verdict.notChecked).toContain('Package scan unavailable');
  });
  test('packages Socket answered only part of are said so, and the verdict is not clean', async () => {
    const note = 'Package scan incomplete: 1 of 2 packages were not checked by Socket.';
    const t = setup({ local: { findings: [], notChecked: [], purls: ['pkg:npm/a@1.0.0', 'pkg:npm/b@1.0.0'] }, scanPackages: vi.fn(async () => ({ ok: true as const, value: [], notChecked: [note] })) });
    const r = await t.scanner.scan({ repoUrl: URL_ });
    expect(r.ok && r.verdict.level).toBe('unknown');
    expect(r.ok && r.verdict.notChecked).toContain(note);
  });
  test('remote package findings can raise the level and are asked for only when there are packages', async () => {
    const malware: Finding = { ...f('critical', 'socket.malware'), layer: 'dependency', source: 'socket' };
    const t = setup({ local: { findings: [], notChecked: [], purls: ['pkg:npm/a@1.0.0'] }, scanPackages: vi.fn(async () => ({ ok: true as const, value: [malware] })) });
    const r = await t.scanner.scan({ repoUrl: URL_ });
    expect(r.ok && r.verdict.level).toBe('critical');
    expect(t.deps.scanPackages).toHaveBeenCalledWith(['pkg:npm/a@1.0.0']);
    const none = setup();
    await none.scanner.scan({ repoUrl: URL_ });
    expect(none.deps.scanPackages).not.toHaveBeenCalled();
  });
  test('onScanned runs once per finished scan: not for a cached answer, a failed clone or a bad url, and a throw does not fail the scan', async () => {
    const seen: string[] = [];
    const t = setup({ onScanned: (v) => void seen.push(v.level) });
    await t.scanner.scan({ repoUrl: URL_ });
    await t.scanner.scan({ repoUrl: URL_ }); // cached
    await t.scanner.scan({ repoUrl: 'https://gitlab.com/o/r' });
    await setup({ onScanned: (v) => void seen.push(v.level), cloneResult: { ok: false, reason: 'nope' } }).scanner.scan({ repoUrl: URL_ });
    expect(seen).toEqual(['no_known_issues']);
    const boom = setup({ onScanned: () => { throw new Error('x'); } });
    expect((await boom.scanner.scan({ repoUrl: URL_ })).ok).toBe(true);
  });
  test('a requested commit that was not the one scanned is said so; a matching one is not', async () => {
    const mismatch = await setup().scanner.scan({ repoUrl: URL_, ref: 'abcdef1' });
    expect(mismatch.ok && mismatch.verdict.notChecked.join()).toMatch(/Commit abcdef1 was not scanned; the default branch tip ccccccc was/);
    expect(mismatch.ok && mismatch.verdict.level).toBe('unknown');
    const match = await setup().scanner.scan({ repoUrl: URL_, ref: 'CCCCCCC' });
    expect(match.ok && match.verdict.notChecked).toEqual([]);
  });
  test('secrets in findings never reach the response', async () => {
    const t = setup({ local: { findings: [{ ...f('critical'), evidence: `PRIVATE_KEY=0x${KEY}` }], notChecked: [], purls: [] } });
    const r = await t.scanner.scan({ repoUrl: URL_ });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

describe('reporting to the graph', () => {
  test('a critical decode-and-run finding posts the package, the wallet and the endpoint once', async () => {
    const t = setup({ local: { findings: [decodeExec], notChecked: [], purls: [] } });
    await t.scanner.scan({ repoUrl: URL_ });
    expect(t.reports).toHaveLength(1);
    const ids = t.reports[0]!.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['1:' + ADDR, 'https://api.telegram.org/bot123456', 'pkg:npm/interview-task@1.0.0'].sort());
    expect(t.reports[0]).toMatchObject({ source: 'vscode', reporter: 'scan-repo' });
  });
  test('nothing reportable → no post', async () => {
    const t = setup({ local: { findings: [f('high', 'settings.shell-override'), f('caution')], notChecked: [], purls: [] } });
    await t.scanner.scan({ repoUrl: URL_ });
    expect(t.deps.report).not.toHaveBeenCalled();
  });
  test('a report that fails does not fail the scan', async () => {
    const t = setup({ local: { findings: [decodeExec], notChecked: [], purls: [] }, report: vi.fn(async () => { throw new Error('graph down'); }) });
    expect((await t.scanner.scan({ repoUrl: URL_ })).ok).toBe(true);
    const t2 = setup({ local: { findings: [decodeExec], notChecked: [], purls: [] }, report: vi.fn(async () => ({ ok: false as const, reason: 'The API rejected the service key.' })) });
    expect((await t2.scanner.scan({ repoUrl: URL_ })).ok).toBe(true);
  });
  test('a repeat request served from the cache does not report again', async () => {
    const t = setup({ local: { findings: [decodeExec], notChecked: [], purls: [] } });
    await t.scanner.scan({ repoUrl: URL_ });
    await t.scanner.scan({ repoUrl: URL_ });
    expect(t.reports).toHaveLength(1);
  });
  test('the package comes from the nearest package.json of the flagged file', async () => {
    const t = setup({ local: { findings: [{ ...decodeExec, location: { file: 'vendor/fake-lib/index.js', line: 1 } }], notChecked: [], purls: [] } });
    await t.scanner.scan({ repoUrl: URL_ });
    // no vendor/fake-lib/package.json in the fake clone, so it falls back to the root package, which owns the file
    expect(t.reports[0]!.nodes.some((n) => n.id === 'pkg:npm/interview-task@1.0.0')).toBe(true);
  });
});

describe('cache, single flight and load', () => {
  test('a second request inside the TTL is answered without cloning; after the TTL it scans again', async () => {
    const t = setup({ opts: { cacheTtlMs: 1000 } });
    await t.scanner.scan({ repoUrl: URL_ });
    t.tick(500);
    await t.scanner.scan({ repoUrl: URL_ });
    expect(t.deps.clone).toHaveBeenCalledTimes(1);
    t.tick(600);
    await t.scanner.scan({ repoUrl: URL_ });
    expect(t.deps.clone).toHaveBeenCalledTimes(2);
  });
  test('a different ref is a different scan', async () => {
    const t = setup();
    await t.scanner.scan({ repoUrl: URL_ });
    await t.scanner.scan({ repoUrl: URL_, ref: 'abcdef1' });
    expect(t.deps.clone).toHaveBeenCalledTimes(2);
  });
  test('failures are not cached, so a retry tries again', async () => {
    const t = setup({ cloneResult: { ok: false, reason: 'Cloning failed.' } });
    await t.scanner.scan({ repoUrl: URL_ });
    await t.scanner.scan({ repoUrl: URL_ });
    expect(t.deps.clone).toHaveBeenCalledTimes(2);
  });
  test('concurrent requests for the same repo share one scan', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = setup({ local: async () => (await gate, { findings: [], notChecked: [], purls: [] }) });
    const all = Promise.all([1, 2, 3, 4].map(() => t.scanner.scan({ repoUrl: URL_ })));
    await new Promise((r) => setTimeout(r, 10));
    release();
    const results = await all;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(t.deps.clone).toHaveBeenCalledTimes(1);
  });
  test('when the queue is full the caller is told it is busy and nothing is cloned for it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = setup({ limiter: createLimiter(1, 0), local: async () => (await gate, { findings: [], notChecked: [], purls: [] }) });
    const first = t.scanner.scan({ repoUrl: 'https://github.com/octo/one' });
    await new Promise((r) => setTimeout(r, 10));
    const second = await t.scanner.scan({ repoUrl: 'https://github.com/octo/two' });
    expect(second).toMatchObject({ ok: false, code: 'busy' });
    expect(t.deps.clone).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
  test('the cache is bounded', async () => {
    const t = setup();
    for (let i = 0; i < 80; i++) await t.scanner.scan({ repoUrl: `https://github.com/octo/r${i}` });
    await t.scanner.scan({ repoUrl: 'https://github.com/octo/r0' }); // evicted long ago
    expect(t.deps.clone).toHaveBeenCalledTimes(81);
  });
});
