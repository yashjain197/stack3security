import { useRef, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { PageHeading, ScanError, Spinner } from "../components/ui";
import { VerdictPanel } from "../components/results";
import { chainName, chains, nativeSymbol } from "../lib/chains";
import { useApi, useSession } from "../lib/session";
import { ADDRESS, reviewTransaction, saveScan, toWeiHex } from "../lib/scans";
import type { ScanRecord, TxReviewRequest } from "../types";

type Mode = "transaction" | "message" | "typed";

const modes: { value: Mode; label: string; hint: string }[] = [
  { value: "transaction", label: "Transaction", hint: "eth_sendTransaction: transfers, approvals, contract calls" },
  { value: "message", label: "Signed message", hint: "personal_sign: login and off-chain messages" },
  { value: "typed", label: "Typed data", hint: "eth_signTypedData_v4: Permit, Permit2, marketplace orders" },
];

/** Builds the review request from the form, throwing a readable error for bad input. */
function buildRequest(mode: Mode, form: FormData): TxReviewRequest {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const chainId = Number(text("chain"));
  const request: TxReviewRequest = {
    chainId,
    method: mode === "transaction" ? "eth_sendTransaction" : mode === "message" ? "personal_sign" : "eth_signTypedData_v4",
  };
  const site = text("origin");
  if (site) {
    try {
      request.origin = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).origin;
    } catch {
      throw new Error("The website must be a URL or domain, e.g. https://app.example.com.");
    }
  }
  const from = text("from");
  if (from) {
    if (!ADDRESS.test(from)) throw new Error("Your wallet address must be 0x followed by 40 hex characters.");
    request.from = from;
  }

  if (mode === "transaction") {
    const to = text("to");
    const data = text("data");
    if (to && !ADDRESS.test(to)) throw new Error("The recipient must be 0x followed by 40 hex characters.");
    if (data && !/^0x([0-9a-fA-F]{2})*$/.test(data)) throw new Error("Call data must be 0x followed by hex bytes.");
    if (!to && !data) throw new Error("Enter a recipient address, call data, or both.");
    if (to) request.to = to;
    if (data && data !== "0x") request.data = data;
    const value = toWeiHex(text("value"));
    if (value) request.value = value;
  } else if (mode === "message") {
    const message = text("message");
    if (!message) throw new Error("Paste the message the site asks you to sign.");
    request.message = message;
  } else {
    let typed: unknown;
    try {
      typed = JSON.parse(text("typedData"));
    } catch {
      throw new Error("Typed data must be valid JSON (the object the wallet shows, with types, domain and message).");
    }
    if (!typed || typeof typed !== "object" || Array.isArray(typed)) throw new Error("Typed data must be a JSON object.");
    request.typedData = typed as Record<string, unknown>;
  }
  return request;
}

function describe(request: TxReviewRequest): string {
  if (request.method === "personal_sign") return "Signed message";
  if (request.method === "eth_signTypedData_v4") {
    const primary = request.typedData?.primaryType;
    return `Typed data${typeof primary === "string" ? ` · ${primary}` : ""}`;
  }
  if (!request.to) return "Contract deployment";
  return request.data ? `Contract call · ${request.data.slice(0, 10)}` : `Transfer to ${request.to}`;
}

export function TransactionsPage() {
  const api = useApi();
  const { user } = useSession();
  const [mode, setMode] = useState<Mode>("transaction");
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<{ record: ScanRecord; request: TxReviewRequest } | null>(null);
  const [busy, setBusy] = useState(false);
  const [chainId, setChainId] = useState(1);
  const controller = useRef<AbortController | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setResult(null);
    let request: TxReviewRequest;
    try {
      request = buildRequest(mode, new FormData(event.currentTarget));
    } catch (caught) {
      setError(caught as Error);
      return;
    }
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    try {
      const verdict = await reviewTransaction(api, request, current.signal);
      if (current.signal.aborted) return;
      const record = saveScan(user?.id ?? "anonymous", "transaction", describe(request), verdict, request.chainId);
      setResult({ record, request });
    } catch (caught) {
      if (!current.signal.aborted) setError(caught as Error);
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }

  const facts: [string, string][] = result
    ? [
        ["Network", chainName(result.request.chainId)],
        ["Request", result.request.method],
        ["Website", result.request.origin ?? "Not given"],
        ["Target", result.request.to ?? (result.request.method === "eth_sendTransaction" ? "New contract" : "n/a")],
      ]
    : [];

  return (
    <>
      <PageHeading
        eyebrow="WEB3 GUARD"
        title="Transaction intent analyzer"
        subtitle="Paste what your wallet is asking you to sign. Stack3 decodes it and checks the spender, the contract, the site and the threat graph."
      />
      <section className="panel contract-search-panel">
        <div className="panel-header">
          <div>
            <h2>Review a wallet request</h2>
            <p>Nothing is signed or broadcast. The request is only decoded and checked by the Stack3 API.</p>
          </div>
        </div>
        <div className="segmented" role="tablist" aria-label="Request type">
          {modes.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={mode === item.value}
              className={mode === item.value ? "segmented-option segmented-option--active" : "segmented-option"}
              onClick={() => { setMode(item.value); setError(null); }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="input-helper">{modes.find((item) => item.value === mode)?.hint}</p>
        <form id="transaction-form" className="form-stack" noValidate onSubmit={(event) => void submit(event)}>
          <div className="form-grid">
            <div className="form-stack">
              <label htmlFor="tx-chain">Network</label>
              <select id="tx-chain" name="chain" className="select-input" value={chainId} onChange={(event) => setChainId(Number(event.target.value))}>
                {chains.map((chain) => <option key={chain.id} value={chain.id}>{chain.name}</option>)}
              </select>
            </div>
            <div className="form-stack">
              <label htmlFor="tx-origin">Website asking (optional)</label>
              <input id="tx-origin" name="origin" className="text-input" placeholder="https://app.example.com" autoComplete="off" />
            </div>
            <div className="form-stack">
              <label htmlFor="tx-from">Your wallet (optional)</label>
              <input id="tx-from" name="from" className="text-input" placeholder="0x…" spellCheck={false} autoComplete="off" />
            </div>
            {mode === "transaction" ? (
              <>
                <div className="form-stack">
                  <label htmlFor="tx-to">To (contract or recipient)</label>
                  <input id="tx-to" name="to" className="text-input" placeholder="0x…" spellCheck={false} autoComplete="off" />
                </div>
                <div className="form-stack">
                  <label htmlFor="tx-value">Value ({nativeSymbol(chainId)})</label>
                  <input id="tx-value" name="value" className="text-input" placeholder="0" inputMode="decimal" autoComplete="off" />
                </div>
              </>
            ) : null}
          </div>
          {mode === "transaction" ? (
            <>
              <label htmlFor="tx-data">Call data (hex, optional)</label>
              <textarea id="tx-data" name="data" className="text-area" rows={4} placeholder="0x095ea7b3…" spellCheck={false} />
            </>
          ) : null}
          {mode === "message" ? (
            <>
              <label htmlFor="tx-message">Message</label>
              <textarea id="tx-message" name="message" className="text-area" rows={6} placeholder="app.example.com wants you to sign in with your Ethereum account…" />
            </>
          ) : null}
          {mode === "typed" ? (
            <>
              <label htmlFor="tx-typed">Typed data (JSON)</label>
              <textarea id="tx-typed" name="typedData" className="text-area" rows={10} placeholder='{"types": {…}, "primaryType": "Permit", "domain": {…}, "message": {…}}' spellCheck={false} />
            </>
          ) : null}
          <ScanError error={error} />
          <div>
            <button id="analyze-transaction" className="button button--primary" type="submit" disabled={busy}>
              {busy ? <>
                <Spinner />Analyzing…
              </> : <>
                Analyze request <Icon name="arrow" />
              </>}
            </button>
          </div>
        </form>
        <div className="privacy-note">
          <Icon name="lock" />
          <span>Never paste a seed phrase or private key. The Stack3 browser extension runs this review automatically before your wallet opens.</span>
        </div>
      </section>
      <section id="transaction-result" className="result-region" aria-live="polite">
        {result ? (
          <VerdictPanel
            verdict={result.record.verdict}
            label={`LIVE REVIEW · ${new Date(result.record.createdAt).toLocaleString()}`}
            title={result.record.target}
            facts={facts}
          />
        ) : null}
      </section>
    </>
  );
}
