import { Link } from "react-router-dom";
import { externalRedirect, formatDateTime, useApi } from "../lib/session";
import type { Account, Subscription } from "../types";
import {
  AccountErrorView,
  AccountHeading,
  AccountLoading,
  AccountMessage,
  Panel,
  useAccountActions,
  useAccountData,
} from "../components/account";

type BillingData = {
  account: Account;
  subscriptions: Subscription[];
};

export function BillingPage() {
  const api = useApi();
  const { state, reload } = useAccountData<BillingData>(async (signal) => {
    const account = await api.request<Account>("/v1/me", { signal });
    const data = await api.request<{ subscriptions: Subscription[] }>("/v1/billing/subscription", { signal });
    return { account, subscriptions: data.subscriptions };
  });
  const { error, busy, run } = useAccountActions();

  if (state.status === "loading") return <AccountLoading />;
  if (state.status === "error") return <AccountErrorView error={state.error} onRetry={reload} />;

  const { account, subscriptions } = state.data;

  return (
    <div className="account-content">
      <AccountMessage error={error} />
      <AccountHeading title="Billing & subscription" text={`Current plan: ${account.plan} · ${account.status}`} />
      <Panel title="Manage billing">
        <p>Use Dodo's customer portal to update payment details, cancel, or manage seats.</p>
        <div className="account-actions">
          <button
            type="button"
            className="button button--primary"
            disabled={busy === "portal"}
            onClick={() => void run("portal", async () => {
              externalRedirect((await api.request<{ url: string }>("/v1/billing/portal", { method: "POST" })).url);
            })}
          >
            Open billing portal
          </button>
          <Link className="button button--secondary" to="/pricing">View plans</Link>
        </div>
      </Panel>
      <Panel title="Subscriptions">
        {subscriptions.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Seats</th>
                  <th>Trial ends</th>
                  <th>Period ends</th>
                  <th>Cancellation</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub, index) => (
                  <tr key={index}>
                    <td>{sub.plan} / {sub.interval}</td>
                    <td>{sub.status}</td>
                    <td>{sub.seats}</td>
                    <td>{formatDateTime(sub.trialEndsAt)}</td>
                    <td>{formatDateTime(sub.currentPeriodEnd)}</td>
                    <td>{sub.cancelAtPeriodEnd ? "At period end" : "Not scheduled"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No billed subscriptions yet. Team access may be provided by your team's subscription.</p>
        )}
      </Panel>
    </div>
  );
}
