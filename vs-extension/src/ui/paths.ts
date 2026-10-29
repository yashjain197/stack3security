import * as path from 'node:path';

/**
 * A repo-relative POSIX path the webview asked to view, or null. Checked without any I/O, so the bridge can drop a bad
 * request before it reaches a handler. The content provider checks containment again against the real directory.
 */
export function safeRelPath(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 1000) return null;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null;
  }
  if (input.includes('\\') || input.startsWith('/') || /^[A-Za-z]:/.test(input) || input.startsWith('~')) return null;
  const n = path.posix.normalize(input);
  if (n === '.' || n === '..' || n.startsWith('../') || n.includes('/../') || n.startsWith('/')) return null;
  return n;
}
