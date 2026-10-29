import { beforeEach, describe, expect, test } from 'vitest';
import type * as vscode from 'vscode';
import { maybeOfferAutoTaskGuard, PROMPTED_KEY } from '../../src/guard/autoTasks';
import { __calls, __docs, __reset } from '../mocks/vscode';
import { __config, __resetInspect, __setInspect, ConfigurationTarget } from '../mocks/vscode';

const ctx = () => {
  const m = new Map<string, unknown>();
  return {
    m,
    ctx: { globalState: { get: (k: string, d?: unknown) => (m.has(k) ? m.get(k) : d), update: async (k: string, v: unknown) => void m.set(k, v) } } as unknown as vscode.ExtensionContext,
  };
};
const TURN_OFF = 'Turn off automatic tasks';

beforeEach(() => {
  __reset();
  __resetInspect();
});

describe('maybeOfferAutoTaskGuard (D-7)', () => {
  test('asks once, in a modal that explains what changes; consenting sets task.allowAutomaticTasks to off at user scope', async () => {
    const c = ctx();
    __docs.infoAnswer = TURN_OFF;
    await maybeOfferAutoTaskGuard(c.ctx);
    const [title, options, ...buttons] = __docs.infoCalls[0] as [string, { modal: boolean; detail: string }, string, string];
    expect(__docs.infoCalls).toHaveLength(2); // the question, then the confirmation
    expect(title).toMatch(/turn off automatic tasks/i);
    expect(options.modal).toBe(true);
    expect(options.detail).toMatch(/task\.allowAutomaticTasks/);
    expect(options.detail).toMatch(/change it back/i);
    expect(buttons).toEqual([TURN_OFF, 'Not now']);
    expect(__config.updates).toEqual([{ section: 'task', key: 'allowAutomaticTasks', value: 'off', target: ConfigurationTarget.Global }]);
    expect(c.m.get(PROMPTED_KEY)).toBe(true);
  });
  test('declining leaves the setting untouched and it is never asked again', async () => {
    const c = ctx();
    __docs.infoAnswer = 'Not now';
    await maybeOfferAutoTaskGuard(c.ctx);
    expect(__config.updates).toEqual([]);
    __docs.infoCalls = [];
    __docs.infoAnswer = TURN_OFF; // would accept if asked again
    await maybeOfferAutoTaskGuard(c.ctx);
    expect(__docs.infoCalls).toEqual([]);
    expect(__config.updates).toEqual([]);
  });
  test('dismissing the dialog (Esc) counts as no, and is also remembered', async () => {
    const c = ctx();
    __docs.infoAnswer = undefined;
    await maybeOfferAutoTaskGuard(c.ctx);
    expect(__config.updates).toEqual([]);
    expect(c.m.get(PROMPTED_KEY)).toBe(true);
  });
  test('already off at user level → no question, and nothing written', async () => {
    const c = ctx();
    __setInspect('task', 'allowAutomaticTasks', { globalValue: 'off' });
    await maybeOfferAutoTaskGuard(c.ctx);
    expect(__docs.infoCalls).toEqual([]);
    expect(__config.updates).toEqual([]);
    expect(c.m.get(PROMPTED_KEY)).toBe(true);
  });
  test('the question is recorded before it is asked, so a crash cannot make it nag', async () => {
    const c = ctx();
    let flagWhenAsked: unknown;
    const w = (await import('../mocks/vscode')).window as unknown as Record<string, unknown>;
    const original = w.showInformationMessage;
    w.showInformationMessage = async () => {
      flagWhenAsked = c.m.get(PROMPTED_KEY);
      throw new Error('ui crashed');
    };
    await expect(maybeOfferAutoTaskGuard(c.ctx)).rejects.toThrow('ui crashed');
    w.showInformationMessage = original;
    expect(flagWhenAsked).toBe(true);
  });
  test('a failure to write the setting is reported to the user and does not throw', async () => {
    const c = ctx();
    __docs.infoAnswer = TURN_OFF;
    __config.failUpdate = true;
    await expect(maybeOfferAutoTaskGuard(c.ctx)).resolves.toBeUndefined();
    expect(__calls.errors.join()).toMatch(/could not change the setting/);
  });
  test('it never writes at workspace level', async () => {
    const c = ctx();
    __docs.infoAnswer = TURN_OFF;
    await maybeOfferAutoTaskGuard(c.ctx);
    expect(__config.updates.every((u) => u.target === ConfigurationTarget.Global)).toBe(true);
  });
  test('wording never claims safety', async () => {
    const c = ctx();
    __docs.infoAnswer = TURN_OFF;
    await maybeOfferAutoTaskGuard(c.ctx);
    expect(JSON.stringify([__docs.infoCalls, __calls.infos])).not.toMatch(/\bsafe\b/i);
  });
});
