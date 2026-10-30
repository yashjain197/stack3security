import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ScanLimits } from '../config/settings';
import type { EngineResult, ScanContext } from '../engine/types';

export interface WorkerLike {
  postMessage(msg: unknown): void;
  terminate(): Promise<number>;
  on(event: 'message', fn: (msg: unknown) => void): unknown;
  on(event: 'error' | 'exit', fn: (arg: unknown) => void): unknown;
}

export interface SchedulerDeps {
  createWorker?: () => WorkerLike;
}

const inFlight = new Map<string, Promise<EngineResult>>();

const failed = (reason: string): EngineResult => ({ findings: [], purls: [], notChecked: [reason] });

function defaultWorker(): WorkerLike {
  // dist/extension.js and dist/worker.js sit side by side.
  return new Worker(path.join(__dirname, 'worker.js'), { resourceLimits: { maxOldGenerationSizeMb: 256 } });
}

function isEngineResult(v: unknown): v is EngineResult {
  const r = v as EngineResult;
  return !!r && Array.isArray(r.findings) && Array.isArray(r.notChecked) && Array.isArray(r.purls);
}

function runOnce(root: string, ctx: ScanContext, limits: ScanLimits, deps: SchedulerDeps, exclude: string[]): Promise<EngineResult> {
  return new Promise((resolve) => {
    let worker: WorkerLike;
    try {
      worker = (deps.createWorker ?? defaultWorker)();
    } catch {
      resolve(failed('Scan failed'));
      return;
    }
    let done = false;
    const finish = (r: EngineResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => finish(failed('Scan timed out')), limits.timeoutMs);
    worker.on('message', (msg) => {
      const m = msg as { ok?: boolean; result?: unknown };
      finish(m?.ok === true && isEngineResult(m.result) ? m.result : failed('Scan failed'));
    });
    worker.on('error', () => finish(failed('Scan failed')));
    worker.on('exit', () => finish(failed('Scan failed')));
    worker.postMessage({ root, ctx, limits, exclude });
  });
}

/** Scan `root` in an isolated, killable worker (I-13). Concurrent calls for the same root, mode and exclusions share one run. */
export function runScan(root: string, ctx: ScanContext, limits: ScanLimits, deps: SchedulerDeps = {}, exclude: string[] = []): Promise<EngineResult> {
  const key = `${ctx.mode}\0${root}\0${exclude.join('\0')}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = runOnce(root, ctx, limits, deps, exclude).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
