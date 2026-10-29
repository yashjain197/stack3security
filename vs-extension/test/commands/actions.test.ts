import { describe, expect, test, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActionHandlers, type ActionDeps } from '../../src/commands/actions';
import { Registry, type KeyValueStore, type ScanRecord } from '../../src/quarantine/registry';
import { makeRec } from '../ui/helpers';

const memory = (): KeyValueStore => {
  const m = new Map<string, unknown>();
  return { get: <V>(k: string, d: V) => (m.has(k) ? (m.get(k) as V) : d), update: async (k, v) => void m.set(k, v) };
};

async function setup(over: Partial<ActionDeps> = {}, recOver: Partial<ScanRecord> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-act-'));
  const rec = makeRec('caution', { dir, scanSetHash: 'hash-at-scan', ...recOver });
  const registry = new Registry(memory(), async () => undefined);
  await registry.add(rec);
  const order: string[] = [];
  const spy = <T extends unknown[]>(name: string, ret?: unknown) => vi.fn((...a: T) => (order.push(name), ret as never));
  const deps = {
    registry,
    hash: vi.fn(async () => (order.push('hash'), 'hash-at-scan')),
    rescan: vi.fn(async () => void order.push('rescan')),
    checkDir: vi.fn(async (d: string) => (order.push('checkDir'), d)),
    neutralize: vi.fn(async () => (order.push('neutralize'), [] as string[])),
    openFolder: vi.fn(async () => void order.push('openFolder')),
    removeDir: vi.fn(async () => void order.push('removeDir')),
    closePanel: spy<[string]>('closePanel'),
    offerAutoTaskGuard: vi.fn(async () => void order.push('offer')),
    viewFile: vi.fn(async () => undefined),
    copyReport: vi.fn(async () => undefined),
    info: vi.fn(),
    error: vi.fn(),
    ...over,
  } satisfies ActionDeps;
  return { dir, rec, registry, deps, order, handlers: createActionHandlers(deps) };
}

describe('openNeutralized', () => {
  test('re-hashes, disables auto-run, offers the guard, then opens in a new window, in that order', async () => {
    const t = await setup();
    await t.handlers.openNeutralized(t.rec);
    expect(t.order).toEqual(['checkDir', 'hash', 'neutralize', 'offer', 'openFolder']);
    expect(t.deps.openFolder).toHaveBeenCalledWith(t.dir);
    expect(t.deps.error).not.toHaveBeenCalled();
  });
  test('marks the clone as opened so it is not deleted behind the user', async () => {
    const t = await setup();
    await t.handlers.openNeutralized(t.rec);
    expect(t.registry.get(t.rec.scanId)?.openedAt).toBeTypeOf('number');
  });
  test('hash mismatch → re-scan, nothing neutralized, nothing opened', async () => {
    const t = await setup({ hash: vi.fn(async () => 'CHANGED') });
    await t.handlers.openNeutralized(t.rec);
    expect(t.deps.rescan).toHaveBeenCalledWith(expect.objectContaining({ scanId: t.rec.scanId }));
    expect(t.deps.neutralize).not.toHaveBeenCalled();
    expect(t.deps.openFolder).not.toHaveBeenCalled();
    expect(t.deps.info).toHaveBeenCalledWith(expect.stringMatching(/changed after the scan.*Nothing was opened/));
  });
  test('neutralize throws → error, not opened', async () => {
    const t = await setup({ neutralize: vi.fn(async () => { throw new Error('EPERM'); }) });
    await t.handlers.openNeutralized(t.rec);
    expect(t.deps.openFolder).not.toHaveBeenCalled();
    expect(t.deps.error).toHaveBeenCalledWith(expect.stringMatching(/could not disable the auto-run files/));
  });
  test('neutralize returns but auto-run items are still there → not opened (verified, not assumed)', async () => {
    const t = await setup();
    mkdirSync(join(t.dir, '.vscode'));
    writeFileSync(join(t.dir, '.vscode', 'tasks.json'), '{}');
    await t.handlers.openNeutralized(t.rec); // the fake neutralize does nothing
    expect(t.deps.openFolder).not.toHaveBeenCalled();
    expect(t.deps.error).toHaveBeenCalled();
  });
  test('a failing consent offer never blocks the open', async () => {
    const t = await setup({ offerAutoTaskGuard: vi.fn(async () => { throw new Error('ui crashed'); }) });
    await t.handlers.openNeutralized(t.rec);
    expect(t.deps.openFolder).toHaveBeenCalledOnce();
  });
});

describe('open', () => {
  test('re-hashes, offers the guard, opens; does not neutralize', async () => {
    const t = await setup();
    await t.handlers.open(t.rec);
    expect(t.order).toEqual(['checkDir', 'hash', 'offer', 'openFolder']);
    expect(t.deps.neutralize).not.toHaveBeenCalled();
  });
  test('hash mismatch → re-scan and no open, same as the neutralized path', async () => {
    const t = await setup({ hash: vi.fn(async () => 'CHANGED') });
    await t.handlers.open(t.rec);
    expect(t.deps.rescan).toHaveBeenCalledOnce();
    expect(t.deps.openFolder).not.toHaveBeenCalled();
  });
});

describe('both open paths', () => {
  test.each(['open', 'openNeutralized'] as const)('%s: a scan that is no longer on record is not opened', async (action) => {
    const t = await setup();
    await t.registry.remove(t.rec.scanId);
    await t.handlers[action](t.rec);
    expect(t.deps.openFolder).not.toHaveBeenCalled();
    expect(t.deps.error).toHaveBeenCalledWith(expect.stringMatching(/no longer available/));
  });
  test.each(['open', 'openNeutralized'] as const)('%s: a different commit under the same id is not opened', async (action) => {
    const t = await setup();
    await t.handlers[action]({ ...t.rec, sha: 'd'.repeat(40) });
    expect(t.deps.openFolder).not.toHaveBeenCalled();
  });
  test.each(['open', 'openNeutralized'] as const)('%s: a folder that is not a quarantine folder is never opened or hashed', async (action) => {
    const t = await setup({ checkDir: vi.fn(async () => { throw new Error('outside'); }) });
    await t.handlers[action](t.rec);
    expect(t.deps.hash).not.toHaveBeenCalled();
    expect(t.deps.openFolder).not.toHaveBeenCalled();
    expect(t.deps.error).toHaveBeenCalledWith(expect.stringMatching(/not a Stack3 quarantine folder/));
  });
  test.each(['open', 'openNeutralized'] as const)('%s: the folder opened is the registry\'s, not whatever the message carried', async (action) => {
    const t = await setup();
    await t.handlers[action]({ ...t.rec, dir: '/etc' });
    expect(t.deps.openFolder).toHaveBeenCalledWith(t.dir);
  });
  test.each(['open', 'openNeutralized'] as const)('%s: a failing openFolder is reported, not thrown', async (action) => {
    const t = await setup({ openFolder: vi.fn(async () => { throw new Error('boom'); }) });
    await expect(t.handlers[action](t.rec)).resolves.toBeUndefined();
    expect(t.deps.error).toHaveBeenCalledWith('VS Code could not open the folder.');
    expect(t.registry.get(t.rec.scanId)?.openedAt).toBeUndefined();
  });
  test.each(['open', 'openNeutralized'] as const)('%s: two quick clicks open one window', async (action) => {
    let release!: () => void;
    const t = await setup({ openFolder: vi.fn(() => new Promise<void>((r) => (release = r))) });
    const a = t.handlers[action](t.rec);
    const b = t.handlers[action](t.rec);
    await new Promise((r) => setTimeout(r, 5));
    release();
    await Promise.all([a, b]);
    expect(t.deps.openFolder).toHaveBeenCalledTimes(1);
  });
});

describe('delete', () => {
  test('removes the clone, forgets the scan, closes the panel and says so', async () => {
    const t = await setup();
    await t.handlers.delete(t.rec);
    expect(t.deps.removeDir).toHaveBeenCalledWith(t.rec.dir);
    expect(t.registry.get(t.rec.scanId)).toBeUndefined();
    expect(t.deps.closePanel).toHaveBeenCalledWith(t.rec.scanId);
    expect(t.deps.info).toHaveBeenCalledWith('The clone was deleted.');
    expect(t.order.indexOf('removeDir')).toBeLessThan(t.order.indexOf('closePanel'));
  });
  test('when the contained delete refuses, nothing else happens and the user is told', async () => {
    const t = await setup({ removeDir: vi.fn(async () => { throw new Error('OutsideQuarantineError'); }) });
    await t.handlers.delete(t.rec);
    expect(t.registry.get(t.rec.scanId)).toBeDefined();
    expect(t.deps.closePanel).not.toHaveBeenCalled();
    expect(t.deps.error).toHaveBeenCalledWith('The clone could not be deleted. It was left where it is.');
  });
  test('does not need a hash check, a consent offer or an open', async () => {
    const t = await setup();
    await t.handlers.delete(t.rec);
    expect(t.deps.hash).not.toHaveBeenCalled();
    expect(t.deps.offerAutoTaskGuard).not.toHaveBeenCalled();
    expect(t.deps.openFolder).not.toHaveBeenCalled();
  });
});

describe('viewFile and copyReport', () => {
  test('are passed straight through', async () => {
    const t = await setup();
    await t.handlers.viewFile(t.rec, 'src/a.ts');
    await t.handlers.copyReport(t.rec);
    expect(t.deps.viewFile).toHaveBeenCalledWith(t.rec, 'src/a.ts');
    expect(t.deps.copyReport).toHaveBeenCalledWith(t.rec);
  });
});
