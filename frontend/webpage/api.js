export class ApiError extends Error {
  constructor(message, { status = 0, code = "network_error", requestId, retryAfter = 0, fields = [] } = {}) {
    super(message);
    this.name = "ApiError";
    Object.assign(this, { status, code, requestId, retryAfter, fields });
  }
}

export function createApiClient({
  baseUrl = "http://localhost:8000",
  fetchImpl = globalThis.fetch.bind(globalThis),
  onSignedOut = () => {},
  onError = (error) => console.error("Session refresh failed:", error),
} = {}) {
  let token = null;
  let user = null;
  let expiresAt = 0;
  let refreshTimer;
  let refreshPromise;
  let generation = 0;

  function clearSession(notify = false) {
    generation += 1;
    clearTimeout(refreshTimer);
    token = null;
    user = null;
    expiresAt = 0;
    if (notify) onSignedOut();
  }

  function acceptSession(data) {
    if (!data.accessToken || !data.user || !Number.isFinite(data.expiresIn) || data.expiresIn <= 0) {
      throw new ApiError("The API returned an invalid login response.", { code: "invalid_response" });
    }
    token = data.accessToken;
    user = data.user;
    expiresAt = Date.now() + data.expiresIn * 1000;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh().catch(onError), Math.max(1000, (data.expiresIn - 60) * 1000));
    refreshTimer.unref?.();
    return data;
  }

  async function send(path, { method = "GET", body, authenticated = true, signal } = {}, retry = true) {
    const sentToken = token;
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authenticated && sentToken) headers.Authorization = `Bearer ${sentToken}`;
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        credentials: "include",
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError("Cannot reach the API. Check that the backend is running and try again.");
    }
    if (response.status === 401 && authenticated && retry) {
      if (!token || token === sentToken) await refresh();
      return send(path, { method, body, authenticated, signal }, false);
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

  function refresh() {
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

  async function request(path, options = {}) {
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
        if (error.status !== 401) throw error;
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
    dispose() { clearSession(); },
  };
}

export function safeReturnPath(value, origin = globalThis.location?.origin ?? "http://localhost:3000") {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/dashboard/settings";
  try {
    const url = new URL(value, origin);
    return url.origin === origin && url.pathname !== "/login"
      ? `${url.pathname}${url.search}${url.hash}` : "/dashboard/settings";
  } catch {
    return "/dashboard/settings";
  }
}
