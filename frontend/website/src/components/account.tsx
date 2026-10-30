import { useEffect, useRef, useState, type DependencyList, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError, safeReturnPath } from "../lib/api";
import { errorMessage, useApi, useSessionContext } from "../lib/session";
import { Skeleton } from "./ui";

export function AccountHeading({ title, text }: { title: string; text: string }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">YOUR ACCOUNT</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel account-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function AccountLoading({ label = "Loading account data…" }: { label?: string }) {
  return (
    <div className="account-loading" role="status">
      <div className="skeleton-stack">
        <Skeleton width="180px" height={18} />
        <Skeleton width="100%" />
        <Skeleton width="86%" />
        <Skeleton width="62%" />
      </div>
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

export function useSwitchAccount() {
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  return async () => {
    const next = `${location.pathname}${location.search}`;
    await api.logout();
    navigate(`/login?next=${encodeURIComponent(safeReturnPath(next))}`);
  };
}

export function AccountMessage({ error }: { error: ApiError | Error | null }) {
  const { flash } = useSessionContext();
  const regionRef = useRef<HTMLDivElement>(null);
  const switchAccount = useSwitchAccount();

  useEffect(() => {
    if (error) regionRef.current?.focus();
  }, [error]);

  if (error) {
    const code = error instanceof ApiError ? error.code : "";
    return (
      <div
        id="account-message"
        ref={regionRef}
        className="account-message account-message--error"
        role="alert"
        tabIndex={-1}
      >
        {errorMessage(error)}
        {["no_seats_available", "already_subscribed"].includes(code) ? (
          <Link to="/account/billing"> Manage billing</Link>
        ) : null}
        {code === "invite_email_mismatch" ? (
          <button type="button" className="button button--secondary" onClick={() => void switchAccount()}>
            Sign in with the invited email
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div id="account-message" className="account-message" role="status" aria-live="polite" tabIndex={-1}>
      {flash}
    </div>
  );
}

export type AccountDataState<T> =
  | { status: "loading" }
  | { status: "error"; error: ApiError | Error }
  | { status: "ready"; data: T };

export function useAccountData<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList = [],
): { state: AccountDataState<T>; reload: () => void } {
  const [state, setState] = useState<AccountDataState<T>>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    loader(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data });
      },
      (error: ApiError | Error) => {
        if (controller.signal.aborted || error.name === "AbortError") return;
        setState({ status: "error", error });
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  return { state, reload: () => setVersion((value) => value + 1) };
}

export function useAccountActions() {
  const { setFlash } = useSessionContext();
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function run(key: string, operation: () => Promise<void>, { onApiError }: { onApiError?: (error: ApiError) => void } = {}) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    setError(null);
    setFlash("");
    try {
      await operation();
    } catch (caught) {
      const failure = caught as ApiError | Error;
      if (failure.name !== "AbortError") {
        if (failure instanceof ApiError && onApiError) onApiError(failure);
        setError(failure);
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  return { error, busy, run, setError };
}

export function AccountErrorView({ error, onRetry }: { error: ApiError | Error; onRetry: () => void }) {
  return (
    <div className="account-content">
      <AccountMessage error={error} />
      <button type="button" className="button button--primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
