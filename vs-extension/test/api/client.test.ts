import { afterEach, describe, expect, test, vi } from 'vitest';
import { createClient, validateBaseUrl } from '../../src/api/client';
import { redact } from '../../src/verdict/redact';
import type { Finding } from '../../src/engine/types';
import { f } from '../engine/helpers';
import { hang, recorder, reply, streamOf } from './helpers';

const BASE = 'https://api.stack3.example';
const PURL = 'pkg:npm/lodash@4.17.21';
const KEY = 'c3'.repeat(32);
const remoteFinding = (over: object = {}) => ({ ...f('critical', 'socket.malware'), layer: 'dependency', source: 'socket', ...over });
const client = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) =>
  createClient({ baseUrl: BASE, allowLocalhost: false, fetchImpl, clientVersion: '1.2.3', ...over });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('base URL (I-16)', () => {
  test.each([
    ['https://api.stack3.example', false, true],
    ['https://api.stack3.example/v1', false, true],
    ['http://api.stack3.example', false, false],
    ['http://api.stack3.example', true, false],
    ['http://localhost:3000', false, false],
    ['http://localhost:3000', true, true],
    ['http://127.0.0.1:8787', true, true],
    ['http://[::1]:8787', true, true],
    ['http://localhost.evil.example', true, false],
    ['http://127.0.0.1.evil.example', true, false],
    ['https://user:pw@api.stack3.example', false, false],
    ['ftp://api.stack3.example', false, false],
    ['file:///etc/passwd', true, false],
    ['javascript:alert(1)', true, false],
    ['not a url', false, false],
    ['', false, false],
  ])('%j (allowLocalhost=%s) → allowed=%s', (baseUrl, allowLocalhost, allowed) => {
    expect(validateBaseUrl(baseUrl, allowLocalhost).ok).toBe(allowed);
  });

  test('a rejected URL makes every call fail without touching the network', async () => {
    const r = recorder(reply({ findings: [] }));
    const c = createClient({ baseUrl: 'http://api.stack3.example', allowLocalhost: true, fetchImpl: r.fetch });
    expect(await c.scanPackage([PURL])).toMatchObject({ ok: false });
    expect(await c.explain('high', [])).toMatchObject({ ok: false });
    expect(await c.report({ indicators: { addresses: [], domains: [] }, ruleIds: [] })).toMatchObject({ ok: false });
    expect(r.calls).toHaveLength(0);
  });
  test('an empty URL is "not configured"', async () => {
    const r = recorder(reply({}));
    const res = await createClient({ baseUrl: '', allowLocalhost: false, fetchImpl: r.fetch }).scanPackage([PURL]);
    expect(res).toEqual({ ok: false, reason: 'API not configured' });
    expect(r.calls).toHaveLength(0);
  });
});

describe('scanPackage', () => {
  test('POSTs only the purls, with one identifying header and no credentials, cookies or redirects', async () => {
    const r = recorder(reply({ findings: [] }));
    await client(r.fetch).scanPackage([PURL]);
    const [call] = r.calls;
    expect(call?.url).toBe(`${BASE}/scan-package`);
    expect(call?.init.method).toBe('POST');
    expect(call?.body).toEqual({ purls: [PURL] });
    const headers = new Headers(call?.init.headers);
    expect(headers.get('x-stack3-client')).toBe('vscode/1.2.3');
    expect([...headers.keys()].sort()).toEqual(['accept', 'content-type', 'x-stack3-client']);
    expect(call?.init.credentials).toBe('omit');
    expect(call?.init.redirect).toBe('error');
  });
  test('a base URL with a path prefix is kept, and a trailing slash is not doubled', async () => {
    const r = recorder(reply({ findings: [] }));
    await client(r.fetch, { baseUrl: `${BASE}/v1/` }).scanPackage([PURL]);
    expect(r.calls[0]?.url).toBe(`${BASE}/v1/scan-package`);
  });
  test('no packages → ok with no findings, and no request', async () => {
    const r = recorder(reply({ findings: [remoteFinding()] }));
    expect(await client(r.fetch).scanPackage([])).toEqual({ ok: true, value: [] });
    expect(r.calls).toHaveLength(0);
  });
  test('anything that is not a purl is refused before it can leave the machine', async () => {
    const r = recorder(reply({ findings: [] }));
    for (const bad of ['/home/me/project', 'lodash', `pkg:npm/x@1 ${KEY}`, 'pkg:npm/' + 'x'.repeat(400) + '@1.0.0']) {
      expect(await client(r.fetch).scanPackage([PURL, bad])).toEqual({ ok: false, reason: 'Invalid package list' });
    }
    expect(r.calls).toHaveLength(0);
  });
  test('findings come back typed, forced to source "socket", with unknown keys and the server level stripped', async () => {
    const r = recorder(reply({ level: 'no_known_issues', findings: [remoteFinding({ source: 'rules', layer: 'repo-file', extra: 'x' })], debug: true }));
    const res = await client(r.fetch).scanPackage([PURL]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0]?.source).toBe('socket');
    expect(res.value[0]).not.toHaveProperty('extra');
    expect(res).not.toHaveProperty('level');
  });
  test('a response that does not match the schema is a failure, not "no findings"', async () => {
    for (const body of [{ findings: 'x' }, { findings: [{ ruleId: 1 }] }, [], 'null', '<html>', '']) {
      expect(await client(recorder(reply(body)).fetch).scanPackage([PURL])).toMatchObject({ ok: false });
    }
  });
  test('4xx is final; 5xx and network errors are retried once', async () => {
    const r4 = recorder(reply({}, { status: 403 }), reply({ findings: [] }));
    expect(await client(r4.fetch).scanPackage([PURL])).toEqual({ ok: false, reason: 'API returned 403' });
    expect(r4.calls).toHaveLength(1);

    const r5 = recorder(reply({}, { status: 503 }), reply({ findings: [] }));
    expect(await client(r5.fetch).scanPackage([PURL])).toEqual({ ok: true, value: [] });
    expect(r5.calls).toHaveLength(2);

    const rn = recorder(new TypeError('fetch failed'), reply({ findings: [] }));
    expect(await client(rn.fetch).scanPackage([PURL])).toMatchObject({ ok: true });
    expect(rn.calls).toHaveLength(2);

    const rb = recorder(new TypeError('fetch failed'));
    expect(await client(rb.fetch).scanPackage([PURL])).toEqual({ ok: false, reason: 'Network error' });
    expect(rb.calls).toHaveLength(2);
  });
  test('timeout at 8000 ms per attempt → ok:false after one retry', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const counting: typeof fetch = (u, i) => (calls++, hang(u, i));
    const pending = client(counting).scanPackage([PURL]);
    await vi.advanceTimersByTimeAsync(7999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toEqual({ ok: false, reason: 'Timed out' });
  });
  test('a body that stalls after the headers is cut off by the same timeout', async () => {
    vi.useFakeTimers();
    const stalled = () => new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
    const pending = client(recorder(stalled).fetch).scanPackage([PURL]);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await pending).toEqual({ ok: false, reason: 'Timed out' });
  });
  test('a response over 1 MiB is dropped and the stream is cancelled', async () => {
    const big = streamOf(new Uint8Array(256 * 1024).fill(32), 8);
    const res = await client(recorder(() => big.response).fetch).scanPackage([PURL]);
    expect(res).toEqual({ ok: false, reason: 'Response too large' });
    expect(big.cancelled()).toBe(true);
  });
  test('a declared content-length over 1 MiB is refused without reading', async () => {
    const big = streamOf(new Uint8Array(10), 1, { 'content-length': String(5 * 1024 * 1024) });
    expect(await client(recorder(() => big.response).fetch).scanPackage([PURL])).toEqual({ ok: false, reason: 'Response too large' });
  });
  test('a 10 MB hostile body is not buffered whole', async () => {
    const big = streamOf(new Uint8Array(1024 * 1024).fill(97), 10);
    const t = Date.now();
    expect(await client(recorder(() => big.response).fetch).scanPackage([PURL])).toMatchObject({ ok: false });
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe('explain', () => {
  const safe = (over: Partial<Finding> = {}) => redact({ ...f('high'), ...over });

  test('the body holds only SafeFinding fields, at most 20 items, evidence at most 300 characters', async () => {
    const r = recorder(reply({ explanation: 'e', fix: 'f' }));
    const many = Array.from({ length: 35 }, (_, i) => safe({ ruleId: `r${i}`, evidence: 'x'.repeat(250) }));
    // A forged "safe" finding: oversized evidence, a secret and an extra field the type does not allow.
    const forged = { ...f('critical', 'forged'), evidence: `${'y'.repeat(900)} PRIVATE_KEY=0x${KEY}`, rawFile: '/home/me/.ssh/id_rsa', __safe: true } as unknown as ReturnType<typeof safe>;
    await client(r.fetch).explain('critical', [forged, ...many]);
    const body = r.calls[0]?.body as { level: string; findings: Record<string, unknown>[] };
    expect(Object.keys(body).sort()).toEqual(['findings', 'level']);
    expect(body.level).toBe('critical');
    expect(body.findings).toHaveLength(20);
    for (const item of body.findings) {
      expect(Object.keys(item).every((k) => ['ruleId', 'layer', 'severity', 'title', 'evidence', 'location', 'source', 'checkedAt'].includes(k))).toBe(true);
      expect(String(item.evidence).length).toBeLessThanOrEqual(300);
    }
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(JSON.stringify(body)).not.toContain('rawFile');
    expect(JSON.stringify(body)).not.toContain('.ssh');
  });
  test('the most severe findings are the ones kept', async () => {
    const r = recorder(reply({ explanation: 'e', fix: 'f' }));
    const list = [...Array.from({ length: 30 }, (_, i) => safe({ severity: 'caution', ruleId: `c${i}` })), safe({ severity: 'critical', ruleId: 'the-one' })];
    await client(r.fetch).explain('critical', list);
    expect((r.calls[0]?.body as { findings: { ruleId: string }[] }).findings[0]?.ruleId).toBe('the-one');
  });
  test('returns the explanation and fix, ignoring any level the server adds', async () => {
    const r = recorder(reply({ explanation: 'It runs a script.', fix: 'Delete it.', level: 'no_known_issues', verdict: 'safe' }));
    const res = await client(r.fetch).explain('critical', []);
    expect(res).toEqual({ ok: true, value: { explanation: 'It runs a script.', fix: 'Delete it.' } });
  });
  test('output is bounded and cleaned: 4000 / 2000 characters, no control or bidi characters, newlines kept', async () => {
    const dirty = `line1\nline2${String.fromCharCode(0x202e, 0x07, 0x200b)}`;
    const r = recorder(reply({ explanation: dirty + 'x'.repeat(9000), fix: dirty + 'y'.repeat(9000) }));
    const res = await client(r.fetch).explain('high', []);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.explanation.length).toBeLessThanOrEqual(4000);
    expect(res.value.fix.length).toBeLessThanOrEqual(2000);
    expect(res.value.explanation.startsWith('line1\nline2x')).toBe(true);
  });
  test('missing or non-string fields are a failure', async () => {
    expect(await client(recorder(reply({ explanation: 'e' })).fetch).explain('high', [])).toMatchObject({ ok: false });
    expect(await client(recorder(reply({ explanation: 1, fix: 2 })).fetch).explain('high', [])).toMatchObject({ ok: false });
  });
});

describe('report', () => {
  test('sends indicators, source and rule ids, with any secret-shaped value removed', async () => {
    const r = recorder(reply({ accepted: 2 }));
    const res = await client(r.fetch).report({
      indicators: { addresses: ['0x9f00000000000000000000000000000000000001'], domains: ['bad.example', `api.telegram.org/bot1234567890:${'A'.repeat(35)}`] },
      source: { type: 'repo', id: 'github.com/x/y@3f9c2a1' },
      ruleIds: ['tasks.folder-open'],
    });
    expect(res).toEqual({ ok: true, value: undefined });
    const body = r.calls[0]?.body as { indicators: { domains: string[] } };
    expect(r.calls[0]?.url).toBe(`${BASE}/report`);
    expect(JSON.stringify(body)).not.toContain('A'.repeat(35));
    expect(body.indicators.domains[0]).toBe('bad.example');
  });
  test('a failed report is a failure result, never a throw', async () => {
    expect(await client(recorder(reply({}, { status: 500 })).fetch).report({ indicators: { addresses: [], domains: [] }, ruleIds: [] })).toMatchObject({ ok: false });
  });
});

describe('STACK3_MOCK=1', () => {
  test('serves mocks/*.json with no network, through the same schemas', async () => {
    vi.stubEnv('STACK3_MOCK', '1');
    const r = recorder(reply({ findings: [] }));
    const c = createClient({ baseUrl: '', allowLocalhost: false, fetchImpl: r.fetch });
    const scan = await c.scanPackage(['pkg:npm/some-lib@1.0.3']);
    expect(scan.ok && scan.value.map((x) => `${x.severity}:${x.source}`)).toEqual(['critical:socket']);
    expect(await c.scanPackage([PURL])).toEqual({ ok: true, value: [] });
    expect(await c.explain('critical', [])).toMatchObject({ ok: true, value: { explanation: expect.any(String), fix: expect.any(String) } });
    expect(await c.report({ indicators: { addresses: [], domains: [] }, ruleIds: [] })).toEqual({ ok: true, value: undefined });
    expect(r.calls).toHaveLength(0);
  });
  test('only the exact value "1" turns it on', async () => {
    vi.stubEnv('STACK3_MOCK', 'true');
    const r = recorder(reply({ findings: [] }));
    await createClient({ baseUrl: BASE, allowLocalhost: false, fetchImpl: r.fetch }).scanPackage([PURL]);
    expect(r.calls).toHaveLength(1);
  });
});
