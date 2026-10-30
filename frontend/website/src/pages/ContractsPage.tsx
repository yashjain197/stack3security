import { useRef, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { DemoBanner, PageHeading, Spinner } from "../components/ui";
import { ContractResultPanel } from "../components/results";
import { reviewSampleContract } from "../lib/security-service";
import { contractExample } from "../lib/mock-data";
import type { ContractResult } from "../types";

export function ContractsPage() {
  const [error, setError] = useState("");
  const [result, setResult] = useState<ContractResult>(contractExample);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    try {
      setResult(reviewSampleContract(inputRef.current?.value ?? ""));
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
        title="Smart-contract overview"
        subtitle="Review available contract information and risk indicators before interacting."
      />
      <section className="panel contract-search-panel">
        <div className="panel-header">
          <div>
            <h2>Review a contract</h2>
            <p>Live verification is not connected. Enter the sample fixture to see the illustrative view.</p>
          </div>
          <span className="scanner-icon"><Icon name="blocks" /></span>
        </div>
        <form id="contract-form" className="form-stack" noValidate onSubmit={(event) => void submit(event)}>
          <label htmlFor="contract-address">Contract address</label>
          <div className="input-with-icon">
            <Icon name="blocks" />
            <input
              id="contract-address"
              name="contract"
              type="text"
              placeholder="Paste a public contract address"
              aria-describedby="contract-error"
              ref={inputRef}
            />
            <button className="button button--primary" type="submit" disabled={busy}>
              {busy ? <>
                <Spinner />Checking sample…
              </> : <>
                Review contract <Icon name="arrow" />
              </>}
            </button>
          </div>
          <p id="contract-error" className="form-error" role="alert" hidden={!error}>{error}</p>
          <span className="input-helper">Sample fixture: sample-contract. No address lookup is performed.</span>
        </form>
      </section>
      <section id="contract-result" className="result-region">
        <ContractResultPanel result={result} />
      </section>
    </>
  );
}
