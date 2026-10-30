import * as path from 'node:path';

// The user's own list of paths to leave out of the guard scan of one folder (the stack3.scan.exclude setting).
// Plain path prefixes, no wildcards and no regular expressions: nothing here can be made slow or surprising by its input.

export const EXCLUDED_NOTE = 'Some paths are excluded by your stack3.scan.exclude setting';

const MAX_PATTERN = 200;
export const MAX_PATTERNS_PER_FOLDER = 50;
export const MAX_FOLDERS = 50;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/** A pattern as a relative POSIX path (`test/fixtures/**` → `test/fixtures`), or undefined when it cannot be used. */
export function normalizeExclude(pattern: unknown): string | undefined {
  if (typeof pattern !== 'string') return undefined;
  let p = pattern.trim().replace(/\\/g, '/');
  if (p.length > MAX_PATTERN || CONTROL.test(p)) return undefined;
  for (const tail of ['/**', '/*', '/']) {
    if (p.endsWith(tail)) {
      p = p.slice(0, -tail.length);
      break;
    }
  }
  while (p.startsWith('./')) p = p.slice(2);
  if (p === '' || p.startsWith('/')) return undefined;
  const parts = p.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..' || s.includes('*') || s.includes('?'))) return undefined;
  return parts.join('/');
}

/** True when `rel` is one of the paths, or inside one. `dist` covers `dist/a.js` but not `dist2/a.js` or `src/dist/a.js`. */
export function isExcluded(rel: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => rel === p || rel.startsWith(`${p}/`));
}

/** The patterns the user set for exactly this folder. A subfolder, a parent or a lookalike name gets none. */
export function excludesFor(map: Readonly<Record<string, readonly string[]>>, root: string): string[] {
  const here = path.resolve(root);
  for (const [folder, patterns] of Object.entries(map)) {
    if (path.resolve(folder) !== here) continue;
    return [...new Set(patterns.map(normalizeExclude).filter((p): p is string => p !== undefined))];
  }
  return [];
}
