import { parse as parseYaml } from 'yaml';
import type { Finding, Rule, VirtualFile } from '../types';
import { finding } from './evidence';

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** 1-based line of the first line matching `re`. */
function lineMatching(text: string, re: RegExp): number | undefined {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => re.test(l));
  return i < 0 ? undefined : i + 1;
}

const NPM_REGISTRY = 'https://registry.npmjs.org';

function npmrcRule(file: VirtualFile, ctx: Parameters<Rule>[1]): Finding[] {
  const out: Finding[] = [];
  (file.text ?? '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) return;
    const eq = line.indexOf('=');
    if (eq < 0) return;
    const key = line.slice(0, eq).trim().toLowerCase().replace(/_/g, '-');
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    const isRegistry = key === 'registry' || /^@[^:]+:registry$/.test(key);
    const dangerous = key === 'script-shell' || key === 'node-options' || (isRegistry && value.replace(/\/+$/, '') !== NPM_REGISTRY);
    if (dangerous) out.push(finding(ctx, 'npmrc.dangerous-key', 'high', `.npmrc sets ${key}, which changes what npm runs or where it downloads from`, `${key}=${value}`, file.path, i + 1));
  });
  return out;
}

function yarnRules(file: VirtualFile, ctx: Parameters<Rule>[1]): Finding[] {
  const text = file.text ?? '';
  const repoBinary = (evidence: string, line?: number) =>
    finding(ctx, 'yarn.repo-binary', 'high', 'Yarn is configured to run JavaScript from this repo on every yarn command', evidence, file.path, line);

  if (baseName(file.path) === '.yarnrc') {
    const line = lineMatching(text, /^\s*yarn-path\b/i);
    return line === undefined ? [] : [repoBinary(text.split('\n')[line - 1] ?? 'yarn-path', line)];
  }

  let doc: unknown;
  try {
    doc = parseYaml(text, { maxAliasCount: 50 });
  } catch {
    return [finding(ctx, 'config.unparseable', 'caution', 'Configuration file could not be parsed', `${file.path} is not valid YAML; its contents were not checked`, file.path)];
  }
  if (!doc || typeof doc !== 'object') return [];
  const cfg = doc as { yarnPath?: unknown; plugins?: unknown };
  const out: Finding[] = [];
  if (cfg.yarnPath) out.push(repoBinary(`yarnPath: ${String(cfg.yarnPath)}`, lineMatching(text, /^\s*yarnPath\s*:/)));
  if (Array.isArray(cfg.plugins)) {
    for (const p of cfg.plugins) {
      const path = typeof p === 'string' ? p : (p as { path?: unknown } | null)?.path;
      if (typeof path === 'string') out.push(repoBinary(`plugins: ${path}`, lineMatching(text, /^\s*plugins\s*:/)));
    }
  }
  return out;
}

const PNPMFILE_DANGEROUS = /child_process|\bfetch\s*\(|\bhttps?\.(?:request|get)\b|require\(\s*['"](?:node:)?(?:https?|net)['"]\s*\)/;

function pnpmfileRules(file: VirtualFile, ctx: Parameters<Rule>[1]): Finding[] {
  const out = [finding(ctx, 'pnpmfile.present', 'caution', '.pnpmfile.cjs runs code on every pnpm install', file.path, file.path)];
  const text = file.text ?? '';
  const m = PNPMFILE_DANGEROUS.exec(text);
  if (m) {
    out.push(finding(ctx, 'pnpmfile.dangerous', 'critical', '.pnpmfile.cjs starts processes or uses the network', m[0], file.path, lineMatching(text, PNPMFILE_DANGEROUS)));
  }
  return out;
}

function foundryRules(file: VirtualFile, ctx: Parameters<Rule>[1]): Finding[] {
  const text = file.text ?? '';
  const line = lineMatching(text, /^\s*ffi\s*=\s*true\b/);
  return line === undefined ? [] : [finding(ctx, 'foundry.ffi', 'caution', 'Foundry tests may run shell commands (ffi = true)', 'ffi = true', file.path, line)];
}

export const pmConfigRules: Rule[] = [
  (files, ctx) => files.filter((f) => baseName(f.path) === '.npmrc' && f.text !== undefined).flatMap((f) => npmrcRule(f, ctx)),
  (files, ctx) => files.filter((f) => /^\.yarnrc(\.yml)?$/.test(baseName(f.path)) && f.text !== undefined).flatMap((f) => yarnRules(f, ctx)),
  (files, ctx) => files.filter((f) => baseName(f.path) === '.pnpmfile.cjs').flatMap((f) => pnpmfileRules(f, ctx)),
  (files, ctx) => files.filter((f) => baseName(f.path) === 'foundry.toml' && f.text !== undefined).flatMap((f) => foundryRules(f, ctx)),
];
