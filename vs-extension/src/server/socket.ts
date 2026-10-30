import { PURL, readCapped } from '../api/client';
import { clip } from '../engine/rules/evidence';
import type { Finding, Severity } from '../engine/types';
import type { PackageScan } from './scanRepo';

export interface SocketOptions {
  apiKey: string;
  /** Set to use the current organisation route; without it the deprecated `/v0/purl` route is used. */
  orgSlug?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** Extra tries after a rate limit (429) or a 502/503/504, waiting as long as Retry-After says (at most 5 s). Default 0. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const BASE = 'https://api.socket.dev/v0';
const BATCH = 500; // Socket allows 1024; each request costs 100 quota units, so the cap on requests is the cost cap
const MAX_REQUESTS = 4;
const MAX_BODY = 32 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

// Only what a person should stop for: a hostile package (malware, typosquat, install script, exfiltration). Socket's
// "middle" alerts (network access, eval, shell use...) fire on ordinary packages, and its vulnerability alerts are known
// CVEs in old versions: a popular repo with an old dev dependency is not an attack, and would read as "critical".
// Licence, quality and maintenance alerts are not security findings.
const SEVERITY: Record<string, Severity> = { critical: 'critical', high: 'high' };
const CATEGORIES = new Set(['supplyChainRisk']);
// Alerts Socket synthesises when it has no verdict yet; the package was not checked.
const UNRESOLVED = new Set(['pendingScan', 'notFound']);

type Chunk = { ok: true; findings: Finding[]; unresolved: number } | { ok: false; reason: string };
const RETRY_STATUS = new Set([429, 502, 503, 504]);
const DEFAULT_WAIT_MS = 2000;
const MAX_WAIT_MS = 5000;
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const identifier = (v: unknown, max: number): string => text(v).replace(/[^A-Za-z0-9._-]/g, '').slice(0, max);

/**
 * Package-malware data from Socket.dev, for the repo-scan service. Only package URLs leave the
 * service. Anything Socket could not answer is reported back as "not checked", never as clean (I-5), and what it does
 * answer can only add findings: the level is still computed locally.
 */
export function createSocketScanner(opts: SocketOptions): (purls: string[]) => Promise<PackageScan> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const retries = Math.max(0, Math.min(opts.retries ?? 0, 3));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const route = opts.orgSlug ? `/orgs/${encodeURIComponent(opts.orgSlug)}/purl` : '/purl';
  const url = `${BASE}${route}?alerts=true&purlErrors=true`;

  async function fetchChunk(purls: string[]): Promise<Chunk> {
    for (let attempt = 0; ; attempt++) {
      const { chunk, waitMs } = await tryChunk(purls);
      if (waitMs === undefined || attempt >= retries) return chunk;
      await sleep(waitMs);
    }
  }

  async function tryChunk(purls: string[]): Promise<{ chunk: Chunk; waitMs?: number }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/x-ndjson', authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ components: purls.map((purl) => ({ purl })) }),
        signal: ctl.signal,
        redirect: 'error', // the key must never follow a redirect to another origin
        credentials: 'omit',
      });
      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined);
        const asked = Number(res.headers.get('retry-after'));
        const waitMs = RETRY_STATUS.has(res.status) ? (Number.isFinite(asked) && asked >= 0 && res.headers.has('retry-after') ? Math.min(asked * 1000, MAX_WAIT_MS) : DEFAULT_WAIT_MS) : undefined;
        return { chunk: { ok: false, reason: `Socket returned ${res.status}` }, ...(waitMs === undefined ? {} : { waitMs }) };
      }
      const bytes = await readCapped(res, ctl.signal, MAX_BODY);
      if (bytes === 'too-large') return { chunk: { ok: false, reason: 'Socket response too large' } };
      return { chunk: parse(new TextDecoder().decode(bytes), purls.length) };
    } catch {
      return { chunk: { ok: false, reason: ctl.signal.aborted ? 'Socket timed out' : 'Socket request failed' } };
    } finally {
      clearTimeout(timer);
    }
  }

  function parse(body: string, requested: number): Chunk {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    let resolved = 0;
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        return { ok: false, reason: 'Socket sent an unexpected response' };
      }
      if (!isRecord(row)) return { ok: false, reason: 'Socket sent an unexpected response' };
      if (row._type !== undefined) continue; // purlError and summary lines: the package simply does not count as resolved
      const alerts = Array.isArray(row.alerts) ? row.alerts.filter(isRecord) : [];
      if (alerts.some((a) => UNRESOLVED.has(text(a.type)))) continue;
      resolved++;
      const label = clip([text(row.namespace), text(row.name)].filter(Boolean).join('/') + (text(row.version) ? `@${text(row.version)}` : ''), 200);
      for (const a of alerts) {
        const severity = SEVERITY[text(a.severity)];
        const category = text(a.category);
        if (!severity || !CATEGORIES.has(category)) continue;
        const type = identifier(a.type, 60) || 'alert';
        const dedupe = `${label}|${identifier(a.key, 200) || type}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        findings.push({
          ruleId: `socket.${type}`,
          layer: 'dependency',
          severity,
          title: clip(`Socket.dev flagged ${label}: ${type}`, 300),
          evidence: clip(`Socket.dev reported ${severity} (${category}) alert "${type}" on ${label}.`),
          source: 'socket',
          checkedAt: new Date(now()).toISOString(),
        });
      }
    }
    return { ok: true, findings, unresolved: Math.max(0, requested - resolved) };
  }

  return async (purls) => {
    const unique = [...new Set(purls)];
    if (unique.length === 0) return { ok: true, value: [] };
    // Fail closed: only well-formed npm package URLs may be sent, and no more than the request cap allows.
    const valid = unique.filter((p) => p.length <= 300 && PURL.test(p));
    const sent = valid.slice(0, BATCH * MAX_REQUESTS);
    const batches: string[][] = [];
    for (let i = 0; i < sent.length; i += BATCH) batches.push(sent.slice(i, i + BATCH));

    const findings: Finding[] = [];
    let unchecked = unique.length - sent.length;
    let reason = '';
    let answered = 0;
    for (const batch of batches) {
      const r = await fetchChunk(batch);
      if (r.ok) {
        answered++;
        findings.push(...r.findings);
        unchecked += r.unresolved;
      } else {
        reason ||= r.reason;
        unchecked += batch.length;
      }
    }
    if (batches.length > 0 && answered === 0) return { ok: false, reason };
    return unchecked > 0
      ? { ok: true, value: findings, notChecked: [`Package scan incomplete: ${unchecked} of ${unique.length} packages were not checked by Socket.`] }
      : { ok: true, value: findings };
  };
}
