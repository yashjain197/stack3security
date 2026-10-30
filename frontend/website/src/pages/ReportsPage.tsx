import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PageHeading } from "../components/ui";
import { ReportTable, VerdictPanel } from "../components/results";
import { chainName } from "../lib/chains";
import { scanKindLabels, useScanHistory } from "../lib/scans";
import { useSession } from "../lib/session";

export function ReportsPage() {
  const { user } = useSession();
  const { records, clear } = useScanHistory(user?.id);
  const [params] = useSearchParams();
  const [confirming, setConfirming] = useState(false);
  const id = params.get("id");
  const record = id ? records.find((item) => item.id === id) : null;

  let detail;
  if (record) {
    detail = (
      <>
        <VerdictPanel
          verdict={record.verdict}
          label={`${scanKindLabels[record.kind].toUpperCase()} SCAN · ${new Date(record.createdAt).toLocaleString()}`}
          title={record.target}
          subtitle={record.chainId ? chainName(record.chainId) : undefined}
        />
        <Link to="/dashboard/reports" className="text-link"><Icon name="arrow" /> Back to all reports</Link>
      </>
    );
  } else if (id) {
    detail = (
      <div className="empty-state">
        <span className="empty-state-icon"><Icon name="file" /></span>
        <h2>Report not found</h2>
        <p>This scan is not in this browser's history. It may have been cleared or run on another device.</p>
        <Link className="button button--secondary" to="/dashboard/reports">View all reports</Link>
      </div>
    );
  } else if (!records.length) {
    detail = (
      <div className="empty-state">
        <span className="empty-state-icon"><Icon name="file" /></span>
        <h2>No scans yet</h2>
        <p>Scan a website, contract or wallet request and the live result is saved here.</p>
        <Link className="button button--primary" to="/dashboard/scanner">Scan a website</Link>
      </div>
    );
  } else {
    detail = (
      <section className="panel reports-panel">
        <div className="panel-header">
          <div>
            <h2>Recent scan reports</h2>
            <p>Your last {records.length} live {records.length === 1 ? "scan" : "scans"}, saved in this browser.</p>
          </div>
          {confirming ? (
            <span className="inline-actions">
              <button type="button" className="button button--secondary" onClick={() => setConfirming(false)}>Keep</button>
              <button type="button" className="button button--danger" onClick={() => { clear(); setConfirming(false); }}>Clear history</button>
            </span>
          ) : (
            <button type="button" className="button button--secondary" onClick={() => setConfirming(true)}>Clear history</button>
          )}
        </div>
        <ReportTable items={records} />
      </section>
    );
  }

  return (
    <>
      <PageHeading
        eyebrow="YOUR SECURITY WORKSPACE"
        title="Scan reports"
        subtitle="Findings, evidence, and checks not performed for every scan you run."
      />
      {detail}
    </>
  );
}
