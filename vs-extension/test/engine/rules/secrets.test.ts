import { describe, expect, test } from 'vitest';
import { secretRules } from '../../../src/engine/rules/secrets';
import { ctx, vf } from '../load';

const run = (files: ReturnType<typeof vf>[], c = ctx) => secretRules.flatMap((r) => r(files, c));
const ids = (files: ReturnType<typeof vf>[], c = ctx) => run(files, c).map((f) => f.ruleId);

const KEY = 'a1'.repeat(32); // 64 hex chars
const abandon = (n: number, last: string) => [...Array<string>(n - 1).fill('abandon'), last].join(' ');
const MNEMONIC_12 = abandon(12, 'about');

describe('secret.evm-key', () => {
  test.each([`PRIVATE_KEY=0x${KEY}`, `const pk = "${KEY}";`, `"deployer": "0x${KEY}"`, `wallet secret: 0x${KEY.toUpperCase()}`])('%s', (line) => {
    expect(ids([vf('src/a.js', line)])).toEqual(['secret.evm-key']);
  });
  test('a 64-hex value with no key context (a tx hash) is not a key', () => {
    expect(ids([vf('src/a.js', `const txHash = "0x${KEY}";`)])).toEqual([]);
  });
  test('longer hex runs (public keys, hashes) are not a 64-hex key', () => {
    expect(ids([vf('src/a.js', `privateKey = "${KEY}${KEY}"`)])).toEqual([]);
  });
  test('evidence is the masked form only', () => {
    const [f] = run([vf('src/a.js', `PRIVATE_KEY=0x${KEY}`)]);
    expect(f?.evidence).toContain('0xa1…1a1');
    expect(f?.evidence).not.toContain(KEY);
    expect(f?.evidence).not.toMatch(/[0-9a-f]{12}/i);
  });
  test('reports the line', () => expect(run([vf('src/a.js', `x\ny\nPRIVATE_KEY=${KEY}`)])[0]?.location).toEqual({ file: 'src/a.js', line: 3 }));
});

describe('secret.mnemonic', () => {
  test.each([12, 15, 18, 21, 24])('a valid %i-word phrase is flagged', (n) => {
    const last = { 12: 'about', 15: 'address', 18: 'agent', 21: 'admit', 24: 'art' }[n]!;
    expect(ids([vf('notes.txt', abandon(n, last))])).toEqual(['secret.mnemonic']);
  });
  test('12 words with a bad checksum are not flagged', () => {
    expect(ids([vf('notes.txt', abandon(12, 'abandon'))])).toEqual([]);
    expect(ids([vf('notes.txt', 'zoo wrong abandon ability able about above absent absorb abstract absurd abuse')])).toEqual([]);
  });
  test('a phrase inside a sentence, a string or JSON is found', () => {
    expect(ids([vf('a.js', `const seed = "${MNEMONIC_12}";`)])).toEqual(['secret.mnemonic']);
    expect(ids([vf('a.json', `{"mnemonic": "${MNEMONIC_12}"}`)])).toEqual(['secret.mnemonic']);
    expect(ids([vf('a.md', `my backup is ${MNEMONIC_12}, do not share`)])).toEqual(['secret.mnemonic']);
  });
  test('an ordinary English sentence is not flagged', () => {
    expect(ids([vf('a.md', 'the quick brown fox jumps over the lazy dog and keeps running far away from home today')])).toEqual([]);
  });
  test('evidence says what it is and holds none of the words', () => {
    const [f] = run([vf('notes.txt', MNEMONIC_12)]);
    expect(f?.evidence).toMatch(/12-word/);
    expect(f?.evidence).not.toContain('abandon');
  });
  test('a long run of valid-looking words is bounded work', () => {
    const t = Date.now();
    run([vf('a.txt', 'abandon '.repeat(100_000))]);
    expect(Date.now() - t).toBeLessThan(3000);
  });
});

describe('secret.pem', () => {
  const pem = (kind: string) => `-----BEGIN ${kind}-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END ${kind}-----`;
  test.each(['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'OPENSSH PRIVATE KEY', 'ENCRYPTED PRIVATE KEY'])('%s', (kind) => {
    expect(ids([vf('deploy/key.pem', pem(kind))])).toEqual(['secret.pem']);
  });
  test('public keys and certificates are not secrets', () => {
    expect(ids([vf('a.pem', pem('PUBLIC KEY')), vf('b.pem', pem('CERTIFICATE'))])).toEqual([]);
  });
  test('evidence holds no key material', () => {
    expect(run([vf('key.pem', pem('RSA PRIVATE KEY'))])[0]?.evidence).not.toContain('MIIE');
  });
});

describe('secret.solana-keypair', () => {
  const arr = (n: number, v = (i: number) => i * 3 % 256) => `[${Array.from({ length: n }, (_, i) => v(i)).join(',')}]`;
  test('a JSON array of 64 bytes is flagged, compact or pretty-printed', () => {
    expect(ids([vf('id.json', arr(64))])).toEqual(['secret.solana-keypair']);
    expect(ids([vf('id.json', `[\n${Array.from({ length: 64 }, (_, i) => `  ${i}`).join(',\n')}\n]`)])).toEqual(['secret.solana-keypair']);
  });
  test('63 or 65 numbers, or a value above 255, is not', () => {
    expect(ids([vf('a.json', arr(63))])).toEqual([]);
    expect(ids([vf('a.json', arr(65))])).toEqual([]);
    expect(ids([vf('a.json', arr(64, (i) => (i === 10 ? 256 : 1)))])).toEqual([]);
  });
  test('evidence holds no numbers from the key', () => expect(run([vf('id.json', arr(64))])[0]?.evidence).not.toMatch(/\d,\d/));
});

describe('secret.keystore', () => {
  const ks = JSON.stringify({ version: 3, id: 'x', address: 'abc', crypto: { cipher: 'aes-128-ctr', ciphertext: 'deadbeef', kdf: 'scrypt', mac: 'ff' } });
  test('an Ethereum V3 keystore is flagged', () => expect(ids([vf('keys/UTC--2020--abc', ks)])).toEqual(['secret.keystore']));
  test('other JSON is not', () => expect(ids([vf('a.json', '{"cipher":"x"}')])).toEqual([]));
  test('evidence holds no ciphertext', () => expect(run([vf('k.json', ks)])[0]?.evidence).not.toContain('deadbeef'));
});

describe('secret.dotenv', () => {
  test('a .env with a real-looking secret is flagged, naming variables but never values', () => {
    const [f] = run([vf('.env', '# c\nAPI_KEY=sk_live_abc123\nPORT=3000\nDB_PASSWORD="hunter2"\n')]);
    expect(f?.ruleId).toBe('secret.dotenv');
    expect(f?.evidence).toContain('API_KEY');
    expect(f?.evidence).toContain('DB_PASSWORD');
    expect(f?.evidence).not.toContain('PORT');
    expect(f?.evidence).not.toMatch(/sk_live|abc123|hunter2/);
  });
  test('.env.local, nested and export forms count', () => {
    expect(ids([vf('app/.env.local', 'export AUTH_TOKEN=abc')])).toEqual(['secret.dotenv']);
  });
  test('a connection string with credentials counts whatever it is called', () => {
    expect(ids([vf('.env', 'DATABASE=postgres://user:pw@host/db')])).toEqual(['secret.dotenv']);
  });
  test('templates, placeholders, empty values and plain config are not flagged', () => {
    expect(ids([vf('.env.example', 'API_KEY=abc123')])).toEqual([]);
    expect(ids([vf('.env', 'API_KEY=\nSECRET=your-secret-here\nTOKEN=changeme\nKEY=<paste>\n')])).toEqual([]);
    expect(ids([vf('.env', 'PORT=3000\nNODE_ENV=development\n')])).toEqual([]);
  });
});

describe('severity by mode', () => {
  const file = vf('src/a.js', `PRIVATE_KEY=0x${KEY}`);
  test('clone → caution (someone else\'s leak, possibly bait)', () => expect(run([file], { ...ctx, mode: 'clone' })[0]?.severity).toBe('caution'));
  test.each(['workspace', 'quick'] as const)('%s → high', (mode) => expect(run([file], { ...ctx, mode })[0]?.severity).toBe('high'));
});

describe('no full key ever appears in a finding', () => {
  test('across every detector', () => {
    const files = [
      vf('a.js', `PRIVATE_KEY=0x${KEY}`),
      vf('b.txt', MNEMONIC_12),
      vf('c.pem', '-----BEGIN PRIVATE KEY-----\nQUJDREVGRw==\n-----END PRIVATE KEY-----'),
      vf('.env', 'SECRET=topsecretvalue'),
    ];
    const text = JSON.stringify(run(files));
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('topsecretvalue');
    expect(text).not.toContain('QUJDREVGRw');
    expect(text).not.toContain('abandon');
  });
});
