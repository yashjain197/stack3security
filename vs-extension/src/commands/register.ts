import * as vscode from 'vscode';
import { createClient } from '../api/client';
import { getSettings } from '../config/settings';
import { clip } from '../engine/rules/evidence';
import { cloneRepo } from '../quarantine/git';
import { createQuarantineDir, validateRepoUrl } from '../quarantine/paths';
import { Registry, type ScanRecord } from '../quarantine/registry';
import { removeQuarantined, sweepQuarantine } from '../quarantine/remove';
import { runScan } from '../scan/scheduler';
import { cloneAndScan, type CloneAndScanDeps } from './cloneAndScan';

export const CLONE_AND_SCAN = 'stack3.cloneAndScan';
const KEEP_DAYS = 7;

/**
 * Stand-in result display until the verdict panel (Task 13). Everything shown comes from the repo, so it is
 * cleaned and bounded. Wording never claims a folder is safe, and nothing is styled as an all-clear.
 */
export function summarize(rec: ScanRecord): { kind: 'error' | 'warning' | 'info'; text: string } {
  const v = rec.verdict;
  const repo = clip(v.target.id, 120);
  const top = v.findings.find((f) => f.severity === v.level) ?? v.findings[0];
  const detail = top ? ` Top finding: ${clip(top.title, 140)}${top.location ? ` (${clip(top.location.file, 100)}${top.location.line ? `:${top.location.line}` : ''})` : ''}.` : '';
  const count = `${v.findings.length} finding${v.findings.length === 1 ? '' : 's'}`;
  switch (v.level) {
    case 'critical':
      return { kind: 'error', text: `Stack3: Do not open ${repo} in VS Code. ${count}.${detail}` };
    case 'high':
      return { kind: 'warning', text: `Stack3: High risk in ${repo}. Open only with auto-run disabled. ${count}.${detail}` };
    case 'caution':
      return { kind: 'warning', text: `Stack3: Review ${repo} before running anything. ${count}.${detail}` };
    case 'unknown':
      return { kind: 'warning', text: `Stack3: ${repo} could not be checked fully (${clip(v.notChecked.join('; '), 160)}).${detail}` };
    default:
      return { kind: 'info', text: `Stack3: No known issues found in ${repo}. This is not a guarantee.` };
  }
}

function showSummary(rec: ScanRecord): void {
  const s = summarize(rec);
  const show = s.kind === 'error' ? vscode.window.showErrorMessage : s.kind === 'warning' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
  void show(s.text);
}

export function registerCommands(context: vscode.ExtensionContext): void {
  // Housekeeping at startup: clones older than a week are deleted (S8).
  void sweepQuarantine(KEEP_DAYS).catch(() => undefined);
  void new Registry(context.globalState).pruneOlderThan(KEEP_DAYS).catch(() => undefined);

  context.subscriptions.push(
    vscode.commands.registerCommand(CLONE_AND_SCAN, async (arg?: unknown) => {
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
      if (url === undefined) return; // cancelled

      const checked = validateRepoUrl(url);
      if ('error' in checked) {
        void vscode.window.showErrorMessage(`Stack3: ${checked.error}`);
        return;
      }

      // Settings are read when the command runs, and only their user-level values are used (I-10).
      const settings = getSettings();
      const client = createClient({
        baseUrl: settings.apiUrl,
        allowLocalhost: settings.allowLocalhost,
        clientVersion: String((context.extension.packageJSON as { version?: string }).version ?? ''),
      });
      const registry = new Registry(context.globalState);

      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Stack3', cancellable: false }, async (progress) => {
        const deps: CloneAndScanDeps = {
          makeDir: createQuarantineDir,
          clone: (u, dest) => cloneRepo(u, dest),
          scan: (dir) => runScan(dir, { mode: 'clone', checkedAt: new Date().toISOString() }, settings.limits),
          client,
          registry,
          removeDir: removeQuarantined,
          showPanel: showSummary,
          showError: (m) => void vscode.window.showErrorMessage(`Stack3: ${m}`),
          report: (m) => progress.report({ message: m }),
        };
        await cloneAndScan(checked.url, deps);
      });
    }),
  );
}
