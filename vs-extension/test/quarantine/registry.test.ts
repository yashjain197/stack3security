import { describe, expect, test } from 'vitest';
import { Registry, scanIdFor, type KeyValueStore } from '../../src/quarantine/registry';
import type { ScanRecord } from '../../src/quarantine/registry';
import { aggregate } from '../../src/engine/verdict';
import { I, T } from '../engine/helpers';

const store = (): KeyValueStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return { data, get: <V>(k: string, d?: V) => (data.has(k) ? (data.get(k) as V) : (d as V)), update: async (k, v) => void data.set(k, v) };
};
const rec = (over: Partial<ScanRecord> = {}): ScanRecord => ({
  scanId: 'id1', dir: '/tmp/stack3-quarantine/octo__hello__abcd1234', url: 'https://github.com/octo/hello', sha: 'a'.repeat(40),
  verdict: aggregate([], [], T, I), scanSetHash: 'h', createdAt: Date.now(), ...over,
});
const DAY = 86_400_000;

describe('Registry', () => {
  test('add / get / remove', async () => {
    const r = new Registry(store(), async () => undefined);
    await r.add(rec());
    expect(r.get('id1')?.url).toBe('https://github.com/octo/hello');
    await r.remove('id1');
    expect(r.get('id1')).toBeUndefined();
  });
  test('adding the same scanId replaces the record', async () => {
    const r = new Registry(store(), async () => undefined);
    await r.add(rec({ sha: 'a'.repeat(40) }));
    await r.add(rec({ sha: 'b'.repeat(40) }));
    expect(r.list()).toHaveLength(1);
    expect(r.get('id1')?.sha).toBe('b'.repeat(40));
  });
  test('survives a reload (state lives in the store)', async () => {
    const s = store();
    await new Registry(s, async () => undefined).add(rec());
    expect(new Registry(s, async () => undefined).get('id1')).toBeDefined();
  });
  test('pruneOlderThan removes old records and their directories, keeps fresh ones', async () => {
    const removed: string[] = [];
    const r = new Registry(store(), async (d) => void removed.push(d));
    await r.add(rec({ scanId: 'old', dir: '/q/old', createdAt: Date.now() - 8 * DAY }));
    await r.add(rec({ scanId: 'new', dir: '/q/new', createdAt: Date.now() - 1 * DAY }));
    expect(await r.pruneOlderThan(7)).toEqual(['old']);
    expect(removed).toEqual(['/q/old']);
    expect(r.get('old')).toBeUndefined();
    expect(r.get('new')).toBeDefined();
  });
  test('a directory that cannot be removed keeps its record so it is retried', async () => {
    const r = new Registry(store(), async () => { throw new Error('busy'); });
    await r.add(rec({ scanId: 'old', createdAt: Date.now() - 9 * DAY }));
    expect(await r.pruneOlderThan(7)).toEqual([]);
    expect(r.get('old')).toBeDefined();
  });
  test('keeps at most 50 records, dropping the oldest', async () => {
    const r = new Registry(store(), async () => undefined);
    for (let i = 0; i < 55; i++) await r.add(rec({ scanId: `s${i}`, createdAt: 1000 + i }));
    expect(r.list()).toHaveLength(50);
    expect(r.get('s0')).toBeUndefined();
    expect(r.get('s54')).toBeDefined();
  });
  test('malformed stored entries are ignored, not trusted', async () => {
    const s = store();
    s.data.set('stack3.quarantine.records', [{ scanId: 1 }, null, 'x', { ...rec(), dir: 42 }, rec({ scanId: 'good' })]);
    expect(new Registry(s, async () => undefined).list().map((x) => x.scanId)).toEqual(['good']);
  });
});

describe('scanIdFor', () => {
  test('is a stable sha-256 of repo + sha + engine version, and changes with each', () => {
    const a = scanIdFor('https://github.com/o/r', 'a'.repeat(40), '1.0.0');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(scanIdFor('https://github.com/o/r', 'a'.repeat(40), '1.0.0')).toBe(a);
    expect(scanIdFor('https://github.com/o/r', 'b'.repeat(40), '1.0.0')).not.toBe(a);
    expect(scanIdFor('https://github.com/o/r', 'a'.repeat(40), '1.0.1')).not.toBe(a);
    expect(scanIdFor('https://github.com/o/x', 'a'.repeat(40), '1.0.0')).not.toBe(a);
  });
  test('field boundaries cannot be shifted to collide', () => {
    expect(scanIdFor('ab', 'c', 'd')).not.toBe(scanIdFor('a', 'bc', 'd'));
  });
});
