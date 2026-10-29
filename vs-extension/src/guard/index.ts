import * as vscode from 'vscode';
import { createClient } from '../api/client';
import { getSettings } from '../config/settings';
import { runScan } from '../scan/scheduler';
import { createStatusBar } from '../ui/statusbar';
import { notCheckedDiagnostics, toDiagnostics } from '../ui/diagnostics';
import type { Level, Verdict } from '../engine/types';
import { registerStagedSecretWarning } from './staged';
import { registerWatchers, type RootInfo } from './watchers';

/** Starts Flow 3: manifest watchers, editor diagnostics, the status bar item and the staged-secret warning. */
export function registerGuard(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('stack3');
  const status = createStatusBar();
  const levels = new Map<string, Level>();
  const touched = new Map<string, Set<string>>();

  const refreshStatus = () => status.update([...levels.values()]);

  context.subscriptions.push(
    collection,
    status,
    registerWatchers(context, {
      roots: () =>
        (vscode.workspace.workspaceFolders ?? [])
          .filter((f) => f.uri.scheme === 'file')
          .map((f): RootInfo => ({ path: f.uri.fsPath, name: f.name })),
      // Settings are read when a scan runs, and only their user-level values are used (I-10).
      scan: (root) => runScan(root, { mode: 'workspace', checkedAt: new Date().toISOString() }, getSettings().limits),
      client: () => {
        const s = getSettings();
        return createClient({ baseUrl: s.apiUrl, allowLocalhost: s.allowLocalhost, clientVersion: String((context.extension.packageJSON as { version?: string }).version ?? '') });
      },
      publish: (root: RootInfo, verdict: Verdict) => {
        const rootUri = vscode.Uri.file(root.path);
        const map = toDiagnostics(verdict.findings, rootUri);
        const info = notCheckedDiagnostics(verdict.notChecked);
        if (info.length) map.set(rootUri.toString(), [...(map.get(rootUri.toString()) ?? []), ...info]);
        // clear what the previous scan reported for this folder, then set the new result
        for (const key of touched.get(root.path) ?? []) collection.delete(vscode.Uri.parse(key));
        for (const [key, diags] of map) collection.set(vscode.Uri.parse(key), diags);
        touched.set(root.path, new Set(map.keys()));
        levels.set(root.path, verdict.level);
        refreshStatus();
      },
      clear: (root: RootInfo) => {
        for (const key of touched.get(root.path) ?? []) collection.delete(vscode.Uri.parse(key));
        touched.delete(root.path);
        levels.delete(root.path);
        refreshStatus();
      },
      notify: (m) => void vscode.window.showWarningMessage(m),
      watch: (root, glob, onEvent) => {
        const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root.path), glob));
        const subs = [w.onDidCreate((u) => onEvent(u.fsPath)), w.onDidChange((u) => onEvent(u.fsPath)), w.onDidDelete((u) => onEvent(u.fsPath))];
        return { dispose: () => [...subs, w].forEach((d) => d.dispose()) };
      },
      onRootsChanged: (cb) => vscode.workspace.onDidChangeWorkspaceFolders(cb),
      isTrusted: () => vscode.workspace.isTrusted,
      onTrusted: (cb) => vscode.workspace.onDidGrantWorkspaceTrust(cb),
    }),
    registerStagedSecretWarning(context),
  );
}
