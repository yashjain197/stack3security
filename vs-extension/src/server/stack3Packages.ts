import { z } from 'zod';
import { PURL, postJsonOnce } from '../api/client';
import { clip, trimEndChars } from '../engine/rules/evidence';
import type { Finding } from '../engine/types';
import { FindingSchema } from '../api/schemas';
import type { PackageScan } from './scanRepo';

const BATCH = 40; // the API's limit per request
const MAX_REQUESTS = 10;
const TIMEOUT_MS = 30_000;

// The API's findings carry no rule id, so ruleId is optional here; only `findings` and `notChecked` are read, and the
// level the API computed is dropped (z.object strips unknown keys), so it can never lower ours (I-4).
const AnswerSchema = z.object({
  findings: z.array(FindingSchema.partial({ ruleId: true })).max(500),
  notChecked: z.array(z.string().max(500)).max(100).default([]),
});

export interface Stack3PackagesOptions {
  apiUrl: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/**
 * Package-malware data from the Stack3 API (`POST /v1/internal/scan-packages`), which holds the Socket key. Only package
 * URLs leave this service, and the service key goes in a header. Whatever the API could not answer is reported back as
 * "not checked", never as clean (I-5).
 */
export function createStack3PackageScanner(opts: Stack3PackagesOptions): (purls: string[]) => Promise<PackageScan> {
  const url = `${trimEndChars(opts.apiUrl, '/')}/v1/internal/scan-packages`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = { 'x-service-key': opts.serviceKey };

  return async (purls) => {
    const unique = [...new Set(purls)];
    if (unique.length === 0) return { ok: true, value: [] };
    const valid = unique.filter((p) => p.length <= 300 && PURL.test(p));
    const sent = valid.slice(0, BATCH * MAX_REQUESTS);
    const batches: string[][] = [];
    for (let i = 0; i < sent.length; i += BATCH) batches.push(sent.slice(i, i + BATCH));

    const findings: Finding[] = [];
    const notes = new Set<string>();
    let unchecked = unique.length - sent.length;
    let reason = '';
    let answered = 0;
    for (const batch of batches) {
      const res = await postJsonOnce(fetchImpl, url, { purls: batch }, headers, opts.timeoutMs ?? TIMEOUT_MS);
      const parsed = res.ok ? AnswerSchema.safeParse(res.value) : undefined;
      if (parsed?.success) {
        answered++;
        const checkedAt = new Date((opts.now ?? Date.now)()).toISOString();
        for (const f of parsed.data.findings) {
          findings.push({ ...f, ruleId: f.ruleId ?? `stack3.${f.source}`, checkedAt: f.checkedAt || checkedAt });
        }
        for (const n of parsed.data.notChecked) notes.add(/^socket$/i.test(n) ? 'Socket did not run, so malware data for these packages is missing.' : clip(n, 300));
      } else {
        reason ||= !res.ok ? failure(res.reason) : 'The API gave an unexpected answer.';
        unchecked += batch.length;
      }
    }
    if (batches.length > 0 && answered === 0) return { ok: false, reason };
    const notChecked = [...notes];
    if (unchecked > 0) notChecked.unshift(`Package scan incomplete: ${unchecked} of ${unique.length} packages were not checked.`);
    return notChecked.length > 0 ? { ok: true, value: findings, notChecked } : { ok: true, value: findings };
  };
}

function failure(reason: string): string {
  if (reason === 'API returned 401') return 'The API rejected the service key.';
  if (reason === 'API returned 422') return 'The API rejected a package id.';
  return 'The API could not be reached or returned an error.';
}
