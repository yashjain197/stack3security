import type { ReactNode } from "react";
import type { Finding, Verdict } from "../types";
import { demoNotice } from "../lib/mock-data";
import { Icon } from "./Icon";

export function verdictLabel(verdict: string): string {
  return {
    critical: "Critical",
    high: "High risk",
    caution: "Caution",
    unknown: "Unknown",
    no_known_issues: "No known issues found",
  }[verdict] ?? "Unknown";
}

export function Badge({ verdict }: { verdict: Verdict | string }) {
  return (
    <span className={`verdict verdict--${verdict}`}>
      <span className="verdict-dot"></span>
      {verdictLabel(verdict)}
    </span>
  );
}

export function DemoBanner({ text = demoNotice }: { text?: string }) {
  return (
    <div className="demo-banner">
      <Icon name="shield" />
      <span>{text}</span>
    </div>
  );
}

export function PageHeading({ eyebrow, title, subtitle, action }: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true"></span>;
}

export function FindingCard({ finding, index = 1 }: { finding: Finding; index?: number }) {
  return (
    <article className="finding-card">
      <div className="finding-card-top">
        <span className="finding-index">0{index}</span>
        <Badge verdict={finding.severity} />
        <span className="finding-layer">{finding.layer} signal</span>
      </div>
      <h3>{finding.title}</h3>
      <p>{finding.evidence}</p>
      <details className="technical-details">
        <summary>View technical details</summary>
        <div className="technical-body">
          <div>
            <strong>Evidence source</strong>
            <span>{finding.source ?? "Not available in demo"}</span>
          </div>
          {finding.recommendation ? (
            <div>
              <strong>Recommended action</strong>
              <span>{finding.recommendation}</span>
            </div>
          ) : null}
        </div>
      </details>
    </article>
  );
}

export function Limitations({ items }: { items: string[] }) {
  return (
    <div className="limitations">
      <h3>Checks not performed</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
