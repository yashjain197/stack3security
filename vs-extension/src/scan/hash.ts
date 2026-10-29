import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import * as path from 'node:path';

const MAX_HASHED_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 200_000;
const MAX_DEPTH = 32;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

// The auto-run surface: what the rules read to decide a folder is dangerous to open, and what `open` must not let change.
const BY_NAME = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs', '.devcontainer.json',
]);
const BY_DIR = /(?:^|\/)(?:\.vscode|\.devcontainer)\//;

function selected(rel: string, withinNodeModules: boolean): boolean {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  if (withinNodeModules) return name === 'package.json';
  return BY_NAME.has(name) || name.endsWith('.code-workspace') || BY_DIR.test(rel);
}

async function readCapped(abs: string): Promise<Buffer | 'link'> {
  let fh;
  try {
    fh = await fs.open(abs, constants.O_RDONLY | NOFOLLOW);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') return 'link';
    throw e;
  }
  try {
    const buf = Buffer.alloc(MAX_HASHED_BYTES);
    let off = 0;
    while (off < buf.length) {
      const { bytesRead } = await fh.read(buf, off, buf.length - off, off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    return buf.subarray(0, off);
  } finally {
    await fh.close();
  }
}

/**
 * sha256 over the sorted paths, sizes and bytes of the files that decide whether a folder auto-runs code. It lets
 * "open" detect that the clone changed after it was scanned. Symlinks are never followed, and `.git` is skipped.
 */
export async function hashScanSet(dir: string): Promise<string> {
  const root = await fs.realpath(dir);
  const picked: { rel: string; abs: string; size: number }[] = [];
  let seen = 0;
  let capped = false;

  const stack: { abs: string; rel: string; depth: number; nm: boolean }[] = [{ abs: root, rel: '', depth: 0, nm: false }];
  while (stack.length) {
    const d = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(d.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (++seen > MAX_ENTRIES) {
        capped = true;
        break;
      }
      const rel = d.rel ? `${d.rel}/${e.name}` : e.name;
      const abs = path.join(d.abs, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (d.depth === 0 && e.name === '.git') continue;
        if (d.depth + 1 > MAX_DEPTH) {
          capped = true;
          continue;
        }
        stack.push({ abs, rel, depth: d.depth + 1, nm: d.nm || e.name === 'node_modules' });
      } else if (e.isFile() && selected(rel, d.nm)) {
        picked.push({ rel, abs, size: (await fs.lstat(abs)).size });
      }
    }
    if (capped && seen > MAX_ENTRIES) break;
  }

  picked.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const h = createHash('sha256');
  for (const f of picked) {
    let body: Buffer | 'link' | 'gone';
    try {
      body = await readCapped(f.abs);
    } catch {
      body = 'gone';
    }
    // Length-prefixed fields, so a path and its content can never be shifted against each other.
    h.update(`${f.rel.length}:${f.rel}\0${f.size}\0`);
    if (typeof body === 'string') h.update(`#${body}`);
    else h.update(body);
    h.update('\n');
  }
  h.update(`files:${picked.length}${capped ? ':capped' : ''}`);
  return h.digest('hex');
}
