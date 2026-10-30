import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { errorMessage, formatDateTime, useApi } from "../lib/session";
import type { Account, HealthCheck } from "../types";
import {
  AccountErrorView,
  AccountHeading,
  AccountLoading,
  AccountMessage,
  Panel,
  useAccountActions,
  useAccountData,
} from "../components/account";

type SettingsData = {
  account: Account;
  healthChecks: PromiseSettledResult<HealthCheck>[];
};

export function SettingsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { state, reload } = useAccountData<SettingsData>(async (signal) => {
    const account = await api.request<Account>("/v1/me", { signal });
    const healthChecks = await Promise.allSettled([
      api.request<HealthCheck>("/health", { authenticated: false, signal }),
      api.request<HealthCheck>("/health/ready", { authenticated: false, signal }),
    ]);
    return { account, healthChecks };
  });
  const { error, busy, run } = useAccountActions();

  if (state.status === "loading") return <AccountLoading />;
  if (state.status === "error") return <AccountErrorView error={state.error} onRetry={reload} />;

  const { account, healthChecks } = state.data;
  const details: [string, string][] = [
    ["Email", account.user.email],
    ["Plan", account.plan],
    ["Status", account.status],
    ["Trial ends", formatDateTime(account.trialEndsAt)],
    ["Current period ends", formatDateTime(account.currentPeriodEnd)],
    ["Cancels at period end", account.cancelAtPeriodEnd ? "Yes" : "No"],
    ["Team", account.team?.name ?? "No team"],
  ];
  const extraLimits = Object.keys(account.limits).filter((code) => !account.features.includes(code));

  return (
    <div className="account-content">
      <AccountMessage error={error} />
      <AccountHeading title="Account settings" text="Live account details and entitlements from Stack3." />
      <Panel title="Your account">
        <dl className="account-facts">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="account-actions">
          <Link className="button button--secondary" to="/account/billing">Billing &amp; subscription</Link>
          <Link className="button button--secondary" to="/account/team">Manage team</Link>
          <Link className="button button--secondary" to="/account/sessions">Signed-in devices</Link>
          <button
            type="button"
            className="button button--secondary"
            disabled={busy === "logout"}
            onClick={() => void run("logout", async () => {
              await api.logout();
              navigate("/login");
            })}
          >
            Sign out
          </button>
        </div>
      </Panel>
      <Panel title="Included features and limits">
        <ul className="account-list">
          {account.features.map((feature) => (
            <li key={feature}>
              {feature}
              {Object.hasOwn(account.limits, feature) ? `: ${account.limits[feature]} / month` : ""}
            </li>
          ))}
        </ul>
        {extraLimits.map((limit) => (
          <p key={limit}>{limit}: {account.limits[limit]} / month</p>
        ))}
      </Panel>
      <Panel title="Backend status">
        {healthChecks.map((check, index) => (
          <p key={index}>
            <strong>{index === 0 ? "API process" : "Database and Redis readiness"}:</strong>{" "}
            {check.status === "fulfilled" ? check.value.status : errorMessage(check.reason)}
            {check.status === "fulfilled" && check.value.checks
              ? ` (${Object.entries(check.value.checks).map(([name, status]) => `${name}: ${status}`).join(", ")})`
              : ""}
          </p>
        ))}
      </Panel>
      <Panel title="Scanning remains illustrative">
        <p>
          Login, billing and teams use the live API. Website scans, contract reviews, transactions and reports
          still use demo fixtures; no scan API is connected.
        </p>
      </Panel>
    </div>
  );
}
