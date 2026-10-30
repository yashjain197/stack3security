import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/api";
import { errorMessage } from "../lib/session";
import type { Finding, Verdict } from "../types";

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

const layerLabels: Record<string, string> = {
  "repo-file": "Repository",
  dependency: "Dependency",
  secret: "Secret",
  site: "Website",
  contract: "Contract",
  tx: "Transaction",
  intent: "Signature intent",
  graph: "Threat graph",
};

const sourceLabels: Record<string, string> = {
  rules: "Stack3 rules",
  graph: "Stack3 threat graph",
  socket: "Socket",
  sourcify: "Sourcify",
};

/** A failed live check, with the next step when the API says what is missing. */
export function ScanError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p className="form-error" role="alert">
      {errorMessage(error)}
      {error instanceof ApiError && error.code === "feature_required" ? (
        <> <Link to="/pricing">View plans</Link></>
      ) : null}
    </p>
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
        <span className="finding-index">{String(index).padStart(2, "0")}</span>
        <Badge verdict={finding.severity} />
        <span className="finding-layer">{layerLabels[finding.layer] ?? finding.layer} signal</span>
      </div>
      <h3>{finding.title}</h3>
      {finding.location?.file ? (
        <code className="finding-location">
          {finding.location.file}{finding.location.line ? `:${finding.location.line}` : ""}
        </code>
      ) : null}
      <p>{finding.evidence}</p>
      <details className="technical-details">
        <summary>View technical details</summary>
        <div className="technical-body">
          <div>
            <strong>Evidence source</strong>
            <span>{sourceLabels[finding.source] ?? finding.source}</span>
          </div>
          <div>
            <strong>Checked</strong>
            <span>{new Date(finding.checkedAt).toLocaleString()}</span>
          </div>
        </div>
      </details>
    </article>
  );
}

export function Limitations({ items }: { items: string[] }) {
  if (!items.length) return null;
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
