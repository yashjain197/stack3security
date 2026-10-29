import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { build } from 'esbuild';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { DEFAULT_LIMITS } from '../../src/config/limits';
import { createQuarantineDir, ensureCloneHelpers, quarantineRoot } from '../../src/quarantine/paths';
import { removeQuarantined } from '../../src/quarantine/remove';
import { runScan } from '../../src/scan/scheduler';
import { createApp } from '../../src/server/app';
import { createLimiter } from '../../src/server/limiter';
import { createReporter } from '../../src/server/reporter';
import { createRepoScanner } from '../../src/server/scanRepo';
import { hardenedLocalClone, hasGit, makeBareRemote } from '../helpers/git';

// The whole service, for real: HTTP in, a real hardened git clone, the real bundled scan worker, a stand-in for the
// Stack3 API that checks the service key, and HTTP out. Only the remote is local instead of github.com.
const KEY = 'service-key-0123456789abcdef';
const FIXTURE = fileURLToPath(new URL('../fixtures/repos/interview-task', import.meta.url));
const ADDR = '0x9f00000000000000000000000000000000000001';

describe.skipIf(!hasGit)('scan-repo service, end to end', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'stack3-svc-'));
  const reports: { headers: http.IncomingHttpHeaders; body: any }[] = [];
  let yash: http.Server;
  let service: http.Server;
  let base = '';
  let prevTmp: string | undefined;
  let clones = 0;

  beforeAll(async () => {
    prevTmp = process.env.TMPDIR;
    process.env.TMPDIR = join(tmp, 'tmpdir');
    mkdirSync(process.env.TMPDIR);
    const worker = join(mkdtempSync(join(tmp, 'wb-')), 'worker.js');
    await build({ entryPoints: [fileURLToPath(new URL('../../src/scan/worker.ts', import.meta.url))], outfile: worker, bundle: true, platform: 'node', format: 'cjs', mainFields: ['module', 'main'], logLevel: 'silent' });
    const bare = makeBareRemote(FIXTURE, tmp, 'hostile');

    yash = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        const ok = req.method === 'POST' && req.url === '/v1/internal/report' && req.headers['x-service-key'] === KEY;
        if (!ok) {
          res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'invalid_service_key', message: 'no' } }));
          return;
        }
        reports.push({ headers: req.headers, body: JSON.parse(data) });
        res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'u1', synced: true }));
      });
    });
    await new Promise<void>((r) => yash.listen(0, '127.0.0.1', r));
    const yashUrl = `http://127.0.0.1:${(yash.address() as AddressInfo).port}`;

    const reporter = createReporter({ apiUrl: yashUrl, serviceKey: KEY });
    const scanner = createRepoScanner(
      {
        makeDir: createQuarantineDir,
        clone: async (_url, dest) => {
          clones++;
          const h = await ensureCloneHelpers();
          return { ok: true, value: hardenedLocalClone(bare, dest, h.hooksDir, h.templateDir) };
        },
        removeDir: removeQuarantined,
        scan: (dir) => runScan(dir, { mode: 'clone', checkedAt: '2026-10-30T00:00:00Z' }, DEFAULT_LIMITS, { createWorker: () => new Worker(worker, { resourceLimits: { maxOldGenerationSizeMb: 256 } }) }),
        scanPackages: async () => ({ ok: false, reason: 'not configured' }),
        report: (r) => reporter.report(r),
        limiter: createLimiter(2, 4),
        now: Date.now,
      },
      { cacheTtlMs: 60_000, maxCache: 10 },
    );
    service = http.createServer(createApp({ serviceKey: KEY, scanner, scanTimeoutMs: 60_000, log: () => undefined }));
    await new Promise<void>((r) => service.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => service.close(r));
    await new Promise((r) => yash.close(r));
    if (prevTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = prevTmp;
  });

  const call = (body: unknown, key: string | undefined = KEY) =>
    fetch(`${base}/v1/internal/scan-repo`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-service-key': key } : {}) }, body: JSON.stringify(body) });

  test('a repository built to attack: critical, in the API\'s shape, with the wallet and endpoint named', async () => {
    const res = await call({ repoUrl: 'https://github.com/octo/interview-task' });
    expect(res.status).toBe(200);
    const v = (await res.json()) as any;
    expect(Object.keys(v).sort()).toEqual(['actions', 'explanation', 'findings', 'indicators', 'level', 'notChecked', 'target']);
    expect(v.level).toBe('critical');
    expect(v.target).toEqual({ type: 'repo', id: 'github.com/octo/interview-task' });
    expect(v.explanation).toBeNull();
    expect(v.findings.some((f: any) => f.layer === 'repo-file' && f.severity === 'critical' && f.location?.file === '.vscode/tasks.json' && f.location?.line === 14)).toBe(true);
    expect(v.findings.every((f: any) => !('ruleId' in f))).toBe(true);
    expect(v.indicators).toEqual({ addresses: [`1:${ADDR}`], domains: ['api.telegram.org/bot123456'] });
    expect(JSON.stringify(v)).not.toContain('FAKE-TOKEN');
    expect(JSON.stringify(v)).not.toContain(KEY);
  });

  test('and reports the package, the wallet and the endpoint to the Stack3 API, authenticated with the service key', async () => {
    await new Promise((r) => setTimeout(r, 300));
    expect(reports).toHaveLength(1);
    const { headers, body } = reports[0]!;
    expect(headers['x-service-key']).toBe(KEY);
    expect(body).toMatchObject({ source: 'vscode', reporter: 'scan-repo' });
    expect(body.nodes.map((n: any) => `${n.type}:${n.id}`).sort()).toEqual(
      ['endpoint:https://api.telegram.org/bot123456', `wallet:1:${ADDR}`, 'package:pkg:npm/interview-task@1.0.0'].sort(),
    );
    expect(body.edges.map((e: any) => e.type).sort()).toEqual(['package_drains_to', 'package_sends_to']);
    expect(JSON.stringify(body)).not.toContain('FAKE-TOKEN');
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  test('the clone is gone afterwards: nothing is left in quarantine', () => {
    const left = existsSync(quarantineRoot()) ? readdirSync(quarantineRoot()).filter((n) => !n.startsWith('.')) : [];
    expect(left).toEqual([]);
  });

  test('asking again is answered from the cache: no second clone and no second report', async () => {
    const before = clones;
    const res = await call({ repoUrl: 'github.com/octo/interview-task/tree/main' });
    expect(res.status).toBe(200);
    expect(clones).toBe(before);
    await new Promise((r) => setTimeout(r, 200));
    expect(reports).toHaveLength(1);
  });

  test('a wrong key is refused and nothing is cloned', async () => {
    const before = clones;
    const res = await call({ repoUrl: 'https://github.com/octo/other' }, 'wrong-key-0123456789abcdef');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'invalid_service_key', message: expect.any(String) } });
    expect(clones).toBe(before);
  });

  test('a hostile repoUrl is refused with the API\'s error shape and nothing is cloned', async () => {
    const before = clones;
    for (const repoUrl of ['--upload-pack=touch /tmp/pwned', 'file:///etc/passwd', 'https://evil.example/o/r', 'https://github.com/o/../r']) {
      const res = await call({ repoUrl });
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error.code).toBe('invalid_repo_url');
    }
    expect(clones).toBe(before);
  });
});
