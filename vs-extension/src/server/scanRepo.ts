import { constants, promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Result } from '../api/client';
import { buildVerdict } from '../api/merge';
import { extractIndicators } from '../engine/indicators';
import type { EngineResult, Finding } from '../engine/types';
import { validateRepoUrl } from '../quarantine/paths';
import { buildGraphReport, type GraphReport, type PackageRef } from '../report/graphReport';
import { safeRelPath } from '../ui/paths';
import { BusyError, type Limiter } from './limiter';
import { toWireVerdict, type WireVerdict } from './wire';

/** The package check's answer. `notChecked` carries what it could not check even though it answered. */
export type PackageScan = Result<Finding[]> & { notChecked?: string[] };

export interface ScanRepoDeps {
  makeDir(owner: string, repo: string): Promise<string>;
  clone(url: string, dest: string): Promise<Result<{ sha: string }>>;
  removeDir(dir: string): Promise<void>;
  scan(dir: string): Promise<EngineResult>;
  scanPackages(purls: string[]): Promise<PackageScan>;
  /** Best effort: a failure here never fails a scan. */
  report(r: GraphReport): Promise<unknown>;
  limiter: Limiter;
  now(): number;
}

export type ScanFailureCode = 'invalid_repo_url' | 'invalid_ref' | 'clone_failed' | 'busy' | 'scan_timeout' | 'internal_error';
export type ScanOutcome = { ok: true; verdict: WireVerdict } | { ok: false; code: ScanFailureCode; message: string };

const REF = /^[0-9a-f]{7,40}$/i;
const fail = (code: ScanFailureCode, message: string): ScanOutcome => ({ ok: false, code, message });

/** The nearest package.json at or above each flagged file, read as data from the clone (small, no symlinks). */
async function loadManifests(dir: string, findings: Finding[]): Promise<(file: string) => PackageRef | undefined> {
  const found = new Map<string, { name: string; version: string } | null>();
  const read = async (rel: string) => {
    if (found.has(rel)) return found.get(rel) ?? undefined;
    let out: { name: string; version: string } | null = null;
    try {
      const abs = path.join(dir, rel, 'package.json');
      const st = await fs.lstat(abs);
      if (st.isFile() && !st.isSymbolicLink() && st.size <= 256 * 1024) {
        const fh = await fs.open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const j = JSON.parse(await fh.readFile('utf8')) as { name?: unknown; version?: unknown };
          if (typeof j.name === 'string' && typeof j.version === 'string') out = { name: j.name, version: j.version };
        } finally {
          await fh.close();
        }
      }
    } catch {
      // no usable manifest here
    }
    found.set(rel, out);
    return out ?? undefined;
  };
  const dirsOf = (file: string): string[] => {
    const rel = safeRelPath(file);
    if (!rel) return [];
    const parts = path.posix.dirname(rel) === '.' ? [] : path.posix.dirname(rel).split('/');
    return parts.map((_, i) => parts.slice(0, parts.length - i).join('/')).concat('');
  };
  const wanted = new Set(findings.filter((f) => f.severity === 'critical' && f.location).flatMap((f) => dirsOf(f.location!.file)));
  for (const d of wanted) await read(d);
  return (file) => {
    for (const d of dirsOf(file)) {
      const m = found.get(d);
      if (m) return { ...m, root: d === '' };
    }
    return undefined;
  };
}

export interface ScannerOptions {
  cacheTtlMs: number;
  maxCache: number;
}

/**
 * Scan a public GitHub repository: clone it into quarantine with the hardened clone, scan it in the worker, check its
 * packages, and answer in the API's verdict shape. The clone is always removed. Identical requests share one scan, and a
 * finished scan is kept briefly so a page that is hit repeatedly does not clone repeatedly. A critical finding that names
 * a package and a wallet is reported to the graph, once, in the background.
 */
export function createRepoScanner(deps: ScanRepoDeps, opts: ScannerOptions): { scan(input: { repoUrl: string; ref?: string }): Promise<ScanOutcome> } {
  const cache = new Map<string, { at: number; verdict: WireVerdict }>();
  const inFlight = new Map<string, Promise<ScanOutcome>>();

  async function doScan(owner: string, repo: string, url: string, ref: string | undefined): Promise<ScanOutcome> {
    try {
      return await deps.limiter.run(async (): Promise<ScanOutcome> => {
        const dir = await deps.makeDir(owner, repo);
        try {
          const cloned = await deps.clone(url, dir);
          if (!cloned.ok) return fail('clone_failed', cloned.reason);
          const { sha } = cloned.value;

          const local = await deps.scan(dir);
          const remote: PackageScan = local.purls.length > 0 ? await deps.scanPackages(local.purls) : { ok: true, value: [] };
          const mismatch = ref !== undefined && !sha.startsWith(ref.toLowerCase());
          const notChecked = [...local.notChecked, ...(remote.ok ? remote.notChecked ?? [] : [])];
          if (mismatch) notChecked.push(`Commit ${ref.toLowerCase()} was not scanned; the default branch tip ${sha.slice(0, 7)} was.`);
          const merged = { ...local, notChecked };
          const all = [...local.findings, ...(remote.ok ? remote.value : [])];
          const verdict = buildVerdict(merged, remote, { type: 'repo', id: `github.com/${owner}/${repo}@${sha.slice(0, 7)}` }, extractIndicators(all));

          const packageFor = await loadManifests(dir, all);
          const report = buildGraphReport({ owner, repo, findings: all, packageFor });
          if (report) void Promise.resolve(deps.report(report)).catch(() => undefined);

          return { ok: true, verdict: toWireVerdict(verdict, { owner, repo }) };
        } finally {
          await deps.removeDir(dir).catch(() => undefined);
        }
      });
    } catch (e) {
      if (e instanceof BusyError) return fail('busy', 'The scanner is busy. Try again shortly.');
      return fail('internal_error', 'The scan failed.');
    }
  }

  return {
    async scan(input) {
      const target = validateRepoUrl(input.repoUrl);
      if ('error' in target) return fail('invalid_repo_url', target.error);
      if (input.ref !== undefined && !REF.test(input.ref)) return fail('invalid_ref', 'ref must be a commit id of 7 to 40 hexadecimal characters.');

      const key = `${target.owner}/${target.repo}@${input.ref ?? ''}`.toLowerCase();
      const hit = cache.get(key);
      if (hit && deps.now() - hit.at < opts.cacheTtlMs) return { ok: true, verdict: hit.verdict };
      const running = inFlight.get(key);
      if (running) return running;

      const p = doScan(target.owner, target.repo, target.url, input.ref).then((r) => {
        if (r.ok) {
          cache.delete(key);
          cache.set(key, { at: deps.now(), verdict: r.verdict });
          while (cache.size > opts.maxCache) cache.delete(cache.keys().next().value as string);
        }
        return r;
      }).finally(() => inFlight.delete(key));
      inFlight.set(key, p);
      return p;
    },
  };
}
