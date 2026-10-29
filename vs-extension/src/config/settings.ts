import * as vscode from 'vscode';
import { DEFAULT_LIMITS, type ScanLimits } from './limits';

export { DEFAULT_LIMITS };
export type { ScanLimits };

export interface Stack3Settings {
  apiUrl: string;
  allowLocalhost: boolean;
  explainMode: 'publicOnly' | 'always' | 'never';
  reportMode: 'publicAuto' | 'ask' | 'never';
  /** Where the plain-English explanation comes from. `ollama` runs on this computer; `api` is the Stack3 server. */
  explainProvider: 'ollama' | 'api';
  ollamaModel: string;
  limits: ScanLimits;
}

export const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:7b';
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

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
    explainProvider: oneOf(userValue<unknown>(cfg, 'explain.provider', 'ollama'), ['ollama', 'api'], 'ollama'),
    ollamaModel: ((m) => (typeof m === 'string' && MODEL_NAME.test(m) ? m : DEFAULT_OLLAMA_MODEL))(userValue<unknown>(cfg, 'explain.ollamaModel', DEFAULT_OLLAMA_MODEL)),
    limits: sanitizeLimits(userValue<unknown>(cfg, 'scan.limits', DEFAULT_LIMITS)),
  };
}
