import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { PageHeading } from "../components/ui";
import { ReportTable } from "../components/results";
import { useScanHistory } from "../lib/scans";
import { useSession } from "../lib/session";

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
  const count = (level: string) => records.filter((record) => record.verdict.level === level).length;
  const cards: [string, number, string, IconName, string][] = [
    ["Scans run", records.length, "Live scans saved in this browser", "grid", "stat-blue"],
    ["Critical", count("critical"), "Scans rated critical", "shield", "stat-red"],
    ["Needs review", count("high") + count("caution"), "High-risk and caution results", "scan", "stat-amber"],
    ["No known issues", count("no_known_issues"), "Not a guarantee of safety", "spark", "stat-green"],
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
        {cards.map(([label, value, note, icon, color]) => (
          <article className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <span className={`stat-icon ${color}`}><Icon name={icon} /></span>
            </div>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </section>
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
        </div>
      </section>
    </>
  );
}
