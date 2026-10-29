import { afterEach, describe, expect, test } from 'vitest';
import pkg from '../package.json';
import { __resetInspect, __setInspect } from './mocks/vscode';
import { DEFAULT_LIMITS, getSettings } from '../src/config/settings';

const props = (pkg as any).contributes?.configuration?.properties ?? {};

describe('settings contract', () => {
  afterEach(() => __resetInspect());

  test('declares the five stack3.* settings', () => {
    expect(Object.keys(props).sort()).toEqual([
      'stack3.apiUrl',
      'stack3.dev.allowLocalhost',
      'stack3.explain.sendSnippets',
      'stack3.report.mode',
      'stack3.scan.limits',
    ]);
  });

  test('every stack3.* contribution is application scope', () => {
    for (const [k, v] of Object.entries<any>(props)) if (k.startsWith('stack3.')) expect(v.scope, k).toBe('application');
  });

  test('untrustedWorkspaces supported with restrictedConfigurations', () => {
    const u = (pkg as any).capabilities?.untrustedWorkspaces;
    expect(u?.supported).toBe(true);
    expect(u?.restrictedConfigurations).toEqual(Object.keys(props).sort());
  });

  test('getSettings ignores workspaceValue', () => {
    __setInspect('stack3', 'apiUrl', { defaultValue: '', workspaceValue: 'https://evil.example' });
    expect(getSettings().apiUrl).toBe('');
  });

  test('getSettings ignores workspaceFolderValue for limits', () => {
    __setInspect('stack3', 'scan.limits', { defaultValue: DEFAULT_LIMITS, workspaceFolderValue: { maxFiles: 1e9 } });
    expect(getSettings().limits).toEqual(DEFAULT_LIMITS);
  });

  test('getSettings uses the user (global) value', () => {
    __setInspect('stack3', 'apiUrl', { defaultValue: '', globalValue: 'https://api.example' });
    expect(getSettings().apiUrl).toBe('https://api.example');
  });

  test('limits default to the spec values', () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxFiles: 20000, maxFileBytes: 1048576, maxTotalBytes: 52428800, maxDepth: 32, timeoutMs: 30000,
    });
  });

  test('invalid user limit values fall back to defaults', () => {
    __setInspect('stack3', 'scan.limits', { defaultValue: DEFAULT_LIMITS, globalValue: { maxFiles: -1, maxDepth: 'x' } });
    expect(getSettings().limits).toEqual(DEFAULT_LIMITS);
  });
});
