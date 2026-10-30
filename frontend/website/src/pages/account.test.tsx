import { afterEach, expect, test, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../lib/api";
import { makeApi, me, renderPage, type FakeRequest } from "../test/helpers";
import { SettingsPage } from "./SettingsPage";
import { PricingPage } from "./PricingPage";
import { TeamPage } from "./TeamPage";
import { LinkDevicePage } from "./LinkDevicePage";
import { TeamsJoinPage } from "./TeamsJoinPage";
import { BillingReturnPage } from "./BillingReturnPage";
import { LoginPage } from "./LoginPage";

afterEach(() => {
  vi.useRealTimers();
});

test("settings render live entitlements and escape API text", async () => {
  const request: FakeRequest = async (path) =>
    path.startsWith("/health")
      ? { status: "ok", checks: { database: "ok", redis: "ok" } }
      : { ...me, user: { ...me.user, email: '<script>alert("x")</script>' } };
  const { container } = renderPage("/dashboard/settings", <SettingsPage />, makeApi(request), "/dashboard/settings");
  await screen.findByText("Account settings");
  expect(container.textContent).toContain("repo_scan: 20 / month");
  expect(container.textContent).toContain('<script>alert("x")</script>');
  expect(container.querySelector("script")).toBeNull();
  expect(container.textContent).toContain("Scanning remains illustrative");
  expect(container.textContent).toContain("database: ok, redis: ok");
});

test("pricing uses catalog prices, availability, trial days and minimum seats", async () => {
  const request: FakeRequest = async (path, options) => {
    expect(path).toBe("/v1/billing/plans");
    expect(options?.authenticated).toBe(false);
    return [{
      code: "team", name: "Team", isPaid: true, minSeats: 3, trialDays: 14,
      features: [{ code: "repo", description: "Live team feature", monthlyLimit: null }],
      prices: [{ interval: "month", currency: "USD", amountCents: 3200, perSeat: true, includedSeats: 3, available: false }],
    }];
  };
  const { container } = renderPage("/pricing", <PricingPage />, makeApi(request), "/pricing");
  await screen.findByText("$32.00");
  expect(container.textContent).toContain("14-day trial");
  const seats = container.querySelector('input[name="seats"]') as HTMLInputElement;
  expect(seats.min).toBe("3");
  expect(seats.max).toBe("500");
  expect(seats.value).toBe("3");
  const checkout = screen.getByText("Not available yet") as HTMLButtonElement;
  expect(checkout.disabled).toBe(true);
  expect(container.textContent).toContain("Live team feature");
  expect(container.textContent).not.toContain("Team details coming soon");
});

test("no-team is handled only for the explicit team_not_found contract", async () => {
  let failure: ApiError = new ApiError("You are not in a team", { code: "team_not_found", status: 404 });
  const request: FakeRequest = async (path) => {
    if (path === "/v1/me") return me;
    throw failure;
  };
  const api = makeApi(request);
  const first = renderPage("/account/team", <TeamPage />, api, "/account/team");
  await screen.findByText("Create a team");
  first.unmount();

  failure = new ApiError("Database unavailable", { status: 503 });
  renderPage("/account/team", <TeamPage />, api, "/account/team");
  await screen.findByText(/Database unavailable/);
  expect(screen.queryByText("Create a team")).toBeNull();
});

test("members cannot invite or remove other members or leave as the owner", async () => {
  const data = {
    id: "team-1", name: "Example", myRole: "member", seatsUsed: 3, seats: 3, subscriptionStatus: "active",
    members: [
      { userId: "user-1", email: me.user.email, role: "member" },
      { userId: "owner", email: "owner@example.test", role: "owner" },
    ],
    invites: [],
  };
  const api = makeApi(async (path) => (path === "/v1/me" ? me : data));
  const first = renderPage("/account/team", <TeamPage />, api, "/account/team");
  await screen.findByText("Example");
  expect(screen.getByText("Leave team")).toBeInTheDocument();
  expect(screen.queryByText("Send invite")).toBeNull();
  expect(screen.queryByText("Remove")).toBeNull();
  first.unmount();

  data.myRole = "owner";
  data.members[0].role = "owner";
  renderPage("/account/team", <TeamPage />, api, "/account/team");
  await screen.findByText("Example");
  expect(screen.queryByText("Leave team")).toBeNull();
  expect(screen.getByText("Send invite")).toBeInTheDocument();
});

test("device approval displays identifying details and suppresses expired approval", async () => {
  const data = {
    userCode: "ABCD-EFGH", client: "chrome", deviceName: "<untrusted>",
    requestedIp: "192.0.2.1", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(), status: "pending",
  };
  const api = makeApi(async (path) => (path === "/v1/me" ? me : data));
  const first = renderPage("/link", <LinkDevicePage />, api, "/link?code=ABCD-EFGH");
  await screen.findByText("192.0.2.1");
  expect(screen.getByText("<untrusted>")).toBeInTheDocument();
  expect(screen.getByText("Approve device")).toBeInTheDocument();
  first.unmount();

  data.expiresAt = new Date(Date.now() - 1).toISOString();
  renderPage("/link", <LinkDevicePage />, api, "/link?code=ABCD-EFGH");
  await screen.findByText("192.0.2.1");
  expect(screen.queryByText("Approve device")).toBeNull();
  expect(screen.getByText("This request is no longer awaiting approval.")).toBeInTheDocument();
});

test("invite acceptance requires a complete token and displays the current email", async () => {
  const api = makeApi(async () => me);
  const first = renderPage("/teams/join", <TeamsJoinPage />, api, "/teams/join?token=short");
  await screen.findByText("Join a team");
  expect(screen.queryByRole("button", { name: "Accept invitation" })).toBeNull();
  first.unmount();

  renderPage("/teams/join", <TeamsJoinPage />, api, "/teams/join?token=abcdefghijklmnopqrst");
  await screen.findByRole("button", { name: "Accept invitation" });
  expect(screen.getByText("tester@example.test")).toBeInTheDocument();
});

test("billing return refreshes credentials before re-reading entitlements", async () => {
  const calls: string[] = [];
  const api = makeApi(
    async (path) => { calls.push(path); return me; },
    { refresh: async () => { calls.push("refresh"); return { accessToken: "token", user: me.user, expiresIn: 1800 }; } },
  );
  const { container } = renderPage("/billing/return", <BillingReturnPage />, api, "/billing/return");
  await screen.findByText(/Waiting for confirmation/);
  expect(calls.slice(0, 2)).toEqual(["refresh", "/v1/me"]);
  expect(container.textContent).not.toContain("Payment successful");
});

test("billing polling stops at 20 seconds without claiming activation", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let requests = 0;
  const api = makeApi(
    async () => { requests += 1; return me; },
    { refresh: async () => ({ accessToken: "token", user: me.user, expiresIn: 1800 }) },
  );
  renderPage("/billing/return", <BillingReturnPage />, api, "/billing/return");
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(requests).toBe(1);
  for (let seconds = 2; seconds <= 20; seconds += 2) {
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  }
  expect(requests).toBe(11);
  expect(screen.getByText(/No paid plan has been activated yet/)).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(requests).toBe(11);
});

test("navigating away cancels pending billing polls", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let requests = 0;
  const api = makeApi(
    async () => { requests += 1; return me; },
    { refresh: async () => ({ accessToken: "token", user: me.user, expiresIn: 1800 }) },
  );
  const page = renderPage("/billing/return", <BillingReturnPage />, api, "/billing/return");
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  page.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(requests).toBe(1);
});

test("a failed readiness check is explicitly displayed without hiding the account", async () => {
  const api = makeApi(async (path) => {
    if (path === "/health/ready") throw new ApiError("Database is unavailable", { status: 503 });
    return path === "/health" ? { status: "ok" } : me;
  });
  const { container } = renderPage("/dashboard/settings", <SettingsPage />, api, "/dashboard/settings");
  await screen.findByText("Account settings");
  expect(container.textContent).toContain("tester@example.test");
  expect(container.textContent).toContain("Database is unavailable");
});

test("a rate-limited code request starts a visible resend cooldown", async () => {
  const user = userEvent.setup();
  const api = makeApi(async () => me, {
    signedIn: false,
    user: null,
    requestCode: async () => {
      throw new ApiError("Too many requests", { status: 429, code: "rate_limited", retryAfter: 30 });
    },
  });
  renderPage("/login", <LoginPage />, api, "/login");
  await user.type(screen.getByLabelText("Email address"), "tester@example.test");
  await user.click(screen.getByText("Send login code"));
  await waitFor(() => {
    const resend = screen.getByRole("button", { name: /Resend in \d+s/ }) as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
  });
  expect(screen.getByRole("alert").textContent).toContain("Too many requests");
});
