import { describe, expect, test, vi } from 'vitest';
import { createStack3PackageScanner } from '../../src/server/stack3Packages';

const KEY = 'k'.repeat(24);
const NOW = Date.UTC(2026, 9, 30);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const finding = (extra: Record<string, unknown> = {}) => ({
  layer: 'dependency',
  severity: 'critical',
  title: 'Known malware: pkg:npm/evil@1.0.0',
  evidence: 'Socket alert: malware',
  source: 'socket',
  checkedAt: new Date(NOW).toISOString(),
  ...extra,
});
const verdict = (findings: unknown[] = [], notChecked: string[] = []) => ({ level: 'critical', target: { type: 'package', id: 'x' }, findings, notChecked, actions: [], explanation: null });

function setup(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => respond(String(url), init ?? {}));
  const scan = createStack3PackageScanner({ apiUrl: 'https://api.example/', serviceKey: KEY, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => NOW });
  return { scan, fetchImpl };
}

describe('request', () => {
  test('posts the purls to the internal route with the service key header only', async () => {
    const { scan, fetchImpl } = setup(() => json(verdict()));
    await scan(['pkg:npm/left-pad@1.3.0']);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example/v1/internal/scan-packages');
    expect((init.headers as Record<string, string>)['x-service-key']).toBe(KEY);
    expect(JSON.parse(String(init.body))).toEqual({ purls: ['pkg:npm/left-pad@1.3.0'] });
  });
  test('sends nothing for an empty list, and never a malformed purl', async () => {
    const { scan, fetchImpl } = setup(() => json(verdict()));
    expect(await scan([])).toEqual({ ok: true, value: [] });
    const r = await scan(['not a purl']);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, value: [], notChecked: [expect.stringMatching(/1 of 1/)] });
  });
  test('splits into batches of 40', async () => {
    const { scan, fetchImpl } = setup(() => json(verdict()));
    await scan(Array.from({ length: 85 }, (_, i) => `pkg:npm/p${i}@1.0.0`));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String((fetchImpl.mock.calls[0]![1] as RequestInit).body)).purls).toHaveLength(40);
  });
});

describe('answer', () => {
  test('turns API findings into findings, giving them a rule id and keeping the source', async () => {
    const { scan } = setup(() => json(verdict([finding(), finding({ source: 'graph', layer: 'graph', severity: 'high' })])));
    const r = await scan(['pkg:npm/evil@1.0.0']);
    expect(r).toMatchObject({ ok: true, value: [{ ruleId: 'stack3.socket', source: 'socket', severity: 'critical' }, { ruleId: 'stack3.graph', source: 'graph' }] });
  });
  test('a Socket outage on the API side is reported as not checked, never as clean', async () => {
    const { scan } = setup(() => json(verdict([], ['socket'])));
    const r = await scan(['pkg:npm/a@1.0.0']);
    expect(r).toMatchObject({ ok: true, value: [], notChecked: [expect.stringMatching(/Socket/)] });
  });
  test('a level sent by the API is ignored: only findings count', async () => {
    const { scan } = setup(() => json({ ...verdict(), level: 'no_known_issues' }));
    expect(await scan(['pkg:npm/a@1.0.0'])).toEqual({ ok: true, value: [] });
  });
});

describe('failure', () => {
  test('401 and 422 give a plain reason', async () => {
    expect(await setup(() => json({}, 401)).scan(['pkg:npm/a@1.0.0'])).toEqual({ ok: false, reason: 'The API rejected the service key.' });
    expect(await setup(() => json({}, 422)).scan(['pkg:npm/a@1.0.0'])).toMatchObject({ ok: false, reason: expect.stringMatching(/package/i) });
  });
  test('a garbled answer fails closed', async () => {
    expect(await setup(() => json({ findings: 'x' })).scan(['pkg:npm/a@1.0.0'])).toMatchObject({ ok: false });
  });
  test('a partly failed run still returns what it got and says the rest was not checked', async () => {
    let n = 0;
    const { scan } = setup(() => (n++ === 0 ? json(verdict([finding()])) : json({}, 401)));
    const r = await scan(Array.from({ length: 45 }, (_, i) => `pkg:npm/p${i}@1.0.0`));
    expect(r).toMatchObject({ ok: true, value: [expect.anything()], notChecked: [expect.stringMatching(/5 of 45/)] });
  });
});
