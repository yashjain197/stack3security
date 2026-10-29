import { fileURLToPath } from 'node:url';
import { DEFAULT_LIMITS } from '../../src/config/settings';
import type { ScanContext, VirtualFile } from '../../src/engine/types';
import { walk } from '../../src/scan/walker';

export const ctx: ScanContext = { mode: 'clone', checkedAt: '2026-10-29T18:00:00+05:30' };

export async function loadRepo(name: string): Promise<VirtualFile[]> {
  const root = fileURLToPath(new URL(`../fixtures/repos/${name}`, import.meta.url));
  return (await walk(root, DEFAULT_LIMITS, { includeGitConfig: false, nodeModules: 'committed' })).files;
}

export function vf(path: string, text: string): VirtualFile {
  return { path, text, binary: false, size: text.length, truncated: false };
}
