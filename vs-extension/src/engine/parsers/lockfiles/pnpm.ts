import { parseAllDocuments } from 'yaml';
import { asString, classifyProtocol, classifySpec, isRecord, type LockEntry, type Source } from './types';

const MAX_DOCUMENTS = 4;

/**
 * Newer pnpm writes more than one YAML document into the file (a first one for its own tooling, then the project's), so
 * every document is read and the `packages` of all of them are used. Throws on invalid YAML, an alias bomb or too many documents.
 */
function readDocuments(text: string): Record<string, unknown> {
  const docs = parseAllDocuments(text);
  if (docs.length === 0 || docs.length > MAX_DOCUMENTS) throw new Error('not a lockfile');
  const merged: Record<string, unknown> = {};
  const packages: Record<string, unknown> = {};
  for (const d of docs) {
    if (d.errors.length > 0) throw d.errors[0];
    const js: unknown = d.toJS({ maxAliasCount: 50 });
    if (!isRecord(js)) throw new Error('not a lockfile');
    if (isRecord(js.packages)) Object.assign(packages, js.packages);
    for (const [k, v] of Object.entries(js)) if (k !== 'packages' && !(k in merged)) merged[k] = v;
  }
  merged.packages = packages;
  return merged;
}

/** pnpm-lock.yaml v5 to v9, including the multi-document form. Throws on invalid YAML or an alias bomb. */
export function parsePnpm(text: string): LockEntry[] {
  const doc = readDocuments(text);
  if (!isRecord(doc.packages)) return [];
  const legacy = Number.parseFloat(String(doc.lockfileVersion ?? '9')) < 6; // v5 keys are /name/1.2.3, later ones name@1.2.3

  const out: LockEntry[] = [];
  for (const [rawKey, e] of Object.entries(doc.packages)) {
    if (!isRecord(e)) continue;
    let name: string;
    let version: string;
    const key = rawKey.replace(/^\//, '');
    if (legacy) {
      const slash = key.lastIndexOf('/');
      if (slash <= 0) continue;
      name = key.slice(0, slash);
      version = key.slice(slash + 1).split('_')[0] ?? '';
    } else {
      const base = key.replace(/\(.*$/s, '');
      const at = base.indexOf('@', 1);
      if (at <= 0) continue;
      name = base.slice(0, at);
      version = base.slice(at + 1);
    }

    const r = isRecord(e.resolution) ? e.resolution : {};
    const tarball = asString(r.tarball);
    let source: Source = 'registry';
    if (asString(r.directory)) source = 'file';
    else if (r.type === 'git' || asString(r.repo)) source = 'git';
    else if (tarball) source = classifyProtocol(tarball) ?? 'http';
    else source = classifySpec(version) ?? 'registry';
    out.push({ name, version: classifySpec(version) ? '' : version, resolved: tarball, integrity: asString(r.integrity), source });
  }
  return out;
}
