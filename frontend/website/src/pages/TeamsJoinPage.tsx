import { useNavigate, useSearchParams } from "react-router-dom";
import { useApi, useSessionContext } from "../lib/session";
import type { Account } from "../types";
import {
  AccountErrorView,
  AccountHeading,
  AccountLoading,
  AccountMessage,
  Panel,
  useAccountActions,
  useAccountData,
  useSwitchAccount,
} from "../components/account";

export function TeamsJoinPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { setFlash } = useSessionContext();
  const [params] = useSearchParams();
  const token = params.get("token");
  const { state, reload } = useAccountData<Account>((signal) => api.request<Account>("/v1/me", { signal }));
  const { error, busy, run } = useAccountActions();
  const switchAccount = useSwitchAccount();

  if (state.status === "loading") return <AccountLoading />;
  if (state.status === "error") return <AccountErrorView error={state.error} onRetry={reload} />;

  const account = state.data;
  const validToken = Boolean(token && token.length >= 20 && token.length <= 200);

  return (
    <div className="account-content">
      <AccountMessage error={error} />
      <AccountHeading title="Join a team" text="Sign in with the email address that received the invitation." />
      <Panel title="Accept invitation">
        {validToken ? (
          <>
            <p>
              Signed in as <strong>{account.user.email}</strong>. Accept this invitation only if you recognize the
              team invitation email.
            </p>
            <button
              type="button"
              className="button button--primary"
              disabled={busy === "accept-invite"}
              onClick={() => void run("accept-invite", async () => {
                await api.request("/v1/teams/invites/accept", { method: "POST", body: { token } });
                setFlash("Invitation accepted.");
                navigate("/account/team", { replace: true });
              })}
            >
              Accept invitation
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={busy === "switch-account"}
              onClick={() => void run("switch-account", switchAccount)}
            >
              Use a different email
            </button>
          </>
        ) : (
          <p>This invite link is missing a valid token. Open the complete link from your invitation email.</p>
        )}
      </Panel>
    </div>
  );
}
