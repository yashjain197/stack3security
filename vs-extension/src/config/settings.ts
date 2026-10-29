import * as vscode from 'vscode';

export interface ScanLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  timeoutMs: number;
}

export interface Stack3Settings {
  apiUrl: string;
  allowLocalhost: boolean;
  explainMode: 'publicOnly' | 'always' | 'never';
  reportMode: 'publicAuto' | 'ask' | 'never';
  limits: ScanLimits;
}

export const DEFAULT_LIMITS: Readonly<ScanLimits> = Object.freeze({
  maxFiles: 20000,
  maxFileBytes: 1048576,
  maxTotalBytes: 52428800,
  maxDepth: 32,
  timeoutMs: 30000,
});

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

export function getSettings(): Stack3Settings {
  const cfg = vscode.workspace.getConfiguration('stack3');
  const apiUrl = userValue<unknown>(cfg, 'apiUrl', '');
  return {
    apiUrl: typeof apiUrl === 'string' ? apiUrl : '',
    allowLocalhost: userValue<unknown>(cfg, 'dev.allowLocalhost', false) === true,
    explainMode: oneOf(userValue<unknown>(cfg, 'explain.sendSnippets', 'publicOnly'), ['publicOnly', 'always', 'never'], 'publicOnly'),
    reportMode: oneOf(userValue<unknown>(cfg, 'report.mode', 'publicAuto'), ['publicAuto', 'ask', 'never'], 'publicAuto'),
    limits: sanitizeLimits(userValue<unknown>(cfg, 'scan.limits', DEFAULT_LIMITS)),
  };
}
