import * as vscode from 'vscode';
import { createClient } from '../api/client';
import { withSocket } from '../api/socketClient';
import { getSocketKey } from '../config/socketKey';
import { getSettings } from '../config/settings';
import { excludesFor } from '../scan/exclude';
import { runScan } from '../scan/scheduler';
import { createStatusBar } from '../ui/statusbar';
import { notCheckedDiagnostics, toDiagnostics } from '../ui/diagnostics';
import type { Level, Verdict } from '../engine/types';
import { registerStagedSecretWarning } from './staged';
import { checkUnknownFolder, QUICK_LIMITS, wasWarnedRecently, type UnknownFolderDeps } from './unknownFolder';
import { registerWatchers, type RootInfo } from './watchers';

/** Starts Flow 3: manifest watchers, editor diagnostics, the status bar item and the staged-secret warning. */
export function registerGuard(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('stack3');
  const status = createStatusBar();
  const levels = new Map<string, Level>();
  const touched = new Map<string, Set<string>>();

  const refreshStatus = () => status.update([...levels.values()]);

  // Flow 2: a folder opened directly gets a quick look the moment it opens, before the first watcher scan.
  const unknownFolderDeps: UnknownFolderDeps = {
    scan: (root) => runScan(root, { mode: 'quick', checkedAt: new Date().toISOString() }, QUICK_LIMITS, {}, excludesFor(getSettings().scanExclude, root)),
    showModal: async (title, detail, buttons) => vscode.window.showWarningMessage(title, { modal: true, detail }, ...buttons),
    closeFolder: () => vscode.commands.executeCommand('workbench.action.closeFolder'),
    state: context.globalState,
    now: Date.now,
  };
  const checkFolders = (folders: readonly vscode.WorkspaceFolder[]) => {
    for (const f of folders) void checkUnknownFolder(f.uri, vscode.workspace.isTrusted, unknownFolderDeps);
  };
  checkFolders(vscode.workspace.workspaceFolders ?? []);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((e) => checkFolders(e.added)),
    collection,
    status,
    registerWatchers(context, {
      roots: () =>
        (vscode.workspace.workspaceFolders ?? [])
          .filter((f) => f.uri.scheme === 'file')
          .map((f): RootInfo => ({ path: f.uri.fsPath, name: f.name })),
      // Settings are read when a scan runs, and only their user-level values are used (I-10).
      scan: (root) => {
        const s = getSettings();
        return runScan(root, { mode: 'workspace', checkedAt: new Date().toISOString() }, s.limits, {}, excludesFor(s.scanExclude, root));
      },
      client: () => {
        const s = getSettings();
        const base = createClient({ baseUrl: s.apiUrl, allowLocalhost: s.allowLocalhost, clientVersion: String((context.extension.packageJSON as { version?: string }).version ?? '') });
        return withSocket(base, { apiKey: () => getSocketKey(context) });
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
      // A folder the unknown-folder check has just warned about is not announced a second time.
      notify: (m, root) => {
        if (!wasWarnedRecently(root.path)) void vscode.window.showWarningMessage(m);
      },
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
