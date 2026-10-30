import { ApiError, safeReturnPath } from "./api.js";
import { escapeHtml as escape } from "./html.js";

const date = (value) => value ? new Date(value).toLocaleString() : "Not set";
const button = (action, label, extra = "", style = "secondary") =>
  `<button type="button" class="button button--${style}" data-account-action="${action}" ${extra}>${escape(label)}</button>`;
const link = (href, label) => `<a class="button button--secondary" href="${escape(href)}" data-link>${escape(label)}</a>`;
const panel = (title, body) => `<section class="panel account-panel"><h2>${escape(title)}</h2>${body}</section>`;
const field = (name, label, type = "text", extra = "") =>
  `<label for="account-${name}">${escape(label)}</label><input id="account-${name}" name="${name}" type="${type}" required ${extra} />`;
const heading = (title, text) => `<div class="page-heading"><div><div class="eyebrow">YOUR ACCOUNT</div><h1>${escape(title)}</h1><p>${escape(text)}</p></div></div>`;

export const accountPaths = new Set([
  "/login", "/dashboard/settings", "/account/billing", "/account/sessions",
  "/account/team", "/billing/return", "/link", "/teams/join",
]);

export function createAccountUI({ api, navigate, render }) {
  let account = null;
  let team = null;
  let plans = [];
  let interval = "month";
  let loginEmail = "";
  let retryAt = 0;
  let codeExpiresAt = 0;
  let cooldownTimer;
  let controller;
  let pollTimer;
  let linkDetails = null;
  let flash = "";

  function stop() {
    controller?.abort();
    clearTimeout(pollTimer);
    clearInterval(cooldownTimer);
  }

  function errorMessage(error) {
    let text = error.message;
    if (error.fields?.length) text += ` ${error.fields.map((item) => `${item.field}: ${item.message}`).join("; ")}`;
    if (error.retryAfter > 0) text += ` Try again in ${error.retryAfter} seconds.`;
    if (error.requestId) text += ` Reference: ${error.requestId}.`;
    return text;
  }

  function showError(error) {
    if (error.name === "AbortError") return;
    let region = document.querySelector("#account-message");
    if (!region) {
      region = document.createElement("div");
      region.id = "account-message";
      region.setAttribute("role", "alert");
      region.tabIndex = -1;
      document.querySelector("#app").prepend(region);
    }
    region.className = "account-message account-message--error";
    region.textContent = errorMessage(error);
    if (["no_seats_available", "already_subscribed"].includes(error.code)) {
      const anchor = document.createElement("a");
      anchor.href = "/account/billing";
      anchor.dataset.link = "";
      anchor.textContent = " Manage billing";
      region.append(anchor);
    }
    if (error.code === "invite_email_mismatch") {
      const change = document.createElement("button");
      change.type = "button";
      change.dataset.accountAction = "switch-account";
      change.className = "button button--secondary";
      change.textContent = "Sign in with the invited email";
      region.append(change);
    }
    region.focus();
  }

  function message() {
    const text = flash;
    flash = "";
    return `<div id="account-message" class="account-message" role="status" aria-live="polite" tabindex="-1">${escape(text)}</div>`;
  }

  function loginPage(params) {
    if (api.signedIn) return `${heading("Already signed in", api.user.email)}${link(safeReturnPath(params.get("next")), "Continue")}${button("switch-account", "Use a different email")}`;
    return `${heading("Sign in to Stack3", "Use the six-digit code sent to your email. No password required.")}${panel("Email login", `
      <form class="account-form" data-account-form="request-code">
        ${field("email", "Email address", "email", `autocomplete="email" maxlength="320" value="${escape(loginEmail)}"`)}
        <button class="button button--primary" type="submit" data-resend>Send login code</button>
      </form>
      ${loginEmail && codeExpiresAt ? `<form class="account-form" data-account-form="verify-code">
        <p>Code sent to <strong>${escape(loginEmail)}</strong>. Expires at ${escape(date(codeExpiresAt))}.</p>
        ${field("code", "Six-digit code", "text", 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6"')}
        <button class="button button--primary" type="submit">Verify and sign in</button>
      </form>` : ""}
      <p class="account-note">Your refresh token is stored in an HTTP-only cookie. Access tokens stay in memory, never browser storage.</p>`)}`;
  }

  function settingsPage(healthChecks) {
    const details = [
      ["Email", account.user.email], ["Plan", account.plan], ["Status", account.status],
      ["Trial ends", date(account.trialEndsAt)], ["Current period ends", date(account.currentPeriodEnd)],
      ["Cancels at period end", account.cancelAtPeriodEnd ? "Yes" : "No"],
      ["Team", account.team?.name ?? "No team"],
    ];
    return `${heading("Account settings", "Live account details and entitlements from Stack3.")}${panel("Your account", `
      <dl class="account-facts">${details.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>
      <div class="account-actions">${link("/account/billing", "Billing & subscription")}${link("/account/team", "Manage team")}${link("/account/sessions", "Signed-in devices")}${button("logout", "Sign out")}</div>`)}
      ${panel("Included features and limits", `<ul class="account-list">${account.features.map((feature) => `<li>${escape(feature)}${Object.hasOwn(account.limits, feature) ? `: ${escape(account.limits[feature])} / month` : ""}</li>`).join("")}</ul>
      ${Object.keys(account.limits).filter((code) => !account.features.includes(code)).map((code) => `<p>${escape(code)}: ${escape(account.limits[code])} / month</p>`).join("")}`)}
      ${panel("Backend status", healthChecks.map((check, index) => `<p><strong>${index === 0 ? "API process" : "Database and Redis readiness"}:</strong> ${check.status === "fulfilled" ? escape(check.value.status) : escape(errorMessage(check.reason))}${check.status === "fulfilled" && check.value.checks ? ` (${escape(Object.entries(check.value.checks).map(([name, status]) => `${name}: ${status}`).join(", "))})` : ""}</p>`).join(""))}
      ${panel("Scanning remains illustrative", "<p>Login, billing and teams use the live API. Website scans, contract reviews, transactions and reports still use demo fixtures; no scan API is connected.</p>")}`;
  }

  function pricingContent() {
    return `<section class="subpage-hero pricing-hero"><span class="eyebrow">PLANS & ACCESS</span><h1>Protection for every stage.</h1><p>Live plans and availability from Stack3. Trial eligibility is confirmed at checkout.</p></section>
      <section class="pricing-billing" aria-label="Billing interval"><span>Billing</span><div class="billing-switch">
      ${["month", "year"].map((value) => button("interval", value === "month" ? "Monthly" : "Yearly", `data-interval="${value}" aria-pressed="${interval === value}"`)).join("")}</div></section>
      <section class="pricing-grid">${plans.map((plan) => {
        const price = plan.prices.find((item) => item.interval === interval);
        const minimum = Math.max(plan.minSeats, price?.includedSeats ?? 1);
        const money = price ? new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).format(price.amountCents / 100) : null;
        return `<article class="pricing-card ${plan.code === "pro" ? "pricing-card--featured" : ""}">
          <span class="plan-kicker">${escape(plan.code.toUpperCase())}</span><h2>${escape(plan.name)}</h2>
          <div class="plan-price"><span class="price-amount">${escape(!plan.isPaid ? "$0" : money ?? "Unavailable")}</span>
          <span class="price-period">${plan.isPaid ? `${price?.perSeat ? "/ seat " : ""}/ ${escape(interval)}` : "Free"}</span>
          ${plan.isPaid && price?.perSeat ? `<span class="price-note">${minimum} seats minimum. ${price.includedSeats} seats included in the base bundle.</span>` : ""}
          ${plan.trialDays ? `<span class="price-note">${plan.trialDays}-day trial for eligible new subscribers</span>` : ""}</div>
          <ul class="plan-features">${plan.features.map((feature) => `<li><span class="check-icon" aria-hidden="true">+</span><span>${escape(feature.description)}${feature.monthlyLimit !== null ? ` (${escape(feature.monthlyLimit)} / month)` : ""}</span></li>`).join("")}</ul>
          ${!plan.isPaid ? link(api.signedIn ? "/dashboard/settings" : "/login", api.signedIn ? "Your account" : "Get started") : `<form class="account-form" data-account-form="checkout">
            <input type="hidden" name="plan" value="${escape(plan.code)}" />
            ${plan.code === "team" ? field("seats", "Team seats", "number", `min="${minimum}" max="500" step="1" value="${minimum}"`) : ""}
            <button type="submit" class="button button--primary button--full" ${price?.available ? "" : "disabled"}>${price?.available ? "Continue to checkout" : "Not available yet"}</button>
          </form>`}</article>`;
      }).join("")}</section>`;
  }

  function billingPage(data) {
    return `${heading("Billing & subscription", `Current plan: ${account.plan} · ${account.status}`)}
      ${panel("Manage billing", `<p>Use Dodo's customer portal to update payment details, cancel, or manage seats.</p><div class="account-actions">${button("portal", "Open billing portal", "", "primary")}${link("/pricing", "View plans")}</div>`)}
      ${panel("Subscriptions", data.subscriptions.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Plan</th><th>Status</th><th>Seats</th><th>Trial ends</th><th>Period ends</th><th>Cancellation</th></tr></thead><tbody>${data.subscriptions.map((sub) => `<tr><td>${escape(sub.plan)} / ${escape(sub.interval)}</td><td>${escape(sub.status)}</td><td>${sub.seats}</td><td>${escape(date(sub.trialEndsAt))}</td><td>${escape(date(sub.currentPeriodEnd))}</td><td>${sub.cancelAtPeriodEnd ? "At period end" : "Not scheduled"}</td></tr>`).join("")}</tbody></table></div>` : "<p>No billed subscriptions yet. Team access may be provided by your team's subscription.</p>")}`;
  }

  function sessionsPage(sessions) {
    return `${heading("Signed-in devices", "Review and revoke access to your account.")}${panel("Active sessions", `
      <ul class="account-list">${sessions.map((session) => `<li class="account-row"><div><strong>${escape(session.deviceName ?? session.client)}${session.current ? " (this device)" : ""}</strong><p>${escape(session.client)} · IP: ${escape(session.createdIp ?? "Unknown")}<br />Signed in: ${escape(date(session.createdAt))}<br />Last used: ${escape(date(session.lastUsedAt))}</p></div>
      ${button("revoke-session", session.current ? "Sign out" : "Revoke", `data-id="${escape(session.id)}" data-current="${session.current}"`)}</li>`).join("")}</ul>
      <div class="account-actions">${link("/link", "Review a device code")}${button("logout-all", "Sign out all devices")}</div>`)}`;
  }

  function teamPage() {
    if (!team) return `${heading("Your team", "Create a team before starting Team checkout.")}${panel("Create a team", `<form class="account-form" data-account-form="create-team">${field("name", "Team name", "text", 'maxlength="80"')}<button class="button button--primary" type="submit">Create team</button></form>`)}`;
    const manager = ["owner", "admin"].includes(team.myRole);
    return `${heading(team.name, `${team.myRole} · ${team.seatsUsed} seats used (members and pending invites) / ${team.seats ?? "no active subscription"} · ${team.subscriptionStatus ?? "not subscribed"}`)}
      ${panel("Team plan", `<div class="account-actions">${link("/pricing", "Start Team checkout")}${manager ? button("portal", "Manage seats in billing portal") : ""}${button("reload", "Refresh team")}</div>`)}
      ${panel("Members", `<ul class="account-list">${team.members.map((member) => {
        const self = member.userId === account.user.id;
        const removable = self ? member.role !== "owner" : manager && member.role !== "owner" && (member.role !== "admin" || team.myRole === "owner");
        return `<li class="account-row"><div><strong>${escape(member.email)}</strong><p>${escape(member.role)}${self ? " · you" : ""} · Joined ${escape(date(member.joinedAt))}</p></div>${removable ? button("remove-member", self ? "Leave team" : "Remove", `data-id="${escape(member.userId)}"`) : ""}</li>`;
      }).join("")}</ul>`)}
      ${manager ? panel("Invite a teammate", `<form class="account-form" data-account-form="invite">
        ${field("invite-email", "Email address", "email", 'maxlength="320"')}
        <label for="invite-role">Role</label><select id="invite-role" name="role"><option value="member">Member</option><option value="admin">Admin</option></select>
        <button type="submit" class="button button--primary">Send invite</button>
        <p class="account-note">An active Team plan and an available seat are required.</p></form>`) : ""}
      ${manager ? panel("Pending invitations", team.invites.length ? `<ul class="account-list">${team.invites.map((invite) => `<li class="account-row"><div><strong>${escape(invite.email)}</strong><p>${escape(invite.role)} · Expires ${escape(date(invite.expiresAt))}</p></div>${button("revoke-invite", "Cancel invite", `data-id="${escape(invite.id)}"`)}</li>`).join("")}</ul>` : "<p>No pending invitations.</p>") : ""}`;
  }

  function joinPage(params) {
    const token = params.get("token");
    return `${heading("Join a team", "Sign in with the email address that received the invitation.")}${panel("Accept invitation", token && token.length >= 20 && token.length <= 200
      ? `<p>Signed in as <strong>${escape(account.user.email)}</strong>. Accept this invitation only if you recognize the team invitation email.</p>${button("accept-invite", "Accept invitation", "", "primary")}${button("switch-account", "Use a different email")}`
      : "<p>This invite link is missing a valid token. Open the complete link from your invitation email.</p>")}`;
  }

  function devicePage(params) {
    return `${heading("Link a device", "Only approve a request you initiated in your own extension or CLI.")}${panel("Device code", `<form class="account-form" data-account-form="link-code">${field("userCode", "Device code", "text", `pattern="[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}" maxlength="9" value="${escape(params.get("code") ?? "")}"`)}<button type="submit" class="button button--primary">Review device</button></form>`)}
      ${linkDetails ? panel("Device requesting access", `<dl class="account-facts">${[
        ["Code", linkDetails.userCode], ["Client", linkDetails.client], ["Device", linkDetails.deviceName ?? "Not provided"],
        ["IP address", linkDetails.requestedIp ?? "Unknown"], ["Requested", date(linkDetails.createdAt)],
        ["Expires", date(linkDetails.expiresAt)], ["Status", linkDetails.status],
      ].map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>
      ${linkDetails.status === "pending" && Date.parse(linkDetails.expiresAt) > Date.now() ? `<div class="account-actions">${button("approve-device", "Approve device", "", "primary")}${button("deny-device", "Deny")}</div>` : "<p>This request is no longer awaiting approval.</p>"}`) : ""}`;
  }

  async function load(path, params, signal) {
    if (path === "/login") return loginPage(params);
    if (path === "/pricing") {
      plans = await api.request("/v1/billing/plans", { authenticated: false, signal });
      if (!plans.length) throw new ApiError("No plans are currently published.", { code: "empty_catalog" });
      return pricingContent();
    }
    if (path === "/billing/return") await api.refresh();
    account = await api.request("/v1/me", { signal });
    if (path === "/dashboard/settings") {
      const checks = await Promise.allSettled([
        api.request("/health", { authenticated: false, signal }),
        api.request("/health/ready", { authenticated: false, signal }),
      ]);
      return settingsPage(checks);
    }
    if (path === "/account/billing") return billingPage(await api.request("/v1/billing/subscription", { signal }));
    if (path === "/account/sessions") return sessionsPage(await api.request("/v1/auth/sessions", { signal }));
    if (path === "/account/team") {
      try {
        team = await api.request("/v1/teams/me", { signal });
      } catch (error) {
        if (error.code !== "team_not_found") throw error;
        team = null;
      }
      return teamPage();
    }
    if (path === "/teams/join") return joinPage(params);
    if (path === "/link") {
      linkDetails = null;
      if (params.get("code")) linkDetails = await api.request(`/v1/auth/link/requests/${encodeURIComponent(params.get("code"))}`, { signal });
      return devicePage(params);
    }
    if (path === "/billing/return") {
      return `${heading("Checking your subscription", "Payment confirmation comes from the billing webhook, not the redirect.")}${panel("Subscription status", `<p id="billing-return-status" role="status">${escape(account.plan)} · ${escape(account.status)}${account.plan === "free" ? " — Waiting for confirmation…" : " — Account updated."}</p>${link("/account/billing", "View billing")}${button("reload", "Check again")}`)}`;
    }
    throw new ApiError("Account page not found.", { code: "not_found" });
  }

  function startBillingPoll(signal) {
    const deadline = Date.now() + 20000;
    const poll = async () => {
      try {
        account = await api.request("/v1/me", { signal });
        if (signal.aborted) return;
        const region = document.querySelector("#billing-return-status");
        if (!region) return;
        if (account.plan !== "free") {
          region.textContent = `${account.plan} · ${account.status} — Account updated.`;
        } else if (Date.now() >= deadline) {
          region.textContent = "Confirmation is still pending. No paid plan has been activated yet. Check again shortly or contact support if payment completed.";
        } else {
          pollTimer = setTimeout(poll, 2000);
        }
      } catch (error) {
        if (!signal.aborted) showError(error);
      }
    };
    pollTimer = setTimeout(poll, 2000);
  }

  function startCooldown() {
    clearInterval(cooldownTimer);
    const update = () => {
      const resend = document.querySelector("[data-resend]");
      if (!resend) return;
      const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      resend.disabled = seconds > 0 || resend.getAttribute("aria-busy") === "true";
      resend.textContent = seconds > 0 ? `Resend in ${seconds}s` : loginEmail ? "Send / resend code" : "Send login code";
    };
    update();
    cooldownTimer = setInterval(update, 1000);
  }

  function externalRedirect(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new ApiError("The billing provider returned an invalid redirect URL.", { code: "invalid_response" });
    }
    if (url.protocol !== "https:") throw new ApiError("The billing provider returned an unsafe redirect URL.", { code: "invalid_response" });
    window.location.assign(url.href);
  }

  async function action(name, element) {
    const id = encodeURIComponent(element.dataset.id ?? "");
    if (name === "interval") {
      interval = element.dataset.interval;
      await render();
    } else if (name === "reload") {
      await render();
    } else if (["logout", "logout-all", "switch-account"].includes(name)) {
      if (name === "logout-all" && !window.confirm("Sign out every device, including this one?")) return;
      const next = `${location.pathname}${location.search}`;
      await api.logout(name === "logout-all");
      account = null;
      loginEmail = "";
      codeExpiresAt = 0;
      navigate(name === "switch-account" ? `/login?next=${encodeURIComponent(safeReturnPath(next))}` : "/login");
    } else if (name === "portal") {
      externalRedirect((await api.request("/v1/billing/portal", { method: "POST" })).url);
    } else if (name === "revoke-session") {
      await api.revokeSession(element.dataset.id, element.dataset.current === "true");
      if (!api.signedIn) navigate("/login");
      else { flash = "Session revoked."; await render(); }
    } else if (name === "remove-member") {
      if (!window.confirm("Remove this member from the team? This may remove your own team access.")) return;
      await api.request(`/v1/teams/${encodeURIComponent(team.id)}/members/${id}`, { method: "DELETE" });
      flash = "Team membership removed.";
      await render();
    } else if (name === "revoke-invite") {
      await api.request(`/v1/teams/${encodeURIComponent(team.id)}/invites/${id}`, { method: "DELETE" });
      flash = "Invitation cancelled.";
      await render();
    } else if (name === "accept-invite") {
      await api.request("/v1/teams/invites/accept", { method: "POST", body: { token: new URLSearchParams(location.search).get("token") } });
      flash = "Invitation accepted.";
      navigate("/account/team", true);
    } else if (["approve-device", "deny-device"].includes(name)) {
      if (!linkDetails || linkDetails.status !== "pending" || Date.parse(linkDetails.expiresAt) <= Date.now()) {
        throw new ApiError("This device request has expired. Request a new code in your extension.", { code: "expired_code" });
      }
      const details = await api.request("/v1/auth/link/approve", {
        method: "POST", body: { userCode: linkDetails.userCode, approve: name === "approve-device" },
      });
      flash = `Device request ${details.status}.`;
      await render();
    }
  }

  async function submit(name, form) {
    const data = new FormData(form);
    if (name === "request-code") {
      if (Date.now() < retryAt) throw new ApiError("Wait before requesting another code.", { code: "rate_limited", retryAfter: Math.ceil((retryAt - Date.now()) / 1000) });
      const email = String(data.get("email")).trim().toLowerCase();
      const result = await api.requestCode(email);
      loginEmail = email;
      retryAt = Date.now() + result.retryAfterSeconds * 1000;
      codeExpiresAt = Date.now() + result.expiresInSeconds * 1000;
      flash = "Check your email for the login code.";
      await render();
      document.querySelector('[name="code"]')?.focus();
    } else if (name === "verify-code") {
      if (Date.now() >= codeExpiresAt) throw new ApiError("Your code has expired. Request a new code.", { code: "invalid_code" });
      await api.verifyCode(loginEmail, String(data.get("code")));
      loginEmail = "";
      codeExpiresAt = 0;
      navigate(safeReturnPath(new URLSearchParams(location.search).get("next")), true);
    } else if (name === "checkout") {
      if (!api.signedIn) {
        navigate(`/login?next=${encodeURIComponent("/pricing")}`);
        return;
      }
      const plan = String(data.get("plan"));
      const body = { plan, interval };
      if (plan === "team") {
        try {
          team = await api.request("/v1/teams/me");
        } catch (error) {
          if (error.code !== "team_not_found") throw error;
          flash = "Create a team first, then return to pricing to choose seats.";
          navigate("/account/team");
          return;
        }
        body.teamId = team.id;
        body.seats = Number(data.get("seats"));
      }
      externalRedirect((await api.request("/v1/billing/checkout", { method: "POST", body })).checkoutUrl);
    } else if (name === "create-team") {
      const nameValue = String(data.get("name")).trim();
      if (!nameValue) throw new ApiError("Enter a team name.", { code: "validation_error" });
      await api.request("/v1/teams", { method: "POST", body: { name: nameValue } });
      flash = "Team created. Choose the Team plan to activate seats.";
      await render();
    } else if (name === "invite") {
      await api.request(`/v1/teams/${encodeURIComponent(team.id)}/invites`, {
        method: "POST", body: { email: String(data.get("invite-email")).trim(), role: String(data.get("role")) },
      });
      flash = "Invitation sent.";
      await render();
    } else if (name === "link-code") {
      const code = String(data.get("userCode")).trim().toUpperCase();
      navigate(`/link?code=${encodeURIComponent(code)}`);
    }
  }

  async function run(element, operation) {
    if (element.disabled) return;
    element.disabled = true;
    element.setAttribute("aria-busy", "true");
    const region = document.querySelector("#account-message");
    if (region) region.textContent = "";
    try {
      await operation();
    } catch (error) {
      if (error.status === 429 && location.pathname === "/login" && error.retryAfter > 0) {
        retryAt = Date.now() + error.retryAfter * 1000;
        startCooldown();
      }
      showError(error);
    } finally {
      element.disabled = false;
      element.removeAttribute("aria-busy");
      if (element.matches("[data-resend]") && Date.now() < retryAt) element.disabled = true;
    }
  }

  return {
    get account() { return account; },
    stop,
    showError,
    async page(path, params) {
      stop();
      controller = new AbortController();
      const signal = controller.signal;
      const body = await load(path, params, signal);
      signal.throwIfAborted();
      return `<div class="account-content">${message()}${body}</div>`;
    },
    mount(path) {
      if (path === "/login") startCooldown();
      if (path === "/billing/return" && account?.plan === "free") startBillingPoll(controller.signal);
    },
    bind(root) {
      root.addEventListener("click", (event) => {
        const element = event.target instanceof Element ? event.target.closest("[data-account-action]") : null;
        if (element) void run(element, () => action(element.dataset.accountAction, element));
      });
      root.addEventListener("submit", (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.dataset.accountForm) return;
        event.preventDefault();
        if (!form.reportValidity()) return;
        void run(form.querySelector('[type="submit"]'), () => submit(form.dataset.accountForm, form));
      });
    },
  };
}
