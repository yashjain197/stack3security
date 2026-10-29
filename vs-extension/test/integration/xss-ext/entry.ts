// Test-only extension, built by run.mjs. It opens the REAL verdict panel (src/ui/panel.ts) with hostile text in every
// field a repository can influence, and resolves with what the webview reports is on screen.
import * as vscode from 'vscode';
import { showVerdictPanel } from '../../../src/ui/panel';
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
  ctx.subscriptions.push(
    vscode.commands.registerCommand('stack3test.showHostile', (webviewRoot: string) =>
      new Promise<RenderedStats | { timeout: true }>((resolve) => {
        const noop = async () => undefined;
        showVerdictPanel(ctx, hostileRecord(), { open: noop, openNeutralized: noop, delete: noop, viewFile: noop, copyReport: noop }, { webviewRoot: vscode.Uri.file(webviewRoot), onRendered: resolve });
        setTimeout(() => resolve({ timeout: true }), 25_000);
      }),
    ),
  );
}

export function deactivate(): void {}
