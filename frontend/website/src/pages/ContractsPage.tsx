import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PageHeading, ScanError, Spinner } from "../components/ui";
import { VerdictPanel } from "../components/results";
import { chainName, chains, explorerAddressUrl } from "../lib/chains";
import { useApi, useSession } from "../lib/session";
import { ADDRESS, saveScan, scanContract } from "../lib/scans";
import type { ScanRecord } from "../types";

export function ContractsPage() {
  const api = useApi();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const linkedChain = Number(params.get("chain") ?? "");
  const linkedAddress = params.get("address");
  const [chainId, setChainId] = useState(Number.isInteger(linkedChain) && linkedChain > 0 ? linkedChain : 1);
  const [address, setAddress] = useState(linkedAddress ?? "");
  const [error, setError] = useState<Error | null>(null);
  const [record, setRecord] = useState<ScanRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (chain: number, target: string) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setError(null);
    setRecord(null);
    const trimmed = target.trim();
    if (!ADDRESS.test(trimmed)) {
      setError(new Error("Enter a contract address: 0x followed by 40 hex characters."));
      return;
    }
    setBusy(true);
    try {
      const verdict = await scanContract(api, chain, trimmed, current.signal);
      if (!current.signal.aborted) setRecord(saveScan(user?.id ?? "anonymous", "contract", trimmed.toLowerCase(), verdict, chain));
    } catch (caught) {
      if (!current.signal.aborted) setError(caught as Error);
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }, [api, user?.id]);

  // /dashboard/contracts?chain=1&address=0x… scans straight away (used by the browser extension).
  useEffect(() => {
    if (!linkedAddress) return;
    const chain = Number.isInteger(linkedChain) && linkedChain > 0 ? linkedChain : 1;
    setChainId(chain);
    setAddress(linkedAddress);
    void run(chain, linkedAddress);
    return () => controller.current?.abort();
  }, [linkedAddress, linkedChain, run]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (linkedAddress) setParams({}, { replace: true });
    void run(chainId, address);
  }

  const knownChain = chains.some((chain) => chain.id === chainId);
  const explorer = record ? explorerAddressUrl(record.chainId ?? 1, record.target) : null;

  return (
    <>
      <PageHeading
        eyebrow="WEB3 GUARD"
        title="Smart-contract overview"
        subtitle="Verified source, proxy and owner control, deployment age and threat-graph reports for any EVM contract."
      />
      <section className="panel contract-search-panel">
        <div className="panel-header">
          <div>
            <h2>Review a contract</h2>
            <p>Runs a live scan through Sourcify, the block explorer, the chain's RPC and the Stack3 threat graph.</p>
          </div>
        </div>
        <form id="contract-form" className="form-stack" noValidate onSubmit={submit}>
          <label htmlFor="contract-chain">Network</label>
          <select
            id="contract-chain"
            className="select-input"
            value={chainId}
            onChange={(event) => setChainId(Number(event.target.value))}
          >
            {!knownChain ? <option value={chainId}>{chainName(chainId)}</option> : null}
            {chains.map((chain) => <option key={chain.id} value={chain.id}>{chain.name}</option>)}
          </select>
          <label htmlFor="contract-address">Contract address</label>
          <div className="input-with-icon">
            <Icon name="blocks" />
            <input
              id="contract-address"
              name="contract"
              type="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="0x…"
              aria-describedby="contract-error"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
            <button className="button button--primary" type="submit" disabled={busy}>
              {busy ? <>
                <Spinner />Scanning…
              </> : <>
                Review contract <Icon name="arrow" />
              </>}
            </button>
          </div>
          <div id="contract-error"><ScanError error={error} /></div>
        </form>
      </section>
      <section id="contract-result" className="result-region" aria-live="polite">
        {record ? (
          <VerdictPanel
            verdict={record.verdict}
            label={`LIVE SCAN · ${new Date(record.createdAt).toLocaleString()}`}
            title={record.target}
            subtitle={chainName(record.chainId ?? 1)}
          >
            <div className="result-links">
              {explorer ? (
                <a className="text-link" href={explorer} target="_blank" rel="noopener noreferrer">
                  View on block explorer <Icon name="external" />
                </a>
              ) : null}
              <Link className="text-link" to={`/dashboard/graph?type=wallet&id=${record.chainId ?? 1}:${record.target}`}>
                Open in the threat graph <Icon name="arrow" />
              </Link>
            </div>
          </VerdictPanel>
        ) : null}
      </section>
    </>
  );
}
