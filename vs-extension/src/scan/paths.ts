import * as path from 'node:path';

function norm(p: string, platform: NodeJS.Platform): string {
  const lib = platform === 'win32' ? path.win32 : path.posix;
  let n = lib.normalize(p);
  if (n.length > 1 && n.endsWith(lib.sep) && !/^[A-Za-z]:\\$/.test(n)) n = n.slice(0, -1);
  return platform === 'win32' ? n.toLowerCase() : n;
}

/** True when `p` is strictly below `root`. Callers pass realpaths; this function does no I/O. */
export function isInside(root: string, p: string, platform: NodeJS.Platform = process.platform): boolean {
  const sep = platform === 'win32' ? '\\' : '/';
  const r = norm(root, platform);
  const c = norm(p, platform);
  return c.startsWith(r.endsWith(sep) ? r : r + sep) && c !== r;
}
