// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { ApiError, createApiClient, safeReturnPath, type ApiClientOptions } from "./api";

const session = (accessToken = "test-access-token") => ({
  accessToken, expiresIn: 1800, user: { id: "user-1", email: "tester@example.test" },
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...headers },
  });
const unauthorized = () => json({ error: { code: "invalid_refresh_token", message: "Sign in again" } }, 401);

const clients: { dispose(): void }[] = [];
const makeClient = (options: ApiClientOptions) => {
  const client = createApiClient(options);
  clients.push(client);
  return client;
};

afterEach(() => {
  while (clients.length) clients.pop()!.dispose();
  vi.useRealTimers();
});

test("initialization restores the cookie session without persisting tokens", async () => {
  const client = makeClient({
    fetchImpl: async (url, options) => {
      expect(url).toBe("http://localhost:8000/v1/auth/refresh");
      expect(options?.method).toBe("POST");
      expect(options?.credentials).toBe("include");
      expect((options?.headers as Record<string, string>).Authorization).toBeUndefined();
      expect(options?.body).toBeUndefined();
      return json(session());
    },
  });
  await client.initialize();
  expect(client.signedIn).toBe(true);
  expect(client.user?.email).toBe("tester@example.test");
  expect((client as unknown as { accessToken?: string }).accessToken).toBeUndefined();
});

test("a missing refresh cookie is a normal signed-out state", async () => {
  const client = makeClient({ fetchImpl: async () => unauthorized() });
  await client.initialize();
  expect(client.signedIn).toBe(false);
});

test("backend outages are surfaced, not treated as anonymous success", async () => {
  const client = makeClient({ fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await expect(client.initialize()).rejects.toMatchObject({ code: "network_error" });
});

test("login sends the web contract and protected requests use the bearer token", async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const client = makeClient({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options: options! });
      if (String(url).endsWith("/otp/request")) {
        return json({ status: "sent", expiresInSeconds: 600, retryAfterSeconds: 60 }, 202);
      }
      if (String(url).endsWith("/otp/verify")) return json(session());
      return json({ plan: "free" });
    },
  });
  await client.requestCode("tester@example.test");
  await client.verifyCode("tester@example.test", "123456");
  await client.request("/v1/me");
  expect(JSON.parse(calls[0].options.body as string)).toEqual({ email: "tester@example.test" });
  expect(JSON.parse(calls[1].options.body as string)).toEqual({
    email: "tester@example.test", code: "123456", client: "web", deviceName: "Stack3 website",
  });
  expect((calls[2].options.headers as Record<string, string>).Authorization).toBe("Bearer test-access-token");
  expect(calls.every(({ options }) => options.credentials === "include")).toBe(true);
});

test("public catalog requests do not refresh or attach an access token", async () => {
  const client = makeClient({
    fetchImpl: async (url, options) => {
      expect(String(url).endsWith("/v1/billing/plans")).toBe(true);
      expect((options?.headers as Record<string, string>).Authorization).toBeUndefined();
      return json([]);
    },
  });
  expect(await client.request("/v1/billing/plans", { authenticated: false })).toEqual([]);
});

test("concurrent expired requests share one cookie refresh", async () => {
  let refreshes = 0;
  const client = makeClient({
    fetchImpl: async (url, options) => {
      if (String(url).endsWith("/refresh")) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(session());
      }
      expect((options?.headers as Record<string, string>).Authorization).toBe("Bearer test-access-token");
      return json({ ok: true });
    },
  });
  await Promise.all([client.request("/v1/me"), client.request("/v1/auth/sessions")]);
  expect(refreshes).toBe(1);
});

test("concurrent protected 401s rotate once and retry with the new token", async () => {
  let refreshes = 0;
  let attempts = 0;
  const client = makeClient({
    fetchImpl: async (url, options) => {
      if (String(url).endsWith("/otp/verify")) return json(session("old"));
      if (String(url).endsWith("/refresh")) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(session("new"));
      }
      attempts += 1;
      return (options?.headers as Record<string, string>).Authorization === "Bearer old"
        ? unauthorized()
        : json({ ok: true });
    },
  });
  await client.verifyCode("tester@example.test", "123456");
  await Promise.all([client.request("/v1/me"), client.request("/v1/auth/sessions")]);
  expect(refreshes).toBe(1);
  expect(attempts).toBe(4);
});

test("failed refresh clears the session and notifies the UI", async () => {
  let signedOut = 0;
  const client = makeClient({
    onSignedOut: () => { signedOut += 1; },
    fetchImpl: async (url) => (String(url).endsWith("/otp/verify") ? json(session()) : unauthorized()),
  });
  await client.verifyCode("tester@example.test", "123456");
  await expect(client.request("/v1/me")).rejects.toMatchObject({ status: 401 });
  expect(client.signedIn).toBe(false);
  expect(signedOut).toBe(1);
});

test("a second protected 401 never loops refresh indefinitely", async () => {
  let refreshes = 0;
  const client = makeClient({
    fetchImpl: async (url) => {
      if (String(url).endsWith("/otp/verify")) return json(session("old"));
      if (String(url).endsWith("/refresh")) { refreshes += 1; return json(session("new")); }
      return unauthorized();
    },
  });
  await client.verifyCode("tester@example.test", "123456");
  await expect(client.request("/v1/me")).rejects.toMatchObject({ status: 401 });
  expect(refreshes).toBe(1);
  expect(client.signedIn).toBe(false);
});

test("structured errors preserve codes, request IDs, validation fields and cooldowns", async () => {
  const client = makeClient({
    fetchImpl: async () => json({ error: {
      code: "rate_limited", message: "Wait", requestId: "test-request",
      details: { retryAfterSeconds: 17, fields: [{ field: "email", message: "Invalid" }] },
    } }, 429),
  });
  const failure = await client.requestCode("tester@example.test").catch((error) => error);
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure.retryAfter).toBe(17);
  expect(failure.requestId).toBe("test-request");
  expect(failure.fields[0].field).toBe("email");
  expect(failure.code).toBe("rate_limited");
});

test("Retry-After header takes precedence over body details", async () => {
  const client = makeClient({
    fetchImpl: async () => json({ error: { message: "Wait", code: "rate_limited" } }, 429, { "Retry-After": "45" }),
  });
  await expect(client.requestCode("tester@example.test")).rejects.toMatchObject({ retryAfter: 45 });
});

test("logout and current-session revocation accept empty 204 responses", async () => {
  const paths: [string, string][] = [];
  const client = makeClient({
    fetchImpl: async (url, options) => {
      paths.push([new URL(String(url)).pathname, options?.method ?? "GET"]);
      return String(url).endsWith("/otp/verify") ? json(session()) : new Response(null, { status: 204 });
    },
  });
  await client.verifyCode("tester@example.test", "123456");
  await client.logout(true);
  expect(client.signedIn).toBe(false);
  await client.verifyCode("tester@example.test", "123456");
  await client.revokeSession("current/id", true);
  expect(client.signedIn).toBe(false);
  expect(paths.some(([path, method]) => path === "/v1/auth/logout-all" && method === "POST")).toBe(true);
  expect(paths.some(([path, method]) => path === "/v1/auth/sessions/current%2Fid" && method === "DELETE")).toBe(true);
});

test("a late refresh cannot resurrect a logged-out session", async () => {
  let finishRefresh!: (value: Response) => void;
  const client = makeClient({
    fetchImpl: async (url) => {
      if (String(url).endsWith("/otp/verify")) return json(session());
      if (String(url).endsWith("/refresh")) return new Promise<Response>((resolve) => { finishRefresh = resolve; });
      return new Response(null, { status: 204 });
    },
  });
  await client.verifyCode("tester@example.test", "123456");
  const refreshing = client.refresh();
  await client.logout();
  finishRefresh(json(session("late")));
  await expect(refreshing).rejects.toMatchObject({ code: "session_changed" });
  expect(client.signedIn).toBe(false);
});

test("proactive refresh runs one minute before token expiry", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  let refreshes = 0;
  const client = makeClient({
    fetchImpl: async (url) => {
      if (String(url).endsWith("/refresh")) refreshes += 1;
      return json(session());
    },
  });
  await client.verifyCode("tester@example.test", "123456");
  await vi.advanceTimersByTimeAsync(1739000);
  expect(refreshes).toBe(0);
  // Fire the scheduled refresh synchronously so the explicit refresh() below shares it.
  vi.advanceTimersByTime(1000);
  await client.refresh();
  expect(refreshes).toBe(1);
});

test("invalid responses are errors instead of success-shaped defaults", async () => {
  const client = makeClient({ fetchImpl: async () => new Response("<html>error</html>", { status: 502 }) });
  await expect(client.requestCode("tester@example.test")).rejects.toMatchObject({
    code: "invalid_response", status: 502,
  });
});

test("an incomplete token response cannot create a signed-in session", async () => {
  const client = makeClient({ fetchImpl: async () => json({ user: session().user }) });
  await expect(client.verifyCode("tester@example.test", "123456")).rejects.toMatchObject({ code: "invalid_response" });
  expect(client.signedIn).toBe(false);
});

test("return paths preserve invite/device queries but reject external redirects", () => {
  const origin = "http://localhost:3000";
  expect(safeReturnPath("/teams/join?token=sample", origin)).toBe("/teams/join?token=sample");
  expect(safeReturnPath("/link?code=ABCD-EFGH", origin)).toBe("/link?code=ABCD-EFGH");
  for (const value of ["https://example.test", "//example.test", "/\\example.test", "/login", "javascript:alert(1)", null]) {
    expect(safeReturnPath(value, origin)).toBe("/dashboard/settings");
  }
});
