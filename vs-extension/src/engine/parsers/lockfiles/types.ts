/** Where a locked package comes from. Only `registry` and `http` carry a name and version a registry scanner can look up. */
export type Source = 'registry' | 'git' | 'http' | 'file' | 'link' | 'workspace';

export interface LockEntry {
  name: string;
  /** Empty when the lockfile gives a spec (git/file/link) instead of a version. */
  version: string;
  resolved?: string;
  integrity?: string;
  source: Source;
  /** Bundled inside another package: it legitimately has no integrity of its own. */
  bundled?: boolean;
}

export const REGISTRY_HOSTS: ReadonlySet<string> = new Set(['registry.npmjs.org', 'registry.yarnpkg.com']);

const GIT = /^(?:git\+|git:|git@|ssh:\/\/|github:|gitlab:|bitbucket:|gist:)/i;
const GITHUB_SHORTHAND = /^(?!@)[\w.-]+\/[\w.-]+(?:#.*)?$/;

/** Host of an http(s) URL, taken the way a client takes it: `https://registry.npmjs.org@evil.example/` is `evil.example`. */
export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Classify by protocol: a `resolved` URL or a dependency spec. Undefined when it is not protocol-shaped. */
export function classifyProtocol(s: string | undefined): Source | undefined {
  if (!s) return undefined;
  if (GIT.test(s)) return 'git';
  if (/^file:/i.test(s)) return 'file';
  if (/^(?:link:|portal:)/i.test(s)) return 'link';
  if (/^workspace:/i.test(s)) return 'workspace';
  if (/^https?:\/\//i.test(s)) {
    const host = hostOf(s);
    return s.toLowerCase().startsWith('https:') && host && REGISTRY_HOSTS.has(host) ? 'registry' : 'http';
  }
  return undefined;
}

/** Like `classifyProtocol`, plus npm's `user/repo` GitHub shorthand. */
export function classifySpec(s: string | undefined): Source | undefined {
  return classifyProtocol(s) ?? (s && GITHUB_SHORTHAND.test(s) ? 'git' : undefined);
}

/** A lockfile `resolved` value: no protocol means the default registry (or, for a bare path, a local folder). */
export function classifyResolved(resolved: string | undefined): Source {
  if (!resolved) return 'registry';
  return classifyProtocol(resolved) ?? 'file';
}

export const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
