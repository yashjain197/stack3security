import { clip } from '../engine/rules/evidence';
import { redactSecrets } from '../engine/secretPatterns';
import type { Finding, Severity } from '../engine/types';

/** A finding that has been through `redact`. The brand is type-only, so request bodies carry no extra field. */
export type SafeFinding = Finding & { readonly __safe: true };

export const MAX_EVIDENCE = 300;
export const MAX_TITLE = 200;
export const MAX_FINDINGS = 20;

const RANK: Record<Severity, number> = { critical: 2, high: 1, caution: 0 };

/**
 * The last gate before egress (I-6, I-7). Secrets are removed first, then control and bidi characters,
 * then length is capped, so a key cannot survive by straddling the cut.
 */
export function redact(f: Finding): SafeFinding {
  const out: Finding = {
    ...f,
    title: clip(redactSecrets(f.title), MAX_TITLE),
    evidence: clip(redactSecrets(f.evidence), MAX_EVIDENCE),
  };
  if (f.location) out.location = { ...f.location, file: clip(redactSecrets(f.location.file), 500) };
  return out as SafeFinding;
}

/** At most 20 findings, most severe first (stable within a severity), each redacted. */
export function redactAll(fs: Finding[]): SafeFinding[] {
  return [...fs].sort((a, b) => RANK[b.severity] - RANK[a.severity]).slice(0, MAX_FINDINGS).map(redact);
}
