import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as vscode from 'vscode';
import { activate, deactivate } from '../../src/extension';
import { __calls, __reset } from '../mocks/vscode';
import pkg from '../../package.json';

const context = (): vscode.ExtensionContext => {
  const m = new Map<string, unknown>();
  return {
    subscriptions: [],
    globalState: { get: (k: string, d?: unknown) => (m.has(k) ? m.get(k) : d), update: async (k: string, v: unknown) => void m.set(k, v) },
    extension: { packageJSON: { version: '9.9.9' } },
  } as unknown as vscode.ExtensionContext;
};

let prev: string | undefined;
beforeEach(() => {
  __reset();
  prev = process.env.TMPDIR;
  process.env.TMPDIR = mkdtempSync(join(tmpdir(), 'stack3-reg-'));
});
afterEach(() => {
  if (prev === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = prev;
});

describe('extension wiring', () => {
  test('package.json contributes the command with the plan\'s title', () => {
    const cmds = (pkg as { contributes: { commands: { command: string; title: string }[] } }).contributes.commands;
    expect(cmds).toContainEqual({ command: 'stack3.cloneAndScan', title: 'Stack3: Clone and scan safely' });
  });
  test('activate registers stack3.cloneAndScan and keeps its disposable', () => {
    const ctx = context();
    activate(ctx);
    expect(__calls.registered).toEqual(['stack3.cloneAndScan']);
    // the guard (collection, status bar, watchers, staged-secret warning), the quarantine file viewer, and the command
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(6);
    expect(() => deactivate()).not.toThrow();
  });
  test('cancelling the input box does nothing: no progress, no error', async () => {
    activate(context());
    __calls.nextInput = undefined;
    expect(await __calls.handlers.get('stack3.cloneAndScan')!()).toEqual({ ok: false, reason: 'Cancelled' });
    expect(__calls.progress).toBe(0);
    expect(__calls.errors).toEqual([]);
  });
  test('an invalid URL passed as an argument is rejected up front, with no progress and nothing cloned', async () => {
    activate(context());
    const out = (await __calls.handlers.get('stack3.cloneAndScan')!('--upload-pack=touch /tmp/x')) as { ok: boolean; reason: string };
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/github\.com\/owner\/repo/);
    expect(__calls.progress).toBe(0);
    expect(__calls.errors).toHaveLength(1);
  });
  test('the input box validates as you type', async () => {
    activate(context());
    __calls.nextInput = undefined;
    await __calls.handlers.get('stack3.cloneAndScan')!();
    const validate = __calls.lastInputOptions!.validateInput!;
    expect(validate('https://github.com/o/r')).toBeUndefined();
    expect(String(validate('https://gitlab.com/o/r'))).toMatch(/github\.com\/owner\/repo/);
    expect(__calls.lastInputOptions!.ignoreFocusOut).toBe(true);
  });
  test('a non-string argument is ignored, not trusted', async () => {
    activate(context());
    __calls.nextInput = undefined;
    await __calls.handlers.get('stack3.cloneAndScan')!({ evil: true });
    expect(__calls.progress).toBe(0);
  });
  test('startup sweeps old quarantine folders without throwing when there is none', () => {
    expect(() => activate(context())).not.toThrow();
    vi.useRealTimers();
  });
});
