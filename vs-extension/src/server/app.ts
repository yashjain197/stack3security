import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { ScanOutcome, ScanFailureCode } from './scanRepo';
import type { StatsSnapshot } from './stats';

export interface AppDeps {
  serviceKey: string;
  scanner: { scan(input: { repoUrl: string; ref?: string }): Promise<ScanOutcome> };
  scanTimeoutMs: number;
  stats: { snapshot(): StatsSnapshot };
  log(event: Record<string, unknown>): void;
}

const MAX_BODY = 4096;
const Body = z.strictObject({ repoUrl: z.string().max(300), ref: z.string().max(40).optional() });

const STATUS: Record<ScanFailureCode, number> = {
  invalid_repo_url: 400,
  invalid_ref: 400,
  clone_failed: 502,
  busy: 429,
  scan_timeout: 504,
  internal_error: 500,
};

// Compare digests, so the comparison takes the same time whatever the guess and whatever its length.
const digest = (s: string) => createHash('sha256').update(s).digest();
const keyMatches = (given: string | undefined, expected: string): boolean => {
  const a = digest(given ?? '');
  const b = digest(expected);
  return timingSafeEqual(a, b) && given !== undefined && given.length > 0;
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(text);
}
const sendError = (res: ServerResponse, status: number, code: string, message: string, headers: Record<string, string> = {}) => send(res, status, { error: { code, message } }, headers);

async function readBody(req: IncomingMessage): Promise<string | 'too-large'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return 'too-large';
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), ms)))]).finally(() => clearTimeout(timer));
}

/**
 * The HTTP surface: GET /healthz, and behind X-Service-Key POST /v1/internal/scan-repo and GET /v1/internal/stats. Errors use the API's shape,
 * {"error": {"code", "message"}}. Authentication comes before the body is read; the body is capped; nothing internal
 * (paths, stacks, the key) is ever put in a response or a log line.
 */
export function createApp(deps: AppDeps): RequestListener {
  async function handle(req: IncomingMessage, res: ServerResponse, note: { status?: number; level?: string }): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const reply = (status: number, body: unknown, headers?: Record<string, string>) => {
      note.status = status;
      send(res, status, body, headers);
    };
    const replyError = (status: number, code: string, message: string, headers?: Record<string, string>) => reply(status, { error: { code, message } }, headers);

    if (path === '/healthz') {
      if (req.method !== 'GET') return replyError(405, 'method_not_allowed', 'Use GET.', { allow: 'GET' });
      return reply(200, { status: 'ok' });
    }
    const isStats = path === '/v1/internal/stats';
    if (path !== '/v1/internal/scan-repo' && !isStats) return replyError(404, 'not_found', 'No such route.');
    const method = isStats ? 'GET' : 'POST';
    if (req.method !== method) return replyError(405, 'method_not_allowed', `Use ${method}.`, { allow: method });

    const given = req.headers['x-service-key'];
    if (!keyMatches(typeof given === 'string' ? given : undefined, deps.serviceKey)) {
      return replyError(401, 'invalid_service_key', 'The X-Service-Key header is missing or wrong.', { connection: 'close' });
    }
    if (isStats) return reply(200, deps.stats.snapshot());
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return replyError(415, 'unsupported_media_type', 'Send application/json.');

    const raw = await readBody(req);
    if (raw === 'too-large') return replyError(413, 'payload_too_large', 'The request body is too large.', { connection: 'close' });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return replyError(400, 'invalid_request', 'The body must be JSON like {"repoUrl": "https://github.com/owner/name"}.');
    }
    const body = Body.safeParse(json);
    if (!body.success) return replyError(400, 'invalid_request', 'The body must be {"repoUrl": string, "ref"?: string} and nothing else.');

    const outcome = await withTimeout(deps.scanner.scan({ repoUrl: body.data.repoUrl, ...(body.data.ref !== undefined ? { ref: body.data.ref } : {}) }), deps.scanTimeoutMs);
    if (outcome === 'timeout') return replyError(504, 'scan_timeout', 'The scan took too long.');
    if (outcome.ok) {
      note.level = outcome.verdict.level;
      return reply(200, outcome.verdict);
    }
    return replyError(STATUS[outcome.code], outcome.code, outcome.message, outcome.code === 'busy' ? { 'retry-after': '5' } : undefined);
  }

  return (req, res) => {
    const started = Date.now();
    const note: { status?: number; level?: string } = {};
    void handle(req, res, note)
      .catch(() => {
        if (!res.headersSent) {
          note.status = 500;
          sendError(res, 500, 'internal_error', 'The request failed.');
        } else res.end();
      })
      .finally(() => deps.log({ event: 'request', id: randomUUID().slice(0, 8), method: req.method, path: new URL(req.url ?? '/', 'http://localhost').pathname, status: note.status ?? res.statusCode, ms: Date.now() - started, ...(note.level ? { level: note.level } : {}) }));
  };
}
