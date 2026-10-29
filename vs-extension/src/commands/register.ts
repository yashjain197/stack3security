import * as vscode from 'vscode';
import { createClient } from '../api/client';
import { getSettings } from '../config/settings';
import { cloneRepo } from '../quarantine/git';
import { createQuarantineDir, validateRepoUrl } from '../quarantine/paths';
import { Registry, type ScanRecord } from '../quarantine/registry';
import { removeQuarantined, sweepQuarantine } from '../quarantine/remove';
import { runScan } from '../scan/scheduler';
import { NOTICE } from '../ui/copy';
import { showVerdictPanel } from '../ui/panel';
import { parseQuarantinePath, quarantineUriPath, readQuarantined, SCHEME } from '../ui/quarantineFs';
import { buildReport } from '../ui/view';
import { neutralize } from '../quarantine/neutralize';
import { resolveQuarantineDir } from '../quarantine/remove';
import { hashScanSet } from '../scan/hash';
import { maybeOfferAutoTaskGuard } from '../guard/autoTasks';
import { closePanel } from '../ui/panel';
import { cloneAndScan, rescanRecord, type CloneAndScanDeps } from './cloneAndScan';
import { createActionHandlers } from './actions';

export const CLONE_AND_SCAN = 'stack3.cloneAndScan';

/** What the command returns to whoever ran it (`executeCommand`): an outcome only, never paths or findings. */
export interface CommandOutcome {
  ok: boolean;
  reason?: string;
  level?: string;
  scanId?: string;
}
const KEEP_DAYS = 7;

export function registerCommands(context: vscode.ExtensionContext): void {
  // Housekeeping at startup: clones older than a week are deleted (S8).
  void sweepQuarantine(KEEP_DAYS, Date.now(), new Registry(context.globalState).openedDirs()).catch(() => undefined);
  void new Registry(context.globalState).pruneOlderThan(KEEP_DAYS).catch(() => undefined);

  // Read-only viewer for files of a quarantined clone: contained, <= 1 MiB, plain text, never a workspace.
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      provideTextDocumentContent: async (uri) => {
        const parsed = parseQuarantinePath(uri.path);
        const rec = parsed ? new Registry(context.globalState).get(parsed.scanId) : undefined;
        return parsed && rec ? readQuarantined(rec, parsed.rel) : NOTICE.fileUnavailable;
      },
    }),
  );

  // Settings are read when an action runs, and only their user-level values are used (I-10).
  const scanDeps = (report?: (m: string) => void) => {
    const settings = getSettings();
    return {
      settings,
      client: createClient({
        baseUrl: settings.apiUrl,
        allowLocalhost: settings.allowLocalhost,
        clientVersion: String((context.extension.packageJSON as { version?: string }).version ?? ''),
      }),
      scan: (dir: string) => runScan(dir, { mode: 'clone', checkedAt: new Date().toISOString() }, settings.limits),
      report,
    };
  };

  const handlers = createActionHandlers({
    registry: new Registry(context.globalState),
    hash: hashScanSet,
    rescan: (rec) => {
      const d = scanDeps();
      return rescanRecord(rec, {
        scan: d.scan,
        client: d.client,
        registry: new Registry(context.globalState),
        showPanel: (r) => showVerdictPanel(context, r, handlers),
        showError: (m) => void vscode.window.showErrorMessage(`Stack3: ${m}`),
      });
    },
    checkDir: async (dir) => {
      const real = await resolveQuarantineDir(dir);
      if (real === undefined) throw new Error('missing');
      return real;
    },
    neutralize,
    openFolder: (dir) => vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), { forceNewWindow: true }),
    removeDir: removeQuarantined,
    closePanel,
    offerAutoTaskGuard: () => maybeOfferAutoTaskGuard(context),
    viewFile: async (rec, file) => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: SCHEME, path: quarantineUriPath(rec.scanId, file) }));
      await vscode.languages.setTextDocumentLanguage(doc, 'plaintext');
      await vscode.window.showTextDocument(doc, { preview: true });
    },
    copyReport: async (rec) => {
      await vscode.env.clipboard.writeText(buildReport(rec));
      void vscode.window.showInformationMessage(NOTICE.reportCopied);
    },
    info: (m) => void vscode.window.showInformationMessage(`Stack3: ${m}`),
    error: (m) => void vscode.window.showErrorMessage(`Stack3: ${m}`),
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(CLONE_AND_SCAN, async (arg?: unknown): Promise<CommandOutcome> => {
      const url =
        typeof arg === 'string'
          ? arg
          : await vscode.window.showInputBox({
              title: 'Stack3: Clone and scan safely',
              prompt: 'Public GitHub repository to clone into quarantine and scan. Nothing in it is run or opened.',
              placeHolder: 'https://github.com/owner/repo',
              ignoreFocusOut: true,
              validateInput: (v) => {
                const r = validateRepoUrl(v);
                return 'error' in r ? r.error : undefined;
              },
            });
      if (url === undefined) return { ok: false, reason: 'Cancelled' };

      const checked = validateRepoUrl(url);
      if ('error' in checked) {
        void vscode.window.showErrorMessage(`Stack3: ${checked.error}`);
        return { ok: false, reason: checked.error };
      }

      const registry = new Registry(context.globalState);

      return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Stack3', cancellable: false }, async (progress) => {
        const d = scanDeps((m) => progress.report({ message: m }));
        const deps: CloneAndScanDeps = {
          makeDir: createQuarantineDir,
          clone: (u, dest) => cloneRepo(u, dest),
          scan: d.scan,
          client: d.client,
          registry,
          removeDir: removeQuarantined,
          showPanel: (rec) => showVerdictPanel(context, rec, handlers),
          showError: (m) => void vscode.window.showErrorMessage(`Stack3: ${m}`),
          report: d.report,
        };
        const r = await cloneAndScan(checked.url, deps);
        return r.ok ? { ok: true, level: r.value.verdict.level, scanId: r.value.scanId } : { ok: false, reason: r.reason };
      });
    }),
  );
}
