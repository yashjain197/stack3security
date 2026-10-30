// Wakes the deployed hosts before a demo and puts a few real scans into the live counters, so the numbers are not zero.
//   npm run warm-up                        (node --env-file=.env scripts/warm-up.mjs)
//   npm run warm-up -- owner/name ...      (scan these public repos instead of the defaults)
//
// Environment (the key comes from .env and is only ever sent as the X-Service-Key header; it is never printed):
//   SERVICE_KEY            required, the shared service key (INTERNAL_SERVICE_KEY is the older name and is used if SERVICE_KEY is unset)
//   STACK3_SCAN_URL        scan service origin   (default https://vs-ext-backend.stack3security.workers.dev)
//   STACK3_CHROME_URL      Chrome API origin     (default https://chrome-ext-backend.stack3security.workers.dev)
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';

// Node gives up on each address after 250 ms by default, which is shorter than a TLS connect to a far host on some networks
// (ETIMEDOUT with curl working). A longer per-address timeout keeps the 90 s wake-up budget meaningful.
setDefaultAutoSelectFamilyAttemptTimeout(5000);

const SCAN_URL = (process.env.STACK3_SCAN_URL || 'https://vs-ext-backend.stack3security.workers.dev').replace(/\/+$/, '');
const CHROME_URL = (process.env.STACK3_CHROME_URL || 'https://chrome-ext-backend.stack3security.workers.dev').replace(/\/+$/, '');
const KEY = process.env.SERVICE_KEY || process.env.INTERNAL_SERVICE_KEY || '';

const DEFAULT_REPOS = ['expressjs/express', 'fastify/fastify', 'ethers-io/ethers.js']; // clean public repos from scripts/rehearsal-clean-repos.mjs
const repos = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_REPOS;

const HEALTH_TIMEOUT_MS = 90_000; // a cold worker or container can take this long to answer
const SCAN_TIMEOUT_MS = 120_000; // the service's own limit is 90 s per request
const STATS_TIMEOUT_MS = 30_000;

if (KEY.length < 16) {
  console.error('warm-up: SERVICE_KEY (or INTERNAL_SERVICE_KEY) is missing or too short. Run it as: npm run warm-up (it loads vs-extension/.env).');
  process.exit(2);
}

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** One request with a hard timeout. Never throws; the key is only ever in the request headers. */
async function call(url, { method = 'GET', body, timeoutMs }) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), 'x-service-key': KEY },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let json;
    try { json = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, ms: Date.now() - started, json };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { status: 0, ms: Date.now() - started, error: timedOut ? `timed out after ${secs(timeoutMs)}` : `${e instanceof Error ? e.cause?.code || e.message : 'failed'}` };
  }
}

async function wake(name, origin, path) {
  let r = await call(`${origin}${path}`, { timeoutMs: HEALTH_TIMEOUT_MS });
  const first = r;
  if (r.status !== 200) r = await call(`${origin}${path}`, { timeoutMs: HEALTH_TIMEOUT_MS }); // one retry
  const retried = r !== first;
  console.log(`  ${name.padEnd(8)} ${origin}${path}  ->  ${r.status || r.error}  ${secs(r.ms)}${retried ? `  (retry; first try: ${first.status || first.error}, ${secs(first.ms)})` : ''}`);
  return r.status === 200;
}

console.log('1. Wake the hosts (GET /healthz on the scan service, GET /health on the Chrome API; 90 s timeout, one retry)');
const [scanUp, chromeUp] = await Promise.all([wake('scan', SCAN_URL, '/healthz'), wake('chrome', CHROME_URL, '/health')]);

console.log(`\n2. Scan ${repos.length} public repos (POST /v1/internal/scan-repo)`);
let scanned = 0;
if (!scanUp) console.log('  skipped: the scan service did not answer its health check.');
else {
  for (const repo of repos) {
    const repoUrl = /^https?:\/\//.test(repo) ? repo : `https://github.com/${repo}`;
    const r = await call(`${SCAN_URL}/v1/internal/scan-repo`, { method: 'POST', body: { repoUrl }, timeoutMs: SCAN_TIMEOUT_MS });
    if (r.status === 200 && r.json?.level) {
      scanned += 1;
      console.log(`  ${repo.padEnd(24)} ${String(r.json.level).padEnd(16)} ${String(r.json.findings?.length ?? 0).padStart(3)} findings  ${secs(r.ms)}`);
    } else {
      const why = r.json?.error?.code ? `${r.json.error.code}: ${String(r.json.error.message ?? '').slice(0, 120)}` : r.error || 'no JSON body';
      console.log(`  ${repo.padEnd(24)} FAILED  HTTP ${r.status || '-'}  ${why}  ${secs(r.ms)}`);
    }
  }
}

console.log('\n3. Live counters (GET /v1/internal/stats, counts only)');
let statsOk = false;
if (!scanUp) console.log('  skipped: the scan service did not answer its health check.');
else {
  const r = await call(`${SCAN_URL}/v1/internal/stats`, { timeoutMs: STATS_TIMEOUT_MS });
  if (r.status === 200 && r.json && typeof r.json.reposScanned === 'number') {
    statsOk = true;
    const { reposScanned, threatsFound, byLevel = {}, since } = r.json;
    console.log(`  reposScanned=${reposScanned}  threatsFound=${threatsFound}  ${secs(r.ms)}`);
    console.log(`  byLevel: ${['critical', 'high', 'caution', 'unknown', 'no_known_issues'].map((l) => `${l}=${byLevel[l] ?? 0}`).join('  ')}`);
    if (since) console.log(`  since ${since} (counters are in memory and reset when the service restarts)`);
  } else {
    console.log(`  FAILED  HTTP ${r.status || '-'}  ${r.json?.error?.code || r.error || 'unexpected body'}`);
  }
}

console.log(`\nSummary: scan host ${scanUp ? 'up' : 'DOWN'}, chrome host ${chromeUp ? 'up' : 'DOWN'}, ${scanned}/${repos.length} scans ok, stats ${statsOk ? 'ok' : 'FAILED'}.`);
process.exit(scanUp && chromeUp && scanned === repos.length && statsOk ? 0 : 1);
