import { z } from 'zod';
import { trimEndChars } from '../engine/rules/evidence';
import { postJsonOnce, type Result } from '../api/client';
import { validateGraphReport, type GraphReport } from '../report/graphReport';

const Created = z.object({ id: z.string().min(1).max(100), synced: z.boolean() });
const TIMEOUT_MS = 8000;

export interface Reporter {
  report(r: GraphReport): Promise<Result<{ id: string; synced: boolean }>>;
}

/**
 * Sends a report to the Stack3 API's POST /v1/internal/report. This is the only place the service key leaves this
 * server, and only in a header. A report the API would refuse is not sent. 201 is success whether or not the graph has
 * it yet (`synced: false` means it is saved and will be retried on their side).
 */
export function createReporter(opts: { apiUrl: string; serviceKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Reporter {
  const url = `${trimEndChars(opts.apiUrl, '/')}/v1/internal/report`;
  return {
    async report(r) {
      if (validateGraphReport(r) !== undefined) return { ok: false, reason: 'The report was not valid, so it was not sent.' };
      let last = await postJsonOnce(opts.fetchImpl ?? fetch, url, r, { 'x-service-key': opts.serviceKey }, opts.timeoutMs ?? TIMEOUT_MS);
      if (!last.ok && last.retry) last = await postJsonOnce(opts.fetchImpl ?? fetch, url, r, { 'x-service-key': opts.serviceKey }, opts.timeoutMs ?? TIMEOUT_MS);
      if (!last.ok) {
        if (last.reason === 'API returned 401') return { ok: false, reason: 'The API rejected the service key.' };
        if (last.reason === 'API returned 400') return { ok: false, reason: 'The API rejected the report.' };
        return { ok: false, reason: 'The API could not be reached or returned an error.' };
      }
      const parsed = Created.safeParse(last.value);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: 'The API gave an unexpected answer.' };
    },
  };
}
