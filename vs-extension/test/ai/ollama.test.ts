import { describe, expect, test, vi } from 'vitest';
import { createOllamaProvider, OLLAMA_URL, validateOllamaUrl } from '../../src/ai/ollama';
import { redact } from '../../src/verdict/redact';
import { f } from '../engine/helpers';
import { hang, recorder, reply, streamOf } from '../api/helpers';

const KEY = 'd9'.repeat(32);
const ch = (...c: number[]) => String.fromCharCode(...c);
const ok = (explanation: string, fix = 'Delete the folder.') => reply({ model: 'm', done: true, message: { role: 'assistant', content: JSON.stringify({ explanation, fix }) } });
const provider = (fetchImpl: typeof fetch, over: object = {}) => createOllamaProvider({ model: 'qwen2.5-coder:7b', fetchImpl, ...over });
const safe = (over: Partial<ReturnType<typeof f>> = {}) => redact({ ...f('critical', 'tasks.folder-open'), title: 'Task runs a hidden command', evidence: 'curl x | sh', location: { file: '.vscode/tasks.json', line: 14 }, ...over });

describe('validateOllamaUrl: the model must run on this computer', () => {
  test.each([
    ['http://127.0.0.1:11434', true], ['http://localhost:11434', true], ['http://[::1]:11434', true], ['https://127.0.0.1:11434', true],
    ['http://192.168.1.5:11434', false], ['http://10.0.0.2:11434', false], ['http://example.com', false], ['https://api.openai.com', false],
    ['http://localhost.evil.example', false], ['http://127.0.0.1.evil.example', false], ['http://localhost@evil.example', false],
    ['http://user:pw@127.0.0.1:11434', false], ['ftp://localhost', false], ['file:///etc/passwd', false], ['not a url', false], ['', false],
  ])('%j → %s', (url, allowed) => expect(validateOllamaUrl(url) !== undefined).toBe(allowed));
  test('the default is the loopback address Ollama listens on', () => expect(OLLAMA_URL).toBe('http://127.0.0.1:11434'));
});

describe('request', () => {
  test('POSTs one non-streaming chat request with a JSON schema, low temperature and a token cap', async () => {
    const r = recorder(ok('x'));
    await provider(r.fetch).explain('critical', [safe()]);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(r.calls[0]!.init.method).toBe('POST');
    const b = r.calls[0]!.body as { model: string; stream: boolean; format: { required: string[] }; options: { temperature: number; num_predict: number }; messages: { role: string; content: string }[] };
    expect(b.model).toBe('qwen2.5-coder:7b');
    expect(b.stream).toBe(false);
    expect(b.format.required).toEqual(['explanation', 'fix']);
    expect(b.options.temperature).toBeLessThanOrEqual(0.3);
    expect(b.options.num_predict).toBeGreaterThan(100);
    expect(b.options.num_predict).toBeLessThanOrEqual(800);
    expect(b.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });
  test('sends no tools, no images and no identifying header; no redirects or credentials', async () => {
    const r = recorder(ok('x'));
    await provider(r.fetch).explain('high', [safe()]);
    const body = r.calls[0]!.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['format', 'keep_alive', 'messages', 'model', 'options', 'stream']);
    expect(JSON.stringify(body)).not.toMatch(/"tools"|"images"/);
    const headers = new Headers(r.calls[0]!.init.headers);
    expect([...headers.keys()].sort()).toEqual(['accept', 'content-type']);
    expect(r.calls[0]!.init.redirect).toBe('error');
    expect(r.calls[0]!.init.credentials).toBe('omit');
  });
  test('only the redacted findings are in the prompt: a secret in the evidence never reaches the model, even from a forged finding', async () => {
    const r = recorder(ok('x'));
    const forged = { ...f('critical', 'x'), evidence: `PRIVATE_KEY=0x${KEY} ${'y'.repeat(900)}`, rawFile: '/home/me/.ssh/id_rsa', __safe: true } as unknown as ReturnType<typeof safe>;
    await provider(r.fetch).explain('critical', [forged]);
    const sent = JSON.stringify(r.calls[0]!.body);
    expect(sent).not.toContain(KEY);
    expect(sent).not.toContain('rawFile');
    expect(sent).not.toContain('.ssh');
  });
  test('at most 20 findings, most severe first', async () => {
    const r = recorder(ok('x'));
    const list = [...Array.from({ length: 30 }, (_, i) => safe({ severity: 'caution', ruleId: `c${i}` })), safe({ severity: 'critical', ruleId: 'the-one' })];
    await provider(r.fetch).explain('critical', list);
    const user = (r.calls[0]!.body as { messages: { content: string }[] }).messages[1]!.content;
    const json = JSON.parse(user.slice(user.indexOf('['))) as { ruleId: string }[];
    expect(json).toHaveLength(20);
    expect(json[0]!.ruleId).toBe('the-one');
  });
  test('the model name is passed through unchanged', async () => {
    const r = recorder(ok('x'));
    await createOllamaProvider({ model: 'llama3.2:latest', fetchImpl: r.fetch }).explain('high', []);
    expect((r.calls[0]!.body as { model: string }).model).toBe('llama3.2:latest');
  });
  test('a base URL that is not on this computer is refused before any request', async () => {
    const r = recorder(ok('x'));
    const res = await createOllamaProvider({ model: 'm', baseUrl: 'http://192.168.1.5:11434', fetchImpl: r.fetch }).explain('high', [safe()]);
    expect(res).toEqual({ ok: false, reason: 'The local model must run on this computer (127.0.0.1 or localhost).' });
    expect(r.calls).toHaveLength(0);
  });
  test('is marked local, so nothing it is given leaves the machine', () => expect(provider(recorder(ok('x')).fetch).isLocal).toBe(true));
});

describe('result', () => {
  test('returns the explanation and the fix', async () => {
    const res = await provider(recorder(ok('It runs a script on open.', 'Delete it.')).fetch).explain('critical', [safe()]);
    expect(res).toEqual({ ok: true, value: { explanation: 'It runs a script on open.', fix: 'Delete it.' } });
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
  ])('content that is %s is a failure, not text to show', async (_n, content) => {
    const res = await provider(recorder(reply({ message: { content } })).fetch).explain('high', []);
    expect(res).toEqual({ ok: false, reason: 'The local model gave an unusable answer.' });
  });
  test('extra fields in the model\'s JSON, such as a level, are ignored', async () => {
    const res = await provider(recorder(reply({ message: { content: JSON.stringify({ explanation: 'e', fix: 'f', level: 'no_known_issues', safe: true }) } })).fetch).explain('critical', []);
    expect(res).toEqual({ ok: true, value: { explanation: 'e', fix: 'f' } });
  });
});

describe('failures give a message a person can act on', () => {
  test('Ollama not running', async () => {
    const res = await provider(recorder(new TypeError('fetch failed')).fetch).explain('high', [safe()]);
    expect(res).toMatchObject({ ok: false });
    expect((res as { reason: string }).reason).toMatch(/Ollama is not running.*ollama serve/);
  });
  test('model not installed names the command to fix it', async () => {
    const res = await provider(recorder(reply({ error: "model 'qwen2.5-coder:7b' not found" }, { status: 404 })).fetch).explain('high', [safe()]);
    expect((res as { reason: string }).reason).toBe('The model "qwen2.5-coder:7b" is not installed. Run: ollama pull qwen2.5-coder:7b');
  });
  test('other HTTP errors', async () => {
    expect(await provider(recorder(reply({}, { status: 500 })).fetch).explain('high', [])).toEqual({ ok: false, reason: 'The local model returned an error (500).' });
  });
  test('a slow model times out with one request only (no retry)', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const counting: typeof fetch = (u, i) => (calls++, hang(u, i));
    const pending = createOllamaProvider({ model: 'm', fetchImpl: counting, timeoutMs: 5000 }).explain('high', []);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ ok: false, reason: 'The local model took too long.' });
    expect(calls).toBe(1);
    vi.useRealTimers();
  });
  test('the default wait is long enough for a CPU-only machine (2 minutes)', async () => {
    vi.useFakeTimers();
    const pending = provider(hang).explain('high', []);
    await vi.advanceTimersByTimeAsync(119_999);
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
    expect(await provider(recorder(() => big.response).fetch).explain('high', [])).toEqual({ ok: false, reason: 'The local model returned too much data.' });
    expect(big.cancelled()).toBe(true);
  });
  test('never throws', async () => {
    const throwing: typeof fetch = () => { throw new Error('boom'); };
    await expect(provider(throwing).explain('high', [safe()])).resolves.toMatchObject({ ok: false });
  });
});
