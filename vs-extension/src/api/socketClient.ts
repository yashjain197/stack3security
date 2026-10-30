import { createSocketScanner } from '../server/socket';
import type { PackageResult, Stack3Client } from './client';
import { PACKAGE_SCAN_UNAVAILABLE } from './merge';

export interface SocketOptions {
  /** Read at request time, so a key set after start-up is picked up. Never logged or put in an error. */
  apiKey(): Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Printable ASCII only, so a pasted key can never carry a line break into a header. */
export const isPlausibleSocketKey = (key: string): boolean => /^[\x21-\x7e]{16,200}$/.test(key);

/** A failed package check that says why, so the verdict can tell the user what to fix. It is still "not checked", never clean (I-5). */
const unavailable = (reason: string, why: string): PackageResult => ({ ok: false, reason, notChecked: [`${PACKAGE_SCAN_UNAVAILABLE}: ${why}`] });

function whySocketFailed(reason: string): string {
  if (/ 429$/.test(reason)) return 'Socket quota is used up (each check costs 100 units). Try again in a few minutes.';
  if (/ (401|403)$/.test(reason)) return 'Socket rejected the key (it needs the packages:list scope). Run "Stack3: Set Socket API key".';
  if (/timed out/i.test(reason)) return 'Socket timed out.';
  return 'Socket could not be reached or returned an error.';
}

/**
 * Package checks straight to Socket.dev with the user's own key, when they have stored one; otherwise exactly the plain
 * client. Only package URLs leave the machine, to api.socket.dev over HTTPS, and the key goes in one header. What Socket could
 * not resolve comes back as "not checked" (I-5), and Socket's answer can only add findings: the level is still decided here
 * (I-4). The key is never shipped with the extension.
 */
export function withSocket(base: Stack3Client, opts: SocketOptions): Stack3Client {
  if (process.env.STACK3_MOCK === '1') return base;
  return {
    ...base,
    async scanPackage(purls) {
      const key = (await opts.apiKey())?.trim();
      if (!key) {
        const viaApi = await base.scanPackage(purls);
        // No key and no Stack3 API either: nothing can check packages, so say how to turn it on.
        return !viaApi.ok && viaApi.reason === 'API not configured' ? unavailable(viaApi.reason, 'no Socket API key is set. Run "Stack3: Set Socket API key".') : viaApi;
      }
      if (!isPlausibleSocketKey(key)) return unavailable('The Socket API key is not valid.', 'the Socket API key is not valid. Run "Stack3: Set Socket API key" to replace it.');
      const res = await createSocketScanner({ apiKey: key, retries: 1, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.sleep ? { sleep: opts.sleep } : {}) })(purls);
      return res.ok ? res : unavailable(res.reason, whySocketFailed(res.reason));
    },
  };
}
