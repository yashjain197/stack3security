import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { formatDateTime, useApi, useSessionContext } from "../lib/session";
import type { Account, LinkDetails } from "../types";
import {
  AccountErrorView,
  AccountHeading,
  AccountLoading,
  AccountMessage,
  Panel,
  useAccountActions,
  useAccountData,
} from "../components/account";

type LinkData = {
  account: Account;
  details: LinkDetails | null;
};

export function LinkDevicePage() {
  const api = useApi();
  const navigate = useNavigate();
  const { setFlash } = useSessionContext();
  const [params] = useSearchParams();
  const codeParam = params.get("code") ?? "";
  const [userCode, setUserCode] = useState(codeParam);
  const { state, reload } = useAccountData<LinkData>(async (signal) => {
    const account = await api.request<Account>("/v1/me", { signal });
    let details: LinkDetails | null = null;
    if (codeParam) {
      details = await api.request<LinkDetails>(
        `/v1/auth/link/requests/${encodeURIComponent(codeParam)}`,
        { signal },
      );
    }
    return { account, details };
  }, [codeParam]);
  const { error, busy, run } = useAccountActions();

  if (state.status === "loading") return <AccountLoading />;
  if (state.status === "error") return <AccountErrorView error={state.error} onRetry={reload} />;

  const details = state.data.details;

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const code = userCode.trim().toUpperCase();
    navigate(`/link?code=${encodeURIComponent(code)}`);
  }

  function decide(approve: boolean) {
    void run(approve ? "approve-device" : "deny-device", async () => {
      if (!details || details.status !== "pending" || Date.parse(details.expiresAt) <= Date.now()) {
        throw new ApiError("This device request has expired. Request a new code in your extension.", { code: "expired_code" });
      }
      const result = await api.request<LinkDetails>("/v1/auth/link/approve", {
        method: "POST",
        body: { userCode: details.userCode, approve },
      });
      setFlash(`Device request ${result.status}.`);
      reload();
    });
  }

  const pending = details && details.status === "pending" && Date.parse(details.expiresAt) > Date.now();
  const facts: [string, string][] = details
    ? [
        ["Code", details.userCode],
        ["Client", details.client],
        ["Device", details.deviceName ?? "Not provided"],
        ["IP address", details.requestedIp ?? "Unknown"],
        ["Requested", formatDateTime(details.createdAt)],
        ["Expires", formatDateTime(details.expiresAt)],
        ["Status", details.status],
      ]
    : [];

  return (
    <div className="account-content">
      <AccountMessage error={error} />
      <AccountHeading title="Link a device" text="Only approve a request you initiated in your own extension or CLI." />
      <Panel title="Device code">
        <form className="account-form" onSubmit={review}>
          <label htmlFor="account-userCode">Device code</label>
          <input
            id="account-userCode"
            name="userCode"
            type="text"
            required
            pattern="[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}"
            maxLength={9}
            value={userCode}
            onChange={(event) => setUserCode(event.target.value)}
          />
          <button type="submit" className="button button--primary">Review device</button>
        </form>
      </Panel>
      {details ? (
        <Panel title="Device requesting access">
          <dl className="account-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {pending ? (
            <div className="account-actions">
              <button
                type="button"
                className="button button--primary"
                disabled={busy !== null}
                onClick={() => decide(true)}
              >
                Approve device
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={busy !== null}
                onClick={() => decide(false)}
              >
                Deny
              </button>
            </div>
          ) : (
            <p>This request is no longer awaiting approval.</p>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
