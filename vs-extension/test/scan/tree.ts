import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const CANARY = 'STACK3-CANARY-7f3a9c';

/** Creates a temp dir holding `root/` and a canary file outside it. */
export function sandbox(): { base: string; root: string; canary: string } {
  const base = mkdtempSync(join(tmpdir(), 'stack3-walk-'));
  const root = join(base, 'root');
  mkdirSync(root);
  const canary = join(base, 'secret.txt');
  writeFileSync(canary, CANARY);
  return { base, root, canary };
}

export function put(root: string, rel: string, content: string | Buffer): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

export function link(root: string, rel: string, target: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  symlinkSync(target, p);
}
