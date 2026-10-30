import * as vscode from 'vscode';
import * as path from 'node:path';
import { MAX_FOLDERS, MAX_PATTERNS_PER_FOLDER, normalizeExclude } from '../scan/exclude';
import { DEFAULT_LIMITS, type ScanLimits } from './limits';

export { DEFAULT_LIMITS };
export type { ScanLimits };

export interface Stack3Settings {
  apiUrl: string;
  allowLocalhost: boolean;
  explainMode: 'publicOnly' | 'always' | 'never';
  reportMode: 'publicAuto' | 'ask' | 'never';
  /** Where the plain-English explanation comes from. `claude` asks Claude Haiku with the user's own key; `api` is the Stack3 server. */
  explainProvider: 'claude' | 'api';
  limits: ScanLimits;
  /** Folder (absolute path) → paths to leave out of the guard scan of that folder. User level only. */
  scanExclude: Record<string, string[]>;
}

// Read only the user (global) value. A workspace or folder value comes from the
// repo's own .vscode/settings.json, which is attacker-controlled (I-10).
function userValue<T>(cfg: vscode.WorkspaceConfiguration, key: string, fallback: T): T {
  const i = cfg.inspect<T>(key);
  return i?.globalValue ?? i?.defaultValue ?? fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function sanitizeLimits(value: unknown): ScanLimits {
  const out: ScanLimits = { ...DEFAULT_LIMITS };
  if (value && typeof value === 'object') {
    for (const key of Object.keys(DEFAULT_LIMITS) as (keyof ScanLimits)[]) {
      const v = (value as Record<string, unknown>)[key];
      if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[key] = v;
    }
  }
  return out;
}

function sanitizeExclude(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [folder, patterns] of Object.entries(value as Record<string, unknown>).slice(0, MAX_FOLDERS)) {
    if (!path.isAbsolute(folder) || folder.length > 1000 || !Array.isArray(patterns)) continue;
    const clean = [...new Set(patterns.slice(0, MAX_PATTERNS_PER_FOLDER).map(normalizeExclude).filter((p): p is string => p !== undefined))];
    if (clean.length > 0) out[folder] = clean;
  }
  return out;
}

export function getSettings(): Stack3Settings {
  const cfg = vscode.workspace.getConfiguration('stack3');
  const apiUrl = userValue<unknown>(cfg, 'apiUrl', '');
  return {
    apiUrl: typeof apiUrl === 'string' ? apiUrl : '',
    allowLocalhost: userValue<unknown>(cfg, 'dev.allowLocalhost', false) === true,
    explainMode: oneOf(userValue<unknown>(cfg, 'explain.sendSnippets', 'publicOnly'), ['publicOnly', 'always', 'never'], 'publicOnly'),
    reportMode: oneOf(userValue<unknown>(cfg, 'report.mode', 'publicAuto'), ['publicAuto', 'ask', 'never'], 'publicAuto'),
    explainProvider: oneOf(userValue<unknown>(cfg, 'explain.provider', 'claude'), ['claude', 'api'], 'claude'),
    limits: sanitizeLimits(userValue<unknown>(cfg, 'scan.limits', DEFAULT_LIMITS)),
    scanExclude: sanitizeExclude(userValue<unknown>(cfg, 'scan.exclude', {})),
  };
}
