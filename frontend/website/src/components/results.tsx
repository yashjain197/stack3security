import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { chainName } from "../lib/chains";
import { scanKindLabels } from "../lib/scans";
import type { ScanRecord, ScanVerdict } from "../types";
import { Icon } from "./Icon";
import { Badge, DetailItem, FindingCard, Limitations } from "./ui";

const severityOrder = { critical: 0, high: 1, caution: 2, unknown: 3, no_known_issues: 4 };

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
              <td>{new Date(record.createdAt).toLocaleString()}</td>
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
  const findings = [...verdict.findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const indicators = [...verdict.indicators.addresses, ...verdict.indicators.domains];
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
      {facts.length ? (
        <div className="contract-facts">
          {facts.map(([factLabel, value]) => <DetailItem key={factLabel} label={factLabel} value={value} />)}
        </div>
      ) : null}
      <div className="result-explanation">
        <span className="result-explanation-icon"><Icon name="shield" /></span>
        <p>
          {verdict.explanation ??
            (findings.length
              ? `${findings.length} ${findings.length === 1 ? "finding" : "findings"} from the live checks. Review them below.`
              : "The live checks found no known issues. This is not a guarantee of safety.")}
        </p>
      </div>
      {verdict.actions.length ? (
        <div className="limitations">
          <h3>Recommended actions</h3>
          <ul>{verdict.actions.map((action) => <li key={action}>{action}</li>)}</ul>
        </div>
      ) : null}
      {findings.length ? (
        <div className="finding-list">
          {findings.map((finding, index) => (
            <FindingCard key={`${finding.title}-${index}`} finding={finding} index={index + 1} />
          ))}
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
