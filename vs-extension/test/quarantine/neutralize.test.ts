import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTO_RUN_ENTRIES, DISABLED_DIR, isNeutralized, neutralize } from '../../src/quarantine/neutralize';
import { createQuarantineDir } from '../../src/quarantine/paths';
import { OutsideQuarantineError } from '../../src/quarantine/remove';

let tmp: string;
let prev: string | undefined;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'stack3-neut-'));
  prev = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
});
afterEach(() => {
  if (prev === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = prev;
});

const put = (root: string, rel: string, text: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const clone = async () => {
  const d = await createQuarantineDir('octo', 'hello');
  put(d, '.vscode/tasks.json', '{"tasks":[{"runOptions":{"runOn":"folderOpen"}}]}');
  put(d, '.vscode/settings.json', '{}');
  put(d, '.devcontainer/devcontainer.json', '{"initializeCommand":"touch x"}');
  put(d, 'package.json', '{"name":"x"}');
  put(d, 'src/index.js', 'x');
  return d;
};

describe('neutralize', () => {
  test('moves .vscode and .devcontainer into .stack3-disabled and leaves everything else', async () => {
    const d = await clone();
    const moved = await neutralize(d);
    expect(moved.sort()).toEqual([join(d, DISABLED_DIR, '.devcontainer'), join(d, DISABLED_DIR, '.vscode')].sort());
    expect(existsSync(join(d, '.vscode'))).toBe(false);
    expect(existsSync(join(d, '.devcontainer'))).toBe(false);
    expect(readFileSync(join(d, DISABLED_DIR, '.vscode/tasks.json'), 'utf8')).toContain('folderOpen');
    expect(readFileSync(join(d, 'package.json'), 'utf8')).toBe('{"name":"x"}');
    expect(readFileSync(join(d, 'src/index.js'), 'utf8')).toBe('x');
    expect(readdirSync(d).sort()).toEqual([DISABLED_DIR, 'package.json', 'src']);
  });
  test('writes a README that says what happened and that nothing was run', async () => {
    const d = await clone();
    await neutralize(d);
    const readme = readFileSync(join(d, DISABLED_DIR, 'README.txt'), 'utf8');
    expect(readme).toContain('.vscode');
    expect(readme).toContain('.devcontainer');
    expect(readme).toMatch(/Nothing in this repository has been run/);
    expect(readme).not.toMatch(/\bsafe\b/i);
  });
  test('also moves a root .devcontainer.json', async () => {
    const d = await clone();
    put(d, '.devcontainer.json', '{}');
    await neutralize(d);
    expect(existsSync(join(d, '.devcontainer.json'))).toBe(false);
    expect(existsSync(join(d, DISABLED_DIR, '.devcontainer.json'))).toBe(true);
  });
  test('nothing to move → no change, no .stack3-disabled', async () => {
    const d = await createQuarantineDir('octo', 'plain');
    put(d, 'package.json', '{}');
    expect(await neutralize(d)).toEqual([]);
    expect(existsSync(join(d, DISABLED_DIR))).toBe(false);
  });
  test('running it again changes nothing and keeps the first result', async () => {
    const d = await clone();
    await neutralize(d);
    expect(await neutralize(d)).toEqual([]);
    expect(existsSync(join(d, DISABLED_DIR, '.vscode/tasks.json'))).toBe(true);
  });
  test('a .vscode that is a plain file is moved too', async () => {
    const d = await createQuarantineDir('octo', 'file');
    put(d, '.vscode', '../../somewhere');
    await neutralize(d);
    expect(existsSync(join(d, '.vscode'))).toBe(false);
    expect(readFileSync(join(d, DISABLED_DIR, '.vscode'), 'utf8')).toBe('../../somewhere');
  });
  test.skipIf(process.platform === 'win32')('a .vscode symlink is moved as a link, never followed', async () => {
    const d = await createQuarantineDir('octo', 'link');
    const victim = join(tmp, 'victim');
    mkdirSync(victim);
    writeFileSync(join(victim, 'keep.txt'), 'keep');
    symlinkSync(victim, join(d, '.vscode'));
    await neutralize(d);
    expect(existsSync(join(d, '.vscode'))).toBe(false);
    expect(lstatSync(join(d, DISABLED_DIR, '.vscode')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(victim, 'keep.txt'), 'utf8')).toBe('keep');
  });
  test('a .stack3-disabled the repository shipped is replaced, not trusted', async () => {
    const d = await clone();
    put(d, `${DISABLED_DIR}/.vscode/tasks.json`, 'ATTACKER');
    put(d, `${DISABLED_DIR}/evil.txt`, 'x');
    await neutralize(d);
    expect(readFileSync(join(d, DISABLED_DIR, '.vscode/tasks.json'), 'utf8')).toContain('folderOpen');
    expect(existsSync(join(d, DISABLED_DIR, 'evil.txt'))).toBe(false);
  });
  test.skipIf(process.platform === 'win32')('a .stack3-disabled symlink the repository shipped does not redirect the move', async () => {
    const d = await clone();
    const elsewhere = join(tmp, 'elsewhere');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(d, DISABLED_DIR));
    await neutralize(d);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(lstatSync(join(d, DISABLED_DIR)).isSymbolicLink()).toBe(false);
    expect(existsSync(join(d, DISABLED_DIR, '.vscode/tasks.json'))).toBe(true);
  });
  test('refuses anything that is not a Stack3 quarantine folder', async () => {
    const stranger = join(tmp, 'project');
    mkdirSync(join(stranger, '.vscode'), { recursive: true });
    for (const bad of [stranger, tmp, '/', '', join(tmp, 'stack3-quarantine'), '/home']) {
      await expect(neutralize(bad), bad).rejects.toBeInstanceOf(OutsideQuarantineError);
    }
    expect(existsSync(join(stranger, '.vscode'))).toBe(true);
  });
  test('a quarantine folder that does not exist is refused, not silently ignored', async () => {
    const d = await createQuarantineDir('octo', 'gone');
    const { removeQuarantined } = await import('../../src/quarantine/remove');
    await removeQuarantined(d);
    await expect(neutralize(d)).rejects.toBeInstanceOf(OutsideQuarantineError);
  });
  test('isNeutralized reports whether any auto-run item remains', async () => {
    const d = await clone();
    expect(await isNeutralized(d)).toBe(false);
    await neutralize(d);
    expect(await isNeutralized(d)).toBe(true);
  });
  test('property: only the auto-run items move; every other file is untouched', async () => {
    const names = fc.stringMatching(/^[a-z]{1,6}(\/[a-z]{1,6}){0,2}\.(js|json|txt)$/);
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(names, { maxLength: 8 }), fc.subarray([...AUTO_RUN_ENTRIES]), async (others, entries) => {
        const d = await createQuarantineDir('octo', 'prop');
        const keep = others.filter((n) => !AUTO_RUN_ENTRIES.some((e) => n === e || n.startsWith(`${e}/`)) && !n.split('/').some((seg, i, a) => i < a.length - 1 && a.slice(0, i + 1).join('/') === a.join('/')));
        const written = new Map<string, string>();
        for (const n of keep) {
          try {
            put(d, n, `content:${n}`);
            written.set(n, `content:${n}`);
          } catch {
            // a path that is both file and folder in the random set; skip it
          }
        }
        for (const e of entries) put(d, e === '.devcontainer.json' ? e : `${e}/f.json`, 'auto');
        await neutralize(d);
        for (const [n, c] of written) expect(readFileSync(join(d, n), 'utf8')).toBe(c);
        for (const e of entries) expect(existsSync(join(d, e))).toBe(false);
      }),
      { numRuns: 25 },
    );
  });
});
