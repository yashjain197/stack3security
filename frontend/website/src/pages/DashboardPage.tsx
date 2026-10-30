import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { DemoBanner, PageHeading } from "../components/ui";
import { ReportTable } from "../components/results";
import { getDashboardData } from "../lib/security-service";

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
  const data = getDashboardData();
  const cards: [string, number, string, IconName, string][] = [
    ["Scans reviewed", data.scansReviewed, "Sample scan records in this demo", "grid", "stat-blue"],
    ["Critical findings", data.criticalFindings, "Sample findings classified critical", "shield", "stat-red"],
    ["Needs review", data.needsReview, "High-risk and caution findings", "scan", "stat-amber"],
    ["No known issues", data.noKnownIssues, "Not a guarantee of safety", "spark", "stat-green"],
  ];
  return (
    <>
      <DemoBanner />
      <PageHeading
        eyebrow="YOUR SECURITY WORKSPACE"
        title="Security overview"
        subtitle="Review recent findings across code, websites, transactions, and contracts."
        action={
          <Link className="button button--primary" to="/dashboard/scanner">
            Scan a website<Icon name="arrow" />
          </Link>
        }
      />
      <section className="stats-grid">
        {cards.map(([label, count, note, icon, color]) => (
          <article className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <span className={`stat-icon ${color}`}><Icon name={icon} /></span>
            </div>
            <strong>{count}</strong>
            <small>{note}</small>
          </article>
        ))}
      </section>
      <div className="dashboard-grid">
        <section className="panel activity-panel">
          <div className="panel-header">
            <div>
              <h2>Recent activity</h2>
              <p>Illustrative records from the local demo dataset.</p>
            </div>
            <Link to="/dashboard/reports" className="text-link">View reports <Icon name="arrow" /></Link>
          </div>
          <ReportTable items={data.reports.slice(0, 4)} showView={false} />
        </section>
        <section className="panel findings-panel">
          <div className="panel-header">
            <div>
              <h2>Findings by severity</h2>
              <p>Based on sample report verdicts.</p>
            </div>
          </div>
          <div className="severity-list">
            <SeverityRow label="Critical" count={data.criticalFindings} className="severity-red" />
            <SeverityRow label="High risk" count={data.reports.filter((item) => item.verdict === "high").length} className="severity-orange" />
            <SeverityRow label="Caution" count={data.reports.filter((item) => item.verdict === "caution").length} className="severity-blue" />
            <SeverityRow label="Unknown" count={data.reports.filter((item) => item.verdict === "unknown").length} className="severity-gray" />
          </div>
          <div className="panel-divider"></div>
          <Link to="/dashboard/transactions" className="risk-prompt">
            <Icon name="arrows" />
            <span>
              <strong>Review transaction intent</strong>
              <small>Compare the website's promise with the request.</small>
            </span>
            <Icon name="arrow" />
          </Link>
        </section>
      </div>
      <section className="quick-actions">
        <div>
          <h2>Quick actions</h2>
          <p>Explore an illustrative demo flow.</p>
        </div>
        <div className="quick-action-list">
          <QuickAction icon="scan" title="Scan a website" description="Try the sample recovery-site scan." path="/dashboard/scanner" />
          <QuickAction icon="arrows" title="Review a transaction" description="Understand an illustrative approval." path="/dashboard/transactions" />
          <QuickAction icon="blocks" title="Explore contract details" description="See what is and is not known." path="/dashboard/contracts" />
        </div>
      </section>
    </>
  );
}
