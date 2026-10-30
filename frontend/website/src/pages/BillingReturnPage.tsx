import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/session";
import type { Account } from "../types";
import {
  AccountErrorView,
  AccountHeading,
  AccountLoading,
  AccountMessage,
  Panel,
  useAccountActions,
  useAccountData,
} from "../components/account";

const POLL_WINDOW_MS = 20000;
const POLL_INTERVAL_MS = 2000;

export function BillingReturnPage() {
  const api = useApi();
  const { state, reload } = useAccountData<Account>(async (signal) => {
    await api.refresh();
    return api.request<Account>("/v1/me", { signal });
  });
  const { error } = useAccountActions();
  const [polled, setPolled] = useState<Account | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [pollFailure, setPollFailure] = useState<Error | null>(null);

  const account = polled ?? (state.status === "ready" ? state.data : null);
  const shouldPoll = state.status === "ready" && state.data.plan === "free" && !timedOut;

  useEffect(() => {
    if (!shouldPoll) return;
    const controller = new AbortController();
    const deadline = Date.now() + POLL_WINDOW_MS;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const latest = await api.request<Account>("/v1/me", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (latest.plan !== "free") {
          setPolled(latest);
        } else if (Date.now() >= deadline) {
          setTimedOut(true);
        } else {
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch (caught) {
        if (!controller.signal.aborted) setPollFailure(caught as Error);
      }
    };
    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, shouldPoll]);

  if (state.status === "loading") return <AccountLoading />;
  if (state.status === "error") return <AccountErrorView error={state.error} onRetry={reload} />;
  if (!account) return <AccountLoading />;

  const statusText = account.plan !== "free"
    ? `${account.plan} · ${account.status} — Account updated.`
    : timedOut
      ? "Confirmation is still pending. No paid plan has been activated yet. Check again shortly or contact support if payment completed."
      : `${account.plan} · ${account.status} — Waiting for confirmation…`;

  return (
    <div className="account-content">
      <AccountMessage error={error ?? pollFailure} />
      <AccountHeading
        title="Checking your subscription"
        text="Payment confirmation comes from the billing webhook, not the redirect."
      />
      <Panel title="Subscription status">
        <p id="billing-return-status" role="status">{statusText}</p>
        <Link className="button button--secondary" to="/account/billing">View billing</Link>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            setPolled(null);
            setTimedOut(false);
            setPollFailure(null);
            reload();
          }}
        >
          Check again
        </button>
      </Panel>
    </div>
  );
}
