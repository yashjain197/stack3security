import { Link, useNavigate } from "react-router-dom";
import { formatDateTime, useApi, useSessionContext } from "../lib/session";
import type { Account, SessionInfo } from "../types";
import {
  AccountErrorView,
  AccountHeading,
  AccountLoading,
  AccountMessage,
  Panel,
  useAccountActions,
  useAccountData,
} from "../components/account";

export function SessionsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { setFlash } = useSessionContext();
  const { state, reload } = useAccountData<SessionInfo[]>(async (signal) => {
    await api.request<Account>("/v1/me", { signal });
    return api.request<SessionInfo[]>("/v1/auth/sessions", { signal });
  });
  const { error, busy, run } = useAccountActions();

  if (state.status === "loading") return <AccountLoading />;
  if (state.status === "error") return <AccountErrorView error={state.error} onRetry={reload} />;

  const sessions = state.data;

  return (
    <div className="account-content">
      <AccountMessage error={error} />
      <AccountHeading title="Signed-in devices" text="Review and revoke access to your account." />
      <Panel title="Active sessions">
        <ul className="account-list">
          {sessions.map((session) => (
            <li className="account-row" key={session.id}>
              <div>
                <strong>
                  {session.deviceName ?? session.client}
                  {session.current ? " (this device)" : ""}
                </strong>
                <p>
                  {session.client} · IP: {session.createdIp ?? "Unknown"}
                  <br />
                  Signed in: {formatDateTime(session.createdAt)}
                  <br />
                  Last used: {formatDateTime(session.lastUsedAt)}
                </p>
              </div>
              <button
                type="button"
                className="button button--secondary"
                disabled={busy === `revoke-${session.id}`}
                onClick={() => void run(`revoke-${session.id}`, async () => {
                  await api.revokeSession(session.id, session.current);
                  if (!api.signedIn) {
                    navigate("/login");
                  } else {
                    setFlash("Session revoked.");
                    reload();
                  }
                })}
              >
                {session.current ? "Sign out" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
        <div className="account-actions">
          <Link className="button button--secondary" to="/link">Review a device code</Link>
          <button
            type="button"
            className="button button--secondary"
            disabled={busy === "logout-all"}
            onClick={() => void run("logout-all", async () => {
              if (!window.confirm("Sign out every device, including this one?")) return;
              await api.logout(true);
              navigate("/login");
            })}
          >
            Sign out all devices
          </button>
        </div>
      </Panel>
    </div>
  );
}
