import { parseJsonc } from '../jsonc';
import { asString, classifyProtocol, classifySpec, isRecord, type LockEntry } from './types';

/** bun.lock (the text lockfile; it is JSONC with trailing commas). Throws on a syntax error. */
export function parseBun(text: string): LockEntry[] {
  const { value, errors } = parseJsonc(text);
  if (errors > 0 || !isRecord(value)) throw new Error('not a lockfile');
  if (!isRecord(value.packages)) return [];
  const out: LockEntry[] = [];
  for (const tuple of Object.values(value.packages)) {
    if (!Array.isArray(tuple)) continue;
    const id = asString(tuple[0]);
    const at = id ? id.indexOf('@', 1) : -1;
    if (!id || at <= 0) continue;
    const spec = id.slice(at + 1);
    const registryUrl = asString(tuple[1]);
    const integrity = tuple.find((x): x is string => typeof x === 'string' && x.startsWith('sha'));
    const source = classifySpec(spec) ?? (registryUrl ? classifyProtocol(registryUrl) ?? 'registry' : 'registry');
    out.push({ name: id.slice(0, at), version: classifySpec(spec) ? '' : spec, resolved: registryUrl || undefined, integrity, source });
  }
  return out;
}
