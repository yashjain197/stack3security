import type { z } from 'zod';
import { cleanText, clip, trimEndChars } from '../engine/rules/evidence';
import { redactSecrets } from '../engine/secretPatterns';
import type { Finding, Indicators, Level } from '../engine/types';
import { redactAll, type SafeFinding } from '../verdict/redact';
import { createMockClient } from './mock';
import { ExplainResponseSchema, ReportResponseSchema, ScanPackageResponseSchema } from './schemas';

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface ReportPayload {
  indicators: Indicators;
  source?: { type: 'repo'; id: string };
  ruleIds: string[];
}

export interface Stack3Client {
  scanPackage(purls: string[]): Promise<Result<Finding[]>>;
  explain(level: Level, findings: SafeFinding[]): Promise<Result<{ explanation: string; fix: string }>>;
  report(p: ReportPayload): Promise<Result<void>>;
}

export interface ClientOptions {
  baseUrl: string;
  allowLocalhost: boolean;
  fetchImpl?: typeof fetch;
  clientVersion?: string;
  timeoutMs?: number;
}

const TIMEOUT_MS = 8000;
const MAX_BODY = 1024 * 1024;
const MAX_PURLS = 5000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const PURL = /^pkg:npm\/(?:%40[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+@[A-Za-z0-9.%+_-]+$/;

/** HTTPS only; plain http only for a loopback host and only when the user enabled the dev setting (I-16). */
export function validateBaseUrl(baseUrl: string, allowLocalhost: boolean): { ok: true; url: URL } | { ok: false; reason: string } {
  const raw = baseUrl.trim();
  if (!raw) return { ok: false, reason: 'API not configured' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'API URL is not valid' };
  }
  if (url.username || url.password) return { ok: false, reason: 'API URL must not contain credentials' };
  if (url.protocol === 'https:') return { ok: true, url };
  if (url.protocol === 'http:' && allowLocalhost && LOCAL_HOSTS.has(url.hostname)) return { ok: true, url };
  return { ok: false, reason: 'API URL must use HTTPS' };
}

export type Attempt = { ok: true; value: unknown } | { ok: false; reason: string; retry: boolean };

/** Read at most `maxBytes` (1 MiB by default). The stream is cancelled the moment the cap is passed or the request is aborted. */
export async function readCapped(res: Response, signal: AbortSignal, maxBytes = MAX_BODY): Promise<Uint8Array | 'too-large'> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const stop = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', stop, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return 'too-large';
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', stop);
  }
  if (signal.aborted) throw new Error('aborted');
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) (out.set(c, at), (at += c.byteLength));
  return out;
}

/** One JSON POST with a timeout, a 1 MiB streamed response cap, no redirects and no credentials. Shared by every provider. */
export async function postJsonOnce(fetchImpl: typeof fetch, url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<Attempt> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
      redirect: 'error', // a redirect could carry the request to another origin (I-16)
      credentials: 'omit',
    });
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: `API returned ${res.status}`, retry: res.status >= 500 };
    }
    if (Number(res.headers.get('content-length')) > MAX_BODY) {
      void res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: 'Response too large', retry: false };
    }
    const bytes = await readCapped(res, ctl.signal);
    if (bytes === 'too-large') return { ok: false, reason: 'Response too large', retry: false };
    try {
      return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
    } catch {
      return { ok: false, reason: 'Unexpected response', retry: false };
    }
  } catch {
    return { ok: false, reason: ctl.signal.aborted ? 'Timed out' : 'Network error', retry: true };
  } finally {
    clearTimeout(timer);
  }
}

const parse = <S extends z.ZodType>(schema: S, value: unknown): Result<z.infer<S>> => {
  const r = schema.safeParse(value);
  return r.success ? { ok: true, value: r.data } : { ok: false, reason: 'Unexpected response' };
};

export function createClient(opts: ClientOptions): Stack3Client {
  if (process.env.STACK3_MOCK === '1') return createMockClient();

  const target = validateBaseUrl(opts.baseUrl, opts.allowLocalhost);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const version = /^[0-9A-Za-z.+-]{1,32}$/.test(opts.clientVersion ?? '') ? (opts.clientVersion as string) : '0.0.0';
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  async function post(path: string, body: unknown): Promise<Result<unknown>> {
    if (!target.ok) return target;
    const url = `${target.url.origin}${trimEndChars(target.url.pathname, '/')}${path}`;
    let last: Attempt;
    for (let attempt = 0; ; attempt++) {
      last = await postJsonOnce(fetchImpl, url, body, { 'x-stack3-client': `vscode/${version}` }, timeoutMs);
      if (last.ok || !last.retry || attempt === 1) break; // one retry, only for timeouts, network errors and 5xx
    }
    return last.ok ? last : { ok: false, reason: last.reason };
  }

  return {
    async scanPackage(purls) {
      if (purls.length === 0) return { ok: true, value: [] };
      // Only package URLs may leave the machine on this endpoint (I-6): anything else is a bug, so fail closed.
      if (purls.length > MAX_PURLS || !purls.every((p) => p.length <= 300 && PURL.test(p))) return { ok: false, reason: 'Invalid package list' };
      const res = await post('/scan-package', { purls });
      if (!res.ok) return res;
      const parsed = parse(ScanPackageResponseSchema, res.value);
      // Whatever the server claims, these are registry-scan findings; it cannot pose as the local rules.
      return parsed.ok ? { ok: true, value: parsed.value.findings.map((f) => ({ ...f, source: 'socket' as const })) } : parsed;
    },

    async explain(level, findings) {
      // redactAll re-applies the egress gate at the sink: <= 20 findings, most severe first, known fields only, secrets removed.
      const res = await post('/explain', { level, findings: redactAll(findings) });
      if (!res.ok) return res;
      const parsed = parse(ExplainResponseSchema, res.value);
      return parsed.ok ? { ok: true, value: { explanation: cleanText(parsed.value.explanation, 4000), fix: cleanText(parsed.value.fix, 2000) } } : parsed;
    },

    async report(p) {
      const clean = (xs: string[], max: number) => xs.slice(0, 200).map((x) => clip(redactSecrets(x), max));
      const res = await post('/report', {
        indicators: { addresses: clean(p.indicators.addresses, 100), domains: clean(p.indicators.domains, 253) },
        source: p.source ? { type: p.source.type, id: clip(p.source.id, 300) } : undefined,
        ruleIds: p.ruleIds.slice(0, 100).map((x) => clip(x, 200)),
      });
      if (!res.ok) return res;
      const parsed = parse(ReportResponseSchema, res.value);
      return parsed.ok ? { ok: true, value: undefined } : parsed;
    },
  };
}
