// Test-only extension, built by run.mjs. It opens the REAL verdict panel (src/ui/panel.ts) with hostile text in every
// field a repository can influence, and resolves with what the webview reports is on screen.
import { appendFileSync, cpSync, mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createActionHandlers } from '../../../src/commands/actions';
import { aggregate } from '../../../src/engine/verdict';
import { neutralize } from '../../../src/quarantine/neutralize';
import { createQuarantineDir } from '../../../src/quarantine/paths';
import { Registry } from '../../../src/quarantine/registry';
import { removeQuarantined, resolveQuarantineDir } from '../../../src/quarantine/remove';
import { hashScanSet } from '../../../src/scan/hash';
import { postExplanation, showVerdictPanel } from '../../../src/ui/panel';
import type { RenderedStats } from '../../../src/ui/bridge';
import type { ScanRecord } from '../../../src/quarantine/registry';

export const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<img src=x onerror="window.__stack3_xss=1">',
  '<script>window.__stack3_xss=1</script>',
  '<svg onload="window.__stack3_xss=1">',
  '<a href="javascript:window.__stack3_xss=1">click me</a>',
  '"><iframe src="https://evil.example/"></iframe>',
  '<iframe srcdoc="<script>parent.__stack3_xss=1</script>"></iframe>',
  '<style>@import url(https://evil.example/x.css)</style>',
  '<img src="https://evil.example/pixel.png">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
];

function hostileRecord(): ScanRecord {
  const p = (i: number) => PAYLOADS[i % PAYLOADS.length]!;
  return {
    scanId: 'ab'.repeat(32),
    dir: '/tmp/stack3-quarantine/octo__hostile__abcd1234',
    url: 'https://github.com/octo/hostile',
    sha: 'c'.repeat(40),
    scanSetHash: 'h',
    createdAt: Date.now(),
    verdict: {
      level: 'critical',
      target: { type: 'repo', id: `github.com/octo/hostile@${p(0)}` },
      indicators: { addresses: [], domains: [] },
      actions: [p(1)],
      notChecked: PAYLOADS.map((x) => `Not checked: ${x}`),
      explanation: PAYLOADS.join('\n'),
      findings: PAYLOADS.map((x, i) => ({
        ruleId: `x.${i}`,
        layer: 'repo-file' as const,
        severity: (['critical', 'high', 'caution'] as const)[i % 3]!,
        title: x,
        evidence: x,
        location: { file: `.vscode/${x}.json`, line: i + 1 },
        source: 'rules' as const,
        checkedAt: x,
      })),
    },
  };
}

export function activate(ctx: vscode.ExtensionContext): void {
  // Open the canary fixture in a NEW window, either raw (the control) or through the real Stack3 "open with auto-run
  // disabled" handler. Each copy has a task that creates "<its folder>.ran" if VS Code runs it on open.
  ctx.subscriptions.push(
    vscode.commands.registerCommand('stack3test.openCanary', async (fixture: string, mode: 'raw' | 'neutralized', tasksSetting: 'on' | 'off' = 'on') => {
      // A window opened from a test host (by vscode.openFolder, or via the same instance's CLI) inherits the test runner and
      // would run this suite again. So the folder is handed to the runner, which opens it in a SEPARATE VS Code instance
      // with its own profile whose user setting task.allowAutomaticTasks is `tasksSetting`. Everything before this
      // call is the real code.
      const openFolder = async (dir: string): Promise<void> => {
        const requests = process.env.STACK3_OPEN_REQUESTS;
        if (!requests) throw new Error('STACK3_OPEN_REQUESTS is not set');
        appendFileSync(requests, `${tasksSetting}\t${dir}\n`);
      };
      if (mode === 'raw') {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'raw-'));
        cpSync(fixture, dir, { recursive: true });
        await openFolder(dir);
        return { dir, marker: `${dir}.ran` };
      }
      const dir = await createQuarantineDir('octo', 'canary');
      cpSync(fixture, dir, { recursive: true });
      const registry = new Registry(ctx.globalState);
      const rec: ScanRecord = {
        scanId: 'ab'.repeat(32),
        dir,
        url: 'https://github.com/octo/canary',
        sha: 'c'.repeat(40),
        scanSetHash: await hashScanSet(dir),
        verdict: aggregate([], [], { type: 'repo', id: 'github.com/octo/canary@ccccccc' }, { addresses: [], domains: [] }),
        createdAt: Date.now(),
      };
      await registry.add(rec);
      const handlers = createActionHandlers({
        registry,
        hash: hashScanSet,
        rescan: async () => undefined,
        checkDir: async (d) => (await resolveQuarantineDir(d)) ?? Promise.reject(new Error('missing')),
        neutralize,
        openFolder,
        removeDir: removeQuarantined,
        closePanel: () => undefined,
        offerAutoTaskGuard: async () => undefined, // no dialog in an unattended run
        viewFile: async () => undefined,
        copyReport: async () => undefined,
        info: () => undefined,
        error: (m) => console.error(m),
      });
      await handlers.openNeutralized(rec);
      return { dir, marker: `${dir}.ran` };
    }),
  );
  ctx.subscriptions.push(
    vscode.commands.registerCommand('stack3test.showHostile', (webviewRoot: string) =>
      new Promise<RenderedStats | { timeout: true }>((resolve) => {
        const noop = async () => undefined;
        const rec = hostileRecord();
        let renders = 0;
        showVerdictPanel(ctx, rec, { open: noop, openNeutralized: noop, delete: noop, viewFile: noop, copyReport: noop }, {
          webviewRoot: vscode.Uri.file(webviewRoot),
          // First render: the verdict. Then a hostile AI explanation (a model repeating attacker text) is sent, and the
          // second render, which includes it, is what is reported.
          onRendered: (stats) => {
            if (++renders === 1) postExplanation(rec.scanId, { state: 'ready', explanation: PAYLOADS.join('\n'), fix: PAYLOADS[1]! });
            else resolve(stats);
          },
        });
        setTimeout(() => resolve({ timeout: true }), 25_000);
      }),
    ),
  );
}

export function deactivate(): void {}
