import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQuarantineDir, quarantineRoot } from '../../src/quarantine/paths';
import { OutsideQuarantineError, removeQuarantined, sweepQuarantine } from '../../src/quarantine/remove';

let tmp: string;
let prevTmp: string | undefined;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'stack3-qrm-'));
  prevTmp = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
});
afterEach(() => {
  if (prevTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = prevTmp;
});

describe('quarantine directories', () => {
  test('root is <tmpdir>/stack3-quarantine', () => expect(quarantineRoot()).toBe(join(tmp, 'stack3-quarantine')));
  test.skipIf(process.platform === 'win32')('root and every dir are mode 0o700', async () => {
    const d = await createQuarantineDir('octo', 'hello');
    expect(statSync(d).mode & 0o777).toBe(0o700);
    expect(statSync(quarantineRoot()).mode & 0o777).toBe(0o700);
  });
  test('names are <owner>__<repo>__<8 hex> and unique', async () => {
    const a = await createQuarantineDir('octo', 'hello');
    const b = await createQuarantineDir('octo', 'hello');
    expect(a).not.toBe(b);
    expect(a.slice(quarantineRoot().length + 1)).toMatch(/^octo__hello__[0-9a-f]{8}$/);
  });
  test('refuses an owner/repo that would escape or break the name', async () => {
    for (const [o, r] of [['..', 'x'], ['a/b', 'c'], ['a', '../c'], ['a', ''], ['', 'a'], ['-a', 'b']] as const) {
      await expect(createQuarantineDir(o, r), `${o}/${r}`).rejects.toThrow();
    }
  });
  test.skipIf(process.platform === 'win32')('a pre-planted symlink at the root is refused, not followed', async () => {
    const elsewhere = join(tmp, 'elsewhere');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, quarantineRoot());
    await expect(createQuarantineDir('octo', 'hello')).rejects.toThrow(/quarantine/i);
    expect(statSync(elsewhere).mode & 0o777).not.toBe(0o700);
  });
  test.skipIf(process.platform === 'win32' || typeof process.getuid !== 'function')('a root made world-writable is tightened to 0o700', async () => {
    mkdirSync(quarantineRoot(), { mode: 0o777 });
    await createQuarantineDir('octo', 'hello');
    expect(statSync(quarantineRoot()).mode & 0o777).toBe(0o700);
  });
});

describe('removeQuarantined', () => {
  test('deletes a quarantine dir with its contents', async () => {
    const d = await createQuarantineDir('octo', 'hello');
    mkdirSync(join(d, 'a/b'), { recursive: true });
    writeFileSync(join(d, 'a/b/c.txt'), 'x');
    await removeQuarantined(d);
    expect(existsSync(d)).toBe(false);
  });
  test('a symlink inside the tree is removed, never followed', async () => {
    const d = await createQuarantineDir('octo', 'hello');
    const outside = join(tmp, 'precious');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    symlinkSync(outside, join(d, 'link'));
    await removeQuarantined(d);
    expect(existsSync(d)).toBe(false);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });
  test('refuses anything outside the root', async () => {
    await createQuarantineDir('octo', 'hello');
    const outside = join(tmp, 'octo__hello__deadbeef');
    mkdirSync(outside);
    for (const bad of [outside, tmp, '/', '/etc', join(quarantineRoot(), '..', 'octo__hello__deadbeef'), '']) {
      await expect(removeQuarantined(bad), bad).rejects.toBeInstanceOf(OutsideQuarantineError);
    }
    expect(existsSync(outside)).toBe(true);
  });
  test('refuses the root itself and anything that is not a quarantine dir name', async () => {
    const d = await createQuarantineDir('octo', 'hello');
    mkdirSync(join(d, 'sub'));
    mkdirSync(join(quarantineRoot(), '.empty-hooks'), { recursive: true });
    mkdirSync(join(quarantineRoot(), 'random-dir'));
    for (const bad of [quarantineRoot(), join(d, 'sub'), join(quarantineRoot(), '.empty-hooks'), join(quarantineRoot(), 'random-dir')]) {
      await expect(removeQuarantined(bad), bad).rejects.toBeInstanceOf(OutsideQuarantineError);
    }
    expect(existsSync(join(d, 'sub'))).toBe(true);
  });
  test.skipIf(process.platform === 'win32')('refuses a quarantine-named symlink that points outside (symlinked escape)', async () => {
    await createQuarantineDir('octo', 'hello');
    const outside = join(tmp, 'victim');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    const trap = join(quarantineRoot(), 'octo__trap__deadbeef');
    symlinkSync(outside, trap);
    await expect(removeQuarantined(trap)).rejects.toBeInstanceOf(OutsideQuarantineError);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });
  test('a quarantine dir that is already gone is not an error', async () => {
    const d = await createQuarantineDir('octo', 'hello');
    await removeQuarantined(d);
    await expect(removeQuarantined(d)).resolves.toBeUndefined();
  });
  test('OutsideQuarantineError is an Error with a useful name', () => {
    expect(new OutsideQuarantineError('x')).toMatchObject({ name: 'OutsideQuarantineError' });
  });
});

describe('sweepQuarantine (clones older than 7 days are cleaned on activation)', () => {
  test('removes old quarantine dirs only', async () => {
    const old = await createQuarantineDir('octo', 'old');
    const fresh = await createQuarantineDir('octo', 'fresh');
    const stranger = join(quarantineRoot(), 'not-ours');
    mkdirSync(stranger);
    const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000;
    for (const p of [old, stranger]) utimesSync(p, eightDaysAgo, eightDaysAgo);
    const removed = await sweepQuarantine(7);
    expect(removed).toEqual([old]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(stranger)).toBe(true);
  });
  test('no root yet → nothing to do', async () => expect(await sweepQuarantine(7)).toEqual([]));
});
