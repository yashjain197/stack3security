import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { chainName } from "../lib/chains";
import { scanKindLabels } from "../lib/scans";
import type { ScanRecord, ScanVerdict } from "../types";
import { Icon } from "./Icon";
import { Badge, DetailItem, FindingCard, Limitations, verdictLabel } from "./ui";

const severityOrder = { critical: 0, high: 1, caution: 2, unknown: 3, no_known_issues: 4 };
// Repository scans can return up to 200 findings; the rest stay one click away.
const FIRST_FINDINGS = 25;

export function recordLink(record: ScanRecord): string {
  return `/dashboard/reports?id=${encodeURIComponent(record.id)}`;
}

export function ReportTable({ items, showView = true }: { items: ScanRecord[]; showView?: boolean }) {
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
          {items.map((record) => (
            <tr key={record.id}>
              <td>
                <strong className="table-target">{record.target}</strong>
                {record.chainId ? <small>{chainName(record.chainId)}</small> : null}
              </td>
              <td>{scanKindLabels[record.kind]}</td>
              <td><Badge verdict={record.verdict.level} /></td>
              <td>{record.verdict.findings.length}</td>
              <td>{new Date(record.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
              {showView ? (
                <td>
                  <Link className="table-action" to={recordLink(record)} aria-label={`View report for ${record.target}`}>
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

/** A live API verdict: overall level, explanation, recommended actions, findings and gaps. */
export function VerdictPanel({ verdict, label, title, subtitle, facts = [], children }: {
  verdict: ScanVerdict;
  label: string;
  title: string;
  subtitle?: string;
  facts?: [string, string][];
  children?: ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const findings = [...verdict.findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const shown = showAll ? findings : findings.slice(0, FIRST_FINDINGS);
  const indicators = [...verdict.indicators.addresses, ...verdict.indicators.domains];
  const counts = (["critical", "high", "caution"] as const)
    .map((level) => [level, findings.filter((finding) => finding.severity === level).length] as const)
    .filter(([, count]) => count > 0);
  return (
    <section className="result-panel">
      <div className="result-header">
        <div>
          <div className="result-label">{label}</div>
          <h2 className="result-target">{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <Badge verdict={verdict.level} />
      </div>
      {counts.length ? (
        <p className="severity-summary">
          {counts.map(([level, count]) => (
            <span key={level} className={`severity-count severity-count--${level}`}>
              <strong>{count}</strong> {verdictLabel(level).toLowerCase()}
            </span>
          ))}
        </p>
      ) : null}
      {facts.length ? (
        <div className="contract-facts">
          {facts.map(([factLabel, value]) => <DetailItem key={factLabel} label={factLabel} value={value} />)}
        </div>
      ) : null}
      {verdict.explanation || !findings.length ? (
        <div className="result-explanation">
          <p>{verdict.explanation ?? "The live checks found no known issues. This is not a guarantee of safety."}</p>
        </div>
      ) : null}
      {verdict.actions.length ? (
        <div className="limitations">
          <h3>Recommended actions</h3>
          <ul>{verdict.actions.map((action) => <li key={action}>{action}</li>)}</ul>
        </div>
      ) : null}
      {findings.length ? (
        <div className="finding-list">
          {shown.map((finding, index) => (
            <FindingCard key={`${finding.title}-${index}`} finding={finding} index={index + 1} />
          ))}
          {findings.length > shown.length ? (
            <button type="button" className="button button--secondary" onClick={() => setShowAll(true)}>
              Show all {findings.length} findings
            </button>
          ) : null}
        </div>
      ) : null}
      {indicators.length ? (
        <div className="limitations">
          <h3>Threat indicators</h3>
          <ul>{indicators.map((item) => <li key={item} className="mono-break">{item}</li>)}</ul>
        </div>
      ) : null}
      <Limitations items={verdict.notChecked} />
      {children}
    </section>
  );
}
