import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { clip } from '../engine/rules/evidence';
import { Registry, type ScanRecord } from '../quarantine/registry';
import { createBridge, type ActionHandlers, type RenderedStats } from './bridge';
import { buildView } from './view';

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The panel's HTML. The CSP allows only our own script (by nonce) and our own stylesheet: no inline script, no inline
 * style, no eval, no network, no frames, no forms (I-11). All verdict text arrives later by message and is rendered as text.
 */
export function renderHtml(cspSource: string, nonce: string, scriptUri: string, styleUri: string): string {
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stack3</title>
<link rel="stylesheet" href="${escapeAttr(styleUri)}">
</head>
<body>
<main id="app"></main>
<script nonce="${escapeAttr(nonce)}" src="${escapeAttr(scriptUri)}"></script>
</body>
</html>`;
}

export interface PanelHooks {
  /** Folder holding main.js and styles.css. Defaults to <extension>/dist/webview. */
  webviewRoot?: vscode.Uri;
  onRendered?(stats: RenderedStats): void;
  confirm?(title: string, detail: string, okLabel: string): Promise<boolean>;
}

/** Host → webview: the AI explanation, shown as plain text beside the verdict. Never part of the verdict. */
export type ExplanationMessage = { state: 'pending' } | { state: 'ready'; explanation: string; fix: string } | { state: 'unavailable'; reason: string };

const panels = new Map<string, { panel: vscode.WebviewPanel; rec: ScanRecord; explanation?: ExplanationMessage }>();

const modalConfirm = async (title: string, detail: string, okLabel: string): Promise<boolean> =>
  (await vscode.window.showWarningMessage(title, { modal: true, detail }, okLabel)) === okLabel;

/** Show (or bring forward) the verdict panel for one scan. Its buttons only act through the validated bridge. */
export function showVerdictPanel(ctx: vscode.ExtensionContext, rec: ScanRecord, handlers: ActionHandlers, hooks: PanelHooks = {}): void {
  const view = buildView(rec);
  const existing = panels.get(rec.scanId);
  if (existing && existing.rec.scanSetHash === rec.scanSetHash && existing.rec.verdict.level === rec.verdict.level) {
    existing.panel.reveal();
    void existing.panel.webview.postMessage({ type: 'verdict', scanId: rec.scanId, view });
    return;
  }
  // A re-scan produced a different verdict. The old panel's bridge is bound to the old verdict, so replace it.
  existing?.panel.dispose();

  const root = hooks.webviewRoot ?? vscode.Uri.joinPath(ctx.extensionUri, 'dist', 'webview');
  const panel = vscode.window.createWebviewPanel('stack3.verdict', `Stack3: ${clip(rec.verdict.target.id, 60)}`, vscode.ViewColumn.Active, {
    enableScripts: true,
    enableCommandUris: false,
    localResourceRoots: [root],
    retainContextWhenHidden: false,
  });
  panels.set(rec.scanId, { panel, rec });

  const registry = new Registry(ctx.globalState);
  const bridge = createBridge({
    rec,
    handlers,
    ui: { confirm: hooks.confirm ?? modalConfirm },
    isRecorded: () => {
      const current = registry.get(rec.scanId);
      return current !== undefined && current.sha === rec.sha && current.scanSetHash === rec.scanSetHash;
    },
    onReady: () => {
      void panel.webview.postMessage({ type: 'verdict', scanId: rec.scanId, view });
      const last = panels.get(rec.scanId)?.explanation; // a reloaded page gets the explanation again
      if (last) void panel.webview.postMessage({ type: 'explanation', scanId: rec.scanId, ...last });
    },
    onRendered: hooks.onRendered,
  });

  const nonce = randomBytes(16).toString('base64');
  const web = panel.webview;
  web.html = renderHtml(web.cspSource, nonce, web.asWebviewUri(vscode.Uri.joinPath(root, 'main.js')).toString(), web.asWebviewUri(vscode.Uri.joinPath(root, 'styles.css')).toString());
  web.onDidReceiveMessage((raw: unknown) => void bridge.handle(raw));
  panel.onDidDispose(() => {
    if (panels.get(rec.scanId)?.panel === panel) panels.delete(rec.scanId);
  });
}

/** Show an explanation in the open panel for a scan (and remember it for a reload). Ignored if no such panel is open. */
export function postExplanation(scanId: string, msg: ExplanationMessage): void {
  const entry = panels.get(scanId);
  if (!entry) return;
  entry.explanation = msg;
  void entry.panel.webview.postMessage({ type: 'explanation', scanId, ...msg });
}

/** Close the panel for a scan (after its clone was deleted). */
export function closePanel(scanId: string): void {
  panels.get(scanId)?.panel.dispose();
}

/** Test seam: forget open panels. */
export function __resetPanels(): void {
  panels.clear();
}
