import { classifyResolved, classifySpec, type LockEntry } from './types';

const unquote = (s: string): string => s.trim().replace(/^"(.*)"$/, '$1');

/** Yarn classic (v1) yarn.lock: a line-based format, so a truncated file still yields every complete block. */
export function parseYarn1(text: string): LockEntry[] {
  const out: LockEntry[] = [];
  let header: string[] | undefined;
  let version = '';
  let resolved: string | undefined;
  let integrity: string | undefined;

  const flush = () => {
    const first = header?.[0];
    if (first) {
      const at = first.indexOf('@', 1);
      if (at > 0) {
        const range = first.slice(at + 1);
        out.push({ name: first.slice(0, at), version, resolved, integrity, source: classifySpec(range) ?? classifyResolved(resolved) });
      }
    }
    header = undefined;
    version = '';
    resolved = undefined;
    integrity = undefined;
  };

  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue;
    if (line.trim() === '') {
      flush();
    } else if (!/^\s/.test(line) && line.trimEnd().endsWith(':')) {
      flush();
      header = line.trimEnd().slice(0, -1).split(/,\s*/).map(unquote);
    } else if (header) {
      const m = /^\s+(version|resolved|integrity)\s+"?([^"\s]+)"?\s*$/.exec(line);
      if (m?.[1] === 'version') version = m[2] ?? '';
      else if (m?.[1] === 'resolved') resolved = m[2];
      else if (m?.[1] === 'integrity') integrity = m[2];
    }
  }
  flush();
  return out;
}
