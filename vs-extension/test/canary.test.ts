import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { build } from 'esbuild';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { cloneAndScan, type CloneAndScanDeps } from '../src/commands/cloneAndScan';
import { DEFAULT_LIMITS } from '../src/config/settings';
import { Registry, type KeyValueStore } from '../src/quarantine/registry';
import { createQuarantineDir, ensureCloneHelpers } from '../src/quarantine/paths';
import { removeQuarantined } from '../src/quarantine/remove';
import { runScan } from '../src/scan/scheduler';
import { hasGit, hardenedLocalClone, makeBareRemote } from './helpers/git';

// I-1: Stack3 reads a hostile repo as data and never executes any of it. Every file in the canary fixture
// would create $STACK3_CANARY if it were ever run, required, installed or opened.
const FIXTURE = fileURLToPath(new URL('./fixtures/repos/canary', import.meta.url));
const memory = (): KeyValueStore => {
  const m = new Map<string, unknown>();
  return { get: <V>(k: string, d: V) => (m.has(k) ? (m.get(k) as V) : d), update: async (k, v) => void m.set(k, v) };
};

describe.skipIf(!hasGit)('canary: clone → scan of a repo built to run code', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'stack3-canary-'));
  const canary = join(tmp, 'stack3-canary');
  let worker: string;
  let prevTmp: string | undefined;

  beforeAll(async () => {
    prevTmp = process.env.TMPDIR;
    process.env.TMPDIR = join(tmp, 'tmpdir');
    mkdirSync(process.env.TMPDIR);
    process.env.STACK3_CANARY = canary;
    worker = join(mkdtempSync(join(tmp, 'wb-')), 'worker.js');
    await build({ entryPoints: [join(fileURLToPath(new URL('../src/scan/worker.ts', import.meta.url)))], outfile: worker, bundle: true, platform: 'node', format: 'cjs', mainFields: ['module', 'main'], logLevel: 'silent' });
  });
  afterAll(() => {
    delete process.env.STACK3_CANARY;
    if (prevTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = prevTmp;
  });

  test('the canary file never appears, and the verdict is critical with the auto-run findings', async () => {
    expect(existsSync(canary)).toBe(false);
    const bare = makeBareRemote(FIXTURE, tmp, 'canary');
    const panels: unknown[] = [];
    const errors: string[] = [];
    const registry = new Registry(memory());
    const deps: CloneAndScanDeps = {
      makeDir: createQuarantineDir,
      // the real hardened git arguments against a local remote (the real cloneRepo only talks to github.com)
      clone: async (_url, dest) => {
        const h = await ensureCloneHelpers();
        return { ok: true, value: hardenedLocalClone(bare, dest, h.hooksDir, h.templateDir) };
      },
      // the real scan worker, bundled, in its own thread with the production heap limit
      scan: (dir) => runScan(dir, { mode: 'clone', checkedAt: '2026-10-30T00:00:00+05:30' }, DEFAULT_LIMITS, { createWorker: () => new Worker(worker, { resourceLimits: { maxOldGenerationSizeMb: 256 } }) }),
      client: { scanPackage: vi.fn(async () => ({ ok: true as const, value: [] })) },
      registry,
      removeDir: removeQuarantined,
      showPanel: (rec) => void panels.push(rec),
      showError: (m) => void errors.push(m),
    };

    const r = await cloneAndScan('https://github.com/octo/canary', deps);
    expect(errors).toEqual([]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(existsSync(canary), 'something executed a file from the cloned repo').toBe(false);
    expect(r.value.verdict.level).toBe('critical');
    const ids = new Set(r.value.verdict.findings.map((x) => x.ruleId));
    for (const id of ['tasks.folder-open', 'scripts.lifecycle', 'devcontainer.initialize-command', 'pnpmfile.present', 'yarn.repo-binary', 'npmrc.dangerous-key', 'settings.auto-tasks-on', 'settings.repo-executable']) {
      expect(ids, id).toContain(id);
    }
    expect(panels).toHaveLength(1);
    expect(registry.get(r.value.scanId)).toBeDefined();
    // the clone is real, on disk, quarantined, and still just data
    expect(readdirSync(r.value.dir)).toContain('index.js');
    expect(existsSync(join(r.value.dir, '.git', 'hooks'))).toBe(false);
    await removeQuarantined(r.value.dir);
  });
});
