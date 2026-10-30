import type { User } from "../types";

export type ApiErrorField = { field: string; message: string };

type ApiErrorOptions = {
  status?: number;
  code?: string;
  requestId?: string;
  retryAfter?: number;
  fields?: ApiErrorField[];
};

export class ApiError extends Error {
  status: number;
  code: string;
  requestId?: string;
  retryAfter: number;
  fields: ApiErrorField[];

  constructor(message: string, { status = 0, code = "network_error", requestId, retryAfter = 0, fields = [] }: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
    this.fields = fields;
  }
}

type SessionData = {
  accessToken: string;
  user: User;
  expiresIn: number;
};

export type RequestOptions = {
  method?: string;
  body?: unknown;
  authenticated?: boolean;
  signal?: AbortSignal;
  /** Defaults to 15 seconds; repository scans need longer. */
  timeoutMs?: number;
};

export type ApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  onSignedOut?: () => void;
  onError?: (error: ApiError) => void;
};

export type ApiClient = {
  readonly user: User | null;
  readonly signedIn: boolean;
  initialize(): Promise<void>;
  refresh(): Promise<SessionData>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request<T = any>(path: string, options?: RequestOptions): Promise<T>;
  requestCode(email: string): Promise<{ status: string; expiresInSeconds: number; retryAfterSeconds: number }>;
  verifyCode(email: string, code: string): Promise<SessionData>;
  logout(all?: boolean): Promise<void>;
  revokeSession(id: string, current?: boolean): Promise<void>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

export function createApiClient({
  baseUrl = "http://localhost:8000",
  fetchImpl = globalThis.fetch.bind(globalThis),
  onSignedOut = () => {},
  onError = (error) => console.error("Session refresh failed:", error),
}: ApiClientOptions = {}): ApiClient {
  let token: string | null = null;
  let user: User | null = null;
  let expiresAt = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshPromise: Promise<SessionData> | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();

  function notifyListeners() {
    for (const listener of listeners) listener();
  }

  function clearSession(notify = false) {
    generation += 1;
    clearTimeout(refreshTimer);
    token = null;
    user = null;
    expiresAt = 0;
    notifyListeners();
    if (notify) onSignedOut();
  }

  function acceptSession(data: SessionData): SessionData {
    if (!data.accessToken || !data.user || !Number.isFinite(data.expiresIn) || data.expiresIn <= 0) {
      throw new ApiError("The API returned an invalid login response.", { code: "invalid_response" });
    }
    token = data.accessToken;
    user = data.user;
    expiresAt = Date.now() + data.expiresIn * 1000;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh().catch(onError), Math.max(1000, (data.expiresIn - 60) * 1000));
    (refreshTimer as unknown as { unref?: () => void }).unref?.();
    notifyListeners();
    return data;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function send(path: string, { method = "GET", body, authenticated = true, signal, timeoutMs = 15000 }: RequestOptions = {}, retry = true): Promise<any> {
    const sentToken = token;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authenticated && sentToken) headers.Authorization = `Bearer ${sentToken}`;
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        credentials: "include",
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if ((error as Error).name === "TimeoutError") {
        throw new ApiError("The API took too long to answer. Try again in a moment.", { code: "timeout" });
      }
      throw new ApiError("Cannot reach the API. Check that the backend is running and try again.");
    }
    if (response.status === 401 && authenticated && retry) {
      if (!token || token === sentToken) await refresh();
      return send(path, { method, body, authenticated, signal, timeoutMs }, false);
    }
    if (response.status === 204) return null;
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError("The API returned an unreadable response.", {
        status: response.status, code: "invalid_response",
      });
    }
    if (!response.ok) {
      const error = data.error ?? {};
      if (response.status === 401 && authenticated) clearSession(true);
      throw new ApiError(error.message ?? `API request failed (${response.status}).`, {
        status: response.status,
        code: error.code ?? "http_error",
        requestId: error.requestId,
        retryAfter: Number(response.headers.get("Retry-After") ?? error.details?.retryAfterSeconds ?? 0),
        fields: error.details?.fields ?? [],
      });
    }
    return data;
  }

  function refresh(): Promise<SessionData> {
    if (!refreshPromise) {
      const startedGeneration = generation;
      refreshPromise = send("/v1/auth/refresh", { method: "POST", authenticated: false })
        .then((data) => {
          if (startedGeneration !== generation) {
            throw new ApiError("The session changed. Sign in again.", { status: 401, code: "session_changed" });
          }
          return acceptSession(data);
        })
        .catch((error) => {
          if (error.status === 401 && startedGeneration === generation) clearSession(true);
          throw error;
        })
        .finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function request(path: string, options: RequestOptions = {}): Promise<any> {
    if (options.authenticated !== false && (!token || Date.now() >= expiresAt - 1000)) await refresh();
    return send(path, options);
  }

  return {
    get user() { return user; },
    get signedIn() { return token !== null; },
    async initialize() {
      try {
        await refresh();
      } catch (error) {
        if ((error as ApiError).status !== 401) throw error;
      }
    },
    refresh,
    request,
    requestCode: (email) => request("/v1/auth/otp/request", {
      method: "POST", body: { email }, authenticated: false,
    }),
    async verifyCode(email, code) {
      const data = await request("/v1/auth/otp/verify", {
        method: "POST", body: { email, code, client: "web", deviceName: "Stack3 website" }, authenticated: false,
      });
      generation += 1;
      return acceptSession(data);
    },
    async logout(all = false) {
      await request(all ? "/v1/auth/logout-all" : "/v1/auth/logout", { method: "POST" });
      clearSession(true);
    },
    async revokeSession(id, current = false) {
      await request(`/v1/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (current) clearSession(true);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() { clearSession(); },
  };
}

export function safeReturnPath(value: string | null | undefined, origin = globalThis.location?.origin ?? "http://localhost:3000"): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/dashboard/settings";
  try {
    const url = new URL(value, origin);
    return url.origin === origin && url.pathname !== "/login"
      ? `${url.pathname}${url.search}${url.hash}` : "/dashboard/settings";
  } catch {
    return "/dashboard/settings";
  }
}
