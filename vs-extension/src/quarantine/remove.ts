import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { isInside } from '../scan/paths';
import { QUARANTINE_DIR_NAME, quarantineRoot } from './paths';

export class OutsideQuarantineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutsideQuarantineError';
  }
}

const refuse = (dir: string): never => {
  throw new OutsideQuarantineError(`Refusing to delete a folder that is not a Stack3 quarantine folder: ${dir.slice(0, 200)}`);
};

/**
 * The real path of `dir` if it is one of our quarantine directories, else throws OutsideQuarantineError. It must be a
 * direct child of the quarantine root with a name this extension generated, must not be a symlink, and must resolve to
 * the same place. Returns undefined when it does not exist (already gone).
 */
export async function resolveQuarantineDir(dir: string): Promise<string | undefined> {
  if (typeof dir !== 'string' || dir === '') return refuse(String(dir));
  const root = path.resolve(quarantineRoot());
  const abs = path.resolve(dir);
  if (!isInside(root, abs) || path.dirname(abs) !== root || !QUARANTINE_DIR_NAME.test(path.basename(abs))) return refuse(dir);

  let st;
  try {
    st = await fs.lstat(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return refuse(dir);

  const real = await fs.realpath(abs);
  if (real !== path.join(await fs.realpath(root), path.basename(abs))) return refuse(dir);
  return real;
}

/**
 * Delete one quarantine directory and nothing else (see resolveQuarantineDir). A deleted tree's own symlinks are
 * removed, never followed (fs.rm does not follow them).
 */
export async function removeQuarantined(dir: string): Promise<void> {
  const real = await resolveQuarantineDir(dir);
  if (real === undefined) return; // already gone
  await fs.rm(real, { recursive: true, force: true, maxRetries: 3 });
}

/** Remove quarantine directories not modified for `days` days (run on activation), except those in `keep`. Returns what it removed. */
export async function sweepQuarantine(days: number, now: number = Date.now(), keep: ReadonlySet<string> = new Set()): Promise<string[]> {
  const root = quarantineRoot();
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const removed: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory() || !QUARANTINE_DIR_NAME.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    if (keep.has(dir)) continue; // a clone the user opened is theirs now
    try {
      if (now - (await fs.lstat(dir)).mtimeMs > days * 86_400_000) {
        await removeQuarantined(dir);
        removed.push(dir);
      }
    } catch {
      // leave it; the next sweep tries again
    }
  }
  return removed;
}
