import type { Finding, VirtualFile } from './types';
import { analyzeLockfiles, dirOf, inNodeModules, isExactVersion, MAX_PURLS, purlOf, UNRESOLVED, versionFromSpec } from './lockfiles';
import { parseJsonc } from './parsers/jsonc';
import { classifySpec } from './parsers/lockfiles/types';

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const NPM_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,213}$/;

export interface PurlSet {
  purls: string[];
  notChecked: string[];
  /** First file that named each package URL, so a Socket finding can point at that folder. */
  locations: Record<string, string>;
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

function isNpmName(name: string): boolean {
  if (name.length < 1 || name.length > 214) return false;
  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    if (slash < 2 || slash !== name.lastIndexOf('/')) return false;
    return NPM_PART.test(name.slice(1, slash)) && NPM_PART.test(name.slice(slash + 1));
  }
  return NPM_PART.test(name) && !name.includes('/');
}

function manifestOf(text: string): Record<string, unknown> | undefined {
  const { value, errors } = parseJsonc(text);
  if (errors > 0 || typeof value !== 'object' || value === null) return undefined;
  return value as Record<string, unknown>;
}

function eachDep(manifest: Record<string, unknown>, fn: (name: string, spec: string) => void): void {
  for (const key of SECTIONS) {
    const section = manifest[key];
    if (typeof section !== 'object' || section === null) continue;
    for (const [name, spec] of Object.entries(section as Record<string, unknown>)) {
      if (typeof spec === 'string' && name) fn(name, spec.trim());
    }
  }
}

/** A registry spec Socket cannot look up without a resolved version (a range, tag, or `latest`). */
function isUnresolvedRegistrySpec(spec: string): boolean {
  if (isExactVersion(spec) || classifySpec(spec) !== undefined) return false;
  return spec.length > 0;
}

export function labelFromPurl(purl: string): string {
  const body = purl.startsWith('pkg:npm/') ? purl.slice('pkg:npm/'.length) : purl;
  const at = body.lastIndexOf('@');
  try {
    if (at <= 0) return decodeURIComponent(body);
    return `${decodeURIComponent(body.slice(0, at))}@${decodeURIComponent(body.slice(at + 1))}`;
  } catch {
    return body;
  }
}

export function mentionsPackage(text: string, purl: string, label: string): boolean {
  if (text.includes(purl)) return true;
  return text.includes(`flagged ${label}:`) || text.includes(`on ${label}`);
}

/**
 * Lockfiles plus every exact-version identity in the walked tree. Nested manifests and committed node_modules are
 * included; the app's own package name is not (unpublished names come back as not found).
 */
export function collectPurls(files: VirtualFile[]): PurlSet {
  const analysis = analyzeLockfiles(files);
  const notChecked = new Set(analysis.notChecked);
  const locations: Record<string, string> = {};
  const found = new Set<string>();

  const remember = (purl: string, file: string): void => {
    if (!found.has(purl)) locations[purl] = file;
    found.add(purl);
  };

  for (const lf of analysis.lockfiles) {
    for (const e of lf.entries) {
      if ((e.source === 'registry' || e.source === 'http') && isExactVersion(e.version)) remember(purlOf(e.name, e.version), lf.path);
    }
  }

  const lockDirs = new Set(analysis.lockfiles.map((lf) => dirOf(lf.path)));
  const covered = (dir: string): boolean => {
    for (let d = dir; ; d = dirOf(d)) {
      if (lockDirs.has(d)) return true;
      if (d === '') return false;
    }
  };

  for (const f of files) {
    if (baseName(f.path) !== 'package.json' || f.text === undefined) continue;
    const manifest = manifestOf(f.text);
    if (!manifest) continue;

    if (inNodeModules(f.path)) {
      const name = manifest.name;
      const version = manifest.version;
      if (typeof name === 'string' && typeof version === 'string' && isNpmName(name) && isExactVersion(version)) {
        remember(purlOf(name, version), f.path);
      }
    }

    let unresolved = false;
    eachDep(manifest, (name, spec) => {
      if (!isNpmName(name)) return;
      const version = versionFromSpec(spec);
      if (version) remember(purlOf(name, version), f.path);
      else if (isUnresolvedRegistrySpec(spec)) unresolved = true;
    });
    if (unresolved && !inNodeModules(f.path) && !covered(dirOf(f.path))) notChecked.add(UNRESOLVED);
  }

  let list = [...found].sort();
  if (list.length > MAX_PURLS) {
    list = list.slice(0, MAX_PURLS);
    const keep = new Set(list);
    for (const p of Object.keys(locations)) if (!keep.has(p)) delete locations[p];
    notChecked.add(`More than ${MAX_PURLS} packages; only the first ${MAX_PURLS} were checked`);
  }
  return { purls: list, notChecked: [...notChecked], locations };
}

/** Point Socket findings at the file that named the package. Findings that already have a location are left alone. */
export function locatePackageFindings(findings: Finding[], locations: Record<string, string>): Finding[] {
  const named = Object.entries(locations)
    .map(([purl, file]) => ({ purl, file, label: labelFromPurl(purl) }))
    .sort((a, b) => b.label.length - a.label.length);
  if (named.length === 0) return findings;
  return findings.map((f) => {
    if (f.location || f.source !== 'socket') return f;
    const text = `${f.title} ${f.evidence}`;
    const hit = named.find((n) => mentionsPackage(text, n.purl, n.label));
    return hit ? { ...f, location: { file: hit.file } } : f;
  });
}
