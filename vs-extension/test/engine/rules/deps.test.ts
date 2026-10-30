import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { depRules } from '../../../src/engine/rules/deps';
import { ctx, vf } from '../load';

const golden = (name: string) => readFileSync(fileURLToPath(new URL(`../../fixtures/lockfiles/${name}`, import.meta.url)), 'utf8');
const run = (files: ReturnType<typeof vf>[]) => depRules.flatMap((r) => r(files, ctx));
const ids = (files: ReturnType<typeof vf>[]) => run(files).map((f) => `${f.ruleId}:${f.severity}`);
const pkg = (deps: object, key = 'dependencies') => vf('package.json', JSON.stringify({ name: 'x', [key]: deps }, null, 2));
const npmLock = (packages: object) => vf('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages }));
const reg = (n: string, extra: object = {}) => ({ version: '1.0.0', resolved: `https://registry.npmjs.org/${n}/-/${n}-1.0.0.tgz`, integrity: 'sha512-x', ...extra });

describe('deps.unverified-source in package.json', () => {
  test.each([
    'git+https://github.com/x/y.git', 'git://github.com/x/y.git', 'github:x/y', 'gitlab:x/y', 'bitbucket:x/y', 'x/y', 'x/y#main',
    'https://example.com/y.tgz', 'http://example.com/y.tgz', 'file:./vendor/y', 'file:../y', 'link:../y',
  ])('%s → caution', (spec) => expect(ids([pkg({ y: spec })])).toEqual(['deps.unverified-source:caution']));

  test.each(['^1.2.3', '~1.2', '1.x', '*', 'latest', '>=1 <2', 'npm:other@^1.0.0', 'workspace:*', 'catalog:', '1.0.0 || 2.0.0'])('%s → nothing', (spec) => {
    expect(ids([pkg({ y: spec })])).toEqual([]);
  });
  test('fake file: package is flagged with no network and no lockfile', () => {
    const [f] = run([pkg({ 'fake-lib': 'file:./vendor/fake-lib' })]);
    expect(f).toMatchObject({ ruleId: 'deps.unverified-source', severity: 'caution', location: { file: 'package.json', line: 4 } });
    expect(f?.evidence).toContain('fake-lib');
  });
  test('devDependencies and optionalDependencies are checked', () => {
    expect(ids([pkg({ y: 'file:./y' }, 'devDependencies')])).toEqual(['deps.unverified-source:caution']);
    expect(ids([pkg({ y: 'github:x/y' }, 'optionalDependencies')])).toEqual(['deps.unverified-source:caution']);
  });
  test('one finding per file lists every offending dependency', () => {
    const r = run([pkg({ a: 'file:./a', b: 'github:x/b', c: '^1.0.0' })]);
    expect(r).toHaveLength(1);
    expect(r[0]?.evidence).toMatch(/a.*b/);
    expect(r[0]?.evidence).not.toContain('c:');
  });
  test('package.json in committed node_modules is skipped', () => {
    expect(ids([vf('node_modules/x/package.json', '{"dependencies":{"y":"file:./y"}}')])).toEqual([]);
  });
  test('unparseable package.json yields nothing here (installScripts reports it)', () => {
    expect(ids([vf('package.json', '{ "dependencies": ')])).toEqual([]);
  });
});

describe('lockfile rules', () => {
  test('clean npm lockfile → nothing', () => {
    expect(ids([npmLock({ '': {}, 'node_modules/a': reg('a'), 'node_modules/b': reg('b') })])).toEqual([]);
  });
  test('registry.yarnpkg.com is accepted', () => {
    expect(ids([npmLock({ 'node_modules/a': reg('a', { resolved: 'https://registry.yarnpkg.com/a/-/a-1.0.0.tgz' }) })])).toEqual([]);
  });
  test('resolved from another host → foreign-registry high, grouped per host', () => {
    const l = npmLock({
      'node_modules/a': reg('a', { resolved: 'https://registry.evil.example/a/-/a-1.0.0.tgz' }),
      'node_modules/b': reg('b', { resolved: 'https://registry.evil.example/b/-/b-1.0.0.tgz' }),
      'node_modules/c': reg('c', { resolved: 'https://other.example/c.tgz' }),
    });
    const r = run([l]);
    expect(r.map((f) => `${f.ruleId}:${f.severity}`)).toEqual(['deps.foreign-registry:high', 'deps.foreign-registry:high']);
    expect(r[0]?.evidence).toContain('registry.evil.example');
    expect(r[0]?.evidence).toMatch(/a.*b/);
  });
  test('look-alike hosts do not pass the host check', () => {
    expect(ids([npmLock({ 'node_modules/a': reg('a', { resolved: 'https://registry.npmjs.org.evil.example/a.tgz' }) })])).toEqual(['deps.foreign-registry:high']);
    expect(ids([npmLock({ 'node_modules/a': reg('a', { resolved: 'https://evil.example/registry.npmjs.org/a.tgz' }) })])).toEqual(['deps.foreign-registry:high']);
    expect(ids([npmLock({ 'node_modules/a': reg('a', { resolved: 'https://registry.npmjs.org@evil.example/a.tgz' }) })])).toEqual(['deps.foreign-registry:high']);
  });
  // Rehearsal 3: hardhat's pnpm-lock.yaml locks `foundry-rs/forge-std#v1.17.0` as a codeload.github.com tarball.
  test('regression: a GitHub dependency downloaded from codeload.github.com is unverified-source (caution), not a foreign registry', () => {
    const l = npmLock({ 'node_modules/forge-std': reg('forge-std', { resolved: 'https://codeload.github.com/foundry-rs/forge-std/tar.gz/abc123', integrity: undefined }) });
    expect(ids([l])).toEqual(['deps.unverified-source:caution']);
  });
  test('and a look-alike of that host is still a foreign registry', () => {
    for (const u of ['https://codeload.github.com.evil.example/a.tgz', 'https://codeload.github.com@evil.example/a.tgz', 'https://evil.example/codeload.github.com/a.tgz']) {
      expect(ids([npmLock({ 'node_modules/a': reg('a', { resolved: u }) })]), u).toEqual(['deps.foreign-registry:high']);
    }
  });
  test('git and file entries in a lockfile → unverified-source, not foreign-registry', () => {
    const l = npmLock({
      'node_modules/g': { version: '1.0.0', resolved: 'git+ssh://git@github.com/x/g.git#abc' },
      'node_modules/l': { resolved: 'vendor/l', link: true },
    });
    expect(ids([l])).toEqual(['deps.unverified-source:caution']);
  });
  test('registry entry with no integrity → no-integrity caution; bundled and link entries are exempt', () => {
    expect(ids([npmLock({ 'node_modules/a': reg('a', { integrity: undefined }) })])).toEqual(['deps.no-integrity:caution']);
    expect(ids([npmLock({ 'node_modules/a': { version: '1.0.0', inBundle: true } })])).toEqual([]);
  });
  test('yarn classic github dependency is unverified-source, not foreign-registry', () => {
    expect(ids([vf('yarn.lock', golden('yarn1.lock'))]).sort()).toEqual(['deps.unverified-source:caution']);
  });
  test('golden berry, pnpm and bun lockfiles flag only their local file: entry', () => {
    for (const [p, g] of [['yarn.lock', 'yarn-berry.lock'], ['pnpm-lock.yaml', 'pnpm-v9.yaml'], ['bun.lock', 'bun.lock']] as const) {
      expect(ids([vf(p, golden(g))]), p).toEqual(['deps.unverified-source:caution']);
    }
  });
  test('lockfile findings point at the lockfile', () => {
    expect(run([npmLock({ 'node_modules/a': reg('a', { resolved: 'https://registry.evil.example/a.tgz' }) })])[0]?.location?.file).toBe('package-lock.json');
  });
  test('an unreadable lockfile does not throw', () => {
    expect(() => run([vf('package-lock.json', '{ "packages": ')])).not.toThrow();
  });
});
