import { describe, expect, test, vi } from 'vitest';
import { createReporter } from '../../src/server/reporter';
import type { GraphReport } from '../../src/report/graphReport';
import { hang, recorder, reply } from '../api/helpers';

const KEY = 'service-key-0123456789abcdef';
const ADDR = '0x9f00000000000000000000000000000000000001';
const report = (): GraphReport => ({
  source: 'vscode', reporter: 'scan-repo', reason: 'install script sends funds to a drainer',
  nodes: [{ type: 'package', id: 'pkg:npm/evil-kit@1.0.0', risk: 'critical', category: 'drainer' }, { type: 'wallet', id: `1:${ADDR}`, risk: 'critical', category: 'drainer' }],
  edges: [{ type: 'package_drains_to', fromId: 'pkg:npm/evil-kit@1.0.0', toId: `1:${ADDR}` }],
});
const make = (fetchImpl: typeof fetch, apiUrl = 'http://localhost:8000') => createReporter({ apiUrl, serviceKey: KEY, fetchImpl });

describe('reporter', () => {
  test('POSTs the report to /v1/internal/report with the service key in X-Service-Key and nothing else identifying', async () => {
    const r = recorder(reply({ id: 'abc', synced: true }, { status: 201 }));
    await make(r.fetch).report(report());
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url).toBe('http://localhost:8000/v1/internal/report');
    expect(r.calls[0]!.init.method).toBe('POST');
    expect(r.calls[0]!.body).toEqual(report());
    const h = new Headers(r.calls[0]!.init.headers);
    expect(h.get('x-service-key')).toBe(KEY);
    expect([...h.keys()].sort()).toEqual(['accept', 'content-type', 'x-service-key']);
    expect(r.calls[0]!.init.redirect).toBe('error');
  });
  test('the key goes in the header only, never in the URL or the body', async () => {
    const r = recorder(reply({ id: 'abc', synced: true }, { status: 201 }));
    await make(r.fetch).report(report());
    expect(r.calls[0]!.url).not.toContain(KEY);
    expect(JSON.stringify(r.calls[0]!.body)).not.toContain(KEY);
  });
  test('201 is success whether or not TigerGraph has it yet', async () => {
    expect(await make(recorder(reply({ id: 'u1', synced: true }, { status: 201 })).fetch).report(report())).toEqual({ ok: true, value: { id: 'u1', synced: true } });
    expect(await make(recorder(reply({ id: 'u2', synced: false }, { status: 201 })).fetch).report(report())).toEqual({ ok: true, value: { id: 'u2', synced: false } });
  });
  test('a base URL with a path prefix is kept', async () => {
    const r = recorder(reply({ id: 'x', synced: true }, { status: 201 }));
    await make(r.fetch, 'https://api.stack3.example/prefix/').report(report());
    expect(r.calls[0]!.url).toBe('https://api.stack3.example/prefix/v1/internal/report');
  });
  test('401 means the service key was rejected, and says so', async () => {
    const res = await make(recorder(reply({ error: { code: 'invalid_service_key', message: 'no' } }, { status: 401 })).fetch).report(report());
    expect(res).toEqual({ ok: false, reason: 'The API rejected the service key.' });
  });
  test('400 means the report was refused', async () => {
    const res = await make(recorder(reply({ error: { code: 'invalid_report', message: 'bad id' } }, { status: 400 })).fetch).report(report());
    expect(res).toEqual({ ok: false, reason: 'The API rejected the report.' });
  });
  test('a response that is not {id, synced} is a failure', async () => {
    expect(await make(recorder(reply({ ok: true }, { status: 201 })).fetch).report(report())).toMatchObject({ ok: false });
  });
  test('a report the API would refuse is never sent', async () => {
    const r = recorder(reply({ id: 'x', synced: true }, { status: 201 }));
    const bad = report();
    bad.edges[0]!.toId = '1:0x' + 'b'.repeat(40);
    expect(await make(r.fetch).report(bad)).toMatchObject({ ok: false });
    expect(r.calls).toHaveLength(0);
  });
  test('network failure and timeout are failures, not throws', async () => {
    expect(await make(recorder(new TypeError('fetch failed')).fetch).report(report())).toMatchObject({ ok: false });
    vi.useFakeTimers();
    const pending = createReporter({ apiUrl: 'http://localhost:8000', serviceKey: KEY, fetchImpl: hang, timeoutMs: 1000 }).report(report());
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toMatchObject({ ok: false });
    vi.useRealTimers();
  });
  test('a 5xx is retried once; a 4xx is not', async () => {
    const r5 = recorder(reply({}, { status: 503 }), reply({ id: 'x', synced: true }, { status: 201 }));
    expect(await make(r5.fetch).report(report())).toMatchObject({ ok: true });
    expect(r5.calls).toHaveLength(2);
    const r4 = recorder(reply({}, { status: 400 }), reply({ id: 'x', synced: true }, { status: 201 }));
    await make(r4.fetch).report(report());
    expect(r4.calls).toHaveLength(1);
  });
});
