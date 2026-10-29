import { describe, expect, test } from 'vitest';
import { ConfigError, loadConfig } from '../../src/server/config';

const KEY = 'k'.repeat(32);
const env = (over: Record<string, string | undefined> = {}) => ({ SERVICE_KEY: KEY, ...over });

describe('loadConfig', () => {
  test('defaults', () => {
    expect(loadConfig(env())).toEqual({ serviceKey: KEY, apiUrl: 'http://localhost:8000', port: 8080, maxConcurrent: 2, maxQueue: 8, scanTimeoutMs: 90_000, cacheTtlMs: 300_000 });
  });
  test('reads every setting from the environment', () => {
    const c = loadConfig(env({ STACK3_API_URL: 'https://api.stack3.example/', PORT: '9000', MAX_CONCURRENT_SCANS: '4', MAX_QUEUED_SCANS: '20', SCAN_TIMEOUT_MS: '60000', CACHE_TTL_MS: '1000' }));
    expect(c).toMatchObject({ apiUrl: 'https://api.stack3.example', port: 9000, maxConcurrent: 4, maxQueue: 20, scanTimeoutMs: 60_000, cacheTtlMs: 1000 });
  });
  test('refuses to start without a service key, or with a short one', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ SERVICE_KEY: '' })).toThrow(/SERVICE_KEY/);
    expect(() => loadConfig({ SERVICE_KEY: 'short' })).toThrow(/at least 16/);
  });
  test('the error never echoes the key', () => {
    try {
      loadConfig({ SERVICE_KEY: 'short-secret' });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('short-secret');
    }
  });
  test.each(['0', '-1', '65536', 'abc', '8080.5'])('a bad PORT (%s) is refused', (port) => expect(() => loadConfig(env({ PORT: port }))).toThrow(/PORT/));
  test.each(['ftp://x', 'not a url', 'javascript:alert(1)', 'http://user:pw@host:8000', ''])('a bad STACK3_API_URL (%j) is refused', (u) => {
    expect(() => loadConfig(env({ STACK3_API_URL: u }))).toThrow(/STACK3_API_URL/);
  });
  test.each([['MAX_CONCURRENT_SCANS', '0'], ['MAX_CONCURRENT_SCANS', '99'], ['MAX_QUEUED_SCANS', '-1'], ['SCAN_TIMEOUT_MS', '10'], ['CACHE_TTL_MS', 'x']])('%s=%s is refused', (k, v) => {
    expect(() => loadConfig(env({ [k]: v }))).toThrow(new RegExp(k));
  });
});
