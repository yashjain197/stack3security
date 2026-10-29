import { constants, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { isInside } from '../scan/paths';
import type { ScanRecord } from '../quarantine/registry';
import { NOTICE } from './copy';
import { safeRelPath } from './paths';

export const SCHEME = 'stack3-quarantine';
export const MAX_VIEW_BYTES = 1024 * 1024;
const SCAN_ID = /^[0-9a-f]{64}$/;

/** The URI path for viewing `rel` of a scan: `/<scanId>/<rel>`. */
export function quarantineUriPath(scanId: string, rel: string): string {
  return `/${scanId}/${rel}`;
}

export function parseQuarantinePath(uriPath: string): { scanId: string; rel: string } | null {
  const m = /^\/([0-9a-f]{64})\/(.+)$/.exec(uriPath);
  const rel = m ? safeRelPath(m[2]) : null;
  return m && SCAN_ID.test(m[1] ?? '') && rel ? { scanId: m[1]!, rel } : null;
}

/**
 * Text of one file of a quarantined clone, for the read-only viewer. Contained (a real, non-symlink file whose
 * real path is inside the clone), at most 1 MiB, and shown as plain text. It is never opened as a workspace.
 */
export async function readQuarantined(rec: Pick<ScanRecord, 'dir'>, rel: string): Promise<string> {
  const relPath = safeRelPath(rel);
  if (!relPath) return NOTICE.fileUnavailable;
  try {
    const root = await fs.realpath(rec.dir);
    const abs = path.join(root, relPath);
    const st = await fs.lstat(abs);
    if (st.isSymbolicLink() || !st.isFile()) return NOTICE.fileUnavailable;
    if (!isInside(root, await fs.realpath(abs))) return NOTICE.fileUnavailable;

    const fh = await fs.open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const buf = Buffer.alloc(Math.min(st.size, MAX_VIEW_BYTES));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const bytes = buf.subarray(0, bytesRead);
      if (bytes.subarray(0, 8192).includes(0)) return NOTICE.binary(st.size);
      const text = new TextDecoder('utf-8').decode(bytes);
      return st.size > MAX_VIEW_BYTES ? `${text}\n\n${NOTICE.fileTruncated}` : text;
    } finally {
      await fh.close();
    }
  } catch {
    return NOTICE.fileUnavailable;
  }
}
