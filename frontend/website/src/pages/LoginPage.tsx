import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, safeReturnPath } from "../lib/api";
import { formatDateTime, useApi, useSession, useSessionContext } from "../lib/session";
import { AccountHeading, AccountMessage, Panel, useAccountActions, useSwitchAccount } from "../components/account";

export function LoginPage() {
  const api = useApi();
  const { signedIn, user } = useSession();
  const { setFlash } = useSessionContext();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [codeExpiresAt, setCodeExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const { error, busy, run, setError } = useAccountActions();
  const switchAccount = useSwitchAccount();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const cooldownSeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));

  function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    void run("request-code", async () => {
      if (Date.now() < retryAt) {
        throw new ApiError("Wait before requesting another code.", {
          code: "rate_limited",
          retryAfter: Math.ceil((retryAt - Date.now()) / 1000),
        });
      }
      const normalized = email.trim().toLowerCase();
      const result = await api.requestCode(normalized);
      setSentTo(normalized);
      setEmail(normalized);
      setRetryAt(Date.now() + result.retryAfterSeconds * 1000);
      setCodeExpiresAt(Date.now() + result.expiresInSeconds * 1000);
      setFlash("Check your email for the login code.");
    }, {
      onApiError(failure) {
        if (failure.status === 429 && failure.retryAfter > 0) {
          setRetryAt(Date.now() + failure.retryAfter * 1000);
        }
      },
    });
  }

  function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    void run("verify-code", async () => {
      if (Date.now() >= codeExpiresAt) {
        throw new ApiError("Your code has expired. Request a new code.", { code: "invalid_code" });
      }
      await api.verifyCode(sentTo, code);
      setSentTo("");
      setCodeExpiresAt(0);
      navigate(safeReturnPath(params.get("next")), { replace: true });
    });
  }

  if (signedIn) {
    return (
      <div className="account-content">
        <AccountMessage error={error} />
        <AccountHeading title="Already signed in" text={user?.email ?? ""} />
        <Link className="button button--secondary" to={safeReturnPath(params.get("next"))}>Continue</Link>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void run("switch-account", switchAccount)}
        >
          Use a different email
        </button>
      </div>
    );
  }

  const resendBusy = busy === "request-code";
  const resendDisabled = resendBusy || cooldownSeconds > 0;
  const resendLabel = cooldownSeconds > 0
    ? `Resend in ${cooldownSeconds}s`
    : sentTo
      ? "Send / resend code"
      : "Send login code";

  return (
    <div className="account-content">
      <AccountMessage error={error} />
      <AccountHeading title="Sign in to Stack3" text="Use the six-digit code sent to your email. No password required." />
      <Panel title="Email login">
        <form className="account-form" onSubmit={requestCode}>
          <label htmlFor="account-email">Email address</label>
          <input
            id="account-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            maxLength={320}
            value={email}
            onChange={(event) => { setEmail(event.target.value); setError(null); }}
          />
          <button
            className="button button--primary"
            type="submit"
            data-resend
            disabled={resendDisabled}
            aria-busy={resendBusy || undefined}
          >
            {resendLabel}
          </button>
        </form>
        {sentTo && codeExpiresAt ? (
          <form className="account-form" onSubmit={verifyCode}>
            <p>Code sent to <strong>{sentTo}</strong>. Expires at {formatDateTime(codeExpiresAt)}.</p>
            <label htmlFor="account-code">Six-digit code</label>
            <input
              id="account-code"
              name="code"
              type="text"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <button className="button button--primary" type="submit" disabled={busy === "verify-code"}>
              Verify and sign in
            </button>
          </form>
        ) : null}
        <p className="account-note">
          Your refresh token is stored in an HTTP-only cookie. Access tokens stay in memory, never browser storage.
        </p>
      </Panel>
    </div>
  );
}
