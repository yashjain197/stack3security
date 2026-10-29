import { describe, expect, test } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_VIEW_BYTES, parseQuarantinePath, quarantineUriPath, readQuarantined, SCHEME } from '../../src/ui/quarantineFs';
import { CANARY, put, sandbox } from '../scan/tree';
import { SCAN_ID } from './helpers';

const UNAVAILABLE = '[Stack3: this file cannot be shown]';

describe('uri path', () => {
  test('round trips', () => {
    expect(SCHEME).toBe('stack3-quarantine');
    expect(parseQuarantinePath(quarantineUriPath(SCAN_ID, 'src/a.ts'))).toEqual({ scanId: SCAN_ID, rel: 'src/a.ts' });
  });
  test.each(['', '/', `/${SCAN_ID}`, `/${SCAN_ID}/`, `/short/a.ts`, `/${SCAN_ID}/../x`, `/${SCAN_ID}//etc/passwd`, `/${'AB'.repeat(32)}/a`, `/${SCAN_ID}/a\\..\\b`])('rejects %j', (p) => {
    expect(parseQuarantinePath(p)).toBeNull();
  });
});

describe('readQuarantined', () => {
  test('returns a text file', async () => {
    const { root } = sandbox();
    put(root, 'src/a.ts', 'export const x = 1;\n');
    expect(await readQuarantined({ dir: root }, 'src/a.ts')).toBe('export const x = 1;\n');
  });
  test.each(['../secret.txt', '../../etc/passwd', '/etc/passwd', 'a/../../secret.txt', 'C:\\x', '', '..', '.'])('refuses %j', async (rel) => {
    const { root } = sandbox();
    put(root, 'a.txt', 'a');
    expect(await readQuarantined({ dir: root }, rel)).toBe(UNAVAILABLE);
  });
  test('never reveals a file outside the clone, even through a symlink', async () => {
    const { root, canary } = sandbox();
    symlinkSync(canary, join(root, 'link.txt'));
    mkdirSync(join(root, 'd'));
    symlinkSync(join(root, '..'), join(root, 'd', 'up'));
    expect(await readQuarantined({ dir: root }, 'link.txt')).toBe(UNAVAILABLE);
    expect(await readQuarantined({ dir: root }, 'd/up/secret.txt')).toBe(UNAVAILABLE);
    expect(await readQuarantined({ dir: root }, '../secret.txt')).not.toContain(CANARY);
  });
  test('a directory, a missing file and a bad clone dir are all just "cannot be shown"', async () => {
    const { root } = sandbox();
    mkdirSync(join(root, 'sub'));
    expect(await readQuarantined({ dir: root }, 'sub')).toBe(UNAVAILABLE);
    expect(await readQuarantined({ dir: root }, 'missing.txt')).toBe(UNAVAILABLE);
    expect(await readQuarantined({ dir: join(root, 'nope') }, 'a')).toBe(UNAVAILABLE);
  });
  test('binary files are not dumped', async () => {
    const { root } = sandbox();
    writeFileSync(join(root, 'b.bin'), Buffer.from([1, 2, 0, 3, 4]));
    expect(await readQuarantined({ dir: root }, 'b.bin')).toBe('[Stack3: binary file, 5 bytes, not shown]');
  });
  test('a file over 1 MiB is cut off and says so', async () => {
    const { root } = sandbox();
    put(root, 'big.txt', 'x'.repeat(MAX_VIEW_BYTES + 500));
    const out = await readQuarantined({ dir: root }, 'big.txt');
    expect(out.startsWith('x'.repeat(100))).toBe(true);
    expect(out.length).toBeLessThan(MAX_VIEW_BYTES + 100);
    expect(out).toContain('[Stack3: file truncated at 1 MiB]');
  });
  test('invalid UTF-8 does not throw', async () => {
    const { root } = sandbox();
    writeFileSync(join(root, 'l1.txt'), Buffer.from([0x68, 0xe9, 0x6c, 0x6c, 0x6f]));
    expect(await readQuarantined({ dir: root }, 'l1.txt')).toContain('h');
  });
  test('the content is returned as text only: markup is not interpreted by this layer', async () => {
    const { root } = sandbox();
    put(root, 'x.html', '<img src=x onerror=alert(1)>');
    expect(await readQuarantined({ dir: root }, 'x.html')).toBe('<img src=x onerror=alert(1)>');
  });
});
