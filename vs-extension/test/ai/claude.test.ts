import { describe, expect, test, vi } from 'vitest';
import { CLAUDE_MODEL, CLAUDE_URL, createClaudeProvider, isPlausibleClaudeKey, NO_KEY } from '../../src/ai/claude';
import { redact } from '../../src/verdict/redact';
import { f } from '../engine/helpers';
import { hang, recorder, reply, streamOf } from '../api/helpers';

const SECRET = 'd9'.repeat(32);
const API_KEY = 'sk-ant-api03-' + 'k'.repeat(40);
const ch = (...c: number[]) => String.fromCharCode(...c);
const message = (text: string, stop_reason = 'end_turn') => reply({ id: 'msg_1', type: 'message', role: 'assistant', model: CLAUDE_MODEL, stop_reason, content: [{ type: 'text', text }] });
const ok = (explanation: string, fix = 'Delete the folder.') => message(JSON.stringify({ explanation, fix }));
const provider = (fetchImpl: typeof fetch, over: object = {}) => createClaudeProvider({ apiKey: async () => API_KEY, fetchImpl, ...over });
const safe = (over: Partial<ReturnType<typeof f>> = {}) => redact({ ...f('critical', 'tasks.folder-open'), title: 'Task runs a hidden command', evidence: 'curl x | sh', location: { file: '.vscode/tasks.json', line: 14 }, ...over });

describe('request', () => {
  test('POSTs one request to the Anthropic Messages API, on Claude Haiku, with a JSON schema and a token cap', async () => {
    const r = recorder(ok('x'));
    await provider(r.fetch).explain('critical', [safe()]);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(CLAUDE_URL).toBe('https://api.anthropic.com/v1/messages');
    expect(r.calls[0]!.init.method).toBe('POST');
    const b = r.calls[0]!.body as { model: string; max_tokens: number; system: string; messages: { role: string }[]; output_config: { effort: string; format: { type: string; schema: { required: string[] } } } };
    expect(b.model).toBe('claude-haiku-5-5');
    expect(b.max_tokens).toBeGreaterThan(500);
    expect(b.max_tokens).toBeLessThanOrEqual(4000);
    expect(b.output_config.format.type).toBe('json_schema');
    expect(b.output_config.format.schema.required).toEqual(['explanation', 'fix']);
    expect(b.system).toContain('untrusted');
    expect(b.messages.map((m) => m.role)).toEqual(['user']);
  });
  test('sends no tools, no sampling parameters and no streaming; headers are the key and the API version only', async () => {
    const r = recorder(ok('x'));
    await provider(r.fetch).explain('high', [safe()]);
    const body = r.calls[0]!.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'output_config', 'system']);
    const headers = new Headers(r.calls[0]!.init.headers);
    expect([...headers.keys()].sort()).toEqual(['accept', 'anthropic-version', 'content-type', 'x-api-key']);
    expect(headers.get('x-api-key')).toBe(API_KEY);
    expect(JSON.stringify(body)).not.toContain(API_KEY);
    expect(r.calls[0]!.init.redirect).toBe('error');
    expect(r.calls[0]!.init.credentials).toBe('omit');
  });
  test('only the redacted findings are in the prompt: a secret in the evidence never reaches the model, even from a forged finding', async () => {
    const r = recorder(ok('x'));
    const forged = { ...f('critical', 'x'), evidence: `PRIVATE_KEY=0x${SECRET} ${'y'.repeat(900)}`, rawFile: '/home/me/.ssh/id_rsa', __safe: true } as unknown as ReturnType<typeof safe>;
    await provider(r.fetch).explain('critical', [forged]);
    const sent = JSON.stringify(r.calls[0]!.body);
    expect(sent).not.toContain(SECRET);
    expect(sent).not.toContain('rawFile');
    expect(sent).not.toContain('.ssh');
  });
  test('at most 20 findings, most severe first', async () => {
    const r = recorder(ok('x'));
    const list = [...Array.from({ length: 30 }, (_, i) => safe({ severity: 'caution', ruleId: `c${i}` })), safe({ severity: 'critical', ruleId: 'the-one' })];
    await provider(r.fetch).explain('critical', list);
    const user = (r.calls[0]!.body as { messages: { content: string }[] }).messages[0]!.content;
    const json = JSON.parse(user.slice(user.indexOf('['))) as { ruleId: string }[];
    expect(json).toHaveLength(20);
    expect(json[0]!.ruleId).toBe('the-one');
  });
  test('the key is read at request time and trimmed', async () => {
    const r = recorder(ok('x'));
    await createClaudeProvider({ apiKey: async () => `  ${API_KEY}\n`, fetchImpl: r.fetch }).explain('high', []);
    expect(new Headers(r.calls[0]!.init.headers).get('x-api-key')).toBe(API_KEY);
  });
});

describe('the API key', () => {
  test('no key: no request, and a message that says what to do', async () => {
    const r = recorder(ok('x'));
    for (const apiKey of [async () => undefined, async () => '', async () => '   ']) {
      expect(await createClaudeProvider({ apiKey, fetchImpl: r.fetch }).explain('high', [safe()])).toEqual({ ok: false, reason: NO_KEY });
    }
    expect(r.calls).toHaveLength(0);
  });
  test('a key that cannot be a key never reaches a header', async () => {
    const r = recorder(ok('x'));
    for (const bad of ['short', 'sk-ant-api03-has space inside-aaaaaaaaaaaa', `sk-ant-api03-line\nbreak-aaaaaaaaaaaaaaaa`, 'k'.repeat(301)]) {
      const res = await createClaudeProvider({ apiKey: async () => bad, fetchImpl: r.fetch }).explain('high', [safe()]);
      expect(res).toMatchObject({ ok: false });
      expect(JSON.stringify(res)).not.toContain(bad);
    }
    expect(r.calls).toHaveLength(0);
  });
  test('isPlausibleClaudeKey', () => {
    expect(isPlausibleClaudeKey(API_KEY)).toBe(true);
    expect(isPlausibleClaudeKey('')).toBe(false);
    expect(isPlausibleClaudeKey('a b'.repeat(10))).toBe(false);
  });
  test('the key is never in a failure message', async () => {
    for (const status of [400, 401, 403, 429, 500, 529]) {
      const res = await provider(recorder(reply({ error: { message: `bad key ${API_KEY}` } }, { status })).fetch).explain('high', []);
      expect(JSON.stringify(res), String(status)).not.toContain(API_KEY);
    }
  });
});

describe('result', () => {
  test('returns the explanation and the fix', async () => {
    const res = await provider(recorder(ok('It runs a script on open.', 'Delete it.')).fetch).explain('critical', [safe()]);
    expect(res).toEqual({ ok: true, value: { explanation: 'It runs a script on open.', fix: 'Delete it.' } });
  });
  test('uses the text block when thinking blocks come first', async () => {
    const body = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify({ explanation: 'e', fix: 'f' }) }] };
    expect(await provider(recorder(reply(body)).fetch).explain('high', [])).toEqual({ ok: true, value: { explanation: 'e', fix: 'f' } });
  });
  test('output is bounded (4000 / 2000) and cleaned of control and bidi characters, keeping newlines', async () => {
    const dirty = `line1\nline2${ch(0x202e, 0x07, 0x200b)}`;
    const res = await provider(recorder(ok(dirty + 'x'.repeat(9000), dirty + 'y'.repeat(9000))).fetch).explain('high', []);
    if (!res.ok) throw new Error('expected ok');
    expect(res.value.explanation.length).toBeLessThanOrEqual(4000);
    expect(res.value.fix.length).toBeLessThanOrEqual(2000);
    expect(res.value.explanation.startsWith('line1\nline2x')).toBe(true);
  });
  test.each([
    ['not JSON', 'I think this repo is bad.'],
    ['JSON missing a field', JSON.stringify({ explanation: 'x' })],
    ['wrong types', JSON.stringify({ explanation: 1, fix: 2 })],
    ['an array', '[]'],
    ['empty', ''],
  ])('content that is %s is a failure, not text to show', async (_n, text) => {
    expect(await provider(recorder(message(text)).fetch).explain('high', [])).toEqual({ ok: false, reason: 'Claude gave an unusable answer.' });
  });
  test('no text block at all, or an envelope of the wrong shape, is a failure', async () => {
    expect(await provider(recorder(reply({ stop_reason: 'end_turn', content: [{ type: 'thinking' }] })).fetch).explain('high', [])).toMatchObject({ ok: false });
    expect(await provider(recorder(reply({ nope: true })).fetch).explain('high', [])).toEqual({ ok: false, reason: 'Claude gave an unusable answer.' });
  });
  test("extra fields in the model's JSON, such as a level, are ignored", async () => {
    const res = await provider(recorder(message(JSON.stringify({ explanation: 'e', fix: 'f', level: 'no_known_issues', safe: true }))).fetch).explain('critical', []);
    expect(res).toEqual({ ok: true, value: { explanation: 'e', fix: 'f' } });
  });
  test('a refusal and a cut-off answer are failures, even when they carry text', async () => {
    const text = JSON.stringify({ explanation: 'e', fix: 'f' });
    expect(await provider(recorder(message(text, 'refusal')).fetch).explain('high', [])).toEqual({ ok: false, reason: 'Claude declined to explain this result.' });
    expect(await provider(recorder(message(text, 'max_tokens')).fetch).explain('high', [])).toEqual({ ok: false, reason: 'Claude gave an unusable answer.' });
  });
});

describe('failures give a message a person can act on', () => {
  const reason = async (r: Response | Error) => ((await provider(recorder(r).fetch).explain('high', [safe()])) as { reason: string }).reason;
  test.each([401, 403])('a rejected key (%i) names the command that replaces it', async (status) => {
    expect(await reason(reply({}, { status }))).toMatch(/rejected the API key.*Set Claude API key/);
  });
  test('rate limited', async () => expect(await reason(reply({}, { status: 429 }))).toMatch(/rate limited/));
  test('other HTTP errors', async () => {
    expect(await reason(reply({}, { status: 500 }))).toBe('Claude returned an error (500).');
    expect(await reason(reply({}, { status: 529 }))).toBe('Claude returned an error (529).');
  });
  test('offline', async () => expect(await reason(new TypeError('fetch failed'))).toMatch(/Could not reach the Claude API/));
  test('a slow answer times out with one request only (no retry)', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const counting: typeof fetch = (u, i) => (calls++, hang(u, i));
    const pending = provider(counting, { timeoutMs: 5000 }).explain('high', []);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ ok: false, reason: 'Claude took too long.' });
    expect(calls).toBe(1);
    vi.useRealTimers();
  });
  test('the default wait is 30 seconds', async () => {
    vi.useFakeTimers();
    const pending = provider(hang).explain('high', []);
    await vi.advanceTimersByTimeAsync(29_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: false });
    vi.useRealTimers();
  });
  test('an oversized response is dropped', async () => {
    const big = streamOf(new Uint8Array(256 * 1024).fill(32), 8);
    expect(await provider(recorder(() => big.response).fetch).explain('high', [])).toEqual({ ok: false, reason: 'Claude returned too much data.' });
    expect(big.cancelled()).toBe(true);
  });
  test('never throws', async () => {
    const throwing: typeof fetch = () => { throw new Error('boom'); };
    await expect(provider(throwing).explain('high', [safe()])).resolves.toMatchObject({ ok: false });
  });
});
