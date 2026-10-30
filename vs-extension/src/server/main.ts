// Entry point of the Stack3 repo-scan service (run in Docker). No VS Code in here.
import http from 'node:http';
import { DEFAULT_LIMITS } from '../config/limits';
import { cloneRepo } from '../quarantine/git';
import { createQuarantineDir } from '../quarantine/paths';
import { removeQuarantined, sweepQuarantine } from '../quarantine/remove';
import { runScan } from '../scan/scheduler';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { createLimiter } from './limiter';
import { createReporter } from './reporter';
import { createRepoScanner, type PackageScan } from './scanRepo';
import { createSocketScanner } from './socket';
import { createStack3PackageScanner } from './stack3Packages';
import { createStats } from './stats';

const log = (event: Record<string, unknown>): void => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));

function main(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    log({ event: 'fatal', message: e instanceof ConfigError ? e.message : 'The service could not start.' });
    process.exit(1);
  }

  // Package data comes from the Stack3 API (which holds the Socket key) unless a Socket key is set here, which talks to
  // Socket directly. A failure of either is reported as "Package scan unavailable" (so at best "unknown"), never as clean.
  const packageSource = config.socket ? 'socket' : 'stack3';
  const checkPackages = config.socket ? createSocketScanner(config.socket) : createStack3PackageScanner({ apiUrl: config.apiUrl, serviceKey: config.serviceKey });
  const scanPackages = async (purls: string[]): Promise<PackageScan> => {
    const res = await checkPackages(purls);
    log({ event: 'packages', source: packageSource, ok: res.ok, packages: purls.length, ...(res.ok ? { findings: res.value.length, incomplete: Boolean(res.notChecked?.length) } : { reason: res.reason }) });
    return res;
  };

  const stats = createStats();
  const reporter = createReporter({ apiUrl: config.apiUrl, serviceKey: config.serviceKey });
  const scanner = createRepoScanner(
    {
      makeDir: createQuarantineDir,
      clone: (url, dest) => cloneRepo(url, dest),
      removeDir: removeQuarantined,
      scan: (dir) => runScan(dir, { mode: 'clone', checkedAt: new Date().toISOString() }, DEFAULT_LIMITS),
      scanPackages,
      report: async (r) => {
        const res = await reporter.report(r);
        log({ event: 'report', ok: res.ok, nodes: r.nodes.length, edges: r.edges.length, ...(res.ok ? { synced: res.value.synced } : { reason: res.reason }) });
      },
      onScanned: (v) => stats.record(v.level),
      limiter: createLimiter(config.maxConcurrent, config.maxQueue),
      now: Date.now,
    },
    { cacheTtlMs: config.cacheTtlMs, maxCache: 200 },
  );

  const server = http.createServer(createApp({ serviceKey: config.serviceKey, scanner, scanTimeoutMs: config.scanTimeoutMs, stats, log }));
  server.headersTimeout = 10_000;
  server.requestTimeout = 20_000;
  server.keepAliveTimeout = 5_000;
  server.listen(config.port, '0.0.0.0', () => log({ event: 'listening', port: config.port, apiUrl: config.apiUrl, packages: config.socket ? (config.socket.orgSlug ? 'socket-org' : 'socket-legacy') : 'stack3-api' }));

  // Housekeeping: clones are removed after every scan; this catches any left by a crash.
  const sweep = () => void sweepQuarantine(1).catch(() => undefined);
  sweep();
  const timer = setInterval(sweep, 3_600_000);
  timer.unref();

  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('unhandledRejection', () => log({ event: 'unhandled_rejection' }));
}

main();
