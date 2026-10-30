import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectPurls, locatePackageFindings } from '../../src/engine/purls';
import { parseNpm } from '../../src/engine/parsers/lockfiles/npm';
import { parseYarn1 } from '../../src/engine/parsers/lockfiles/yarn1';
import { parseYarnBerry } from '../../src/engine/parsers/lockfiles/yarnBerry';
import { parsePnpm } from '../../src/engine/parsers/lockfiles/pnpm';
import { parseBun } from '../../src/engine/parsers/lockfiles/bun';
import { vf } from './load';

const golden = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/lockfiles/${name}`, import.meta.url)), 'utf8');
const GOLDEN_PURLS = ['pkg:npm/%40types/node@22.20.5', 'pkg:npm/lodash@4.17.21', 'pkg:npm/semver@7.6.0'];
const names = (es: { name: string }[]) => es.map((e) => e.name).sort();
const src = (es: { name: string; source: string }[], n: string) => es.find((e) => e.name === n)?.source;

describe('parsers', () => {
  test('npm v3: registry entries, link entry, no local folder entry', () => {
    const es = parseNpm(golden('npm-v3.json'));
    expect(names(es)).toEqual(['@types/node', 'local', 'lodash', 'semver']);
    expect(src(es, 'lodash')).toBe('registry');
    expect(src(es, 'local')).toBe('link');
    expect(es.find((e) => e.name === 'lodash')).toMatchObject({ version: '4.17.21', integrity: 'sha512-bbb' });
  });
  test('npm v1: nested dependencies and a file: version', () => {
    const es = parseNpm(golden('npm-v1.json'));
    expect(names(es)).toEqual(['@types/node', 'local', 'lodash', 'lru-cache', 'semver']);
    expect(src(es, 'local')).toBe('file');
  });
  test('npm: nested node_modules take the innermost name', () => {
    const es = parseNpm(JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/a/node_modules/@s/b': { version: '1.0.0', resolved: 'https://registry.npmjs.org/@s/b/-/b-1.0.0.tgz', integrity: 'sha512-x' } } }));
    expect(names(es)).toEqual(['@s/b']);
  });
  test('npm: git+ resolved is a git source; foreign host is http', () => {
    const es = parseNpm(JSON.stringify({ lockfileVersion: 3, packages: {
      'node_modules/g': { version: '1.0.0', resolved: 'git+ssh://git@github.com/x/g.git#abc' },
      'node_modules/h': { version: '1.0.0', resolved: 'https://registry.evil.example/h/-/h-1.0.0.tgz', integrity: 'sha512-x' },
    } }));
    expect([src(es, 'g'), src(es, 'h')]).toEqual(['git', 'http']);
  });
  test('yarn classic: multi-spec headers, scoped names, github dep', () => {
    const es = parseYarn1(golden('yarn1.lock'));
    expect(names(es)).toEqual(['@types/node', 'evil', 'local', 'lodash', 'semver']);
    expect(src(es, 'evil')).toBe('git');
    expect(src(es, 'local')).toBe('file');
    expect(es.find((e) => e.name === 'lodash')).toMatchObject({ version: '4.17.21', integrity: 'sha512-bbb' });
  });
  test('yarn berry: workspace entry and file: locator are not registry', () => {
    const es = parseYarnBerry(golden('yarn-berry.lock'));
    expect(names(es)).toEqual(['@types/node', 'golden', 'local', 'lodash', 'semver']);
    expect(src(es, 'golden')).toBe('workspace');
    expect(src(es, 'local')).toBe('file');
    expect(es.find((e) => e.name === 'lodash')).toMatchObject({ version: '4.17.21', integrity: '10c0/bbb', source: 'registry' });
  });
  test('pnpm v9', () => {
    const es = parsePnpm(golden('pnpm-v9.yaml'));
    expect(names(es)).toEqual(['@types/node', 'local', 'lodash', 'semver']);
    expect(src(es, 'local')).toBe('file');
    expect(es.find((e) => e.name === 'semver')).toMatchObject({ version: '7.6.0', integrity: 'sha512-ccc' });
  });
  // Rehearsal 3: vite and hardhat commit a pnpm-lock.yaml with several documents (`---`), which used to read as "Could not read".
  test('regression: pnpm lockfile with several YAML documents reads the packages of all of them', () => {
    const multi = "---\nlockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: false\n\n---\n" + golden('pnpm-v9.yaml');
    const es = parsePnpm(multi);
    expect(names(es)).toEqual(['@types/node', 'local', 'lodash', 'semver']);
    expect(collectPurls([vf('package.json', JSON.stringify({ name: 'x', dependencies: { lodash: '4.17.21' } })), vf('pnpm-lock.yaml', multi)]).notChecked).toEqual([]);
  });
  test('a pnpm lockfile with an absurd number of documents is refused, not parsed', () => {
    expect(() => parsePnpm(Array.from({ length: 10 }, () => 'lockfileVersion: 9').join('\n---\n'))).toThrow();
  });
  test('pnpm v5 and v6 key shapes', () => {
    const v5 = parsePnpm("lockfileVersion: 5.4\npackages:\n  /lodash/4.17.21:\n    resolution: {integrity: sha512-b}\n  /@types/node/22.20.5_peer@1.0.0:\n    resolution: {integrity: sha512-a}\n");
    const v6 = parsePnpm("lockfileVersion: '6.0'\npackages:\n  /lodash@4.17.21:\n    resolution: {integrity: sha512-b}\n  /@types/node@22.20.5(peer@1.0.0):\n    resolution: {integrity: sha512-a}\n");
    for (const es of [v5, v6]) expect(es.map((e) => `${e.name}@${e.version}`).sort()).toEqual(['@types/node@22.20.5', 'lodash@4.17.21']);
  });
  test('pnpm: git and tarball resolutions', () => {
    const es = parsePnpm("lockfileVersion: '9.0'\npackages:\n  g@https://codeload.github.com/x/g/tar.gz/abc:\n    resolution: {tarball: 'https://codeload.github.com/x/g/tar.gz/abc'}\n  h@1.0.0:\n    resolution: {type: git, repo: 'https://github.com/x/h.git', commit: abc}\n");
    // A GitHub tarball is a git dependency (unverified-source, caution), not "another registry" (high): hardhat's lockfile has two.
    expect([src(es, 'g'), src(es, 'h')]).toEqual(['git', 'git']);
    expect(src(parsePnpm("lockfileVersion: '9.0'\npackages:\n  t@1.0.0:\n    resolution: {tarball: 'https://cdn.example/t.tgz'}\n"), 't')).toBe('http');
  });
  test('bun.lock (JSONC with trailing commas)', () => {
    const es = parseBun(golden('bun.lock'));
    expect(names(es)).toEqual(['@types/node', 'golden', 'local', 'lodash', 'semver']);
    expect(src(es, 'golden')).toBe('workspace');
    expect(src(es, 'local')).toBe('file');
    expect(es.find((e) => e.name === 'lodash')).toMatchObject({ version: '4.17.21', integrity: 'sha512-bbb' });
  });
  test('malformed input throws instead of returning a partial list', () => {
    expect(() => parseNpm('{ "packages": ')).toThrow();
    expect(() => parsePnpm('a: [')).toThrow();
    expect(() => parseBun('{ "packages": ')).toThrow();
  });
});

describe('collectPurls', () => {
  const lock = (path: string, name: string, base = '') => vf(base + path, golden(name));
  test.each([
    ['package-lock.json', 'npm-v3.json'],
    ['package-lock.json', 'npm-v1.json'],
    ['yarn.lock', 'yarn1.lock'],
    ['yarn.lock', 'yarn-berry.lock'],
    ['pnpm-lock.yaml', 'pnpm-v9.yaml'],
    ['bun.lock', 'bun.lock'],
  ])('%s from %s → golden purls (file:, link:, workspace and git excluded)', (path, fixture) => {
    const { purls, notChecked } = collectPurls([vf('package.json', '{"dependencies":{"lodash":"4.17.21"}}'), lock(path, fixture)]);
    expect(purls.filter((p) => GOLDEN_PURLS.includes(p))).toEqual(GOLDEN_PURLS);
    expect(purls.every((p) => !/local|golden|evil/.test(p))).toBe(true);
    expect(notChecked).toEqual([]);
  });
  test('npm v1 also yields nested packages', () => {
    expect(collectPurls([lock('package-lock.json', 'npm-v1.json')]).purls).toContain('pkg:npm/lru-cache@6.0.0');
  });
  test('purls are deduplicated and sorted; build metadata is percent-encoded', () => {
    const l = JSON.stringify({ lockfileVersion: 3, packages: {
      'node_modules/b': { version: '1.0.0+build.5', resolved: 'https://registry.npmjs.org/b/-/b-1.0.0.tgz', integrity: 'sha512-x' },
      'node_modules/a': { version: '2.0.0', resolved: 'https://registry.npmjs.org/a/-/a-2.0.0.tgz', integrity: 'sha512-x' },
      'node_modules/x/node_modules/a': { version: '2.0.0', resolved: 'https://registry.npmjs.org/a/-/a-2.0.0.tgz', integrity: 'sha512-x' },
    } });
    expect(collectPurls([vf('package-lock.json', l)]).purls).toEqual(['pkg:npm/a@2.0.0', 'pkg:npm/b@1.0.0%2Bbuild.5']);
  });
  test('lockfiles inside committed node_modules are ignored', () => {
    expect(collectPurls([lock('node_modules/x/package-lock.json', 'npm-v3.json')]).purls).toEqual([]);
  });
});

describe('notChecked', () => {
  const pkg = (deps: object = { lodash: '4.17.21' }, path = 'package.json') => vf(path, JSON.stringify({ name: 'x', dependencies: deps }));
  const UNRESOLVED = 'Exact package versions unresolved';
  test('package.json with pinned dependencies and no lockfile still yields those purls', () => {
    const r = collectPurls([pkg()]);
    expect(r.purls).toEqual(['pkg:npm/lodash@4.17.21']);
    expect(r.notChecked).toEqual([]);
    expect(r.locations['pkg:npm/lodash@4.17.21']).toBe('package.json');
  });
  test('devDependencies and optionalDependencies count too', () => {
    expect(collectPurls([vf('package.json', '{"devDependencies":{"a":"1"}}')]).notChecked).toEqual([UNRESOLVED]);
    expect(collectPurls([vf('package.json', '{"optionalDependencies":{"a":"1"}}')]).notChecked).toEqual([UNRESOLVED]);
  });
  test('no manifest at all → nothing unchecked (Review Focus 2)', () => {
    expect(collectPurls([vf('README.md', 'hi'), vf('src/a.ts', 'x')])).toEqual({ purls: [], notChecked: [], locations: {} });
  });
  test('package.json with no dependencies → nothing to check', () => {
    expect(collectPurls([vf('package.json', '{"name":"x","dependencies":{}}')]).notChecked).toEqual([]);
    expect(collectPurls([vf('package.json', '{"name":"x"}')]).notChecked).toEqual([]);
  });
  test('bun.lockb only → unresolved', () => {
    expect(collectPurls([pkg(), { path: 'bun.lockb', binary: true, size: 100, truncated: false }]).notChecked).toEqual([UNRESOLVED]);
  });
  test('bun.lockb next to a readable lockfile is covered by it', () => {
    const l = vf('package-lock.json', golden('npm-v3.json'));
    expect(collectPurls([pkg(), l, { path: 'bun.lockb', binary: true, size: 100, truncated: false }]).notChecked).toEqual([]);
  });
  test('a root lockfile covers nested workspace package.json files', () => {
    expect(collectPurls([vf('package-lock.json', golden('npm-v3.json')), pkg({ a: '1' }, 'packages/a/package.json')]).notChecked).toEqual([]);
  });
  test('a nested package.json outside any lockfile directory is unresolved', () => {
    expect(collectPurls([vf('app/package-lock.json', golden('npm-v3.json')), pkg({ a: '1' }, 'tools/package.json')]).notChecked).toEqual([UNRESOLVED]);
  });
  test('package.json files inside committed node_modules are not manifests', () => {
    expect(collectPurls([pkg({ a: '1' }, 'node_modules/x/package.json')]).notChecked).toEqual([]);
  });
  test('an unparseable lockfile is reported, not skipped', () => {
    expect(collectPurls([pkg(), vf('package-lock.json', '{ "packages": ')]).notChecked).toEqual(['Could not read package-lock.json']);
  });
  test('a lockfile cut off by the size limit is reported', () => {
    const cut = { ...vf('yarn.lock', golden('yarn1.lock')), truncated: true };
    const r = collectPurls([pkg(), cut]);
    expect(r.notChecked).toEqual(['yarn.lock is larger than the scan limit; later packages were not checked']);
    expect(r.purls).toContain('pkg:npm/lodash@4.17.21');
  });
  test('a yaml alias bomb does not throw', () => {
    const bomb = 'a: &a [x,x,x,x]\n' + Array.from({ length: 80 }, (_, i) => `b${i}: *a`).join('\n');
    expect(collectPurls([pkg(), vf('pnpm-lock.yaml', bomb)]).notChecked).toEqual(['Could not read pnpm-lock.yaml']);
  });
});

describe('manifests across the tree', () => {
  test('a nested package.json with a pinned dependency is sent to Socket', () => {
    const r = collectPurls([vf('tools/package.json', JSON.stringify({ name: 'tools', dependencies: { evil: '1.0.0' } }))]);
    expect(r.purls).toEqual(['pkg:npm/evil@1.0.0']);
    expect(r.notChecked).toEqual([]);
    expect(r.locations['pkg:npm/evil@1.0.0']).toBe('tools/package.json');
  });
  test('a committed node_modules package.json name and version is sent', () => {
    const r = collectPurls([vf('node_modules/evil-pkg/package.json', JSON.stringify({ name: 'evil-pkg', version: '9.9.9' }))]);
    expect(r.purls).toEqual(['pkg:npm/evil-pkg@9.9.9']);
    expect(r.locations['pkg:npm/evil-pkg@9.9.9']).toBe('node_modules/evil-pkg/package.json');
    expect(r.notChecked).toEqual([]);
  });
  test('the root app name is not sent', () => {
    const r = collectPurls([vf('package.json', JSON.stringify({ name: 'my-app', version: '1.0.0', dependencies: { lodash: '4.17.21' } }))]);
    expect(r.purls).toEqual(['pkg:npm/lodash@4.17.21']);
    expect(r.purls.some((p) => p.includes('my-app'))).toBe(false);
  });
  test('a caret range without a lockfile still yields the floor version for Socket', () => {
    const r = collectPurls([vf('package.json', JSON.stringify({ name: 'x', dependencies: { lodash: '^4.17.21' } }))]);
    expect(r.purls).toEqual(['pkg:npm/lodash@4.17.21']);
    expect(r.notChecked).toEqual([]);
    expect(r.locations['pkg:npm/lodash@4.17.21']).toBe('package.json');
  });
  test('a package.json of ranges and no lockfile (bezkoder/node-js-jwt-auth) lists every dependency', () => {
    const r = collectPurls([
      vf(
        'package.json',
        JSON.stringify({
          name: 'node-js-jwt-auth',
          version: '1.0.0',
          dependencies: {
            bcryptjs: '^2.4.3',
            cors: '^2.8.5',
            express: '^4.18.2',
            jsonwebtoken: '^9.0.0',
            mysql2: '^2.3.3',
            sequelize: '^6.32.1',
          },
        }),
      ),
    ]);
    expect(r.purls).toEqual([
      'pkg:npm/bcryptjs@2.4.3',
      'pkg:npm/cors@2.8.5',
      'pkg:npm/express@4.18.2',
      'pkg:npm/jsonwebtoken@9.0.0',
      'pkg:npm/mysql2@2.3.3',
      'pkg:npm/sequelize@6.32.1',
    ]);
    expect(r.notChecked).toEqual([]);
  });
  test('latest and 1.x stay unresolved, with no fake purl', () => {
    const r = collectPurls([vf('package.json', JSON.stringify({ name: 'x', dependencies: { lodash: 'latest', a: '1.x' } }))]);
    expect(r.purls).toEqual([]);
    expect(r.notChecked).toEqual(['Exact package versions unresolved']);
  });
  test('a lockfile location is preferred when the same package is also in package.json', () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/lodash': { version: '4.17.21', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz', integrity: 'sha512-x' } } });
    const r = collectPurls([vf('package-lock.json', lock), vf('package.json', JSON.stringify({ dependencies: { lodash: '4.17.21' } }))]);
    expect(r.locations['pkg:npm/lodash@4.17.21']).toBe('package-lock.json');
  });
});

describe('locatePackageFindings', () => {
  const loc = { 'pkg:npm/evil@1.0.0': 'tools/package.json' };
  test('a Socket finding that names the package gets that file', () => {
    const f = {
      ruleId: 'socket.malware',
      layer: 'dependency' as const,
      severity: 'critical' as const,
      title: 'Socket.dev flagged evil@1.0.0: malware',
      evidence: 'Socket.dev reported critical (supplyChainRisk) alert "malware" on evil@1.0.0.',
      source: 'socket' as const,
      checkedAt: '2026-10-29T18:00:00+05:30',
    };
    expect(locatePackageFindings([f], loc)[0]?.location).toEqual({ file: 'tools/package.json' });
  });
  test('a finding that already has a location is left alone', () => {
    const f = {
      ruleId: 'socket.malware',
      layer: 'dependency' as const,
      severity: 'critical' as const,
      title: 'Socket.dev flagged evil@1.0.0: malware',
      evidence: 'Socket.dev reported critical on pkg:npm/evil@1.0.0.',
      location: { file: 'already.json', line: 2 },
      source: 'socket' as const,
      checkedAt: '2026-10-29T18:00:00+05:30',
    };
    expect(locatePackageFindings([f], loc)[0]?.location).toEqual({ file: 'already.json', line: 2 });
  });
  test('a non-socket finding is not given a package location', () => {
    const f = {
      ruleId: 'deps.unverified-source',
      layer: 'repo-file' as const,
      severity: 'caution' as const,
      title: 't',
      evidence: 'evil@1.0.0',
      source: 'rules' as const,
      checkedAt: '2026-10-29T18:00:00+05:30',
    };
    expect(locatePackageFindings([f], loc)[0]?.location).toBeUndefined();
  });
});
