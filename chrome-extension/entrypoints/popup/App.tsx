import { useCallback, useEffect, useState, type FormEvent } from "react";
import { levelLabels, WEBSITE_URL } from "../../utils/api";
import type { LinkStart, TabCheckResult, Verdict } from "../../utils/types";

type BackgroundReply<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; status?: number };

class PopupError extends Error {
  code: string;
  constructor(message: string, code = "error") {
    super(message);
    this.code = code;
  }
}

async function ask<T>(message: Record<string, unknown>): Promise<T> {
  const reply = (await browser.runtime.sendMessage(message)) as BackgroundReply<T>;
  if (!reply) throw new PopupError("The background worker did not answer. Try reopening the popup.");
  if (!reply.ok) throw new PopupError(reply.error, reply.code);
  return reply.data;
}

type Status = { linked: boolean; email: string | null; apiBaseUrl: string };
type LinkState = { details: LinkStart; email: string | null; error: string | null } | null;

function VerdictCard({ title, verdict }: { title: string; verdict: Verdict }) {
  return (
    <section className={`verdict-card verdict-card--${verdict.level}`}>
      <header>
        <strong>{title}</strong>
        <span className="verdict-pill">{levelLabels[verdict.level]}</span>
      </header>
      {verdict.explanation ? <p className="verdict-explanation">{verdict.explanation}</p> : null}
      {verdict.findings.map((finding) => (
        <div className="verdict-finding" key={`${finding.title}-${finding.source}`}>
          <strong>{finding.title}</strong>
          <p>{finding.evidence}</p>
        </div>
      ))}
      {verdict.notChecked.length ? (
        <p className="verdict-not-checked">Not checked: {verdict.notChecked.join(", ")}.</p>
      ) : null}
      {verdict.actions.length ? (
        <ul className="verdict-actions">
          {verdict.actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<LinkState>(null);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<{ id: number; url: string } | null>(null);
  const [result, setResult] = useState<TabCheckResult | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [contractChain, setContractChain] = useState("1");
  const [contractVerdict, setContractVerdict] = useState<Verdict | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await ask<Status>({ type: "get-status" }));
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
      if (active?.id !== undefined && active.url && /^https?:/.test(active.url)) {
        setTab({ id: active.id, url: active.url });
      }
    });
  }, [refreshStatus]);

  // While a link flow is open, poll the background for approval.
  useEffect(() => {
    if (!link || link.email || link.error) return;
    const timer = setInterval(async () => {
      try {
        const state = await ask<LinkState>({ type: "link-poll" });
        if (state) setLink(state);
        if (state?.email) {
          clearInterval(timer);
          await refreshStatus();
        }
      } catch {
        // Keep polling; the background answers when it can.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [link, refreshStatus]);

  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setErrorCode("");
    try {
      await operation();
    } catch (caught) {
      setError((caught as Error).message);
      setErrorCode(caught instanceof PopupError ? caught.code : "");
    } finally {
      setBusy(false);
    }
  }

  function beginLink() {
    void run(async () => {
      const state = await ask<LinkState>({ type: "link-start" });
      setLink(state);
      if (state) {
        browser.tabs.create({ url: state.details.verificationUriComplete }).catch(() => {});
      }
    });
  }

  function checkTab() {
    if (!tab) return;
    void run(async () => {
      setResult(null);
      setResult(await ask<TabCheckResult>({ type: "check-tab", tabId: tab.id, url: tab.url }));
    });
  }

  function checkContract(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      setContractVerdict(null);
      const chainId = Number(contractChain);
      if (!Number.isInteger(chainId) || chainId < 1) throw new Error("Enter a valid chain id.");
      if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress.trim())) {
        throw new Error("Enter a 0x contract address (40 hex characters).");
      }
      setContractVerdict(
        await ask<Verdict>({ type: "scan-contract", chainId, address: contractAddress.trim() }),
      );
    });
  }

  const linked = status?.linked ?? false;

  return (
    <main className="popup">
      <header className="popup-header">
        <span className="popup-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </span>
        <h1>stack3<span> security</span></h1>
      </header>

      {error ? (
        <p className="popup-error" role="alert">
          {error}
          {errorCode === "feature_required" ? (
            <>
              {" "}
              <a href={`${WEBSITE_URL}/pricing`} target="_blank" rel="noreferrer">
                View plans
              </a>
            </>
          ) : null}
          {errorCode === "unauthorized" ? " Link this device again." : null}
        </p>
      ) : null}

      {!linked ? (
        <section className="popup-section">
          <p className="popup-tagline">Link this extension to your Stack3 account to run live checks.</p>
          {link && !link.email ? (
            <>
              <p className="popup-code" aria-label="Device code">{link.details.userCode}</p>
              <p className="popup-note">
                Approve this code on the Stack3 website. The approval page opened in a new tab; this popup
                finishes automatically once you approve.
              </p>
              {link.error ? <p className="popup-error" role="alert">{link.error}</p> : null}
            </>
          ) : null}
          <button className="popup-button popup-button--primary" disabled={busy} onClick={beginLink}>
            {link && !link.email ? "Start over with a new code" : "Link this device"}
          </button>
        </section>
      ) : (
        <>
          <section className="popup-section popup-account">
            <div>
              <strong>{status?.email}</strong>
              <small>Linked · {status?.apiBaseUrl.replace(/^https?:\/\//, "")}</small>
            </div>
            <button
              className="popup-button popup-button--small"
              disabled={busy}
              onClick={() => void run(async () => {
                await ask({ type: "unlink" });
                setLink(null);
                setResult(null);
                await refreshStatus();
              })}
            >
              Unlink
            </button>
          </section>

          <section className="popup-section">
            <button
              className="popup-button popup-button--primary"
              disabled={busy || !tab}
              onClick={checkTab}
            >
              {busy ? "Checking…" : tab ? `Check ${new URL(tab.url).hostname}` : "No checkable tab"}
            </button>
            {result ? (
              <div className="popup-results">
                {result.domain ? <VerdictCard title="Address" verdict={result.domain} /> : null}
                {result.page ? <VerdictCard title="Page behavior" verdict={result.page} /> : null}
                {result.scripts ? <VerdictCard title="Loaded scripts" verdict={result.scripts} /> : null}
                {!result.page ? (
                  <p className="popup-note">Page signals were not captured yet. Reload the tab and check again.</p>
                ) : null}
                {result.errors.map((message) => (
                  <p className="popup-error" key={message}>{message}</p>
                ))}
              </div>
            ) : null}
          </section>

          <section className="popup-section">
            <form className="popup-contract" onSubmit={checkContract}>
              <label htmlFor="contract-chain">Chain</label>
              <input
                id="contract-chain"
                inputMode="numeric"
                value={contractChain}
                onChange={(event) => setContractChain(event.target.value)}
              />
              <label htmlFor="contract-address">Contract</label>
              <input
                id="contract-address"
                placeholder="0x…"
                value={contractAddress}
                onChange={(event) => setContractAddress(event.target.value)}
              />
              <button className="popup-button" type="submit" disabled={busy}>Check contract</button>
            </form>
            {contractVerdict ? <VerdictCard title="Contract" verdict={contractVerdict} /> : null}
          </section>
        </>
      )}

      <p className="popup-note">
        Checks return risk indicators, not a guarantee of safety. No page text or recovery phrase ever leaves
        this browser.
      </p>
    </main>
  );
}
