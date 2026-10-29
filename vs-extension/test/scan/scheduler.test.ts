import { describe, expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { DEFAULT_LIMITS } from '../../src/config/settings';
import { runScan, type WorkerLike } from '../../src/scan/scheduler';
import { scanJob } from '../../src/scan/scanJob';
import { put, sandbox } from './tree';

const ctx = { mode: 'clone' as const, checkedAt: '2026-10-29T18:00:00+05:30' };

class FakeWorker extends EventEmitter implements WorkerLike {
  terminated = false;
  posted: unknown[] = [];
  constructor(private onPost?: (w: FakeWorker, msg: unknown) => void) { super(); }
  postMessage(msg: unknown) { this.posted.push(msg); this.onPost?.(this, msg); }
  terminate() { this.terminated = true; return Promise.resolve(0); }
}

describe('runScan', () => {
  test('timeout → empty result with "Scan timed out" and the worker is terminated', async () => {
    const w = new FakeWorker();
    const r = await runScan('/r1', ctx, { ...DEFAULT_LIMITS, timeoutMs: 50 }, { createWorker: () => w });
    expect(r).toEqual({ findings: [], purls: [], notChecked: ['Scan timed out'] });
    expect(w.terminated).toBe(true);
  });

  test('worker crash → notChecked ["Scan failed"]', async () => {
    const w = new FakeWorker((self) => setImmediate(() => self.emit('error', new Error('boom'))));
    const r = await runScan('/r2', ctx, DEFAULT_LIMITS, { createWorker: () => w });
    expect(r).toEqual({ findings: [], purls: [], notChecked: ['Scan failed'] });
  });

  test('malformed worker reply → notChecked ["Scan failed"]', async () => {
    const w = new FakeWorker((self) => setImmediate(() => self.emit('message', { nonsense: true })));
    expect((await runScan('/r3', ctx, DEFAULT_LIMITS, { createWorker: () => w })).notChecked).toEqual(['Scan failed']);
  });

  test('two calls on the same root share one run', async () => {
    let created = 0;
    const make = () => {
      created++;
      return new FakeWorker((self) => setTimeout(() => self.emit('message', { ok: true, result: { findings: [], notChecked: [], purls: ['pkg:npm/a@1'] } }), 20));
    };
    const [a, b] = await Promise.all([runScan('/same', ctx, DEFAULT_LIMITS, { createWorker: make }), runScan('/same', ctx, DEFAULT_LIMITS, { createWorker: make })]);
    expect(created).toBe(1);
    expect(a).toEqual(b);
    await runScan('/same', ctx, DEFAULT_LIMITS, { createWorker: make });
    expect(created).toBe(2);
  });
});

describe('scanJob', () => {
  test('stamps checkedAt on walker findings and merges walker notChecked', async () => {
    const { root } = sandbox();
    put(root, 'node_modules/x/package.json', '{}');
    for (let i = 0; i < 3; i++) put(root, `z${i}.txt`, 'a');
    const r = await scanJob({ root, ctx, limits: { ...DEFAULT_LIMITS, maxFiles: 2 } });
    expect(r.findings[0]).toMatchObject({ ruleId: 'walker.committed-node-modules', checkedAt: ctx.checkedAt });
    expect(r.notChecked.join()).toContain('file limit');
  });

  test('a rule that throws becomes notChecked instead of crashing', async () => {
    const { root } = sandbox();
    put(root, 'a.txt', 'x');
    const r = await scanJob({ root, ctx, limits: DEFAULT_LIMITS }, [() => { throw new Error('bad rule'); }]);
    expect(r.notChecked).toEqual(['A detection rule failed; results may be incomplete']);
  });
});

describe('real worker bundle', () => {
  test('dist worker scans a tree end to end', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'stack3-wb-')), 'worker.js');
    await build({ entryPoints: ['src/scan/worker.ts'], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
    const { root } = sandbox();
    put(root, 'node_modules/x/package.json', '{}');
    const r = await runScan(root, ctx, DEFAULT_LIMITS, { createWorker: () => new Worker(out, { resourceLimits: { maxOldGenerationSizeMb: 256 } }) });
    expect(r.findings.map((f) => f.ruleId)).toEqual(['walker.committed-node-modules']);
  });
});
