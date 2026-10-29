import { asString, classifyProtocol, classifyResolved, isRecord, type LockEntry } from './types';

const NM = 'node_modules/';
const MAX_V1_ENTRIES = 200_000;

/** package-lock.json / npm-shrinkwrap.json, lockfileVersion 1 to 3. Throws on invalid JSON. */
export function parseNpm(text: string): LockEntry[] {
  const lock: unknown = JSON.parse(text);
  if (!isRecord(lock)) throw new Error('not a lockfile');
  const out: LockEntry[] = [];

  if (isRecord(lock.packages)) {
    for (const [key, e] of Object.entries(lock.packages)) {
      const at = key.lastIndexOf(NM);
      // The root ("") and folders outside node_modules (workspace and link targets) are local code, not installed packages.
      if (key === '' || at < 0 || !isRecord(e)) continue;
      const name = asString(e.name) ?? key.slice(at + NM.length);
      if (e.link === true) {
        out.push({ name, version: '', resolved: asString(e.resolved), source: 'link' });
        continue;
      }
      out.push({
        name,
        version: asString(e.version) ?? '',
        resolved: asString(e.resolved),
        integrity: asString(e.integrity),
        source: classifyResolved(asString(e.resolved)),
        bundled: e.inBundle === true || e.bundled === true,
      });
    }
    return out;
  }

  // lockfileVersion 1: nested `dependencies`. Iterative, so a hostile depth cannot overflow the stack.
  const stack: [string, unknown][] = isRecord(lock.dependencies) ? Object.entries(lock.dependencies) : [];
  while (stack.length && out.length < MAX_V1_ENTRIES) {
    const [name, e] = stack.pop()!;
    if (!isRecord(e)) continue;
    const version = asString(e.version) ?? '';
    // For non-registry dependencies v1 stores the spec (file:, git+...) in `version`.
    const specSource = classifyProtocol(version);
    out.push({
      name,
      version: specSource ? '' : version,
      resolved: asString(e.resolved) ?? (specSource ? version : undefined),
      integrity: asString(e.integrity),
      source: specSource ?? classifyResolved(asString(e.resolved)),
      bundled: e.bundled === true,
    });
    if (isRecord(e.dependencies)) stack.push(...Object.entries(e.dependencies));
  }
  return out;
}
