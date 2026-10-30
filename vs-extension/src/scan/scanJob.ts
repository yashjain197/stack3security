import type { ScanLimits } from '../config/settings';
import { engineScan, QUICK_RULES, RULES } from '../engine';
import type { EngineResult, Rule, ScanContext } from '../engine/types';
import { walk, type WalkOptions } from './walker';

export interface ScanJob {
  root: string;
  ctx: ScanContext;
  limits: ScanLimits;
  /** Paths the user left out of a guard scan of this folder. Never applied to a clone: a hostile repo must not hide behind it. */
  exclude?: string[];
}

const WALK_OPTIONS: Record<ScanContext['mode'], WalkOptions> = {
  clone: { includeGitConfig: false, nodeModules: 'committed' },
  workspace: { includeGitConfig: false, nodeModules: 'skip' },
  quick: { includeGitConfig: true, nodeModules: 'skip' },
};

/** Walk + engine. Runs inside the worker; exported for tests. */
export async function scanJob(job: ScanJob, rules: Rule[] = job.ctx.mode === 'quick' ? QUICK_RULES : RULES): Promise<EngineResult> {
  const exclude = job.ctx.mode === 'clone' ? [] : (job.exclude ?? []);
  const walked = await walk(job.root, job.limits, { ...WALK_OPTIONS[job.ctx.mode], exclude });
  const result = engineScan(walked.files, job.ctx, rules);
  return {
    findings: [...walked.findings.map((f) => ({ ...f, checkedAt: job.ctx.checkedAt })), ...result.findings],
    notChecked: [...new Set([...walked.notChecked, ...result.notChecked])],
    purls: result.purls,
    purlLocations: result.purlLocations,
  };
}
