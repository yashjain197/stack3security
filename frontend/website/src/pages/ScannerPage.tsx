import { useRef, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { DemoBanner, PageHeading, Spinner } from "../components/ui";
import { ScanResultPanel } from "../components/results";
import { scanWebsite } from "../lib/security-service";
import type { ScanResult } from "../types";

function CheckItem({ text }: { text: string }) {
  return (
    <li>
      <span className="check-icon">✓</span>
      <span>{text}</span>
    </li>
  );
}

export function ScannerPage() {
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setResult(null);
    setBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 650));
    try {
      setResult(scanWebsite(inputRef.current?.value ?? ""));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DemoBanner />
      <PageHeading
        eyebrow="WEB3 GUARD"
        title="Website risk scanner"
        subtitle="Inspect a domain for suspicious identity, page behavior, and recovery-phrase requests."
      />
      <div className="scanner-layout">
        <section className="panel scanner-form-panel">
          <div className="panel-header">
            <div>
              <span className="feature-kicker">DEMO SCAN</span>
              <h2>Inspect a website</h2>
              <p>Try the sample fixture to see how findings and evidence are presented.</p>
            </div>
            <span className="scanner-icon"><Icon name="scan" /></span>
          </div>
          <form id="scanner-form" className="form-stack" noValidate onSubmit={(event) => void submit(event)}>
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
                aria-describedby="scanner-helper scanner-error"
                ref={inputRef}
              />
              <button className="button button--primary" type="submit" disabled={busy}>
                {busy ? <>
                  <Spinner />Checking sample…
                </> : <>
                  Scan website <Icon name="arrow" />
                </>}
              </button>
            </div>
            <small id="scanner-helper" className="input-helper">Sample supported: demo-recovery-site.test</small>
            <p id="scanner-error" className="form-error" role="alert" hidden={!error}>{error}</p>
          </form>
          <div className="privacy-note">
            <Icon name="lock" />
            <span>Never enter a seed phrase or private key. This sample scan does not send the entered URL to the API.</span>
          </div>
        </section>
        <section className="panel inspection-panel">
          <div className="panel-header">
            <div>
              <h2>What the scanner may inspect</h2>
              <p>Checks depend on available signals and supported data.</p>
            </div>
          </div>
          <ul className="check-list">
            <CheckItem text="Lookalike or suspicious domain patterns" />
            <CheckItem text="Recovery-phrase or private-key prompts" />
            <CheckItem text="Suspicious form destinations" />
            <CheckItem text="Wallet-brand impersonation signals" />
            <CheckItem text="Relevant page-script indicators, when supported" />
          </ul>
        </section>
      </div>
      <section id="scanner-result" className="result-region" aria-live="polite">
        {result ? <ScanResultPanel result={result} /> : null}
      </section>
    </>
  );
}
