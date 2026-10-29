import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { ScanLimits } from '../config/limits';
import { clip } from '../engine/rules/evidence';
import type { EngineResult, Finding, Severity } from '../engine/types';
import { quarantineRoot } from '../quarantine/paths';
import type { KeyValueStore } from '../quarantine/registry';
import { isInside } from '../scan/paths';
import { redact } from '../verdict/redact';

export const WARNED_KEY = 'stack3.warnedFolders';
const TITLE = "Don't trust this folder";
const CLOSE = 'Close this folder';
const MAX_WARNED = 200;
const SHOWN = 3;
const RECENT_MS = 120_000;
const RANK: Record<Severity, number> = { critical: 2, high: 1, caution: 0 };

/** A few seconds and a few thousand small files at most: this runs the moment a folder opens. */
export const QUICK_LIMITS: ScanLimits = { maxFiles: 5000, maxFileBytes: 256 * 1024, maxTotalBytes: 20 * 1024 * 1024, maxDepth: 10, timeoutMs: 5000 };

export interface UnknownFolderDeps {
  /** The quick scan of a folder on disk. */
  scan(root: string): Promise<EngineResult>;
  showModal(title: string, detail: string, buttons: string[]): Promise<string | undefined>;
  closeFolder(): PromiseLike<unknown>;
  state: KeyValueStore;
  now(): number;
}

const inFlight = new Set<string>();
const recent = new Map<string, number>();

/** True if a folder was warned about a moment ago, so the file watcher does not announce the same thing again. */
export function wasWarnedRecently(folderPath: string): boolean {
  const at = recent.get(folderPath);
  return at !== undefined && Date.now() - at < RECENT_MS;
}

const keyOf = (realPath: string): string => createHash('sha256').update(realPath).digest('hex').slice(0, 16);

function describe(f: Finding): string {
  const s = redact(f);
  const where = s.location ? ` (${s.location.file}${s.location.line ? `:${s.location.line}` : ''})` : '';
  return `${clip(s.title, 140)}${where}`;
}

function detailFor(serious: Finding[], isTrusted: boolean): string {
  const top = [...serious].sort((a, b) => RANK[b.severity] - RANK[a.severity]).slice(0, SHOWN);
  const lines = ['Stack3 found problems in this folder:', '', ...top.map((f, i) => `${i + 1}. ${describe(f)}`)];
  if (serious.length > top.length) lines.push(`and ${serious.length - top.length} more.`);
  lines.push(
    '',
    isTrusted
      ? 'Auto-run tasks may already have run. Check .vscode/tasks.json and your terminal history before you do anything else.'
      : 'This window is in Restricted Mode. Stay in it, and do not choose "Trust" until you have looked at these files.',
    '',
    'This check is best effort and can come too late. Stack3 ran nothing from this folder; it only read files.',
  );
  return lines.join('\n');
}

/**
 * Flow 2, best effort: a folder was opened directly (not through "Clone and scan safely"). Scan it quickly as data, and if
 * it looks dangerous say so before the person trusts it. It never claims to prevent anything: a trusted folder's tasks may
 * have run before this extension started, and the message says so. Once per folder; any failure is silent.
 */
export async function checkUnknownFolder(folder: vscode.Uri, isTrusted: boolean, deps: UnknownFolderDeps): Promise<void> {
  try {
    if (folder.scheme !== 'file') return;
    const real = await fs.realpath(folder.fsPath).catch(() => undefined);
    if (real === undefined) return;

    // A clone made by Stack3 already had its verdict shown, and was opened on purpose.
    const root = path.resolve(quarantineRoot());
    const realRoot = await fs.realpath(root).catch(() => root);
    if (isInside(root, real) || isInside(realRoot, real)) return;

    const key = keyOf(real);
    if (inFlight.has(key) || key in deps.state.get<Record<string, number>>(WARNED_KEY, {})) return;
    inFlight.add(key);
    try {
      const serious = (await deps.scan(real)).findings.filter((f) => f.severity === 'high' || f.severity === 'critical');
      if (serious.length === 0) return;

      recent.set(real, Date.now());
      recent.set(folder.fsPath, Date.now());
      const answer = await deps.showModal(TITLE, detailFor(serious, isTrusted), [CLOSE]);

      const warned = { ...deps.state.get<Record<string, number>>(WARNED_KEY, {}), [key]: deps.now() };
      const keep = Object.entries(warned).sort((a, b) => b[1] - a[1]).slice(0, MAX_WARNED);
      await deps.state.update(WARNED_KEY, Object.fromEntries(keep));
      if (answer === CLOSE) await deps.closeFolder();
    } finally {
      inFlight.delete(key);
    }
  } catch {
    // best effort: never let this break startup
  }
}
