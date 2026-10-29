import { constants, promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ScanLimits } from '../config/settings';
import type { Finding, VirtualFile } from '../engine/types';
import { isInside } from './paths';

export interface WalkOptions {
  /** Read `.git/config` and non-sample hooks (Flow 2). Otherwise `.git/` is skipped. */
  includeGitConfig: boolean;
  /** `committed`: a cloned repo shipped node_modules, read only its package.json files. `skip`: installed deps, ignore. */
  nodeModules: 'committed' | 'skip';
}

export interface WalkResult {
  files: VirtualFile[];
  notChecked: string[];
  findings: Finding[];
}

const BINARY_PROBE = 8192;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

function decode(buf: Buffer): { text?: string; binary: boolean } {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), binary: false };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), binary: false };
  if (buf.subarray(0, BINARY_PROBE).includes(0)) return { binary: true };
  const start = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  return { text: new TextDecoder('utf-8').decode(buf.subarray(start)), binary: false };
}

async function readCapped(abs: string, max: number): Promise<Buffer> {
  const fh = await fs.open(abs, constants.O_RDONLY | NOFOLLOW);
  try {
    const buf = Buffer.alloc(max);
    let off = 0;
    while (off < max) {
      const { bytesRead } = await fh.read(buf, off, max - off, off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    return buf.subarray(0, off);
  } finally {
    await fh.close();
  }
}

/** Breadth-first, symlink-free, bounded read of a tree (I-8, I-13). Never throws for unreadable entries. */
export async function walk(root: string, limits: ScanLimits, opts: WalkOptions): Promise<WalkResult> {
  const realRoot = await fs.realpath(root);
  const files: VirtualFile[] = [];
  const notChecked = new Set<string>();
  const findings: Finding[] = [];
  let totalBytes = 0;
  let stopped = false;
  const queue: { abs: string; rel: string; depth: number; within?: 'git' | 'node_modules' }[] = [{ abs: realRoot, rel: '', depth: 0 }];

  const take = async (abs: string, rel: string, size: number): Promise<void> => {
    if (files.length >= limits.maxFiles) {
      notChecked.add('Stopped at the file limit; some files were not checked');
      stopped = true;
      return;
    }
    const want = Math.min(size, limits.maxFileBytes);
    if (totalBytes + want > limits.maxTotalBytes) {
      notChecked.add('Stopped at the size limit; some files were not checked');
      stopped = true;
      return;
    }
    let buf: Buffer;
    try {
      buf = await readCapped(abs, want);
    } catch {
      notChecked.add('Some files could not be read');
      return;
    }
    totalBytes += buf.length;
    files.push({ path: rel, ...decode(buf), size, truncated: size > limits.maxFileBytes });
  };

  while (queue.length > 0 && !stopped) {
    const dir = queue.shift()!;
    let real: string;
    try {
      real = await fs.realpath(dir.abs);
    } catch {
      continue;
    }
    if (real !== realRoot && !isInside(realRoot, real)) continue;
    let names: string[];
    try {
      names = (await fs.readdir(real)).sort();
    } catch {
      notChecked.add('Some folders could not be read');
      continue;
    }
    for (const name of names) {
      if (stopped) break;
      const abs = path.join(real, name);
      const rel = dir.rel ? `${dir.rel}/${name}` : name;
      let st;
      try {
        st = await fs.lstat(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (dir.depth + 1 > limits.maxDepth) {
          notChecked.add('Stopped at the folder depth limit; some files were not checked');
          continue;
        }
        if (dir.within === 'git') {
          if (rel === '.git/hooks') queue.push({ abs, rel, depth: dir.depth + 1, within: 'git' });
          continue;
        }
        if (name === '.git' && dir.depth === 0) {
          if (opts.includeGitConfig) queue.push({ abs, rel, depth: 1, within: 'git' });
          continue;
        }
        if (name === 'node_modules' && dir.within !== 'node_modules') {
          if (opts.nodeModules === 'skip') continue;
          if (!findings.some((f) => f.ruleId === 'walker.committed-node-modules')) {
            findings.push({
              ruleId: 'walker.committed-node-modules',
              layer: 'repo-file',
              severity: 'caution',
              title: 'The repo ships its own node_modules folder',
              evidence: rel,
              location: { file: rel },
              source: 'rules',
              checkedAt: '',
            });
          }
          queue.push({ abs, rel, depth: dir.depth + 1, within: 'node_modules' });
          continue;
        }
        queue.push({ abs, rel, depth: dir.depth + 1, within: dir.within });
        continue;
      }
      if (!st.isFile()) continue;
      if (dir.within === 'git') {
        const keep = rel === '.git/config' || (rel.startsWith('.git/hooks/') && !name.endsWith('.sample'));
        if (keep) await take(abs, rel, st.size);
        continue;
      }
      if (dir.within === 'node_modules' && name !== 'package.json') continue;
      await take(abs, rel, st.size);
    }
  }
  return { files, notChecked: [...notChecked], findings };
}
