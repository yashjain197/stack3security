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
import { createRepoScanner } from './scanRepo';

const log = (event: Record<string, unknown>): void => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));

function main(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    log({ event: 'fatal', message: e instanceof ConfigError ? e.message : 'The service could not start.' });
    process.exit(1);
  }

  const reporter = createReporter({ apiUrl: config.apiUrl, serviceKey: config.serviceKey });
  const scanner = createRepoScanner(
    {
      makeDir: createQuarantineDir,
      clone: (url, dest) => cloneRepo(url, dest),
      removeDir: removeQuarantined,
      scan: (dir) => runScan(dir, { mode: 'clone', checkedAt: new Date().toISOString() }, DEFAULT_LIMITS),
      // Socket's package data needs its own key and API, which this service does not have yet. Until then every repository
      // with packages is reported as "Package scan unavailable" (so at best "unknown"), never as clean.
      scanPackages: async () => ({ ok: false, reason: 'Package scan is not configured on this server.' }),
      report: async (r) => {
        const res = await reporter.report(r);
        log({ event: 'report', ok: res.ok, nodes: r.nodes.length, edges: r.edges.length, ...(res.ok ? { synced: res.value.synced } : { reason: res.reason }) });
      },
      limiter: createLimiter(config.maxConcurrent, config.maxQueue),
      now: Date.now,
    },
    { cacheTtlMs: config.cacheTtlMs, maxCache: 200 },
  );

  const server = http.createServer(createApp({ serviceKey: config.serviceKey, scanner, scanTimeoutMs: config.scanTimeoutMs, log }));
  server.headersTimeout = 10_000;
  server.requestTimeout = 20_000;
  server.keepAliveTimeout = 5_000;
  server.listen(config.port, '0.0.0.0', () => log({ event: 'listening', port: config.port, apiUrl: config.apiUrl }));

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
