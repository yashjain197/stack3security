import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient, safeReturnPath } from "./api.js";

const session = (accessToken = "test-access-token") => ({
  accessToken, expiresIn: 1800, user: { id: "user-1", email: "tester@example.test" },
});
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", ...headers },
});
const unauthorized = () => json({ error: { code: "invalid_refresh_token", message: "Sign in again" } }, 401);
const makeClient = (t, options) => {
  const client = createApiClient(options);
  t.after(() => client.dispose());
  return client;
};

test("initialization restores the cookie session without persisting tokens", async (t) => {
  const client = makeClient(t, {
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://localhost:8000/v1/auth/refresh");
      assert.equal(options.method, "POST");
      assert.equal(options.credentials, "include");
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.body, undefined);
      return json(session());
    },
  });
  await client.initialize();
  assert.equal(client.signedIn, true);
  assert.equal(client.user.email, "tester@example.test");
  assert.equal(client.accessToken, undefined);
});

test("a missing refresh cookie is a normal signed-out state", async (t) => {
  const client = makeClient(t, { fetchImpl: async () => unauthorized() });
  await client.initialize();
  assert.equal(client.signedIn, false);
});

test("backend outages are surfaced, not treated as anonymous success", async (t) => {
  const client = makeClient(t, { fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(client.initialize(), { code: "network_error" });
});

test("login sends the web contract and protected requests use Bearer credentials", async (t) => {
  const calls = [];
  const client = makeClient(t, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/otp/request")) return json({ status: "sent", expiresInSeconds: 600, retryAfterSeconds: 60 }, 202);
      if (url.endsWith("/otp/verify")) return json(session());
      return json({ plan: "free" });
    },
  });
  await client.requestCode("tester@example.test");
  await client.verifyCode("tester@example.test", "123456");
  await client.request("/v1/me");
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: "tester@example.test" });
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    email: "tester@example.test", code: "123456", client: "web", deviceName: "Stack3 website",
  });
  assert.equal(calls[2].options.headers.Authorization, "Bearer test-access-token");
  assert.ok(calls.every(({ options }) => options.credentials === "include"));
});

test("public catalog requests do not refresh or attach an access token", async (t) => {
  const client = makeClient(t, {
    fetchImpl: async (url, options) => {
      assert.ok(url.endsWith("/v1/billing/plans"));
      assert.equal(options.headers.Authorization, undefined);
      return json([]);
    },
  });
  assert.deepEqual(await client.request("/v1/billing/plans", { authenticated: false }), []);
});

test("concurrent expired requests share one cookie refresh", async (t) => {
  let refreshes = 0;
  const client = makeClient(t, {
    fetchImpl: async (url, options) => {
      if (url.endsWith("/refresh")) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(session());
      }
      assert.equal(options.headers.Authorization, "Bearer test-access-token");
      return json({ ok: true });
    },
  });
  await Promise.all([client.request("/v1/me"), client.request("/v1/auth/sessions")]);
  assert.equal(refreshes, 1);
});

test("concurrent protected 401s rotate once and retry with the new token", async (t) => {
  let refreshes = 0;
  let attempts = 0;
  const client = makeClient(t, {
    fetchImpl: async (url, options) => {
      if (url.endsWith("/otp/verify")) return json(session("old"));
      if (url.endsWith("/refresh")) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(session("new"));
      }
      attempts += 1;
      return options.headers.Authorization === "Bearer old" ? unauthorized() : json({ ok: true });
    },
  });
  await client.verifyCode("tester@example.test", "123456");
  await Promise.all([client.request("/v1/me"), client.request("/v1/auth/sessions")]);
  assert.equal(refreshes, 1);
  assert.equal(attempts, 4);
});

test("failed refresh clears the session and notifies the UI", async (t) => {
  let signedOut = 0;
  const client = makeClient(t, {
    onSignedOut: () => { signedOut += 1; },
    fetchImpl: async (url) => url.endsWith("/otp/verify") ? json(session()) : unauthorized(),
  });
  await client.verifyCode("tester@example.test", "123456");
  await assert.rejects(client.request("/v1/me"), { status: 401 });
  assert.equal(client.signedIn, false);
  assert.equal(signedOut, 1);
});

test("a second protected 401 never loops refresh indefinitely", async (t) => {
  let refreshes = 0;
  const client = makeClient(t, {
    fetchImpl: async (url) => {
      if (url.endsWith("/otp/verify")) return json(session("old"));
      if (url.endsWith("/refresh")) { refreshes += 1; return json(session("new")); }
      return unauthorized();
    },
  });
  await client.verifyCode("tester@example.test", "123456");
  await assert.rejects(client.request("/v1/me"), { status: 401 });
  assert.equal(refreshes, 1);
  assert.equal(client.signedIn, false);
});

test("structured errors preserve codes, request IDs, validation fields and cooldowns", async (t) => {
  const client = makeClient(t, {
    fetchImpl: async () => json({ error: {
      code: "rate_limited", message: "Wait", requestId: "test-request",
      details: { retryAfterSeconds: 17, fields: [{ field: "email", message: "Invalid" }] },
    } }, 429),
  });
  await assert.rejects(client.requestCode("tester@example.test"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.retryAfter, 17);
    assert.equal(error.requestId, "test-request");
    assert.equal(error.fields[0].field, "email");
    return error.code === "rate_limited";
  });
});

test("Retry-After header takes precedence over body details", async (t) => {
  const client = makeClient(t, {
    fetchImpl: async () => json({ error: { message: "Wait", code: "rate_limited" } }, 429, { "Retry-After": "45" }),
  });
  await assert.rejects(client.requestCode("tester@example.test"), { retryAfter: 45 });
});

test("logout and current-session revocation accept empty 204 responses", async (t) => {
  const paths = [];
  const client = makeClient(t, {
    fetchImpl: async (url, options) => {
      paths.push([new URL(url).pathname, options.method]);
      return url.endsWith("/otp/verify") ? json(session()) : new Response(null, { status: 204 });
    },
  });
  await client.verifyCode("tester@example.test", "123456");
  await client.logout(true);
  assert.equal(client.signedIn, false);
  await client.verifyCode("tester@example.test", "123456");
  await client.revokeSession("current/id", true);
  assert.equal(client.signedIn, false);
  assert.ok(paths.some(([path, method]) => path === "/v1/auth/logout-all" && method === "POST"));
  assert.ok(paths.some(([path, method]) => path === "/v1/auth/sessions/current%2Fid" && method === "DELETE"));
});

test("a late refresh cannot resurrect a logged-out session", async (t) => {
  let finishRefresh;
  const client = makeClient(t, {
    fetchImpl: async (url) => {
      if (url.endsWith("/otp/verify")) return json(session());
      if (url.endsWith("/refresh")) return new Promise((resolve) => { finishRefresh = resolve; });
      return new Response(null, { status: 204 });
    },
  });
  await client.verifyCode("tester@example.test", "123456");
  const refreshing = client.refresh();
  await client.logout();
  finishRefresh(json(session("late")));
  await assert.rejects(refreshing, { code: "session_changed" });
  assert.equal(client.signedIn, false);
});

test("proactive refresh runs one minute before token expiry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let refreshes = 0;
  const client = makeClient(t, {
    fetchImpl: async (url) => {
      if (url.endsWith("/refresh")) refreshes += 1;
      return json(session());
    },
  });
  await client.verifyCode("tester@example.test", "123456");
  t.mock.timers.tick(1739000);
  assert.equal(refreshes, 0);
  t.mock.timers.tick(1000);
  await client.refresh();
  assert.equal(refreshes, 1);
});

test("invalid responses are errors instead of success-shaped defaults", async (t) => {
  const client = makeClient(t, { fetchImpl: async () => new Response("<html>error</html>", { status: 502 }) });
  await assert.rejects(client.requestCode("tester@example.test"), { code: "invalid_response", status: 502 });
});

test("an incomplete token response cannot create a signed-in session", async (t) => {
  const client = makeClient(t, { fetchImpl: async () => json({ user: session().user }) });
  await assert.rejects(client.verifyCode("tester@example.test", "123456"), { code: "invalid_response" });
  assert.equal(client.signedIn, false);
});

test("return paths preserve invite/device queries but reject external redirects", () => {
  assert.equal(safeReturnPath("/teams/join?token=sample"), "/teams/join?token=sample");
  assert.equal(safeReturnPath("/link?code=ABCD-EFGH"), "/link?code=ABCD-EFGH");
  for (const value of ["https://example.test", "//example.test", "/\\example.test", "/login", "javascript:alert(1)", null]) {
    assert.equal(safeReturnPath(value), "/dashboard/settings");
  }
});
