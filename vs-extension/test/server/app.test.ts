import { afterEach, describe, expect, test, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/server/app';
import type { ScanOutcome } from '../../src/server/scanRepo';
import type { WireVerdict } from '../../src/server/wire';

const KEY = 'service-key-0123456789abcdef';
const verdict = (over: Partial<WireVerdict> = {}): WireVerdict => ({
  level: 'high', target: { type: 'repo', id: 'github.com/octo/hostile' },
  findings: [{ layer: 'repo-file', severity: 'high', title: 'T', evidence: 'E', location: { file: 'a', line: 1 }, source: 'rules', checkedAt: '2026-10-30T00:00:00Z' }],
  indicators: { addresses: [], domains: [] }, notChecked: [], actions: ['Open with auto-run disabled'], explanation: null, ...over,
});

let server: http.Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())).then(() => (server = undefined)));

async function start(scan: (i: { repoUrl: string; ref?: string }) => Promise<ScanOutcome> = async () => ({ ok: true, verdict: verdict() }), over: { scanTimeoutMs?: number } = {}) {
  const logs: object[] = [];
  const scanner = { scan: vi.fn(scan) };
  server = http.createServer(createApp({ serviceKey: KEY, scanner, scanTimeoutMs: over.scanTimeoutMs ?? 5000, log: (e) => void logs.push(e) }));
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, headers: Record<string, string> = { 'x-service-key': KEY }, path = '/v1/internal/scan-repo') =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { base, post, scanner, logs };
}
const err = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

describe('health', () => {
  test('GET /healthz needs no key and says only that it is up', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('authentication (X-Service-Key)', () => {
  test.each([[{}], [{ 'x-service-key': '' }], [{ 'x-service-key': 'wrong' }], [{ 'x-service-key': KEY + 'x' }], [{ 'x-service-key': KEY.slice(1) }], [{ authorization: `Bearer ${KEY}` }]])('%j → 401 invalid_service_key, and nothing is scanned', async (headers) => {
    const { post, scanner } = await start();
    const res = await post({ repoUrl: 'https://github.com/o/r' }, headers);
    expect(res.status).toBe(401);
    expect(await err(res)).toEqual({ code: 'invalid_service_key', message: expect.any(String) });
    expect(scanner.scan).not.toHaveBeenCalled();
  });
  test('the key in the URL does not count', async () => {
    const { post } = await start();
    expect((await post({ repoUrl: 'https://github.com/o/r' }, {}, `/v1/internal/scan-repo?x-service-key=${KEY}`)).status).toBe(401);
  });
  test('an unauthenticated request is refused before its body is read, so a big body costs nothing', async () => {
    const { post } = await start();
    const res = await post('x'.repeat(200_000), { 'x-service-key': 'wrong' });
    expect(res.status).toBe(401);
  });
  test('the key never appears in a response or a log line', async () => {
    const { post, logs } = await start();
    const bodies = [await (await post({ repoUrl: 'https://github.com/o/r' })).text(), await (await post({ repoUrl: 'x' }, { 'x-service-key': 'wrong' })).text()];
    expect(bodies.join()).not.toContain(KEY);
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });
});

describe('authentication does not depend on the config being sane', () => {
  test('even an app built with an EMPTY key refuses a request that sends no key (or an empty one)', async () => {
    const logs: object[] = [];
    server = http.createServer(createApp({ serviceKey: '', scanner: { scan: async () => ({ ok: true, verdict: verdict() }) }, scanTimeoutMs: 1000, log: (e) => void logs.push(e) }));
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/internal/scan-repo`;
    const body = JSON.stringify({ repoUrl: 'https://github.com/o/r' });
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(401);
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-key': '' }, body })).status).toBe(401);
  });
});

describe('request handling', () => {
  test('a valid request returns the verdict exactly as the scanner produced it', async () => {
    const { post, scanner } = await start();
    const res = await post({ repoUrl: 'https://github.com/octo/hostile', ref: 'abcdef1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual(verdict());
    expect(scanner.scan).toHaveBeenCalledWith({ repoUrl: 'https://github.com/octo/hostile', ref: 'abcdef1' });
  });
  test('responses are not cached and not sniffed', async () => {
    const { post } = await start();
    const res = await post({ repoUrl: 'https://github.com/o/r' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
  test.each([
    ['not json', 'not json'], ['an array', '[]'], ['a string', '"x"'], ['null', 'null'],
    ['missing repoUrl', '{}'], ['repoUrl not a string', '{"repoUrl":5}'], ['an extra key', '{"repoUrl":"https://github.com/o/r","admin":true}'],
    ['ref not a string', '{"repoUrl":"https://github.com/o/r","ref":5}'], ['repoUrl too long', JSON.stringify({ repoUrl: 'https://github.com/o/' + 'a'.repeat(400) })],
  ])('%s → 400 invalid_request', async (_n, body) => {
    const { post, scanner } = await start();
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await err(res)).code).toBe('invalid_request');
    expect(scanner.scan).not.toHaveBeenCalled();
  });
  test('a body over 4 KiB → 413', async () => {
    const { post } = await start();
    const res = await post({ repoUrl: 'https://github.com/o/r', ref: 'a'.repeat(5000) });
    expect(res.status).toBe(413);
    expect((await err(res)).code).toBe('payload_too_large');
  });
  test('the content type must be JSON', async () => {
    const { base, scanner } = await start();
    const res = await fetch(`${base}/v1/internal/scan-repo`, { method: 'POST', headers: { 'content-type': 'text/plain', 'x-service-key': KEY }, body: '{"repoUrl":"https://github.com/o/r"}' });
    expect(res.status).toBe(415);
    expect(scanner.scan).not.toHaveBeenCalled();
  });
  test('unknown routes are 404 and wrong methods are 405 with Allow', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/v1/internal/report`, { method: 'POST', headers: { 'x-service-key': KEY } })).status).toBe(404);
    const get = await fetch(`${base}/v1/internal/scan-repo`, { headers: { 'x-service-key': KEY } });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await fetch(`${base}/healthz`, { method: 'POST' })).status).toBe(405);
  });
});

describe('failures use the API\'s error shape', () => {
  test.each([
    [{ ok: false, code: 'invalid_repo_url', message: 'Only public GitHub repositories are supported.' }, 400],
    [{ ok: false, code: 'invalid_ref', message: 'ref must be a commit id.' }, 400],
    [{ ok: false, code: 'clone_failed', message: 'Repository not found, or it is private.' }, 502],
    [{ ok: false, code: 'busy', message: 'The scanner is busy. Try again shortly.' }, 429],
    [{ ok: false, code: 'internal_error', message: 'The scan failed.' }, 500],
  ] as const)('%j → %i', async (outcome, status) => {
    const { post } = await start(async () => outcome);
    const res = await post({ repoUrl: 'https://github.com/o/r' });
    expect(res.status).toBe(status);
    expect(await err(res)).toEqual({ code: outcome.code, message: outcome.message });
    if (status === 429) expect(res.headers.get('retry-after')).toBe('5');
  });
  test('a scan that takes too long → 504 scan_timeout', async () => {
    const { post } = await start(() => new Promise(() => undefined), { scanTimeoutMs: 100 });
    const res = await post({ repoUrl: 'https://github.com/o/r' });
    expect(res.status).toBe(504);
    expect((await err(res)).code).toBe('scan_timeout');
  });
  test('an unexpected throw is a generic 500: no message, no stack, no path', async () => {
    const { post } = await start(() => Promise.reject(new Error('ENOENT /home/secret/clone/x')));
    const res = await post({ repoUrl: 'https://github.com/o/r' });
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('/home/secret');
    expect(text).not.toContain('ENOENT');
  });
  test('the verdict level is never "safe"', async () => {
    const { post } = await start(async () => ({ ok: true, verdict: verdict({ level: 'no_known_issues' }) }));
    const body = await (await post({ repoUrl: 'https://github.com/o/r' })).json() as WireVerdict;
    expect(body.level).toBe('no_known_issues');
  });
});

describe('logging', () => {
  test('one line per request: id, route, status and timing; no body, no key, no headers', async () => {
    const { post, logs } = await start();
    await post({ repoUrl: 'https://github.com/octo/hostile' });
    const line = logs.find((l) => (l as { event?: string }).event === 'request') as Record<string, unknown>;
    expect(line).toMatchObject({ event: 'request', method: 'POST', path: '/v1/internal/scan-repo', status: 200 });
    expect(line.ms).toBeTypeOf('number');
    expect(JSON.stringify(line)).not.toMatch(/x-service-key|authorization/i);
  });
});
