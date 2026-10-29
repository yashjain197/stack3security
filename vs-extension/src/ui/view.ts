import { clip } from '../engine/rules/evidence';
import type { Level, Severity } from '../engine/types';
import type { ScanRecord } from '../quarantine/registry';
import { redact } from '../verdict/redact';
import { BUTTON_LABEL, HEADLINE, LEVEL_LABEL, OPEN_ANYWAY, type ActionName } from './copy';
import { safeRelPath } from './paths';

export const MAX_FINDINGS_SHOWN = 200;

/** D-3: which buttons a level offers, primary first. critical never offers a plain Open. */
export function buttonsFor(level: Level): ActionName[] {
  if (level === 'critical') return ['delete', 'openNeutralized'];
  if (level === 'high') return ['openNeutralized', 'open', 'delete'];
  return ['open', 'openNeutralized', 'delete'];
}

/** Opening that needs a host-side modal confirmation (I-12). */
export function requiresConfirm(level: Level, action: ActionName): boolean {
  return (action === 'open' && (level === 'high' || level === 'critical')) || (action === 'openNeutralized' && level === 'critical');
}

export interface ViewFinding {
  ruleId: string;
  severity: Severity;
  title: string;
  evidence: string;
  file?: string;
  line?: number;
  canView: boolean;
}

export interface ViewButton {
  action: ActionName;
  label: string;
  primary: boolean;
}

/** Everything the webview shows. Plain data, already cleaned and redacted by the host; the webview only renders text. */
export interface ViewModel {
  scanId: string;
  level: Level;
  label: string;
  headline: string;
  target: string;
  findings: ViewFinding[];
  hiddenFindings: number;
  notChecked: string[];
  guidance: string[];
  buttons: ViewButton[];
  explanation?: string;
}

const RANK: Record<Severity, number> = { critical: 2, high: 1, caution: 0 };

export function topFinding(rec: ScanRecord): ScanRecord['verdict']['findings'][number] | undefined {
  const f = rec.verdict.findings;
  return f.find((x) => x.severity === rec.verdict.level) ?? f[0];
}

export function buildView(rec: ScanRecord): ViewModel {
  const v = rec.verdict;
  const ordered = [...v.findings].sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  const shown = ordered.slice(0, MAX_FINDINGS_SHOWN).map((f) => {
    const clean = redact(f); // secrets never reach the screen either
    return {
      ruleId: clean.ruleId,
      severity: clean.severity,
      title: clean.title,
      evidence: clean.evidence,
      ...(clean.location ? { file: clean.location.file, ...(clean.location.line ? { line: clean.location.line } : {}) } : {}),
      canView: Boolean(f.location && safeRelPath(f.location.file)),
    } satisfies ViewFinding;
  });
  const risky = v.level === 'high' || v.level === 'critical';
  const buttons = buttonsFor(v.level).map((action, i) => ({
    action,
    label: action === 'open' && risky ? OPEN_ANYWAY : BUTTON_LABEL[action],
    primary: i === 0,
  }));
  return {
    scanId: rec.scanId,
    level: v.level,
    label: LEVEL_LABEL[v.level],
    headline: HEADLINE[v.level],
    target: clip(v.target.id, 200),
    findings: shown,
    hiddenFindings: Math.max(0, ordered.length - shown.length),
    notChecked: v.notChecked.slice(0, 50).map((n) => clip(n, 300)),
    guidance: v.actions.slice(0, 10).map((a) => clip(a, 200)),
    buttons: [...buttons, { action: 'copyReport', label: BUTTON_LABEL.copyReport, primary: false }],
    ...(v.explanation ? { explanation: clip(v.explanation, 4000) } : {}),
  };
}

/** Plain-text report for the clipboard. Findings go through the same redaction as everything else. */
export function buildReport(rec: ScanRecord): string {
  const v = rec.verdict;
  const lines = [`Stack3 report`, `Target: ${clip(v.target.id, 200)}`, `Result: ${LEVEL_LABEL[v.level]}. ${HEADLINE[v.level]}`, ''];
  for (const f of v.findings.map(redact)) {
    const where = f.location ? ` (${f.location.file}${f.location.line ? `:${f.location.line}` : ''})` : '';
    lines.push(`[${f.severity}] ${f.title}${where}`, `    ${f.evidence}`);
  }
  if (v.notChecked.length) lines.push('', 'Not checked:', ...v.notChecked.map((n) => `  - ${clip(n, 300)}`));
  lines.push('', 'Produced by Stack3 detection rules. Not a guarantee.');
  return lines.join('\n');
}
