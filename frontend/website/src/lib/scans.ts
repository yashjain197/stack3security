import { useCallback, useSyncExternalStore } from "react";
import type { ApiClient } from "./api";
import type { ScanKind, ScanRecord, ScanStats, ScanVerdict, TxReviewRequest } from "../types";

// ---------- Live checks (Stack3 protection API) ----------

export function checkWebsite(api: ApiClient, domain: string, signal?: AbortSignal): Promise<ScanVerdict> {
  return api.request<ScanVerdict>("/v1/check-domain", { method: "POST", body: { domain }, signal });
}

export function scanContract(api: ApiClient, chainId: number, address: string, signal?: AbortSignal): Promise<ScanVerdict> {
  return api.request<ScanVerdict>(
    `/v1/scan-contract/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}`,
    { signal },
  );
}

export function reviewTransaction(api: ApiClient, review: TxReviewRequest, signal?: AbortSignal): Promise<ScanVerdict> {
  return api.request<ScanVerdict>("/v1/review-tx", { method: "POST", body: review, signal });
}

// ---------- Repository scans (VS Code scan service, through the Chrome API) ----------
// The Chrome API holds the scan service's key, so the browser never talks to it directly.

export function scanRepository(api: ApiClient, repoUrl: string, signal?: AbortSignal): Promise<ScanVerdict> {
  // The scan service clones and scores the repo; it allows up to about 100 seconds.
  return api.request<ScanVerdict>("/v1/scan-repo", { method: "POST", body: { repoUrl }, signal, timeoutMs: 120_000 });
}

export function getScanStats(api: ApiClient, signal?: AbortSignal): Promise<ScanStats> {
  return api.request<ScanStats>("/v1/stats", { authenticated: false, signal });
}

/** "owner/name", "github.com/owner/name" or a full URL → https://github.com/owner/name. */
export function normalizeRepoUrl(input: string): string {
  const trimmed = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const match = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
  if (!match || match[2] === "." || match[2] === "..") {
    throw new Error("Enter a public GitHub repository, e.g. github.com/owner/name.");
  }
  return `https://github.com/${match[1]}/${match[2]}`;
}

// ---------- Input helpers ----------

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Hostname from a URL or bare domain; throws a readable error when it is not one. */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Enter a website URL or domain.");
  let host: string;
  try {
    host = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    throw new Error("Enter a valid website URL or domain.");
  }
  if (!/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i.test(host)) throw new Error("Enter a valid website URL or domain.");
  return host.toLowerCase();
}

/** Converts a decimal amount of the native token (e.g. "0.5") to a hex wei quantity. */
export function toWeiHex(amount: string): string | undefined {
  const trimmed = amount.trim();
  if (!trimmed || Number(trimmed) === 0) return undefined;
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) throw new Error("Enter the value as a number, e.g. 0.05.");
  const [whole, fraction = ""] = trimmed.split(".");
  return `0x${(BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"))).toString(16)}`;
}

// ---------- Scan history (this browser only) ----------
// The API keeps no per-user scan history, so completed scans are kept in localStorage,
// separately for each signed-in account.

const MAX_RECORDS = 50;
const CHANGE_EVENT = "stack3:scan-history";
const storageKey = (userId: string) => `stack3.scanHistory.${userId}`;
const cache = new Map<string, { raw: string | null; records: ScanRecord[] }>();

function readHistory(userId: string): ScanRecord[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(userId));
  } catch {
    // Storage blocked: history is simply empty.
  }
  const cached = cache.get(userId);
  if (cached && cached.raw === raw) return cached.records;
  let records: ScanRecord[] = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) records = parsed.filter((item) => item && typeof item.id === "string" && item.verdict);
  } catch {
    records = [];
  }
  cache.set(userId, { raw, records });
  return records;
}

function writeHistory(userId: string, records: ScanRecord[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch {
    // Storage full or blocked: the scan result is still shown, only not remembered.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function saveScan(userId: string, kind: ScanKind, target: string, verdict: ScanVerdict, chainId?: number): ScanRecord {
  const record: ScanRecord = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    target,
    chainId,
    createdAt: new Date().toISOString(),
    verdict,
  };
  writeHistory(userId, [record, ...readHistory(userId)]);
  return record;
}

export function useScanHistory(userId: string | undefined) {
  const id = userId ?? "anonymous";
  const records = useSyncExternalStore(subscribe, () => readHistory(id));
  const clear = useCallback(() => writeHistory(id, []), [id]);
  return { records, clear };
}

export const scanKindLabels: Record<ScanKind, string> = {
  website: "Website",
  contract: "Contract",
  transaction: "Transaction",
  repo: "Repository",
};
