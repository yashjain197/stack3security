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
      'stack3.explain.ollamaModel',
      'stack3.explain.provider',
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

  test('explanation provider defaults to the local model, and a bad value falls back', () => {
    expect(getSettings()).toMatchObject({ explainProvider: 'ollama', ollamaModel: 'qwen2.5-coder:7b' });
    __setInspect('stack3', 'explain.provider', { defaultValue: 'ollama', globalValue: 'api' });
    expect(getSettings().explainProvider).toBe('api');
    __setInspect('stack3', 'explain.provider', { defaultValue: 'ollama', globalValue: 'https://evil.example' });
    expect(getSettings().explainProvider).toBe('ollama');
  });
  test('a workspace cannot choose the model or the provider (application scope)', () => {
    __setInspect('stack3', 'explain.ollamaModel', { defaultValue: 'qwen2.5-coder:7b', workspaceValue: 'evil' });
    __setInspect('stack3', 'explain.provider', { defaultValue: 'ollama', workspaceValue: 'api' });
    expect(getSettings()).toMatchObject({ explainProvider: 'ollama', ollamaModel: 'qwen2.5-coder:7b' });
  });
  test('model names are restricted to the characters Ollama uses', () => {
    for (const bad of ['', ' x', 'x y', '../../x', 'a;rm -rf /', 'a'.repeat(101), 5, null]) {
      __setInspect('stack3', 'explain.ollamaModel', { defaultValue: 'qwen2.5-coder:7b', globalValue: bad });
      expect(getSettings().ollamaModel, String(bad)).toBe('qwen2.5-coder:7b');
    }
    __setInspect('stack3', 'explain.ollamaModel', { defaultValue: 'x', globalValue: 'llama3.2:latest' });
    expect(getSettings().ollamaModel).toBe('llama3.2:latest');
    __setInspect('stack3', 'explain.ollamaModel', { defaultValue: 'x', globalValue: 'library/llama3.2:3b' });
    expect(getSettings().ollamaModel).toBe('library/llama3.2:3b');
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
