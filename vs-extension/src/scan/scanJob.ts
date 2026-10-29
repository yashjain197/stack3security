import type { ScanLimits } from '../config/settings';
import { engineScan, RULES } from '../engine';
import type { EngineResult, Rule, ScanContext } from '../engine/types';
import { walk, type WalkOptions } from './walker';

export interface ScanJob {
  root: string;
  ctx: ScanContext;
  limits: ScanLimits;
}

const WALK_OPTIONS: Record<ScanContext['mode'], WalkOptions> = {
  clone: { includeGitConfig: false, nodeModules: 'committed' },
  workspace: { includeGitConfig: false, nodeModules: 'skip' },
  quick: { includeGitConfig: true, nodeModules: 'skip' },
};

/** Walk + engine. Runs inside the worker; exported for tests. */
export async function scanJob(job: ScanJob, rules: Rule[] = RULES): Promise<EngineResult> {
  const walked = await walk(job.root, job.limits, WALK_OPTIONS[job.ctx.mode]);
  const result = engineScan(walked.files, job.ctx, rules);
  return {
    findings: [...walked.findings.map((f) => ({ ...f, checkedAt: job.ctx.checkedAt })), ...result.findings],
    notChecked: [...new Set([...walked.notChecked, ...result.notChecked])],
    purls: result.purls,
  };
}
