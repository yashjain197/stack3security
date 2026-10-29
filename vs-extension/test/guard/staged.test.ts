import { describe, expect, test, vi } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerStagedSecretWarning, type GitApi, type GitRepository, type StagedDeps } from '../../src/guard/staged';

const KEY = 'b8'.repeat(32);

function setup(files: Record<string, string> = {}, over: { status?: number; api?: GitApi | undefined | 'none' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'stack3-staged-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  let onChange: () => void = () => undefined;
  const repo: GitRepository = {
    rootUri: { fsPath: root },
    state: { indexChanges: Object.keys(files).map((rel) => ({ uri: { fsPath: join(root, rel) }, status: over.status ?? 1 })), onDidChange: (cb) => ((onChange = cb), { dispose: () => undefined }) },
  };
  let onOpen: (r: GitRepository) => void = () => undefined;
  const api: GitApi = { repositories: [repo], onDidOpenRepository: (cb) => ((onOpen = cb), { dispose: () => undefined }) };
  const notes: string[] = [];
  const deps: StagedDeps = { getGitApi: async () => (over.api === 'none' ? undefined : (over.api ?? api)), notify: (m) => void notes.push(m), debounceMs: 30 };
  return { root, repo, api, notes, deps, change: () => onChange(), open: (r: GitRepository) => onOpen(r) };
}
// Real timers: the check reads real files, which a frozen clock would never let finish.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = async (ms = 250) => { await sleep(ms); };

describe('staged secret warning (V-3: read-only, never runs git)', () => {
  test('warns about a staged wallet key, naming the file and line but never the value', async () => {
    const t = setup({ 'config/deploy.js': `const a = 1;\nconst PRIVATE_KEY = "0x${KEY}";\n` });
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    expect(t.notes).toHaveLength(1);
    expect(t.notes[0]).toMatch(/possible evm key is staged in config\/deploy\.js:2/);
    expect(t.notes[0]).not.toContain(KEY);
    expect(t.notes[0]).not.toMatch(/\bsafe\b/i);
  });
  test('seed phrases, private key files and .env credentials are caught too', async () => {
    const words = [...Array(11).fill('abandon'), 'about'].join(' ');
    const t = setup({ 'notes.txt': words, 'k.pem': '-----BEGIN RSA PRIVATE KEY-----\nQUJD\n-----END RSA PRIVATE KEY-----', '.env': 'API_SECRET=abc123def' });
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    expect(t.notes.map((n) => /possible ([a-z ]+) is staged/.exec(n)![1]).sort()).toEqual(['dotenv', 'mnemonic', 'pem']);
    expect(t.notes.join()).not.toMatch(/abandon|abc123def|QUJD/);
  });
  test('each secret is reported once, however many times the git state changes', async () => {
    const t = setup({ 'a.js': `PRIVATE_KEY=0x${KEY}` });
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    for (let i = 0; i < 5; i++) {
      t.change();
      await flush();
    }
    expect(t.notes).toHaveLength(1);
  });
  test('a burst of state changes is one check', async () => {
    const t = setup({ 'a.js': `PRIVATE_KEY=0x${KEY}` });
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    t.notes.length = 0;
    let reads = 0;
    const original = t.repo.state.indexChanges;
    Object.defineProperty(t.repo.state, 'indexChanges', { get: () => (reads++, original) });
    for (let i = 0; i < 10; i++) {
      t.change();
      await sleep(4);
    }
    await flush();
    expect(reads).toBe(1);
  });
  test('a clean staged file, or nothing staged, is silent', async () => {
    const t = setup({ 'a.js': 'export const x = 1;' });
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    expect(t.notes).toEqual([]);
    const none = setup({});
    registerStagedSecretWarning({ subscriptions: [] }, none.deps);
    await flush();
    expect(none.notes).toEqual([]);
  });
  test('a file staged for deletion is not read', async () => {
    const t = setup({ 'gone.js': `PRIVATE_KEY=0x${KEY}` }, { status: 2 });
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    expect(t.notes).toEqual([]);
  });
  test('a symlink is never followed, even to a real secret outside the repo', async () => {
    const t = setup({ 'a.js': 'x' });
    const outside = join(tmpdir(), `stack3-outside-${Date.now()}.txt`);
    writeFileSync(outside, `PRIVATE_KEY=0x${KEY}`);
    symlinkSync(outside, join(t.root, 'link.js'));
    t.repo.state.indexChanges.push({ uri: { fsPath: join(t.root, 'link.js') }, status: 1 });
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    expect(t.notes).toEqual([]);
  });
  test('a path outside the repository is not read', async () => {
    const t = setup({ 'a.js': 'x' });
    const outside = join(tmpdir(), `stack3-outside2-${Date.now()}.txt`);
    writeFileSync(outside, `PRIVATE_KEY=0x${KEY}`);
    t.repo.state.indexChanges.push({ uri: { fsPath: outside }, status: 1 });
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    expect(t.notes).toEqual([]);
  });
  test('binary files are skipped', async () => {
    const t = setup();
    writeFileSync(join(t.root, 'b.bin'), Buffer.from([0, 1, 2, 3]));
    t.repo.state.indexChanges.push({ uri: { fsPath: join(t.root, 'b.bin') }, status: 1 });
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    expect(t.notes).toEqual([]);
  });
  test('a repository opened later is watched too', async () => {
    const t = setup({ 'a.js': 'x' });
    const later = setup({ 'b.js': `PRIVATE_KEY=0x${KEY}` });
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    t.open(later.repo);
    await flush();
    expect(t.notes).toHaveLength(1);
  });
  test('without the git extension it does nothing and does not throw', async () => {
    const t = setup({ 'a.js': `PRIVATE_KEY=0x${KEY}` }, { api: 'none' });
    const d = registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    expect(t.notes).toEqual([]);
    expect(() => d.dispose()).not.toThrow();
  });
  test('a failing git API does not throw', async () => {
    const t = setup({}, {});
    t.deps.getGitApi = async () => { throw new Error('git extension crashed'); };
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await expect(flush()).resolves.toBeUndefined();
  });
  test('a git API that misbehaves inside the timer is swallowed, not an unhandled rejection', async () => {
    const t = setup({ 'a.js': `PRIVATE_KEY=0x${KEY}` });
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => void unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    Object.defineProperty(t.repo.state, 'indexChanges', { get: () => { throw new Error('git extension quirk'); } });
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
    expect(t.notes).toEqual([]);
  });
  test('an index that is missing is treated as nothing staged', async () => {
    const t = setup({ 'a.js': 'x' });
    (t.repo.state as unknown as { indexChanges?: unknown }).indexChanges = undefined;
    registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    await flush();
    expect(t.notes).toEqual([]);
  });
  test('after dispose nothing is reported', async () => {
    const t = setup({ 'a.js': `PRIVATE_KEY=0x${KEY}` });
    const d = registerStagedSecretWarning({ subscriptions: [] }, t.deps);
    d.dispose();
    await flush();
    expect(t.notes).toEqual([]);
  });
  test('the module never spawns a process', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../src/guard/staged.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/child_process|execFile|spawn|exec\(/);
  });
});
