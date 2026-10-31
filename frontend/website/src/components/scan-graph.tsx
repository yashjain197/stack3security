import { useMemo, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { chainName } from "../lib/chains";
import { nodeTypeLabels, shorten } from "../lib/graph-model";
import { scanKindLabels } from "../lib/scans";
import { buildScanGraph, type GraphRef, type ScanGraphScan } from "../lib/scan-graph";
import type { ScanRecord, Verdict } from "../types";
import { recordLink } from "./results";
import { Badge, verdictLabel } from "./ui";
import { Icon } from "./Icon";

const levelColors: Record<Verdict, string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  caution: "var(--caution)",
  unknown: "var(--unknown)",
  no_known_issues: "var(--ok)",
};

type Filter = "all" | "critical" | "high" | "caution";
const filters: [Filter, string][] = [["all", "All scans"], ["critical", "Critical"], ["high", "High"], ["caution", "Caution"]];
const FIRST_FINDINGS = 12;

const W = 760;
const ROW = 58;
const NODE_H = 42;
const TOP = 34;

function activate(handler: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler();
    }
  };
}

function matchesFilter(scan: ScanGraphScan, filter: Filter): boolean {
  return filter === "all" || scan.record.verdict.level === filter || scan.counts[filter] > 0;
}

/** Every scan saved in this browser, drawn against the wallets and domains its findings point at. */
export function ScanFindingsGraph({ records, onOpenPeer }: {
  records: ScanRecord[];
  onOpenPeer: (peer: GraphRef) => void;
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [hovered, setHovered] = useState<string | null>(null);
  const [showAllFindings, setShowAllFindings] = useState(false);
  const graph = useMemo(() => buildScanGraph(records), [records]);

  if (!records.length) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon"><Icon name="graph" /></span>
        <h2>No scans to graph yet</h2>
        <p>
          Scan a website, contract, wallet request or repository. Each result is drawn here with the wallets and
          domains it found, so shared infrastructure stands out.
        </p>
        <Link className="button button--primary" to="/dashboard/scanner">Scan a website</Link>
      </div>
    );
  }

  const scans = graph.scans.filter((scan) => matchesFilter(scan, filter));
  const scanKeys = new Set(scans.map((scan) => scan.key));
  const links = graph.links.filter((link) => scanKeys.has(link.scan));
  const indicatorKeys = new Set(links.map((link) => link.indicator));
  const indicators = graph.indicators.filter((indicator) => indicatorKeys.has(indicator.key));
  const findings = graph.findings.filter(({ finding, record }) =>
    filter === "all" ? true : finding.severity === filter || (record.verdict.level === filter && !record.verdict.findings.length),
  );
  const shownFindings = showAllFindings ? findings : findings.slice(0, FIRST_FINDINGS);

  // Hovering a node lights up it and everything it is linked to.
  const lit = new Set<string>();
  if (hovered) {
    lit.add(hovered);
    for (const link of links) {
      if (link.scan === hovered) lit.add(link.indicator);
      if (link.indicator === hovered) lit.add(link.scan);
    }
  }
  const dim = (key: string) => (hovered && !lit.has(key) ? " scan-graph-dim" : "");

  const hasIndicators = indicators.length > 0;
  const scanW = hasIndicators ? 280 : 420;
  const scanX = hasIndicators ? 16 : (W - scanW) / 2;
  const indW = 250;
  const indX = W - 16 - indW;
  const rows = Math.max(scans.length, indicators.length, 1);
  const H = TOP + rows * ROW + 8;
  const rowY = (index: number, count: number) => TOP + index * ROW + ((rows - count) * ROW) / 2 + (ROW - NODE_H) / 2;
  const scanPos = new Map(scans.map((scan, index) => [scan.key, rowY(index, scans.length)]));
  const indPos = new Map(indicators.map((indicator, index) => [indicator.key, rowY(index, indicators.length)]));

  const stats: [string, number, string][] = [
    ["Scans", graph.scans.length + graph.hiddenScans, "latest result per target"],
    ["Findings", graph.findings.length, `${graph.totals.critical} critical · ${graph.totals.high} high`],
    ["Risky targets", graph.scans.filter((scan) => ["critical", "high"].includes(scan.record.verdict.level)).length, "critical or high verdict"],
    ["Linked indicators", graph.indicators.length + graph.hiddenIndicators, "wallets and domains found"],
  ];

  return (
    <section className="result-panel scan-graph">
      <div className="stats-grid scan-graph-stats">
        {stats.map(([label, value, note]) => (
          <article className="stat-card" key={label}>
            <div className="stat-top"><span>{label}</span></div>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>

      <div className="scan-graph-toolbar">
        <div className="segmented" role="group" aria-label="Filter by severity">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`segmented-option${filter === value ? " segmented-option--active" : ""}`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="input-helper">Hover a node to trace its links. Click a scan for its report, an indicator to look it up.</span>
      </div>

      {scans.length ? (
        <div className="graph-svg-wrap">
          <svg className="graph-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Your scans and the indicators they found">
            <text className="scan-graph-heading" x={scanX} y={20}>YOUR SCANS</text>
            {hasIndicators ? <text className="scan-graph-heading" x={indX} y={20}>WALLETS AND DOMAINS FOUND</text> : null}
            {links.map((link) => {
              const sy = (scanPos.get(link.scan) ?? 0) + NODE_H / 2;
              const ey = (indPos.get(link.indicator) ?? 0) + NODE_H / 2;
              const sx = scanX + scanW;
              const ex = indX;
              const mid = (sx + ex) / 2;
              const scan = scans.find((item) => item.key === link.scan)!;
              const active = hovered === link.scan || hovered === link.indicator;
              return (
                <path
                  key={`${link.scan}-${link.indicator}`}
                  className={`scan-graph-link${hovered ? (active ? " scan-graph-link--active" : " scan-graph-dim") : ""}`}
                  d={`M${sx} ${sy} C${mid} ${sy} ${mid} ${ey} ${ex} ${ey}`}
                  style={{ stroke: levelColors[scan.record.verdict.level] ?? levelColors.unknown }}
                />
              );
            })}
            {scans.map((scan) => {
              const y = scanPos.get(scan.key) ?? 0;
              const { record } = scan;
              const level = record.verdict.level;
              const total = record.verdict.findings.length;
              const open = () => navigate(recordLink(record));
              return (
                <g
                  key={scan.key}
                  className={`scan-graph-node${dim(scan.key)}`}
                  role="link"
                  tabIndex={0}
                  data-scan-node={record.id}
                  aria-label={`${scanKindLabels[record.kind]} scan of ${record.target}: ${verdictLabel(level)}, ${total} findings. Open report.`}
                  onClick={open}
                  onKeyDown={activate(open)}
                  onMouseEnter={() => setHovered(scan.key)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(scan.key)}
                  onBlur={() => setHovered(null)}
                >
                  <title>{`${record.target}\n${verdictLabel(level)} · ${total} findings`}</title>
                  <rect className="scan-graph-box" x={scanX} y={y} width={scanW} height={NODE_H} rx={7} />
                  <rect x={scanX} y={y} width={4} height={NODE_H} rx={2} style={{ fill: levelColors[level] ?? levelColors.unknown }} />
                  <text className="scan-graph-kind" x={scanX + 14} y={y + 16} style={{ fill: levelColors[level] ?? levelColors.unknown }}>
                    {`${scanKindLabels[record.kind].toUpperCase()} · ${verdictLabel(level).toUpperCase()}`}
                  </text>
                  <text className="scan-graph-id" x={scanX + 14} y={y + 32}>
                    {shorten(record.target, hasIndicators ? 30 : 46)}
                  </text>
                  <text className="scan-graph-count" x={scanX + scanW - 12} y={y + 26}>
                    {total ? `${total} finding${total === 1 ? "" : "s"}` : "no findings"}
                  </text>
                </g>
              );
            })}
            {indicators.map((indicator) => {
              const y = indPos.get(indicator.key) ?? 0;
              const open = () => onOpenPeer(indicator.ref);
              const shared = indicator.scanKeys.length;
              return (
                <g
                  key={indicator.key}
                  className={`scan-graph-node${dim(indicator.key)}`}
                  role="link"
                  tabIndex={0}
                  data-indicator-node={indicator.key}
                  aria-label={`${indicator.ref.type} ${indicator.ref.id}, found by ${shared} scan${shared === 1 ? "" : "s"}. Look it up in the threat graph.`}
                  onClick={open}
                  onKeyDown={activate(open)}
                  onMouseEnter={() => setHovered(indicator.key)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(indicator.key)}
                  onBlur={() => setHovered(null)}
                >
                  <title>{`${indicator.ref.type}: ${indicator.ref.id}`}</title>
                  <rect className="scan-graph-box" x={indX} y={y} width={indW} height={NODE_H} rx={21} />
                  <circle cx={indX + 20} cy={y + NODE_H / 2} r={5} style={{ fill: levelColors[indicator.level] ?? levelColors.unknown }} />
                  <text className="scan-graph-kind" x={indX + 34} y={y + 16}>
                    {`${nodeTypeLabels[indicator.ref.type].toUpperCase()}${shared > 1 ? ` · ${shared} SCANS` : ""}`}
                  </text>
                  <text className="scan-graph-id" x={indX + 34} y={y + 32}>{shorten(indicator.ref.id, 28)}</text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="graph-empty-edges">No scans match this filter.</div>
      )}
      {!hasIndicators && scans.length ? (
        <p className="input-helper">These scans did not point at any wallets or domains, so there are no links to draw yet.</p>
      ) : null}
      {graph.hiddenScans || graph.hiddenIndicators ? (
        <p className="input-helper">
          The diagram shows your {graph.scans.length} most recent targets
          {graph.hiddenIndicators ? ` and ${graph.indicators.length} most connected indicators` : ""}. Every finding is listed below.
        </p>
      ) : null}

      <div className="scan-graph-findings">
        <h3>Findings {filter === "all" ? "across all scans" : `· ${verdictLabel(filter)}`} <span>({findings.length})</span></h3>
        {findings.length ? (
          <ul>
            {shownFindings.map(({ finding, record }, index) => (
              <li key={`${record.id}-${index}`}>
                <Badge verdict={finding.severity} />
                <div>
                  <strong>{finding.title}</strong>
                  <p>{finding.evidence}</p>
                  <Link className="scan-graph-target" to={recordLink(record)}>
                    {scanKindLabels[record.kind]} · {shorten(record.target, 48)}
                    {record.chainId ? ` · ${chainName(record.chainId)}` : ""}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="input-helper">No findings at this severity.</p>
        )}
        {findings.length > FIRST_FINDINGS ? (
          <button type="button" className="button button--secondary button--small" onClick={() => setShowAllFindings((value) => !value)}>
            {showAllFindings ? "Show fewer" : `Show all ${findings.length} findings`}
          </button>
        ) : null}
      </div>
    </section>
  );
}
