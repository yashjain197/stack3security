import { describe, expect, test, vi } from 'vitest';
import fc from 'fast-check';
import { createBridge, parseWebviewMessage } from '../../src/ui/bridge';
import type { Level } from '../../src/engine/types';
import { buttonsFor, requiresConfirm } from '../../src/ui/view';
import { called, makeHandlers, makeRec, SCAN_ID } from './helpers';

const act = (action: string, extra: object = {}) => ({ type: 'action', scanId: SCAN_ID, action, ...extra });

function setup(level: Level, opts: { confirm?: boolean; recorded?: boolean } = {}) {
  const { h, handlers } = makeHandlers();
  const confirm = vi.fn(async () => opts.confirm ?? true);
  const onReady = vi.fn();
  const onRendered = vi.fn();
  const rec = makeRec(level);
  const bridge = createBridge({ rec, handlers, ui: { confirm }, isRecorded: () => opts.recorded ?? true, onReady, onRendered });
  return { h, confirm, onReady, onRendered, bridge, rec };
}

describe('parseWebviewMessage: a closed, strict schema', () => {
  test.each([
    [{ type: 'ready' }],
    [act('openNeutralized')], [act('open')], [act('delete')], [act('copyReport')],
    [act('viewFile', { file: '.vscode/tasks.json' })],
    [{ type: 'rendered', scanId: SCAN_ID, images: 0, scripts: 0, anchors: 0, injected: false, text: 'hi' }],
  ])('accepts %j', (m) => expect(parseWebviewMessage(m)).toEqual(m));

  test.each([
    ['unknown type', { type: 'run', scanId: SCAN_ID }],
    ['unknown action', act('format')],
    ['action missing', { type: 'action', scanId: SCAN_ID }],
    ['extra key on an action', act('open', { force: true })],
    ['extra key on ready', { type: 'ready', x: 1 }],
    ['file on a non-viewFile action', act('delete', { file: 'a' })],
    ['viewFile without a file', act('viewFile')],
    ['file of the wrong type', act('viewFile', { file: 5 })],
    ['empty file', act('viewFile', { file: '' })],
    ['huge file name', act('viewFile', { file: 'a'.repeat(1001) })],
    ['scanId wrong shape', { type: 'action', scanId: 'abc', action: 'open' }],
    ['scanId uppercase hex', { type: 'action', scanId: 'AB'.repeat(32), action: 'open' }],
    ['scanId missing', { type: 'action', action: 'open' }],
    ['scanId a number', { type: 'action', scanId: 5, action: 'open' }],
    ['rendered with a string count', { type: 'rendered', scanId: SCAN_ID, images: '0', scripts: 0, anchors: 0, injected: false, text: '' }],
    ['rendered with a negative count', { type: 'rendered', scanId: SCAN_ID, images: -1, scripts: 0, anchors: 0, injected: false, text: '' }],
    ['rendered text over 20000', { type: 'rendered', scanId: SCAN_ID, images: 0, scripts: 0, anchors: 0, injected: false, text: 'x'.repeat(20001) }],
    ['null', null], ['undefined', undefined], ['a string', 'open'], ['a number', 5], ['an array', [act('open')]], ['empty object', {}],
    ['__proto__ key', JSON.parse('{"type":"action","scanId":"' + SCAN_ID + '","action":"open","__proto__":{"x":1}}')],
    ['constructor key', { type: 'action', scanId: SCAN_ID, action: 'open', constructor: 1 }],
  ])('rejects %s', (_n, m) => expect(parseWebviewMessage(m)).toBeNull());

  test('does not mutate or trust the input object', () => {
    const m = act('open');
    const out = parseWebviewMessage(m);
    expect(out).not.toBe(m);
    expect(m).toEqual(act('open'));
  });
});

describe('buttonsFor (D-3)', () => {
  test('critical: delete first, no plain open', () => expect(buttonsFor('critical')).toEqual(['delete', 'openNeutralized']));
  test('high: open with auto-run disabled first', () => expect(buttonsFor('high')).toEqual(['openNeutralized', 'open', 'delete']));
  test.each(['caution', 'unknown', 'no_known_issues'] as const)('%s: open first', (l) => expect(buttonsFor(l)).toEqual(['open', 'openNeutralized', 'delete']));
  test('confirmation is required exactly where D-3 says', () => {
    expect(requiresConfirm('critical', 'openNeutralized')).toBe(true);
    expect(requiresConfirm('high', 'open')).toBe(true);
    expect(requiresConfirm('critical', 'open')).toBe(true);
    expect(requiresConfirm('high', 'openNeutralized')).toBe(false);
    for (const l of ['caution', 'unknown', 'no_known_issues'] as const) for (const a of ['open', 'openNeutralized'] as const) expect(requiresConfirm(l, a)).toBe(false);
    expect(requiresConfirm('critical', 'delete')).toBe(false);
  });
});

describe('bridge: routing', () => {
  test('ready asks the host to send the verdict', async () => {
    const t = setup('high');
    expect(await t.bridge.handle({ type: 'ready' })).toEqual({ handled: true });
    expect(t.onReady).toHaveBeenCalledOnce();
  });
  test('a message for a different scan is dropped, whatever it asks', async () => {
    const t = setup('caution');
    for (const action of ['open', 'delete', 'openNeutralized', 'copyReport']) {
      expect(await t.bridge.handle({ type: 'action', scanId: 'cd'.repeat(32), action })).toEqual({ handled: false, reason: 'wrong scan' });
    }
    expect(called(t.h)).toEqual([]);
    expect(await t.bridge.handle({ type: 'rendered', scanId: 'cd'.repeat(32), images: 0, scripts: 0, anchors: 0, injected: false, text: '' })).toMatchObject({ handled: false });
    expect(t.onRendered).not.toHaveBeenCalled();
  });
  test('rendered stats reach the host hook', async () => {
    const t = setup('high');
    await t.bridge.handle({ type: 'rendered', scanId: SCAN_ID, images: 1, scripts: 2, anchors: 3, injected: true, text: 'abc' });
    expect(t.onRendered).toHaveBeenCalledWith({ images: 1, scripts: 2, anchors: 3, injected: true, text: 'abc' });
  });
  test('the host enforces the button set: a plain open on critical is dropped even if the webview sends it', async () => {
    const t = setup('critical');
    expect(await t.bridge.handle(act('open'))).toEqual({ handled: false, reason: 'not allowed' });
    expect(called(t.h)).toEqual([]);
    expect(t.confirm).not.toHaveBeenCalled();
  });
  test('delete, viewFile and copyReport work at every level, without a confirmation', async () => {
    for (const level of ['critical', 'high', 'caution', 'unknown', 'no_known_issues'] as const) {
      const t = setup(level);
      await t.bridge.handle(act('delete'));
      await t.bridge.handle(act('copyReport'));
      await t.bridge.handle(act('viewFile', { file: 'src/a.ts' }));
      expect(called(t.h).sort(), level).toEqual(['copyReport', 'delete', 'viewFile']);
      expect(t.confirm).not.toHaveBeenCalled();
    }
  });
  test.each(['caution', 'unknown', 'no_known_issues'] as const)('%s: open and openNeutralized run with no confirmation', async (level) => {
    const t = setup(level);
    await t.bridge.handle(act('open'));
    await t.bridge.handle(act('openNeutralized'));
    expect(called(t.h).sort()).toEqual(['open', 'openNeutralized']);
    expect(t.confirm).not.toHaveBeenCalled();
  });
  test('high: openNeutralized runs directly', async () => {
    const t = setup('high');
    await t.bridge.handle(act('openNeutralized'));
    expect(called(t.h)).toEqual(['openNeutralized']);
    expect(t.confirm).not.toHaveBeenCalled();
  });
});

describe('bridge: modal confirmation (I-12)', () => {
  test('open on high asks first, naming the top finding; confirming runs the handler', async () => {
    const t = setup('high', { confirm: true });
    expect(await t.bridge.handle(act('open'))).toEqual({ handled: true });
    expect(t.confirm).toHaveBeenCalledOnce();
    const [title, detail, ok] = t.confirm.mock.calls[0] as unknown as [string, string, string];
    expect(title).toContain('github.com/octo/hello@ccccccc');
    expect(detail).toContain('Task runs a hidden command');
    expect(detail).toContain('.vscode/tasks.json:14');
    expect(ok).toBe('Open anyway');
    expect(called(t.h)).toEqual(['open']);
  });
  test('open on high: cancel → no handler call', async () => {
    const t = setup('high', { confirm: false });
    expect(await t.bridge.handle(act('open'))).toEqual({ handled: false, reason: 'cancelled' });
    expect(called(t.h)).toEqual([]);
  });
  test('openNeutralized on critical asks first; cancel → nothing, confirm → runs', async () => {
    const no = setup('critical', { confirm: false });
    await no.bridge.handle(act('openNeutralized'));
    expect(called(no.h)).toEqual([]);
    const yes = setup('critical', { confirm: true });
    await yes.bridge.handle(act('openNeutralized'));
    expect(called(yes.h)).toEqual(['openNeutralized']);
    expect((yes.confirm.mock.calls[0] as unknown as string[])[2]).toBe('Open with auto-run disabled');
  });
  test('a second open while the first is waiting for the modal is dropped (no double-click bypass)', async () => {
    let release!: (v: boolean) => void;
    const { h, handlers } = makeHandlers();
    const confirm = vi.fn(() => new Promise<boolean>((r) => (release = r)));
    const bridge = createBridge({ rec: makeRec('high'), handlers, ui: { confirm }, isRecorded: () => true, onReady: () => undefined });
    const first = bridge.handle(act('open'));
    expect(await bridge.handle(act('open'))).toEqual({ handled: false, reason: 'busy' });
    release(true);
    await first;
    expect(h.open).toHaveBeenCalledTimes(1);
  });
  test('after a cancelled confirmation the next attempt asks again', async () => {
    const t = setup('high', { confirm: false });
    await t.bridge.handle(act('open'));
    await t.bridge.handle(act('open'));
    expect(t.confirm).toHaveBeenCalledTimes(2);
  });
});

describe('bridge: open needs a recorded verdict (I-2)', () => {
  test('open actions are dropped when the registry no longer holds this verdict', async () => {
    const t = setup('caution', { recorded: false });
    expect(await t.bridge.handle(act('open'))).toEqual({ handled: false, reason: 'not recorded' });
    expect(await t.bridge.handle(act('openNeutralized'))).toEqual({ handled: false, reason: 'not recorded' });
    expect(called(t.h)).toEqual([]);
  });
  test('delete still works for a clone that is no longer recorded', async () => {
    const t = setup('caution', { recorded: false });
    await t.bridge.handle(act('delete'));
    expect(called(t.h)).toEqual(['delete']);
  });
});

describe('bridge: viewFile containment', () => {
  test.each([
    '../../.ssh/id_rsa', '../x', 'a/../../x', '/etc/passwd', 'C:\\Windows\\win.ini', 'C:/x', '~/.ssh/id_rsa', 'a\\..\\b',
    '..', '.', 'a/./../..', 'x\u0000y'.replace('\u0000', String.fromCharCode(0)), `a${String.fromCharCode(10)}b`,
  ])('%j is refused and no handler runs', async (file) => {
    const t = setup('high');
    expect(await t.bridge.handle(act('viewFile', { file }))).toMatchObject({ handled: false });
    expect(called(t.h)).toEqual([]);
  });
  test('a normal relative path is passed to the handler normalized', async () => {
    const t = setup('high');
    await t.bridge.handle(act('viewFile', { file: './src//a/../b.ts' }));
    expect(t.h.viewFile).toHaveBeenCalledWith(expect.objectContaining({ scanId: SCAN_ID }), 'src/b.ts');
  });
});

describe('bridge: robustness', () => {
  test('a handler that throws is reported as a failure, not a crash', async () => {
    const t = setup('caution');
    t.h.open.mockRejectedValueOnce(new Error('boom'));
    expect(await t.bridge.handle(act('open'))).toEqual({ handled: false, reason: 'handler failed' });
  });
  test('fuzz: random values never cause an action', async () => {
    const t = setup('caution');
    await fc.assert(fc.asyncProperty(fc.anything(), async (raw) => void (await t.bridge.handle(raw))), { numRuns: 400 });
    expect(called(t.h)).toEqual([]);
  });
  test('fuzz: near-valid messages with the wrong scan id or an unknown action never cause an action', async () => {
    const t = setup('caution');
    const near = fc.record({
      type: fc.constantFrom('action', 'ready', 'rendered', 'Action', ' action'),
      scanId: fc.oneof(fc.stringMatching(/^[0-9a-f]{64}$/).filter((s) => s !== SCAN_ID), fc.string()),
      action: fc.oneof(fc.string(), fc.constantFrom('Open', 'OPEN', 'delete ', 'rm', 'exec', 'openFolder')),
      file: fc.option(fc.string(), { nil: undefined }),
    });
    await fc.assert(fc.asyncProperty(near, async (m) => { if (m.type !== 'ready') await t.bridge.handle(m); }), { numRuns: 400 });
    expect(called(t.h)).toEqual([]);
  });
  test('fuzz: with the right scan id only allowed actions ever run, and risky opens never run unconfirmed', async () => {
    for (const level of ['critical', 'high', 'caution', 'unknown', 'no_known_issues'] as const) {
      const t = setup(level, { confirm: false });
      const action = fc.constantFrom('open', 'openNeutralized', 'delete', 'viewFile', 'copyReport', 'x');
      await fc.assert(fc.asyncProperty(action, fc.string(), async (a, file) => void (await t.bridge.handle({ type: 'action', scanId: SCAN_ID, action: a, ...(a === 'viewFile' ? { file } : {}) }))), { numRuns: 200 });
      const ran = called(t.h);
      for (const a of ran) expect([...buttonsFor(level), 'viewFile', 'copyReport'], `${level}:${a}`).toContain(a);
      for (const a of ['open', 'openNeutralized'] as const) if (requiresConfirm(level, a)) expect(ran, `${level}:${a} ran without confirmation`).not.toContain(a);
    }
  });
});
