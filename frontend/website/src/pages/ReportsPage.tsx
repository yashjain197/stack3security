import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Badge, DemoBanner, FindingCard, Limitations, PageHeading } from "../components/ui";
import { ReportTable } from "../components/results";
import { getReport } from "../lib/security-service";
import { reports } from "../lib/mock-data";

export function ReportsPage() {
  const [params] = useSearchParams();
  const target = params.get("target");
  const report = target ? getReport(target) : null;

  let detail;
  if (report) {
    detail = (
      <section className="report-detail panel">
        <div className="report-detail-header">
          <div>
            <div className="result-label">ILLUSTRATIVE DEMO REPORT</div>
            <h2>{report.target}</h2>
            <p>{report.type} · {report.date}</p>
          </div>
          <Badge verdict={report.verdict} />
        </div>
        <p className="report-summary">{report.detail}</p>
        <div className="report-findings">
          <strong>{report.findings} {report.findings === 1 ? "finding" : "findings"}</strong>
          <span>Evidence, sources, and recommendations are illustrative.</span>
        </div>
        {report.findingDetails.map((finding, index) => (
          <FindingCard key={finding.title} finding={finding} index={index + 1} />
        ))}
        <Limitations items={report.notChecked} />
        <Link to="/dashboard/reports" className="text-link"><Icon name="arrow" /> Back to all reports</Link>
      </section>
    );
  } else if (target) {
    detail = (
      <div className="empty-state">
        <span className="empty-state-icon"><Icon name="file" /></span>
        <h2>Report not found</h2>
        <p>This target is not included in the local demo report set.</p>
        <Link className="button button--secondary" to="/dashboard/reports">View all reports</Link>
      </div>
    );
  } else {
    detail = (
      <section className="panel reports-panel">
        <div className="panel-header">
          <div>
            <h2>Recent scan reports</h2>
            <p>Review what was checked, what was found, and what remains unknown.</p>
          </div>
        </div>
        <ReportTable items={reports} />
      </section>
    );
  }

  return (
    <>
      <DemoBanner />
      <PageHeading
        eyebrow="YOUR SECURITY WORKSPACE"
        title="Scan reports"
        subtitle="Review findings, evidence, and checks not performed."
      />
      {detail}
    </>
  );
}
