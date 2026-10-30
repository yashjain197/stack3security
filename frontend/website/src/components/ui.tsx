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

/** A shimmering placeholder bar; `width` is any CSS width. */
export function Skeleton({ width = "100%", height = 12 }: { width?: string; height?: number }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

/** Placeholder in the shape of a scan report, shown while a live check runs. */
export function ResultSkeleton({ label }: { label: string }) {
  return (
    <section className="result-panel result-skeleton" role="status" aria-label={label}>
      <div className="result-header">
        <div className="skeleton-stack">
          <Skeleton width="140px" height={10} />
          <Skeleton width="min(320px, 70%)" height={18} />
        </div>
        <Skeleton width="84px" height={24} />
      </div>
      <div className="skeleton-stack skeleton-stack--body">
        <Skeleton width="92%" />
        <Skeleton width="68%" />
      </div>
      {[0, 1].map((key) => (
        <div className="finding-card skeleton-card" key={key}>
          <Skeleton width="120px" height={10} />
          <Skeleton width="55%" height={14} />
          <Skeleton width="85%" />
        </div>
      ))}
      <span className="visually-hidden">{label}</span>
    </section>
  );
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
