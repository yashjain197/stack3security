import { Link } from "react-router-dom";
import type { ContractResult, Report, ScanResult, TransactionResult } from "../types";
import { Icon } from "./Icon";
import { Badge, DetailItem, FindingCard, Limitations } from "./ui";

export function ReportTable({ items, showView = true }: { items: Report[]; showView?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Target</th>
            <th>Scan type</th>
            <th>Verdict</th>
            <th>Findings</th>
            <th>Date</th>
            {showView ? <th></th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((report) => (
            <tr key={report.target}>
              <td>
                <strong className="table-target">{report.target}</strong>
                <small>Illustrative demo record</small>
              </td>
              <td>{report.type}</td>
              <td><Badge verdict={report.verdict} /></td>
              <td>{report.findings}</td>
              <td>{report.date}</td>
              {showView ? (
                <td>
                  <Link
                    className="table-action"
                    to={`/dashboard/reports?target=${encodeURIComponent(report.target)}`}
                    aria-label={`View report for ${report.target}`}
                  >
                    <Icon name="arrow" />
                  </Link>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScanResultPanel({ result }: { result: ScanResult }) {
  return (
    <section className="result-panel">
      <div className="result-header">
        <div>
          <div className="result-label">ILLUSTRATIVE DEMO RESULT — NOT A LIVE DOMAIN ASSESSMENT</div>
          <h2>{result.target.id}</h2>
        </div>
        <Badge verdict={result.level} />
      </div>
      <div className="result-explanation">
        <span className="result-explanation-icon"><Icon name="shield" /></span>
        <p>{result.explanation}</p>
      </div>
      <div className="finding-list">
        {result.findings.map((finding, index) => (
          <FindingCard key={finding.title} finding={finding} index={index + 1} />
        ))}
      </div>
      <Limitations items={result.notChecked} />
    </section>
  );
}

export function TransactionResultPanel({ result }: { result: TransactionResult }) {
  const finding = result.findings[0];
  return (
    <section className="result-panel">
      <div className="result-header">
        <div>
          <div className="result-label">ILLUSTRATIVE EXAMPLE · PENDING REQUEST</div>
          <h2>Website intent and wallet request</h2>
        </div>
        <Badge verdict={result.level} />
      </div>
      <div className="transaction-compare">
        <div className="compare-card">
          <span>WEBSITE SAYS</span>
          <strong>{result.websiteAction}</strong>
        </div>
        <div className="compare-connector"><Icon name="arrow" /></div>
        <div className="compare-card compare-card--risk">
          <span>DECODED WALLET REQUEST</span>
          <strong>{result.method}</strong>
          <small>ERC-20 token approval</small>
        </div>
      </div>
      <div className="meaning-box">
        <span className="meaning-icon"><Icon name="arrows" /></span>
        <div>
          <h3>What this request means</h3>
          <p>
            The transaction requests permission for a spender to access a token within the allowance's scope.
            Depending on the token, spender, and amount, that permission may create meaningful financial risk.
          </p>
        </div>
      </div>
      <FindingCard finding={finding} />
      <details className="technical-details transaction-details">
        <summary>View technical details</summary>
        <div className="detail-grid">
          <DetailItem label="Network" value={result.network} />
          <DetailItem label="Method / function" value={result.method} />
          <DetailItem label="Target contract" value={result.targetAddress} />
          <DetailItem label="Token address" value={result.tokenAddress} />
          <DetailItem label="Spender address" value={result.spenderAddress} />
          <DetailItem label="Allowance" value={result.allowance} />
          <DetailItem label="Decode source" value="Illustrative fixture" />
          <DetailItem label="Request status" value="Pending · no transaction hash" />
        </div>
      </details>
      <Limitations items={result.notChecked} />
      <p className="subtle-disclaimer">
        A decoded method does not prove what every contract will do in all circumstances. An approval is not
        automatically malicious; review the spender, scope, contract behavior, and context.
      </p>
    </section>
  );
}

export function ContractResultPanel({ result }: { result: ContractResult }) {
  return (
    <section className="result-panel">
      <div className="result-header">
        <div>
          <div className="result-label">ILLUSTRATIVE DEMO DATA</div>
          <h2>{result.target}</h2>
          <p>{result.network}</p>
        </div>
        <Badge verdict={result.verdict} />
      </div>
      <div className="contract-facts">
        <DetailItem label="Source verification" value={result.sourceVerification} />
        <DetailItem label="Proxy status" value={result.proxyStatus} />
        <DetailItem label="Owner permissions" value={result.ownerPermissions} />
        <DetailItem label="Deployment age" value={result.deploymentAge} />
      </div>
      <div className="result-explanation">
        <span className="result-explanation-icon"><Icon name="shield" /></span>
        <p>{result.explanation}</p>
      </div>
      <Limitations items={result.notChecked} />
    </section>
  );
}
