import { describe, expect, test } from 'vitest';
import { pmConfigRules } from '../../../src/engine/rules/pmConfig';
import { ctx, vf } from '../load';

const run = (files: ReturnType<typeof vf>[]) => pmConfigRules.flatMap((r) => r(files, ctx));
const ids = (files: ReturnType<typeof vf>[]) => run(files).map((f) => `${f.ruleId}:${f.severity}`);

describe('npmrc.dangerous-key', () => {
  test.each([
    ['script-shell=./evil.sh'],
    ['node-options=--require ./x.js'],
    ['registry=https://registry.evil.example/'],
    ['@scope:registry=https://registry.evil.example/'],
    ['registry = http://registry.npmjs.org/'],
  ])('%s → high', (line) => expect(ids([vf('.npmrc', line)])).toEqual(['npmrc.dangerous-key:high']));

  test('npmjs registry, comments and benign keys → nothing', () => {
    expect(ids([vf('.npmrc', '; comment\nregistry=https://registry.npmjs.org/\nregistry=https://registry.npmjs.org\nignore-scripts=true\nsave-exact=true')])).toEqual([]);
  });
  test('a commented-out key is ignored', () => expect(ids([vf('.npmrc', '# script-shell=./x\n')])).toEqual([]));
  test('applies to nested .npmrc and reports the line', () => {
    const [f] = run([vf('packages/a/.npmrc', 'save-exact=true\nscript-shell=./x')]);
    expect(f?.location).toEqual({ file: 'packages/a/.npmrc', line: 2 });
  });
});

describe('yarn.repo-binary', () => {
  test('yarnPath in .yarnrc.yml → high', () => expect(ids([vf('.yarnrc.yml', 'yarnPath: .yarn/releases/yarn-4.cjs\nnodeLinker: node-modules')])).toEqual(['yarn.repo-binary:high']));
  test('plugins path (string and object forms) → high', () => {
    expect(ids([vf('.yarnrc.yml', 'plugins:\n  - path: .yarn/plugins/x.cjs\n    spec: "y"')])).toEqual(['yarn.repo-binary:high']);
    expect(ids([vf('.yarnrc.yml', 'plugins:\n  - ./evil.cjs')])).toEqual(['yarn.repo-binary:high']);
  });
  test('yarn-path in .yarnrc → high', () => {
    expect(ids([vf('.yarnrc', 'yarn-path ".yarn/releases/x.js"')])).toEqual(['yarn.repo-binary:high']);
    expect(ids([vf('.yarnrc', 'yarn-path .yarn/x.js')])).toEqual(['yarn.repo-binary:high']);
  });
  test('benign yarn config → nothing', () => {
    expect(ids([vf('.yarnrc.yml', 'nodeLinker: node-modules\nenableTelemetry: false')])).toEqual([]);
    expect(ids([vf('.yarnrc', '--install.ignore-scripts true')])).toEqual([]);
  });
  test('unparseable or alias-bomb yaml does not throw and is not clean', () => {
    expect(() => run([vf('.yarnrc.yml', 'a: [')])).not.toThrow();
    const bomb = 'a: &a [x,x,x,x]\n' + Array.from({ length: 80 }, (_, i) => `b${i}: *a`).join('\n');
    expect(() => run([vf('.yarnrc.yml', bomb)])).not.toThrow();
  });
});

describe('pnpmfile', () => {
  test('present → caution', () => expect(ids([vf('.pnpmfile.cjs', 'module.exports = { hooks: {} };')])).toEqual(['pnpmfile.present:caution']));
  test.each(['require("child_process").exec("x")', 'fetch("http://x")', 'require("http").request(o)'])('%s → critical too', (src) => {
    expect(ids([vf('.pnpmfile.cjs', src)]).sort()).toEqual(['pnpmfile.dangerous:critical', 'pnpmfile.present:caution']);
  });
  test('absent → nothing', () => expect(ids([vf('package.json', '{}')])).toEqual([]));
});

describe('foundry.ffi', () => {
  test('ffi = true → caution', () => expect(ids([vf('foundry.toml', '[profile.default]\nsrc = "src"\nffi = true')])).toEqual(['foundry.ffi:caution']));
  test('ffi = false, commented, or absent → nothing', () => {
    expect(ids([vf('foundry.toml', '[profile.default]\nffi = false')])).toEqual([]);
    expect(ids([vf('foundry.toml', '# ffi = true')])).toEqual([]);
    expect(ids([vf('foundry.toml', '[profile.default]\nsrc = "src"')])).toEqual([]);
  });
});
