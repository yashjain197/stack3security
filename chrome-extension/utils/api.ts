// Stack3 API client for the extension: device-link auth, token refresh, and the Chrome checks.
// The access token stays in memory; only the rotating refresh token is stored in extension storage.

import type {
  Blocklist,
  Level,
  LinkStart,
  PageSignals,
  RulesBundle,
  SourcifyInfo,
  TokenPair,
  TxReview,
  Verdict,
} from "./types";

export const DEFAULT_API_BASE_URL = "https://chrome-ext-backend.stack3security.workers.dev";
export const WEBSITE_URL = "https://stack3security.stack3security.workers.dev";

/** Website page that runs the full live contract scan for a contract on a chain. */
export function contractDetailsUrl(chainId: number, address: string | null): string {
  return address
    ? `${WEBSITE_URL}/dashboard/contracts?chain=${chainId}&address=${address.toLowerCase()}`
    : `${WEBSITE_URL}/dashboard/transactions`;
}

/** Website page that runs the live domain scan for a host. */
export const siteDetailsUrl = (host: string) => `${WEBSITE_URL}/dashboard/scanner?domain=${encodeURIComponent(host)}`;

// Base URLs from old deployments; a stored override matching one is discarded.
const LEGACY_API_BASE_URLS = new Set(["https://stack3security.onrender.com"]);

export class ApiError extends Error {
  status: number;
  code: string;
  requestId?: string;
  retryAfter: number;

  constructor(message: string, status = 0, code = "network_error", requestId?: string, retryAfter = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

type StoredAuth = {
  refreshToken: string;
  email: string;
};

let accessToken: string | null = null;
let accessExpiresAt = 0;
let refreshing: Promise<void> | null = null;

export async function getApiBaseUrl(): Promise<string> {
  const stored = await browser.storage.local.get("apiBaseUrl");
  const value = stored.apiBaseUrl;
  return typeof value === "string" && value ? value.replace(/\/$/, "") : DEFAULT_API_BASE_URL;
}

/** Drops a stored API base URL that still points at a retired deployment. */
export async function clearLegacyApiBaseUrl(): Promise<void> {
  const stored = await browser.storage.local.get("apiBaseUrl");
  const value = stored.apiBaseUrl;
  if (typeof value === "string" && LEGACY_API_BASE_URLS.has(value.replace(/\/$/, ""))) {
    await browser.storage.local.remove("apiBaseUrl");
  }
}

async function getStoredAuth(): Promise<StoredAuth | null> {
  const stored = await browser.storage.local.get("auth");
  const auth = stored.auth as StoredAuth | undefined;
  return auth && auth.refreshToken ? auth : null;
}

async function setStoredAuth(auth: StoredAuth | null): Promise<void> {
  if (auth) await browser.storage.local.set({ auth });
  else await browser.storage.local.remove("auth");
}

function acceptTokens(pair: TokenPair): void {
  accessToken = pair.accessToken;
  accessExpiresAt = Date.now() + pair.expiresIn * 1000;
}

async function rawRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const base = await getApiBaseUrl();
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError("Cannot reach the Stack3 API. Check your connection and try again.");
  }
}

async function readError(response: Response): Promise<ApiError> {
  let data: { error?: { code?: string; message?: string; requestId?: string } } = {};
  try {
    data = await response.json();
  } catch {
    return new ApiError(`API request failed (${response.status}).`, response.status, "invalid_response");
  }
  return new ApiError(
    data.error?.message ?? `API request failed (${response.status}).`,
    response.status,
    data.error?.code ?? "http_error",
    data.error?.requestId,
    Number(response.headers.get("Retry-After") ?? 0),
  );
}

async function refreshAccessToken(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const stored = await getStoredAuth();
    if (!stored) throw new ApiError("Not linked. Link this device first.", 401, "unauthorized");
    const response = await rawRequest("/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });
    if (!response.ok) {
      if (response.status === 401) {
        accessToken = null;
        await setStoredAuth(null);
      }
      throw await readError(response);
    }
    const pair: TokenPair = await response.json();
    acceptTokens(pair);
    // The refresh token rotates on every use; always store the newest one.
    if (pair.refreshToken) await setStoredAuth({ refreshToken: pair.refreshToken, email: pair.user.email });
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function authedRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!accessToken || Date.now() >= accessExpiresAt - 30000) await refreshAccessToken();
  const response = await rawRequest(path, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401 && retry) {
    accessToken = null;
    await refreshAccessToken();
    return authedRequest<T>(path, init, false);
  }
  if (response.status === 304) return null as T;
  if (!response.ok) throw await readError(response);
  return response.json() as Promise<T>;
}

function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---------- Auth / device link ----------

export async function authStatus(): Promise<{ linked: boolean; email: string | null }> {
  const stored = await getStoredAuth();
  return { linked: stored !== null, email: stored?.email ?? null };
}

export async function startLink(): Promise<LinkStart> {
  const response = await rawRequest(
    "/v1/auth/link/start",
    postJson({ client: "chrome", deviceName: "Stack3 Chrome extension" }),
  );
  if (!response.ok) throw await readError(response);
  return response.json();
}

/** One poll of the device-code endpoint. Returns the user email once approved, null while pending. */
export async function pollLinkToken(deviceCode: string): Promise<string | null> {
  const response = await rawRequest("/v1/auth/link/token", postJson({ deviceCode }));
  if (!response.ok) {
    const error = await readError(response);
    if (error.code === "authorization_pending" || error.code === "slow_down") return null;
    throw error;
  }
  const pair: TokenPair = await response.json();
  acceptTokens(pair);
  if (!pair.refreshToken) throw new ApiError("The API did not return a refresh token.", 0, "invalid_response");
  await setStoredAuth({ refreshToken: pair.refreshToken, email: pair.user.email });
  return pair.user.email;
}

export async function unlink(): Promise<void> {
  try {
    if (accessToken) await authedRequest("/v1/auth/logout", { method: "POST" }, false);
  } catch {
    // Best effort: clear local state even when the API is unreachable.
  }
  accessToken = null;
  accessExpiresAt = 0;
  await setStoredAuth(null);
}

// ---------- Rules (cached) ----------

const RULES_KEY = "rulesBundle";
const BLOCKLIST_KEY = "blocklist";

export async function getRulesBundle(force = false): Promise<RulesBundle> {
  const stored = await browser.storage.local.get(RULES_KEY);
  const cached = stored[RULES_KEY] as { bundle: RulesBundle; fetchedAt: number } | undefined;
  if (!force && cached && Date.now() - cached.fetchedAt < cached.bundle.ttlSeconds * 1000) {
    return cached.bundle;
  }
  const bundle = await authedRequest<RulesBundle>("/v1/rules/bundle");
  await browser.storage.local.set({ [RULES_KEY]: { bundle, fetchedAt: Date.now() } });
  return bundle;
}

// Pages are checked against the cached blocklist; it is revalidated at most once per 30 minutes.
const BLOCKLIST_FRESH_MS = 30 * 60 * 1000;

export async function getBlocklist(): Promise<Blocklist> {
  const stored = await browser.storage.local.get(BLOCKLIST_KEY);
  const cached = stored[BLOCKLIST_KEY] as { list: Blocklist; etag: string; checkedAt?: number } | undefined;
  if (cached?.checkedAt && Date.now() - cached.checkedAt < BLOCKLIST_FRESH_MS) return cached.list;
  const headers: Record<string, string> = {};
  if (cached) headers["If-None-Match"] = cached.etag;
  const fresh = await authedRequest<Blocklist | null>("/v1/rules/blocklist", { headers });
  if (fresh === null && cached) {
    // 304: our copy is still good
    await browser.storage.local.set({ [BLOCKLIST_KEY]: { ...cached, checkedAt: Date.now() } });
    return cached.list;
  }
  if (fresh === null) throw new ApiError("Blocklist unavailable.", 0, "invalid_response");
  await browser.storage.local.set({ [BLOCKLIST_KEY]: { list: fresh, etag: fresh.version, checkedAt: Date.now() } });
  return fresh;
}

/** Offline-first phishing check: a listed host, or a subdomain of one, is known phishing. */
export async function isBlocklisted(host: string): Promise<boolean> {
  try {
    const list = await getBlocklist();
    const target = host.toLowerCase().replace(/^www\./, "");
    return list.domains.some((domain) => target === domain || target.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

// ---------- Checks (each returns one Verdict) ----------

export function checkDomain(domain: string): Promise<Verdict> {
  return authedRequest<Verdict>("/v1/check-domain", postJson({ domain }));
}

export function scanPage(origin: string, signals: PageSignals): Promise<Verdict> {
  return authedRequest<Verdict>("/v1/scan-page", postJson({ origin, signals }));
}

export function checkScripts(origin: string, scripts: string[]): Promise<Verdict> {
  return authedRequest<Verdict>("/v1/check-scripts", postJson({ origin, scripts: scripts.slice(0, 40) }));
}

export function reviewTx(review: TxReview): Promise<Verdict> {
  return authedRequest<Verdict>("/v1/review-tx", postJson(review));
}

export function scanContract(chainId: number, address: string): Promise<Verdict> {
  return authedRequest<Verdict>(
    `/v1/scan-contract/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}`,
  );
}

// ---------- Public contract metadata (no account needed) ----------

/** Verification status and contract name from Sourcify. Null when Sourcify cannot be reached. */
export async function lookupSourcify(chainId: number, address: string): Promise<SourcifyInfo | null> {
  try {
    const response = await fetch(
      `https://sourcify.dev/server/v2/contract/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}?fields=compilation`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) },
    );
    if (response.status === 404) return { verified: false, name: null, match: null };
    if (!response.ok) return null;
    const data = (await response.json()) as { match?: string | null; compilation?: { name?: string } };
    return {
      verified: Boolean(data.match),
      name: typeof data.compilation?.name === "string" ? data.compilation.name : null,
      match: data.match ?? null,
    };
  } catch {
    return null;
  }
}

export const levelLabels: Record<Level, string> = {
  critical: "Critical",
  high: "High risk",
  caution: "Caution",
  unknown: "Unknown",
  no_known_issues: "No known issues found",
};
