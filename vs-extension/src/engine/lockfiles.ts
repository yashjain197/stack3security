import { parseBun } from './parsers/lockfiles/bun';
import { parseNpm } from './parsers/lockfiles/npm';
import { parsePnpm } from './parsers/lockfiles/pnpm';
import { classifySpec, type LockEntry } from './parsers/lockfiles/types';
import { parseYarn1 } from './parsers/lockfiles/yarn1';
import { parseYarnBerry } from './parsers/lockfiles/yarnBerry';
import type { VirtualFile } from './types';

export const UNRESOLVED = 'Exact package versions unresolved';
export const MAX_PURLS = 5000;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const inNodeModules = (p: string): boolean => p.startsWith('node_modules/') || p.includes('/node_modules/');
export const isExactVersion = (spec: string): boolean => SEMVER.test(spec);

/** Floor version from a range (`^4.18.2` → `4.18.2`). Tags, `latest`, `*` and git/file specs stay unresolved. */
export function versionFromSpec(spec: string): string | undefined {
  const s = spec.trim();
  if (isExactVersion(s)) return s;
  if (classifySpec(s) !== undefined) return undefined;
  const rest = s.replace(/^(?:>=|<=|\^|~|=|v|>|<)\s*/i, '').trim();
  if (!rest || /[xX*]|\s|\|\|/.test(rest)) return undefined;
  return isExactVersion(rest) ? rest : undefined;
}

export interface ParsedLockfile {
  path: string;
  entries: LockEntry[];
}

export interface LockAnalysis {
  lockfiles: ParsedLockfile[];
  purls: string[];
  notChecked: string[];
}

const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

function parserFor(file: VirtualFile): ((text: string) => LockEntry[]) | undefined {
  switch (baseName(file.path)) {
    case 'package-lock.json':
    case 'npm-shrinkwrap.json':
      return parseNpm;
    case 'yarn.lock':
      return (t) => (/^__metadata:/m.test(t) ? parseYarnBerry(t) : parseYarn1(t));
    case 'pnpm-lock.yaml':
      return parsePnpm;
    case 'bun.lock':
      return parseBun;
    default:
      return undefined;
  }
}

/** Purl-safe form of `pkg:npm/%40scope/name@1.2.3`: each segment encoded, the scope slash kept. */
export function purlOf(name: string, version: string): string {
  return `pkg:npm/${name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(version)}`;
}

const cache = new WeakMap<VirtualFile[], LockAnalysis>();

/** Parse every lockfile once per scan; the purl collector and the dependency rules share the result. */
export function analyzeLockfiles(files: VirtualFile[]): LockAnalysis {
  const hit = cache.get(files);
  if (hit) return hit;

  const notChecked = new Set<string>();
  const lockfiles: ParsedLockfile[] = [];
  const lockDirs = new Set<string>();

  for (const f of files) {
    if (inNodeModules(f.path) || f.text === undefined) continue;
    const parse = parserFor(f);
    if (!parse) continue;
    lockDirs.add(dirOf(f.path));
    if (f.truncated) notChecked.add(`${f.path} is larger than the scan limit; later packages were not checked`);
    try {
      lockfiles.push({ path: f.path, entries: parse(f.text) });
    } catch {
      if (!f.truncated) notChecked.add(`Could not read ${f.path}`);
    }
  }

  // A workspace shares a root lockfile. bun.lockb is binary and is not read: it covers nothing.
  const covered = (dir: string): boolean => {
    for (let d = dir; ; d = dirOf(d)) {
      if (lockDirs.has(d)) return true;
      if (d === '') return false;
    }
  };
  for (const f of files) {
    if (inNodeModules(f.path)) continue;
    if (baseName(f.path) === 'bun.lockb' && !covered(dirOf(f.path))) notChecked.add(UNRESOLVED);
  }

  const purls = new Set<string>();
  for (const lf of lockfiles) {
    for (const e of lf.entries) {
      // file:, link:, workspace and git packages are unknown to a registry scanner; their folders are scanned directly.
      if ((e.source === 'registry' || e.source === 'http') && isExactVersion(e.version)) purls.add(purlOf(e.name, e.version));
    }
  }
  let list = [...purls].sort();
  if (list.length > MAX_PURLS) {
    list = list.slice(0, MAX_PURLS);
    notChecked.add(`More than ${MAX_PURLS} packages; only the first ${MAX_PURLS} were checked`);
  }

  const result = { lockfiles, purls: list, notChecked: [...notChecked] };
  cache.set(files, result);
  return result;
}
