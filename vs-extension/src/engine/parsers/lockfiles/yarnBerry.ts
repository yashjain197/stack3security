import { parse as parseYaml } from 'yaml';
import { asString, classifyProtocol, isRecord, type LockEntry, type Source } from './types';

/** Yarn 2+ (berry) yarn.lock, which is YAML. Throws on invalid YAML or an alias bomb. */
export function parseYarnBerry(text: string): LockEntry[] {
  const doc: unknown = parseYaml(text, { maxAliasCount: 50 });
  if (!isRecord(doc)) throw new Error('not a lockfile');
  const out: LockEntry[] = [];
  for (const [key, e] of Object.entries(doc)) {
    if (key === '__metadata' || !isRecord(e)) continue;
    const resolution = asString(e.resolution);
    const at = resolution ? resolution.indexOf('@', 1) : -1;
    if (!resolution || at < 0) continue;
    const name = resolution.slice(0, at);
    const rest = resolution.slice(at + 1);
    if (rest.startsWith('patch:')) continue; // a derived patch of another entry
    let source: Source;
    let version = '';
    if (rest.startsWith('npm:')) {
      source = 'registry';
      version = rest.slice(4);
    } else {
      // exec: and any unknown protocol can run code, so treat it like a local file.
      source = classifyProtocol(rest) ?? 'file';
    }
    out.push({ name, version, integrity: asString(e.checksum), source });
  }
  return out;
}
