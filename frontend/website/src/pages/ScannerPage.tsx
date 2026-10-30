import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PageHeading, ScanError, Spinner, ResultSkeleton } from "../components/ui";
import { VerdictPanel } from "../components/results";
import { useApi, useSession } from "../lib/session";
import { checkWebsite, normalizeDomain, saveScan } from "../lib/scans";
import type { ScanRecord } from "../types";

function CheckItem({ text }: { text: string }) {
  return (
    <li>
      <span className="check-icon">✓</span>
      <span>{text}</span>
    </li>
  );
}

export function ScannerPage() {
  const api = useApi();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState<Error | null>(null);
  const [record, setRecord] = useState<ScanRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (input: string) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setError(null);
    setRecord(null);
    let domain: string;
    try {
      domain = normalizeDomain(input);
    } catch (caught) {
      setError(caught as Error);
      return;
    }
    setBusy(true);
    try {
      const verdict = await checkWebsite(api, domain, current.signal);
      if (!current.signal.aborted) setRecord(saveScan(user?.id ?? "anonymous", "website", domain, verdict));
    } catch (caught) {
      if (!current.signal.aborted) setError(caught as Error);
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }, [api, user?.id]);

  // /dashboard/scanner?domain=example.com scans straight away (used by the browser extension).
  const linked = params.get("domain");
  useEffect(() => {
    if (!linked) return;
    if (inputRef.current) inputRef.current.value = linked;
    void run(linked);
    return () => controller.current?.abort();
  }, [linked, run]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const value = inputRef.current?.value ?? "";
    if (linked && value.trim() !== linked) setParams({}, { replace: true });
    void run(value);
  }

  return (
    <>
      <PageHeading
        eyebrow="WEB3 GUARD"
        title="Website risk scanner"
        subtitle="Check a domain against the Stack3 phishing blocklists, threat graph and wallet-brand lookalike rules."
      />
      <div className="scanner-layout">
        <section className="panel scanner-form-panel">
          <div className="panel-header">
            <div>
              <span className="feature-kicker">LIVE SCAN</span>
              <h2>Inspect a website</h2>
              <p>Enter any URL or domain. Only the hostname is sent to the Stack3 API.</p>
            </div>
          </div>
          <form id="scanner-form" className="form-stack" noValidate onSubmit={submit}>
            <label htmlFor="website-url">Website URL</label>
            <div className="input-with-icon">
              <Icon name="external" />
              <input
                id="website-url"
                name="website"
                type="text"
                inputMode="url"
                autoComplete="url"
                placeholder="https://example.com"
                aria-describedby="scanner-error"
                defaultValue={linked ?? ""}
                ref={inputRef}
              />
              <button className="button button--primary" type="submit" disabled={busy}>
                {busy ? <>
                  <Spinner />Scanning…
                </> : <>
                  Scan website <Icon name="arrow" />
                </>}
              </button>
            </div>
            <div id="scanner-error"><ScanError error={error} /></div>
          </form>
          <div className="privacy-note">
            <Icon name="lock" />
            <span>Never enter a seed phrase or private key anywhere. For live page-behavior checks while you browse, use the Stack3 browser extension.</span>
          </div>
        </section>
        <section className="panel inspection-panel">
          <div className="panel-header">
            <div>
              <h2>What this scan checks</h2>
              <p>Results come from the live Stack3 API.</p>
            </div>
          </div>
          <ul className="check-list">
            <CheckItem text="Known phishing and drainer blocklists" />
            <CheckItem text="Reports in the Stack3 threat graph" />
            <CheckItem text="Wallet-brand lookalike and homoglyph domains" />
            <CheckItem text="Domain age and registration data, when available" />
          </ul>
        </section>
      </div>
      <section id="scanner-result" className="result-region" aria-live="polite">
        {busy ? <ResultSkeleton label="Scanning website…" /> : null}
        {record ? (
          <VerdictPanel
            verdict={record.verdict}
            label={`LIVE SCAN · ${new Date(record.createdAt).toLocaleString()}`}
            title={record.target}
          >
            <Link className="text-link" to={`/dashboard/graph?type=domain&id=${encodeURIComponent(record.target)}`}>
              Open in the threat graph <Icon name="arrow" />
            </Link>
          </VerdictPanel>
        ) : null}
      </section>
    </>
  );
}
