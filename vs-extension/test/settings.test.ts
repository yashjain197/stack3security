import { afterEach, describe, expect, test } from 'vitest';
import pkg from '../package.json';
import { __resetInspect, __setInspect } from './mocks/vscode';
import { DEFAULT_LIMITS, getSettings } from '../src/config/settings';

const props = (pkg as any).contributes?.configuration?.properties ?? {};

describe('settings contract', () => {
  afterEach(() => __resetInspect());

  test('declares the stack3.* settings', () => {
    expect(Object.keys(props).sort()).toEqual([
      'stack3.apiUrl',
      'stack3.dev.allowLocalhost',
      'stack3.explain.provider',
      'stack3.explain.sendSnippets',
      'stack3.report.mode',
      'stack3.scan.exclude',
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

  test('explanation provider defaults to Claude, and a bad value falls back', () => {
    expect(getSettings()).toMatchObject({ explainProvider: 'claude' });
    __setInspect('stack3', 'explain.provider', { defaultValue: 'claude', globalValue: 'api' });
    expect(getSettings().explainProvider).toBe('api');
    for (const bad of ['https://evil.example', 'ollama', 5, null]) {
      __setInspect('stack3', 'explain.provider', { defaultValue: 'claude', globalValue: bad });
      expect(getSettings().explainProvider, String(bad)).toBe('claude');
    }
  });
  test('a workspace cannot choose the provider (application scope)', () => {
    __setInspect('stack3', 'explain.provider', { defaultValue: 'claude', workspaceValue: 'api' });
    expect(getSettings()).toMatchObject({ explainProvider: 'claude' });
  });
  test('limits default to the spec values', () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxFiles: 20000, maxFileBytes: 1048576, maxTotalBytes: 52428800, maxDepth: 32, timeoutMs: 30000,
    });
  });

  test('scan.exclude: only the user value is read, and a repo cannot set it', () => {
    __setInspect('stack3', 'scan.exclude', { defaultValue: {}, workspaceFolderValue: { '/tmp/x': ['dist'] }, workspaceValue: { '/tmp/x': ['dist'] } });
    expect(getSettings().scanExclude).toEqual({});
    __setInspect('stack3', 'scan.exclude', { defaultValue: {}, globalValue: { '/home/me/proj': ['test/fixtures/**', 'dist'] } });
    expect(getSettings().scanExclude).toEqual({ '/home/me/proj': ['test/fixtures', 'dist'] });
  });

  test('scan.exclude: unusable entries are dropped, not trusted', () => {
    __setInspect('stack3', 'scan.exclude', {
      defaultValue: {},
      globalValue: { relative: ['dist'], '/ok': ['../escape', '/abs', '*.js', 'good', 7], '/notarray': 'dist', '/empty': [] },
    });
    expect(getSettings().scanExclude).toEqual({ '/ok': ['good'] });
    for (const bad of ['text', 42, ['dist'], null]) {
      __setInspect('stack3', 'scan.exclude', { defaultValue: {}, globalValue: bad });
      expect(getSettings().scanExclude).toEqual({});
    }
  });

  test('invalid user limit values fall back to defaults', () => {
    __setInspect('stack3', 'scan.limits', { defaultValue: DEFAULT_LIMITS, globalValue: { maxFiles: -1, maxDepth: 'x' } });
    expect(getSettings().limits).toEqual(DEFAULT_LIMITS);
  });
});
