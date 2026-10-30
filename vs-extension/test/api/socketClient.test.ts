import { describe, expect, test } from 'vitest';
import { createClient, type Stack3Client } from '../../src/api/client';
import { buildVerdict, PACKAGE_SCAN_UNAVAILABLE } from '../../src/api/merge';
import { isPlausibleSocketKey, withSocket } from '../../src/api/socketClient';
import type { EngineResult } from '../../src/engine/types';
import { I, T } from '../engine/helpers';
import { recorder } from './helpers';

const KEY = 'sktsec_' + 'z'.repeat(40);
const PURL = 'pkg:npm/lodash@4.17.21';
const local: EngineResult = { findings: [], notChecked: [], purls: [PURL] };
const row = (purl: string, alerts: unknown[] = []) => ({ type: 'npm', name: purl.slice(8, purl.lastIndexOf('@')), version: purl.slice(purl.lastIndexOf('@') + 1), inputPurl: purl, alerts });
const ndjson = (...rows: unknown[]) => new Response(rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
const high = { key: 'k1', type: 'installScripts', severity: 'high', category: 'supplyChainRisk' };

function build(socket: ReturnType<typeof recorder>, key: string | undefined, stack3 = recorder(ndjson())): { client: Stack3Client; stack3: ReturnType<typeof recorder> } {
  const base = createClient({ baseUrl: 'https://api.stack3.example', allowLocalhost: false, fetchImpl: stack3.fetch });
  return { client: withSocket(base, { apiKey: async () => key, fetchImpl: socket.fetch, sleep: async () => undefined }), stack3 };
}

describe('package check straight to Socket with the user\'s own key', () => {
  test('posts only package URLs to api.socket.dev; the key is a bearer header and never in the body or the URL', async () => {
    const socket = recorder(ndjson(row(PURL)));
    const { client, stack3 } = build(socket, KEY);
    expect((await client.scanPackage([PURL])).ok).toBe(true);
    const call = socket.calls[0]!;
    expect(new URL(call.url).origin).toBe('https://api.socket.dev');
    expect(call.body).toEqual({ components: [{ purl: PURL }] });
    expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    expect(call.url + JSON.stringify(call.body)).not.toContain(KEY);
    expect(stack3.calls).toHaveLength(0); // nothing goes to the Stack3 API for packages
  });

  test('a clean package is checked and clean: no findings, nothing "not checked", and the repo can read no_known_issues', async () => {
    const { client } = build(recorder(ndjson(row(PURL))), KEY);
    const res = await client.scanPackage([PURL]);
    expect(res).toEqual({ ok: true, value: [] });
    expect(buildVerdict(local, res, T, I).level).toBe('no_known_issues');
  });

  test('a flagged package becomes a finding that raises the level', async () => {
    const { client } = build(recorder(ndjson(row(PURL, [high]))), KEY);
    const res = await client.scanPackage([PURL]);
    expect(res.ok && res.value[0]).toMatchObject({ severity: 'high', source: 'socket' });
    expect(buildVerdict(local, res, T, I).level).toBe('high');
  });

  test('a package Socket could not resolve is carried into the verdict as not checked', async () => {
    const { client } = build(recorder(ndjson({ _type: 'purlError', purl: PURL, error: 'not found' })), KEY);
    const v = buildVerdict(local, await client.scanPackage([PURL]), T, I);
    expect(v.notChecked.join(' ')).toMatch(/not checked/);
    expect(v.level).toBe('unknown');
  });

  test('a rejected key, or a failed call, reads "Package scan unavailable", not clean', async () => {
    const { client } = build(recorder(new Response('{"error":"nope"}', { status: 401 })), KEY);
    const res = await client.scanPackage([PURL]);
    expect(res.ok).toBe(false);
    const notChecked = buildVerdict(local, res, T, I).notChecked;
    expect(notChecked).toHaveLength(1);
    expect(notChecked[0]).toMatch(new RegExp(`^${PACKAGE_SCAN_UNAVAILABLE}: Socket rejected the key.*packages:list`));
  });

  test('no key and no Stack3 API: the verdict says to set a Socket key, and it is still not clean', async () => {
    const socket = recorder(ndjson(row(PURL)));
    const base = createClient({ baseUrl: '', allowLocalhost: false });
    const client = withSocket(base, { apiKey: async () => undefined, fetchImpl: socket.fetch });
    const res = await client.scanPackage([PURL]);
    expect(res.ok).toBe(false);
    const v = buildVerdict(local, res, T, I);
    expect(v.notChecked[0]).toMatch(/Set Socket API key/);
    expect(v.level).toBe('unknown');
    expect(socket.calls).toHaveLength(0);
  });

  test('Socket quota used up (429) says so, instead of a bare "unavailable"', async () => {
    const { client } = build(recorder(new Response('{"error":{"message":"Insufficient quota"}}', { status: 429 }), new Response('{}', { status: 429 })), KEY);
    const v = buildVerdict(local, await client.scanPackage([PURL]), T, I);
    expect(v.notChecked[0]).toMatch(/quota is used up/);
    expect(v.level).toBe('unknown');
  });

  test('a bad key never reaches a request, and the reason says to replace it', async () => {
    const socket = recorder(ndjson(row(PURL)));
    const { client } = build(socket, 'short');
    const v = buildVerdict(local, await client.scanPackage([PURL]), T, I);
    expect(v.notChecked[0]).toMatch(/not valid.*Set Socket API key/);
    expect(socket.calls).toHaveLength(0);
  });

  test('a rate limit is retried once', async () => {
    const socket = recorder(new Response('', { status: 429 }), ndjson(row(PURL)));
    const { client } = build(socket, KEY);
    expect((await client.scanPackage([PURL])).ok).toBe(true);
    expect(socket.calls).toHaveLength(2);
  });

  test('no key: nothing goes to Socket, and the plain client answers (not configured here, so unavailable)', async () => {
    const socket = recorder(ndjson(row(PURL)));
    const { client } = build(socket, undefined);
    await client.scanPackage([PURL]);
    expect(socket.calls).toHaveLength(0);
  });

  test('a key with a line break or spaces is never sent', async () => {
    const socket = recorder(ndjson(row(PURL)));
    const { client } = build(socket, `${KEY}\nx-evil: 1`);
    expect((await client.scanPackage([PURL])).ok).toBe(false);
    expect(socket.calls).toHaveLength(0);
    expect(isPlausibleSocketKey(KEY)).toBe(true);
    expect(isPlausibleSocketKey('short')).toBe(false);
    expect(isPlausibleSocketKey(`${KEY} x`)).toBe(false);
  });

  test('explain and report still use the plain client, never Socket', async () => {
    const socket = recorder(ndjson(row(PURL)));
    const stack3 = recorder(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));
    const { client } = build(socket, KEY, stack3);
    await client.report({ indicators: { addresses: [], domains: [] }, ruleIds: [] });
    expect(stack3.calls[0]!.url).toBe('https://api.stack3.example/report');
    expect(socket.calls).toHaveLength(0);
  });
});
