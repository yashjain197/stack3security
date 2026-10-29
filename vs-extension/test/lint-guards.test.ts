import { describe, expect, test } from 'vitest';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd });

async function errors(code: string, filePath: string): Promise<string[]> {
  const [r] = await eslint.lintText(code, { filePath });
  return (r?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? m.message);
}

describe('lint guards', () => {
  test('engine importing fs fails lint', async () => {
    expect(await errors(`import * as fs from 'node:fs'; export const x = fs;`, 'src/engine/x.ts')).toContain('no-restricted-imports');
  });
  test('engine importing vscode fails lint', async () => {
    expect(await errors(`import * as v from 'vscode'; export const x = v;`, 'src/engine/x.ts')).toContain('no-restricted-imports');
  });
  test('child_process outside quarantine/git.ts fails lint', async () => {
    expect(await errors(`import { execFile } from 'node:child_process'; export const x = execFile;`, 'src/ui/x.ts')).toContain('no-restricted-imports');
  });
  test('child_process inside quarantine/git.ts is allowed', async () => {
    expect(await errors(`import { execFile } from 'node:child_process'; export const x = execFile;`, 'src/quarantine/git.ts')).toEqual([]);
  });
  test('innerHTML assignment fails lint', async () => {
    expect(await errors(`export function f(el: HTMLElement, s: string) { el.innerHTML = s; }`, 'webview/x.ts')).toContain('no-restricted-syntax');
  });
  test('eval and new Function fail lint', async () => {
    expect(await errors(`export const a = eval('1');`, 'src/x.ts')).toContain('no-restricted-syntax');
    expect(await errors(`export const b = new Function('return 1');`, 'src/x.ts')).toContain('no-restricted-syntax');
  });
  test('non-literal require fails lint', async () => {
    expect(await errors(`export const m = (p: string) => require(p);`, 'src/x.ts')).toContain('no-restricted-syntax');
  });
});
