import type { Finding, Layer, ScanContext, Severity } from '../types';

const MAX_EVIDENCE = 300;
// C0/C1 controls, bidi embeddings/isolates/marks and zero-width characters: they can reorder or hide text in the UI.
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Untrusted text made fit to show: no control or bidi characters, bounded length (egress cap, I-11). */
export function clip(text: string, max = MAX_EVIDENCE): string {
  const clean = text.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** `text` without its trailing `chars`. A loop, not a regex: `/x+$/` is quadratic on a long run of x (ReDoS, I-14). */
export function trimEndChars(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text.charAt(end - 1))) end--;
  return text.slice(0, end);
}

export function finding(
  ctx: ScanContext,
  ruleId: string,
  severity: Severity,
  title: string,
  evidence: string,
  file: string,
  line?: number,
  layer: Layer = 'repo-file',
): Finding {
  return {
    ruleId,
    layer,
    severity,
    title,
    evidence: clip(evidence),
    location: line === undefined ? { file } : { file, line },
    source: 'rules',
    checkedAt: ctx.checkedAt,
  };
}

/** Prose from an untrusted source: control and bidi characters removed, newlines kept, length capped. */
export function cleanText(text: string, max: number): string {
  return text.replace(UNSAFE_CHARS, '').slice(0, max);
}
