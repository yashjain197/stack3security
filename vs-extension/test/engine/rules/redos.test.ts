import { describe, expect, test } from 'vitest';
import { trimEndChars } from '../../../src/engine/rules/evidence';
import { dangerSignals } from '../../../src/engine/rules/signals';
import { pmConfigRules } from '../../../src/engine/rules/pmConfig';
import { secretRules } from '../../../src/engine/rules/secrets';
import { sourceRules } from '../../../src/engine/rules/source';
import { ctx, vf } from '../load';

// Regressions for the patterns `scripts/check-regexes.mjs` found to be quadratic or cubic. Each was rewritten as a
// loop or a linear pattern; the behaviour must be the same, and a hostile line must be fast.
const FAST_MS = 500;
const timed = (fn: () => unknown): number => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

describe('trimEndChars', () => {
  test.each([
    ['https://x.test///', '/', 'https://x.test'],
    ['/', '/', ''],
    ['', '/', ''],
    ['no-trailing', '/', 'no-trailing'],
    ['a/b/', '/', 'a/b'],
    ['host/path.,;:', '.,;:', 'host/path'],
    ['.,;:', '.,;:', ''],
  ])('%j minus trailing %j is %j', (input, chars, want) => expect(trimEndChars(input, chars)).toBe(want));
  test('a million slashes is instant', () => expect(timed(() => trimEndChars('/'.repeat(1_000_000), '/'))).toBeLessThan(FAST_MS));
});

describe('node -e detection (was cubic)', () => {
  test.each([
    ['node -e "x"', true],
    ['node -p 1', true],
    ['node --eval "x"', true],
    ['nodejs --print 1', true],
    ['node --no-warnings --max-old-space-size=8 -e "x"', true],
    ['NODE -E "x"', true],
    ['node index.js -e', false],
    ['node --version', false],
    ['node server.js', false],
    ['echo node', false],
  ])('%s → node-eval %s', (cmd, want) => expect(dangerSignals(cmd).includes('node-eval')).toBe(want));
  test('a long run of dash options is fast', () => expect(timed(() => dangerSignals(`node ${'-- '.repeat(3300)}`))).toBeLessThan(FAST_MS));
});

describe('.env parsing (was quadratic)', () => {
  const run = (text: string) => secretRules.flatMap((r) => r([vf('.env', text)], ctx));
  test('a trailing comment is not part of the value', () => {
    expect(run('API_TOKEN=realvalue123 # prod token\n').map((f) => f.ruleId)).toEqual(['secret.dotenv']);
    expect(run('API_TOKEN=your-token # placeholder\n')).toEqual([]);
    expect(run('API_TOKEN=#notacomment\n').map((f) => f.ruleId)).toEqual(['secret.dotenv']);
  });
  test('a line of whitespace is fast', () => expect(timed(() => run(`A=${'\t'.repeat(4000)}\n${' '.repeat(4000)}#`))).toBeLessThan(FAST_MS));
});

describe('config-file spawn exemption (was a path regex)', () => {
  const spawn = (path: string) => sourceRules.flatMap((r) => r([vf(path, "const { exec } = require('child_process');")], ctx)).length;
  test.each(['webpack.config.js', 'src/build/x.js', 'a/scripts/y.js', 'tools/z.mjs', 'vite.config.ts'])('%s may spawn', (p) => expect(spawn(p)).toBe(0));
  test.each(['src/app.js', 'config.js', 'src/my.configuration.js', 'a/not-scripts/y.js'])('%s is flagged', (p) => expect(spawn(p)).toBeGreaterThan(0));
});

describe('.npmrc registry comparison (was quadratic)', () => {
  const run = (text: string) => pmConfigRules.flatMap((r) => r([vf('.npmrc', text)], ctx)).map((f) => f.ruleId);
  test('the default registry with or without trailing slashes is fine', () => {
    expect(run('registry=https://registry.npmjs.org/\n')).toEqual([]);
    expect(run('registry=https://registry.npmjs.org///\n')).toEqual([]);
    expect(run('registry=https://evil.test/\n')).toEqual(['npmrc.dangerous-key']);
  });
  test('a 1 MiB line of slashes is fast', () => expect(timed(() => run(`registry=${'/'.repeat(1_000_000)}`))).toBeLessThan(FAST_MS));
});
