import { useState } from "react";
import { Icon } from "../components/Icon";
import { DemoBanner, PageHeading, Spinner } from "../components/ui";
import { TransactionResultPanel } from "../components/results";
import { analyzeSampleTransaction } from "../lib/security-service";
import { transactionExample } from "../lib/mock-data";
import type { TransactionResult } from "../types";

export function TransactionsPage() {
  const [result, setResult] = useState<TransactionResult>(transactionExample);
  const [busy, setBusy] = useState(false);

  async function analyze() {
    if (busy) return;
    setBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setResult(analyzeSampleTransaction());
    setBusy(false);
  }

  return (
    <>
      <DemoBanner />
      <PageHeading
        eyebrow="WEB3 GUARD"
        title="Transaction intent analyzer"
        subtitle="Understand the wallet request, what it authorizes, and whether it matches the website's stated action."
        action={<span className="mode-chip">DEMONSTRATION MODE</span>}
      />
      <div className="transaction-intro">
        <div className="panel transaction-start">
          <div className="panel-header">
            <div>
              <h2>Analyze a sample request</h2>
              <p>This example runs locally and will not connect to a wallet or submit a transaction.</p>
            </div>
          </div>
          <div className="sample-fields">
            <div className="field-pair">
              <span>Network</span>
              <strong>Ethereum (illustrative)</strong>
            </div>
            <div className="field-pair">
              <span>Website's stated action</span>
              <strong>“Claim your reward.”</strong>
            </div>
            <div className="field-pair">
              <span>Request status</span>
              <strong className="status-pending">Pending wallet request · not submitted</strong>
            </div>
          </div>
          <button id="analyze-transaction" className="button button--primary" disabled={busy} onClick={() => void analyze()}>
            {busy ? <>
              <Spinner />Analyzing sample…
            </> : <>
              Analyze sample request <Icon name="arrow" />
            </>}
          </button>
        </div>
        <div className="transaction-side-note">
          <Icon name="lock" />
          <div>
            <strong>Your secrets stay yours.</strong>
            <p>Never enter a seed phrase or private key. This demo uses a fixed sample request only.</p>
          </div>
        </div>
      </div>
      <section id="transaction-result" className="result-region">
        <TransactionResultPanel result={result} />
      </section>
    </>
  );
}
