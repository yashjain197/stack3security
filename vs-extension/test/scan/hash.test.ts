import { describe, expect, test } from 'vitest';
import { mkdirSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashScanSet } from '../../src/scan/hash';
import { put, sandbox } from './tree';

const HEX = /^[0-9a-f]{64}$/;
const base = (root: string) => {
  put(root, '.vscode/tasks.json', '{"tasks":[]}');
  put(root, 'package.json', '{"name":"x"}');
  put(root, 'src/a.ts', 'export {}');
};

describe('hashScanSet', () => {
  test('is a sha-256 and stable across calls', async () => {
    const { root } = sandbox();
    base(root);
    const h = await hashScanSet(root);
    expect(h).toMatch(HEX);
    expect(await hashScanSet(root)).toBe(h);
  });
  test.each([
    ['.vscode/tasks.json edited', (r: string) => put(r, '.vscode/tasks.json', '{"tasks":[1]}')],
    ['a new .vscode file', (r: string) => put(r, '.vscode/settings.json', '{}')],
    ['package.json edited', (r: string) => put(r, 'package.json', '{"name":"y"}')],
    ['a nested package.json added', (r: string) => put(r, 'packages/a/package.json', '{}')],
    ['a lockfile added', (r: string) => put(r, 'package-lock.json', '{}')],
    ['.npmrc added', (r: string) => put(r, '.npmrc', 'a=b')],
    ['.yarnrc.yml added', (r: string) => put(r, '.yarnrc.yml', 'a: b')],
    ['.pnpmfile.cjs added', (r: string) => put(r, '.pnpmfile.cjs', '')],
    ['a code-workspace added', (r: string) => put(r, 'x.code-workspace', '{}')],
    ['.devcontainer added', (r: string) => put(r, '.devcontainer/devcontainer.json', '{}')],
    ['.devcontainer.json added', (r: string) => put(r, '.devcontainer.json', '{}')],
    ['a covered file deleted', (r: string) => rmSync(join(r, 'package.json'))],
    ['a covered file renamed', (r: string) => renameSync(join(r, 'package.json'), join(r, 'package.json.bak'))],
    ['a committed node_modules package.json added', (r: string) => put(r, 'node_modules/x/package.json', '{}')],
  ])('changes when %s', async (_n, mutate) => {
    const { root } = sandbox();
    base(root);
    const before = await hashScanSet(root);
    if (_n === 'a covered file renamed') put(root, 'package.json.bak2', 'unrelated');
    mutate(root);
    expect(await hashScanSet(root)).not.toBe(before);
  });
  test.each([
    ['an ordinary source file edited', (r: string) => put(r, 'src/a.ts', 'export const x = 1')],
    ['README added', (r: string) => put(r, 'README.md', 'hi')],
    ['a file inside node_modules other than package.json', (r: string) => put(r, 'node_modules/x/index.js', 'x')],
    ['.git contents', (r: string) => put(r, '.git/config', '[core]')],
    ['mtimes touched', (r: string) => { const t = new Date(2001, 1, 1); utimesSync(join(r, 'package.json'), t, t); }],
  ])('does not change when %s', async (_n, mutate) => {
    const { root } = sandbox();
    base(root);
    const before = await hashScanSet(root);
    mutate(root);
    expect(await hashScanSet(root)).toBe(before);
  });
  test('does not depend on creation order', async () => {
    const a = sandbox();
    const b = sandbox();
    for (const [p, c] of [['.vscode/a.json', '1'], ['package.json', '2'], ['.npmrc', '3']] as const) put(a.root, p, c);
    for (const [p, c] of [['.npmrc', '3'], ['package.json', '2'], ['.vscode/a.json', '1']] as const) put(b.root, p, c);
    expect(await hashScanSet(a.root)).toBe(await hashScanSet(b.root));
  });
  test('a symlink is never followed: pointing it elsewhere changes nothing', async () => {
    const { root, canary } = sandbox();
    base(root);
    const before = await hashScanSet(root);
    symlinkSync(canary, join(root, '.vscode/link.json'));
    expect(await hashScanSet(root)).toBe(before);
  });
  test('bytes matter, not just names (same size, different content)', async () => {
    const { root } = sandbox();
    put(root, 'package.json', 'aaaa');
    const a = await hashScanSet(root);
    writeFileSync(join(root, 'package.json'), 'aaab');
    expect(await hashScanSet(root)).not.toBe(a);
  });
  test('path and content cannot be traded against each other', async () => {
    const a = sandbox();
    const b = sandbox();
    put(a.root, '.npmrc', 'x');
    put(a.root, 'package.json', 'y');
    put(b.root, '.npmrc', 'xpackage.json');
    mkdirSync(join(b.root, 'q'));
    expect(await hashScanSet(a.root)).not.toBe(await hashScanSet(b.root));
  });
  test('an empty tree hashes to a constant', async () => {
    expect(await hashScanSet(sandbox().root)).toBe(await hashScanSet(sandbox().root));
  });
});
