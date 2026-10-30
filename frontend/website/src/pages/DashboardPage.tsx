import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { PageHeading, Skeleton } from "../components/ui";
import { ReportTable } from "../components/results";
import { getScanStats, useScanHistory } from "../lib/scans";
import { useApi, useSession } from "../lib/session";
import type { ScanStats } from "../types";

/** Live repo-scan counters from the scan service. Hidden when the service cannot be reached. */
/** undefined while loading, null when the scan service cannot be reached. */
function useScanStats(): ScanStats | null | undefined {
  const api = useApi();
  const [stats, setStats] = useState<ScanStats | null | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    getScanStats(api, controller.signal)
      .then((data) => setStats(typeof data?.reposScanned === "number" && typeof data.threatsFound === "number" ? data : null))
      .catch(() => setStats(null));
    return () => controller.abort();
  }, [api]);
  return stats;
}

function SeverityRow({ label, count, className }: { label: string; count: number; className: string }) {
  return (
    <div className="severity-row">
      <span className="severity-label"><i className={className}></i>{label}</span>
      <strong>{count}</strong>
    </div>
  );
}

function QuickAction({ icon, title, description, path }: { icon: IconName; title: string; description: string; path: string }) {
  return (
    <Link className="quick-action" to={path}>
      <span className="quick-action-icon"><Icon name={icon} /></span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <Icon name="arrow" />
    </Link>
  );
}

export function DashboardPage() {
  const { user } = useSession();
  const { records } = useScanHistory(user?.id);
  const stats = useScanStats();
  const count = (level: string) => records.filter((record) => record.verdict.level === level).length;
  const cards: [string, number, string][] = [
    ["Scans run", records.length, "Live scans saved in this browser"],
    ["Critical", count("critical"), "Scans rated critical"],
    ["Needs review", count("high") + count("caution"), "High-risk and caution results"],
    ["No known issues", count("no_known_issues"), "Not a guarantee of safety"],
  ];
  return (
    <>
      <PageHeading
        eyebrow="YOUR SECURITY WORKSPACE"
        title="Security overview"
        subtitle="Your recent website, contract and transaction scans."
        action={
          <Link className="button button--primary" to="/dashboard/scanner">
            Scan a website<Icon name="arrow" />
          </Link>
        }
      />
      <section className="stats-grid">
        {cards.map(([label, value, note]) => (
          <article className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
            </div>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </section>
      {stats === undefined ? (
        <p className="service-stats" aria-hidden="true"><Skeleton width="min(420px, 80%)" height={14} /></p>
      ) : null}
      {stats ? (
        <p className="service-stats">
          <span>Stack3 scan service</span>
          <span><strong>{stats.reposScanned.toLocaleString()}</strong> repositories scanned</span>
          <span><strong>{stats.threatsFound.toLocaleString()}</strong> critical or high-risk</span>
          <span>since {new Date(stats.since).toLocaleDateString()}</span>
        </p>
      ) : null}
      <div className="dashboard-grid">
        <section className="panel activity-panel">
          <div className="panel-header">
            <div>
              <h2>Recent activity</h2>
              <p>Your latest live scans.</p>
            </div>
            <Link to="/dashboard/reports" className="text-link">View reports <Icon name="arrow" /></Link>
          </div>
          {records.length ? (
            <ReportTable items={records.slice(0, 5)} showView={false} />
          ) : (
            <p className="empty-inline">No scans yet. Run your first scan with one of the quick actions below.</p>
          )}
        </section>
        <section className="panel findings-panel">
          <div className="panel-header">
            <div>
              <h2>Results by severity</h2>
              <p>Overall verdict of each scan.</p>
            </div>
          </div>
          <div className="severity-list">
            <SeverityRow label="Critical" count={count("critical")} className="severity-red" />
            <SeverityRow label="High risk" count={count("high")} className="severity-orange" />
            <SeverityRow label="Caution" count={count("caution")} className="severity-blue" />
            <SeverityRow label="Unknown" count={count("unknown")} className="severity-gray" />
          </div>
          <div className="panel-divider"></div>
          <Link to="/dashboard/transactions" className="risk-prompt">
            <Icon name="arrows" />
            <span>
              <strong>Review a wallet request</strong>
              <small>Decode what a site is asking you to sign.</small>
            </span>
            <Icon name="arrow" />
          </Link>
        </section>
      </div>
      <section className="quick-actions">
        <div>
          <h2>Quick actions</h2>
          <p>Every check runs live against the Stack3 API.</p>
        </div>
        <div className="quick-action-list">
          <QuickAction icon="scan" title="Scan a website" description="Blocklists, threat graph and lookalike checks." path="/dashboard/scanner" />
          <QuickAction icon="arrows" title="Review a transaction" description="Decode approvals, permits and signatures." path="/dashboard/transactions" />
          <QuickAction icon="blocks" title="Check a contract" description="Verification, owner control and age." path="/dashboard/contracts" />
          <QuickAction icon="code" title="Scan a repository" description="Install scripts, secrets and dependencies." path="/dashboard/repos" />
        </div>
      </section>
    </>
  );
}
