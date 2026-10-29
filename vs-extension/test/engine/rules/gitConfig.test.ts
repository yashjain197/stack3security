import { describe, expect, test } from 'vitest';
import { gitConfigRules } from '../../../src/engine/rules/gitConfig';
import { ctx, vf } from '../load';

const run = (files: ReturnType<typeof vf>[]) => gitConfigRules.flatMap((r) => r(files, ctx));
const ids = (files: ReturnType<typeof vf>[]) => run(files).map((f) => `${f.ruleId}:${f.severity}`);
const cfg = (text: string) => [vf('.git/config', text)];

describe('gitconfig.exec-key', () => {
  test.each([
    ['[core]\n\tfsmonitor = ./evil.sh'],
    ['[core]\n\tsshCommand = ssh -o ProxyCommand=x'],
    ['[core]\n\tpager = sh -c x'],
    ['[core]\n\teditor = ./x'],
    ['[core]\n\thooksPath = .githooks'],
    ['[filter "lfs"]\n\tclean = ./x'],
    ['[filter "lfs"]\n\tsmudge = ./x'],
    ['[filter "lfs"]\n\tprocess = ./x'],
    ['[diff]\n\texternal = ./x'],
    ['[alias]\n\tco = !sh -c x'],
  ])('%j → critical', (text) => expect(ids(cfg(text))).toEqual(['gitconfig.exec-key:critical']));

  test('keys are case-insensitive', () => expect(ids(cfg('[CORE]\n\tSshCommand = x'))).toEqual(['gitconfig.exec-key:critical']));
  test('legacy [filter.name] subsection form', () => expect(ids(cfg('[filter.lfs]\n\tclean = ./x'))).toEqual(['gitconfig.exec-key:critical']));
  test('comments are ignored', () => expect(ids(cfg('[core]\n\t# pager = x\n\t; editor = y'))).toEqual([]));

  test('benign config → nothing', () => {
    expect(ids(cfg('[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tfsmonitor = false\n[remote "origin"]\n\turl = https://github.com/x/y\n[alias]\n\tco = checkout'))).toEqual([]);
  });
  test('reports the line', () => {
    expect(run(cfg('[core]\n\tbare = false\n\teditor = x'))[0]?.location).toEqual({ file: '.git/config', line: 3 });
  });
  test('applies only when .git/config is present', () => {
    expect(ids([vf('gitconfig.txt', '[core]\n\teditor = x'), vf('.gitconfig', '[core]\n\teditor = x')])).toEqual([]);
  });
});

describe('githooks.present', () => {
  test('a hook file → high', () => expect(ids([vf('.git/hooks/pre-commit', '#!/bin/sh\necho')])).toEqual(['githooks.present:high']));
  test('one finding per hook', () => expect(ids([vf('.git/hooks/pre-commit', 'x'), vf('.git/hooks/post-checkout', 'y')])).toHaveLength(2));
  test('no hooks → nothing', () => expect(ids([vf('src/hooks/x.ts', 'x')])).toEqual([]));
});
