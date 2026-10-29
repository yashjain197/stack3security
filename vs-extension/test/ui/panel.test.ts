import { beforeEach, describe, expect, test } from 'vitest';
import type * as vscode from 'vscode';
import { closePanel, postExplanation, renderHtml, showVerdictPanel, __resetPanels } from '../../src/ui/panel';
import { buildView } from '../../src/ui/view';
import { __calls, __docs, __panels, __reset } from '../mocks/vscode';
import { called, makeHandlers, makeRec, SCAN_ID } from './helpers';
import { Registry } from '../../src/quarantine/registry';

const ctx = (): vscode.ExtensionContext => {
  const m = new Map<string, unknown>();
  return {
    extensionUri: { scheme: 'file', path: '/ext', fsPath: '/ext' },
    globalState: { get: (k: string, d?: unknown) => (m.has(k) ? m.get(k) : d), update: async (k: string, v: unknown) => void m.set(k, v) },
  } as unknown as vscode.ExtensionContext;
};
beforeEach(() => {
  __reset();
  __resetPanels();
});

describe('renderHtml: CSP (I-11)', () => {
  const html = renderHtml('vscode-resource:', 'N', 's.js', 's.css');
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(html)![1]!.replace(/&#39;/g, "'");
  test('default-src none, script only by nonce, styles only from the extension', () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-N'");
    expect(csp).toContain('style-src vscode-resource:');
    expect(csp).toContain('img-src vscode-resource: data:');
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  });
  test('no unsafe-inline, unsafe-eval, wildcard or remote source', () => {
    expect(html).not.toMatch(/unsafe-(inline|eval)/);
    expect(csp).not.toMatch(/\*|https?:|connect-src|frame-src|object-src/);
  });
  test('exactly one script, with the nonce; no inline script, no inline style, no handlers', () => {
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('<script nonce="N" src="s.js"></script>');
    expect(html).not.toMatch(/<style|style=|\son[a-z]+=|javascript:/i);
    expect(html).toContain('<link rel="stylesheet" href="s.css">');
  });
  test('inputs are escaped, so a hostile value cannot break out of an attribute', () => {
    const bad = renderHtml('x', '"><script>1</script>', '"onload="x', "'><b>");
    expect(bad).not.toContain('<script>1</script>');
    expect(bad).not.toContain('"onload="');
    expect(bad.match(/<script/g)).toHaveLength(1);
  });
});

describe('showVerdictPanel', () => {
  test('creates a locked-down webview: scripts yes, command URIs no, resources only from dist/webview', () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('high'), handlers);
    const p = __panels[0]!;
    expect(p.viewType).toBe('stack3.verdict');
    expect(p.options.enableScripts).toBe(true);
    expect(p.options.enableCommandUris).toBe(false);
    expect((p.options.localResourceRoots as { path: string }[]).map((r) => r.path)).toEqual(['/ext/dist/webview']);
    expect(p.options.retainContextWhenHidden).toBe(false);
  });
  test('the page has a fresh nonce each time, matching its CSP and script tag', () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('high'), handlers);
    showVerdictPanel(ctx(), makeRec('high', { scanId: 'cd'.repeat(32) }), handlers);
    const nonces = __panels.map((p) => /script-src 'nonce-([^']+)'|script-src &#39;nonce-([^&]+)&#39;/.exec(p.html)!.slice(1).find(Boolean)!);
    expect(nonces[0]).not.toBe(nonces[1]);
    for (const [i, p] of __panels.entries()) expect(p.html).toContain(`<script nonce="${nonces[i]}"`);
    expect(Buffer.from(nonces[0]!, 'base64')).toHaveLength(16);
  });
  test('sends the verdict only after the webview says it is ready', async () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('critical'), handlers);
    const p = __panels[0]!;
    expect(p.posted).toEqual([]);
    p.receive({ type: 'ready' });
    await Promise.resolve();
    expect(p.posted).toHaveLength(1);
    expect(p.posted[0]).toMatchObject({ type: 'verdict', scanId: SCAN_ID, view: { level: 'critical' } });
  });
  test('the posted view is the redacted view model (a key in evidence never reaches the screen)', () => {
    const key = 'e5'.repeat(32);
    const rec = makeRec('high', {}, [{ ruleId: 'x', layer: 'repo-file', severity: 'high', title: 't', evidence: `PRIVATE_KEY=0x${key}`, source: 'rules', checkedAt: 'c' }]);
    expect(JSON.stringify(buildView(rec))).not.toContain(key);
  });
  test('junk messages do nothing; a valid action goes through the bridge to the handler', async () => {
    const { h, handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('caution'), handlers, { confirm: async () => true });
    // the registry must hold the verdict for open to be reachable (I-2)
    p0().receive({ type: 'exec', cmd: 'rm -rf /' });
    p0().receive('open');
    p0().receive({ type: 'action', scanId: SCAN_ID, action: 'delete' });
    await new Promise((r) => setTimeout(r, 5));
    expect(called(h)).toEqual(['delete']);
  });
  test('open is refused until the verdict is in the registry, then allowed', async () => {
    const { h, handlers } = makeHandlers();
    const c = ctx();
    const rec = makeRec('caution');
    showVerdictPanel(c, rec, handlers);
    p0().receive({ type: 'action', scanId: SCAN_ID, action: 'open' });
    await new Promise((r) => setTimeout(r, 5));
    expect(h.open).not.toHaveBeenCalled();
    await new Registry(c.globalState).add(rec);
    p0().receive({ type: 'action', scanId: SCAN_ID, action: 'open' });
    await new Promise((r) => setTimeout(r, 5));
    expect(h.open).toHaveBeenCalledOnce();
  });
  test('a registry record for the same scan but different content is not accepted', async () => {
    const { h, handlers } = makeHandlers();
    const c = ctx();
    const rec = makeRec('caution');
    showVerdictPanel(c, rec, handlers);
    await new Registry(c.globalState).add({ ...rec, scanSetHash: 'changed!!' });
    p0().receive({ type: 'action', scanId: SCAN_ID, action: 'open' });
    await new Promise((r) => setTimeout(r, 5));
    expect(h.open).not.toHaveBeenCalled();
  });
  test('showing the same scan twice reuses the panel and refreshes it', () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('high'), handlers);
    showVerdictPanel(ctx(), makeRec('high'), handlers);
    expect(__panels).toHaveLength(1);
    expect(__panels[0]!.revealed).toBe(1);
    expect(__panels[0]!.posted).toHaveLength(1);
  });
  test('a re-scan with a different verdict replaces the panel, so its buttons follow the new verdict', () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('caution'), handlers);
    showVerdictPanel(ctx(), makeRec('critical', { scanSetHash: 'changed!!' }), handlers);
    expect(__panels).toHaveLength(2);
    expect(__panels[0]!.disposed).toBe(true);
    __panels[1]!.receive({ type: 'ready' });
    expect(__panels[1]!.posted[0]).toMatchObject({ view: { level: 'critical' } });
  });
  test('closePanel closes the panel for a scan and ignores unknown ones', () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('high'), handlers);
    closePanel('cd'.repeat(32));
    expect(__panels[0]!.disposed).toBe(false);
    closePanel(SCAN_ID);
    expect(__panels[0]!.disposed).toBe(true);
  });
  test('after the panel is closed a new one can be opened', () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('high'), handlers);
    __panels[0]!.dispose();
    showVerdictPanel(ctx(), makeRec('high'), handlers);
    expect(__panels).toHaveLength(2);
  });
  test('the default confirmation is a modal warning with a detail and one button', async () => {
    const { h, handlers } = makeHandlers();
    const c = ctx();
    const rec = makeRec('high');
    await new Registry(c.globalState).add(rec);
    showVerdictPanel(c, rec, handlers);
    __docs.warningAnswer = 'Open anyway';
    p0().receive({ type: 'action', scanId: SCAN_ID, action: 'open' });
    await new Promise((r) => setTimeout(r, 5));
    const [title, options, button] = __docs.lastWarning as [string, { modal: boolean; detail: string }, string];
    expect(title).toContain('github.com/octo/hello');
    expect(options.modal).toBe(true);
    expect(options.detail).toContain('Task runs a hidden command');
    expect(button).toBe('Open anyway');
    expect(h.open).toHaveBeenCalledOnce();
    expect(__calls.errors).toEqual([]);
  });
  test('a dismissed modal (undefined) means no', async () => {
    const { h, handlers } = makeHandlers();
    const c = ctx();
    const rec = makeRec('high');
    await new Registry(c.globalState).add(rec);
    showVerdictPanel(c, rec, handlers);
    __docs.warningAnswer = undefined;
    p0().receive({ type: 'action', scanId: SCAN_ID, action: 'open' });
    await new Promise((r) => setTimeout(r, 5));
    expect(h.open).not.toHaveBeenCalled();
  });
});

describe('postExplanation', () => {
  const ready = { state: 'ready', explanation: 'It runs a script.', fix: 'Delete it.' } as const;
  test('sends the explanation to the open panel for that scan, as its own message type', () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('critical'), handlers);
    postExplanation(SCAN_ID, { state: 'pending' });
    postExplanation(SCAN_ID, ready);
    expect(__panels[0]!.posted).toEqual([
      { type: 'explanation', scanId: SCAN_ID, state: 'pending' },
      { type: 'explanation', scanId: SCAN_ID, ...ready },
    ]);
  });
  test('it is separate from the verdict message: the view model never carries it', () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('critical'), handlers);
    postExplanation(SCAN_ID, ready);
    __panels[0]!.receive({ type: 'ready' });
    const verdictMsg = __panels[0]!.posted.find((m) => (m as { type: string }).type === 'verdict') as { view: Record<string, unknown> };
    expect(verdictMsg.view).not.toHaveProperty('explanation');
    expect(JSON.stringify(verdictMsg)).not.toContain('It runs a script.');
  });
  test('a page that loads after the explanation arrived still gets it, right after the verdict', async () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('critical'), handlers);
    postExplanation(SCAN_ID, ready);
    __panels[0]!.posted.length = 0;
    __panels[0]!.receive({ type: 'ready' });
    await Promise.resolve();
    expect(__panels[0]!.posted.map((m) => (m as { type: string }).type)).toEqual(['verdict', 'explanation']);
  });
  test('the latest state wins on a reload', async () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('critical'), handlers);
    postExplanation(SCAN_ID, { state: 'pending' });
    postExplanation(SCAN_ID, { state: 'unavailable', reason: 'Ollama is not running.' });
    __panels[0]!.posted.length = 0;
    __panels[0]!.receive({ type: 'ready' });
    await Promise.resolve();
    expect(__panels[0]!.posted[1]).toMatchObject({ state: 'unavailable', reason: 'Ollama is not running.' });
  });
  test('an explanation for a scan with no open panel is ignored', () => {
    expect(() => postExplanation('cd'.repeat(32), ready)).not.toThrow();
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('critical'), handlers);
    postExplanation('cd'.repeat(32), ready);
    expect(__panels[0]!.posted).toEqual([]);
  });
  test('after the panel is closed it is ignored', () => {
    const { handlers } = makeHandlers();
    showVerdictPanel(ctx(), makeRec('critical'), handlers);
    __panels[0]!.dispose();
    expect(() => postExplanation(SCAN_ID, ready)).not.toThrow();
  });
});

function p0() {
  return __panels[0]!;
}
