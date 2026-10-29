import type { Node } from 'jsonc-parser';
import { analyzeLockfiles } from '../lockfiles';
import { hostOf, classifySpec } from '../parsers/lockfiles/types';
import { lineOf, nodeAt, parseJsoncTree } from '../parsers/jsonc';
import type { Finding, Rule, ScanContext } from '../types';
import { finding } from './evidence';

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const MAX_LISTED = 8;

const isManifest = (p: string): boolean => (p === 'package.json' || p.endsWith('/package.json')) && !p.startsWith('node_modules/') && !p.includes('/node_modules/');

function list(items: string[]): string {
  return items.length > MAX_LISTED ? `${items.slice(0, MAX_LISTED).join(', ')} (+${items.length - MAX_LISTED} more)` : items.join(', ');
}

/** A dependency spec that does not resolve through the registry. Any http(s) URL counts, whatever its host. */
function unverifiedSpec(spec: string): boolean {
  if (/^https?:\/\//i.test(spec)) return true;
  const s = classifySpec(spec);
  return s === 'git' || s === 'file' || s === 'link';
}

function manifestRule(files: Parameters<Rule>[0], ctx: ScanContext): Finding[] {
  const out: Finding[] = [];
  for (const f of files) {
    if (!isManifest(f.path) || f.text === undefined) continue;
    const d = parseJsoncTree(f.text);
    if (d.errors > 0) continue; // the install-script rule reports an unparseable package.json
    const hits: { text: string; node: Node }[] = [];
    for (const section of SECTIONS) {
      const node = nodeAt(d.root, [section]);
      if (node?.type !== 'object') continue;
      for (const prop of node.children ?? []) {
        const [k, v] = prop.children ?? [];
        if (k && v?.type === 'string' && unverifiedSpec(String(v.value))) hits.push({ text: `${String(k.value)}: ${String(v.value)}`, node: v });
      }
    }
    if (hits.length) {
      out.push(finding(ctx, 'deps.unverified-source', 'caution', 'Dependencies come from outside the npm registry', list(hits.map((h) => h.text)), f.path, lineOf(d.text, hits[0]?.node)));
    }
  }
  return out;
}

function lockfileRule(files: Parameters<Rule>[0], ctx: ScanContext): Finding[] {
  const out: Finding[] = [];
  for (const lf of analyzeLockfiles(files).lockfiles) {
    const unverified = lf.entries.filter((e) => e.source === 'git' || e.source === 'file' || e.source === 'link').map((e) => `${e.name}: ${e.resolved ?? e.source}`);
    if (unverified.length) out.push(finding(ctx, 'deps.unverified-source', 'caution', 'Locked packages come from outside the npm registry', list(unverified), lf.path));

    const byHost = new Map<string, string[]>();
    for (const e of lf.entries) {
      if (e.source !== 'http') continue;
      const host = (e.resolved && hostOf(e.resolved)) || 'unknown host';
      byHost.set(host, [...(byHost.get(host) ?? []), e.name]);
    }
    for (const [host, names] of byHost) {
      out.push(finding(ctx, 'deps.foreign-registry', 'high', `Locked packages are downloaded from ${host}, not the npm registry`, `${host}: ${list(names)}`, lf.path));
    }

    const missing = lf.entries.filter((e) => e.source === 'registry' && !e.integrity && !e.bundled).map((e) => e.name);
    if (missing.length) out.push(finding(ctx, 'deps.no-integrity', 'caution', 'Locked packages have no integrity hash', list(missing), lf.path));
  }
  return out;
}

export const depRules: Rule[] = [manifestRule, lockfileRule];
