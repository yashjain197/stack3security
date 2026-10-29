import type { Result, Stack3Client } from '../api/client';
import { buildVerdict } from '../api/merge';
import { extractIndicators } from '../engine/indicators';
import { ENGINE_VERSION } from '../engine/version';
import type { EngineResult } from '../engine/types';
import { validateRepoUrl } from '../quarantine/paths';
import { scanIdFor, type Registry, type ScanRecord } from '../quarantine/registry';
import { hashScanSet } from '../scan/hash';

export interface CloneAndScanDeps {
  makeDir(owner: string, repo: string): Promise<string>;
  clone(url: string, dest: string): Promise<Result<{ sha: string }>>;
  scan(dir: string): Promise<EngineResult>;
  client: Pick<Stack3Client, 'scanPackage'>;
  registry: Pick<Registry, 'add' | 'get'>;
  removeDir(dir: string): Promise<void>;
  showPanel(rec: ScanRecord): void | Promise<void>;
  showError(message: string): void;
  report?(message: string): void;
  now?(): number;
}

const indicatorsOf = (local: EngineResult, remote: Result<EngineResult['findings']>) => extractIndicators([...local.findings, ...(remote.ok ? remote.value : [])]);

/**
 * The main flow (blueprint 4.1): validate, clone into quarantine, scan in the worker, check packages, merge,
 * hash the scanned set, record, and only then show the result. Nothing from the clone is ever opened or run.
 * Any failure before the verdict is an error message and never a verdict (Review Focus 3).
 */
export async function cloneAndScan(input: string, deps: CloneAndScanDeps): Promise<Result<ScanRecord>> {
  const fail = (reason: string): Result<ScanRecord> => {
    deps.showError(reason);
    return { ok: false, reason };
  };
  const report = (m: string) => deps.report?.(m);

  const target = validateRepoUrl(input);
  if ('error' in target) return fail(target.error);

  let dir: string;
  try {
    dir = await deps.makeDir(target.owner, target.repo);
  } catch (e) {
    return fail((e as Error).message || 'Could not create a quarantine folder.');
  }
  const cleanup = () => deps.removeDir(dir).catch(() => undefined);

  report('Cloning repository…');
  const cloned = await deps.clone(target.url, dir);
  if (!cloned.ok) {
    await cleanup();
    return fail(cloned.reason);
  }
  const { sha } = cloned.value;

  report('Scanning files…');
  const local = await deps.scan(dir);

  report('Checking packages…');
  const remote = await deps.client.scanPackage(local.purls);

  const verdict = buildVerdict(local, remote, { type: 'repo', id: `github.com/${target.owner}/${target.repo}@${sha.slice(0, 7)}` }, indicatorsOf(local, remote));

  let record: ScanRecord;
  try {
    record = {
      scanId: scanIdFor(target.url, sha, ENGINE_VERSION),
      dir,
      url: target.url,
      sha,
      verdict,
      scanSetHash: await hashScanSet(dir),
      createdAt: (deps.now ?? Date.now)(),
    };
    const previous = deps.registry.get(record.scanId);
    await deps.registry.add(record);
    // Same commit scanned again: the older clone is now unreferenced.
    if (previous && previous.dir !== dir) await deps.removeDir(previous.dir).catch(() => undefined);
  } catch {
    await cleanup();
    return fail('Could not save the scan result.');
  }

  try {
    await deps.showPanel(record);
  } catch {
    return fail('The result could not be shown. The scan was saved.');
  }
  return { ok: true, value: record };
}

export type RescanDeps = Pick<CloneAndScanDeps, 'scan' | 'client' | 'registry' | 'showPanel' | 'showError' | 'report' | 'now'>;

/**
 * Scan a clone again after its files changed since the first scan. Same commit, so the same scan id; the new verdict
 * and content hash replace the old record, and the result is shown fresh. Nothing is opened.
 */
export async function rescanRecord(rec: ScanRecord, deps: RescanDeps): Promise<Result<ScanRecord>> {
  const report = (m: string) => deps.report?.(m);
  report('Scanning files…');
  const local = await deps.scan(rec.dir);
  report('Checking packages…');
  const remote = await deps.client.scanPackage(local.purls);
  const verdict = buildVerdict(local, remote, rec.verdict.target, indicatorsOf(local, remote));
  let next: ScanRecord;
  try {
    next = { ...rec, verdict, scanSetHash: await hashScanSet(rec.dir), createdAt: (deps.now ?? Date.now)() };
    await deps.registry.add(next);
  } catch {
    deps.showError('Could not save the new scan result.');
    return { ok: false, reason: 'Could not save the new scan result.' };
  }
  try {
    await deps.showPanel(next);
  } catch {
    deps.showError('The result could not be shown. The scan was saved.');
    return { ok: false, reason: 'The result could not be shown. The scan was saved.' };
  }
  return { ok: true, value: next };
}
