import * as vscode from 'vscode';
import { clip } from '../engine/rules/evidence';
import type { Finding, Severity } from '../engine/types';
import { redact } from '../verdict/redact';
import { safeRelPath } from './paths';

export const MAX_MESSAGE = 200;
const MAX_PER_FILE = 50;
const MAX_TOTAL = 500;
const MAX_UNCHECKED = 5;
const RANK: Record<Severity, number> = { critical: 2, high: 1, caution: 0 };

/** Text from a repo shown in the editor: control, bidi and zero-width characters removed, at most 200 characters. */
export function sanitizeMessage(s: string): string {
  return clip(s, MAX_MESSAGE);
}

const severityOf = (s: Severity): vscode.DiagnosticSeverity =>
  s === 'caution' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;

function add(map: Map<string, vscode.Diagnostic[]>, uri: vscode.Uri, d: vscode.Diagnostic): boolean {
  const key = uri.toString();
  const list = map.get(key) ?? [];
  if (list.length >= MAX_PER_FILE) return false;
  list.push(d);
  map.set(key, list);
  return true;
}

/**
 * Findings → editor squiggles. critical and high are errors, caution is a warning. A finding's file is checked like any
 * other path from a repo: if it is not a plain relative path inside the folder (a remote finding could say "../../x"),
 * the finding is attached to the folder itself instead of to a file outside it. Everything goes through the egress
 * redactor first, so a secret in evidence never reaches the editor either.
 */
export function toDiagnostics(findings: Finding[], root: vscode.Uri): Map<string, vscode.Diagnostic[]> {
  const out = new Map<string, vscode.Diagnostic[]>();
  let total = 0;
  for (const f of [...findings].sort((a, b) => RANK[b.severity] - RANK[a.severity])) {
    if (total >= MAX_TOTAL) break;
    const s = redact(f);
    const rel = s.location ? safeRelPath(s.location.file) : null;
    const uri = rel ? vscode.Uri.joinPath(root, ...rel.split('/')) : root;
    const line = rel && s.location?.line && s.location.line > 0 ? s.location.line - 1 : 0;
    const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, 1000), sanitizeMessage(s.evidence ? `${s.title}: ${s.evidence}` : s.title), severityOf(s.severity));
    d.source = 'Stack3';
    d.code = clip(s.ruleId, 80);
    if (add(out, uri, d)) total++;
  }
  return out;
}

/** What could not be checked, as information (an incomplete scan is not a clean one). Attach to the folder. */
export function notCheckedDiagnostics(notChecked: string[]): vscode.Diagnostic[] {
  return notChecked.slice(0, MAX_UNCHECKED).map((n) => {
    const d = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1000), sanitizeMessage(`Not checked: ${n}`), vscode.DiagnosticSeverity.Information);
    d.source = 'Stack3';
    d.code = 'not-checked';
    return d;
  });
}
