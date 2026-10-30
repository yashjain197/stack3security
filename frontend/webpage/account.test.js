import assert from "node:assert/strict";
import test from "node:test";
import { createAccountUI } from "./account.js";
import { ApiError } from "./api.js";

const me = {
  user: { id: "user-1", email: "tester@example.test" }, plan: "free", status: "active",
  features: ["repo_scan"], limits: { repo_scan: 20 }, team: null, trialEndsAt: null,
  currentPeriodEnd: null, cancelAtPeriodEnd: false,
};
const makeUI = (request, overrides = {}) => createAccountUI({
  api: { request, user: me.user, signedIn: true, ...overrides },
  navigate: () => {}, render: async () => {},
});

test("settings render live entitlements and escape API text", async () => {
  const ui = makeUI(async (path) => path.startsWith("/health")
    ? { status: "ok", checks: { database: "ok", redis: "ok" } }
    : { ...me, user: { ...me.user, email: '<script>alert("x")</script>' } });
  const html = await ui.page("/dashboard/settings", new URLSearchParams());
  assert.match(html, /repo_scan: 20 \/ month/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Scanning remains illustrative/);
  assert.match(html, /database: ok, redis: ok/);
});

test("pricing uses catalog prices, availability, trial days and minimum seats", async () => {
  const ui = makeUI(async (path, options) => {
    assert.equal(path, "/v1/billing/plans");
    assert.equal(options.authenticated, false);
    return [{
      code: "team", name: "Team", isPaid: true, minSeats: 3, trialDays: 14,
      features: [{ code: "repo", description: "Live team feature", monthlyLimit: null }],
      prices: [{ interval: "month", currency: "USD", amountCents: 3200, perSeat: true, includedSeats: 3, available: false }],
    }];
  });
  const html = await ui.page("/pricing", new URLSearchParams());
  assert.match(html, /\$32\.00/);
  assert.match(html, /14-day trial/);
  assert.match(html, /min="3" max="500"/);
  assert.match(html, /disabled>Not available yet/);
  assert.match(html, /Live team feature/);
  assert.doesNotMatch(html, /Team details coming soon/);
});

test("no-team is handled only for the explicit team_not_found contract", async () => {
  let failure = new ApiError("You are not in a team", { code: "team_not_found", status: 404 });
  const ui = makeUI(async (path) => {
    if (path === "/v1/me") return me;
    throw failure;
  });
  assert.match(await ui.page("/account/team", new URLSearchParams()), /Create a team/);
  failure = new ApiError("Database unavailable", { status: 503 });
  await assert.rejects(ui.page("/account/team", new URLSearchParams()), { status: 503 });
});

test("members cannot invite or remove other members or leave as the owner", async () => {
  const data = {
    id: "team-1", name: "Example", myRole: "member", seatsUsed: 3, seats: 3, subscriptionStatus: "active",
    members: [
      { userId: "user-1", email: me.user.email, role: "member" },
      { userId: "owner", email: "owner@example.test", role: "owner" },
    ], invites: [],
  };
  const ui = makeUI(async (path) => path === "/v1/me" ? me : data);
  let html = await ui.page("/account/team", new URLSearchParams());
  assert.match(html, /Leave team/);
  assert.doesNotMatch(html, /Send invite|>Remove</);
  data.myRole = "owner";
  data.members[0].role = "owner";
  html = await ui.page("/account/team", new URLSearchParams());
  assert.doesNotMatch(html, /Leave team/);
  assert.match(html, /Send invite/);
});

test("device approval displays identifying details and suppresses expired approval", async () => {
  const data = {
    userCode: "ABCD-EFGH", client: "chrome", deviceName: "<untrusted>",
    requestedIp: "192.0.2.1", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(), status: "pending",
  };
  const ui = makeUI(async (path) => path === "/v1/me" ? me : data);
  let html = await ui.page("/link", new URLSearchParams("code=ABCD-EFGH"));
  assert.match(html, /192\.0\.2\.1/);
  assert.match(html, /&lt;untrusted&gt;/);
  assert.match(html, /Approve device/);
  data.expiresAt = new Date(Date.now() - 1).toISOString();
  html = await ui.page("/link", new URLSearchParams("code=ABCD-EFGH"));
  assert.doesNotMatch(html, /data-account-action="approve-device"/);
});

test("invite acceptance requires a complete token and displays the current email", async () => {
  const ui = makeUI(async () => me);
  assert.doesNotMatch(await ui.page("/teams/join", new URLSearchParams("token=short")), /data-account-action="accept-invite"/);
  const html = await ui.page("/teams/join", new URLSearchParams("token=abcdefghijklmnopqrst"));
  assert.match(html, /tester@example\.test/);
  assert.match(html, /data-account-action="accept-invite"/);
});

test("billing return refreshes credentials before re-reading entitlements", async () => {
  const calls = [];
  const ui = makeUI(async (path) => { calls.push(path); return me; }, {
    refresh: async () => { calls.push("refresh"); },
  });
  const html = await ui.page("/billing/return", new URLSearchParams());
  assert.deepEqual(calls, ["refresh", "/v1/me"]);
  assert.match(html, /Waiting for confirmation/);
  assert.doesNotMatch(html, /Payment successful/);
});

test("billing polling stops at 20 seconds without claiming activation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let requests = 0;
  const region = { textContent: "" };
  globalThis.document = { querySelector: () => region };
  t.after(() => { delete globalThis.document; });
  const ui = makeUI(async () => { requests += 1; return me; }, { refresh: async () => {} });
  t.after(() => ui.stop());
  await ui.page("/billing/return", new URLSearchParams());
  ui.mount("/billing/return");
  for (let seconds = 2; seconds <= 20; seconds += 2) {
    t.mock.timers.tick(2000);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(requests, 11);
  assert.match(region.textContent, /No paid plan has been activated yet/);
  t.mock.timers.tick(10000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 11);
});

test("navigating away cancels pending billing polls", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let requests = 0;
  const ui = makeUI(async () => { requests += 1; return me; }, { refresh: async () => {} });
  await ui.page("/billing/return", new URLSearchParams());
  ui.mount("/billing/return");
  ui.stop();
  t.mock.timers.tick(10000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
});

test("a failed readiness check is explicitly displayed without hiding the account", async () => {
  const ui = makeUI(async (path) => {
    if (path === "/health/ready") throw new ApiError("Database is unavailable", { status: 503 });
    return path === "/health" ? { status: "ok" } : me;
  });
  const html = await ui.page("/dashboard/settings", new URLSearchParams());
  assert.match(html, /tester@example\.test/);
  assert.match(html, /Database is unavailable/);
});

test("the resend timer cannot re-enable an in-flight OTP request", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  let busy = true;
  const resend = { disabled: true, getAttribute: () => busy ? "true" : null };
  globalThis.document = { querySelector: () => resend };
  t.after(() => { delete globalThis.document; });
  const ui = makeUI(async () => {}, { signedIn: false });
  t.after(() => ui.stop());
  await ui.page("/login", new URLSearchParams());
  ui.mount("/login");
  t.mock.timers.tick(1000);
  assert.equal(resend.disabled, true);
  busy = false;
  t.mock.timers.tick(1000);
  assert.equal(resend.disabled, false);
});
