import type { GraphData, GraphEdge, GraphNode } from "../types";
import {
  edgeShortLabels,
  edgeTypes,
  formatDate,
  normalizeRisk,
  riskColors,
  riskFills,
  riskLabels,
  shorten,
} from "../lib/graph-model";

export type PeerRef = { type: string; id: string };

function RiskBadge({ risk }: { risk: string }) {
  const level = normalizeRisk(risk);
  return (
    <span className={`verdict verdict--${level}`}>
      <span className="verdict-dot"></span>
      {riskLabels[level]}
    </span>
  );
}

function GraphSvg({ node, edges, onOpenPeer }: {
  node: GraphNode;
  edges: GraphEdge[];
  onOpenPeer: (peer: PeerRef) => void;
}) {
  const shown = edges.slice(0, 12);
  if (!shown.length) {
    return <div className="graph-empty-edges">No connections recorded for this node yet.</div>;
  }
  const W = 720;
  const H = 460;
  const cx = W / 2;
  const cy = H / 2;
  const radiusX = 260;
  const radiusY = 160;
  const centerR = 54;
  const peerR = 36;
  const risk = normalizeRisk(node.risk);
  const color = riskColors[risk];
  const fill = riskFills[risk];
  const peers = shown.map((edge, index) => {
    const angle = (2 * Math.PI * index) / shown.length - Math.PI / 2;
    return { edge, x: cx + radiusX * Math.cos(angle), y: cy + radiusY * Math.sin(angle) };
  });

  return (
    <>
      <div className="graph-svg-wrap">
        <svg
          className="graph-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Connections of ${node.id}`}
        >
          <defs>
            <marker
              id="graph-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0 10 5 0 10Z" fill="#8aa0bd" />
            </marker>
          </defs>
          {peers.map(({ edge, x, y }, index) => {
            const dx = x - cx;
            const dy = y - cy;
            const length = Math.hypot(dx, dy) || 1;
            const sx = cx + (dx / length) * (centerR + 5);
            const sy = cy + (dy / length) * (centerR + 5);
            const ex = x - (dx / length) * (peerR + 7);
            const ey = y - (dy / length) * (peerR + 7);
            const [x1, y1, x2, y2] = edge.direction === "in" ? [ex, ey, sx, sy] : [sx, sy, ex, ey];
            return (
              <g key={`edge-${index}`}>
                <line
                  className="graph-edge-line"
                  x1={x1.toFixed(1)}
                  y1={y1.toFixed(1)}
                  x2={x2.toFixed(1)}
                  y2={y2.toFixed(1)}
                  markerEnd="url(#graph-arrow)"
                />
                <text
                  className="graph-edge-label"
                  x={((sx + ex) / 2).toFixed(1)}
                  y={((sy + ey) / 2 - 5).toFixed(1)}
                >
                  {edgeShortLabels[edge.type] ?? edge.type}
                </text>
              </g>
            );
          })}
          {peers.map(({ edge, x, y }, index) => (
            <g
              key={`peer-${index}`}
              className="graph-peer"
              role="link"
              tabIndex={0}
              data-graph-peer
              data-type={edge.peerType}
              data-id={edge.peerId}
              aria-label={`Open ${edge.peerType} ${edge.peerId}`}
              onClick={() => onOpenPeer({ type: edge.peerType, id: edge.peerId })}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenPeer({ type: edge.peerType, id: edge.peerId });
                }
              }}
            >
              <title>{edge.peerType}: {edge.peerId}</title>
              <circle className="graph-peer-circle" cx={x.toFixed(1)} cy={y.toFixed(1)} r={peerR} />
              <text className="graph-peer-type" x={x.toFixed(1)} y={(y + 3.5).toFixed(1)}>
                {edge.peerType.toUpperCase()}
              </text>
              <text className="graph-peer-id" x={x.toFixed(1)} y={(y + peerR + 15).toFixed(1)}>
                {shorten(edge.peerId, 26)}
              </text>
            </g>
          ))}
          <g className="graph-center">
            <circle cx={cx} cy={cy} r={centerR} fill={fill} stroke={color} strokeWidth="2" />
            <text className="graph-center-type" x={cx} y={cy - 6} fill={color}>
              {node.type.toUpperCase()}
            </text>
            <text className="graph-center-id" x={cx} y={cy + 10}>{shorten(node.id, 18)}</text>
          </g>
        </svg>
      </div>
      {edges.length > shown.length ? (
        <p className="input-helper">
          Showing {shown.length} of {edges.length} connections in the diagram. All of them are listed below.
        </p>
      ) : null}
    </>
  );
}

export function GraphResult({ data, onOpenPeer, onReport }: {
  data: GraphData;
  onOpenPeer: (peer: PeerRef) => void;
  onReport: (node: GraphNode) => void;
}) {
  const { node, edges = [], source } = data;
  const attributes = node.attributes ?? {};
  const facts: [string, string][] = [
    ["Reports", String(node.reportCount ?? 0)],
    ["First seen", formatDate(node.firstSeen)],
    ["Last seen", formatDate(node.lastSeen)],
    ["Category", node.category ?? "Not set"],
    ...Object.entries(attributes).map(
      ([key, value]) => [key.replaceAll("_", " "), String(value)] as [string, string],
    ),
  ];
  return (
    <section className="result-panel graph-result">
      <div className="result-header">
        <div>
          <div className="result-label">LIVE THREAT GRAPH · SOURCE: {(source ?? "database").toUpperCase()}</div>
          <h2 className="graph-node-id">{node.id}</h2>
          <p>
            {node.type}
            {node.category ? ` · ${node.category}` : ""}
          </p>
        </div>
        <RiskBadge risk={node.risk} />
      </div>
      <div className="contract-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <GraphSvg node={node} edges={edges} onOpenPeer={onOpenPeer} />
      {edges.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Relationship</th>
                <th>Direction</th>
                <th>Peer</th>
                <th>Tx hash</th>
              </tr>
            </thead>
            <tbody>
              {edges.map((edge, index) => {
                const peerLabel = `${edge.peerType} · ${shorten(edge.peerId, 30)}`;
                const sentence = edge.direction === "in"
                  ? `${peerLabel} → this node`
                  : `this node → ${peerLabel}`;
                return (
                  <tr key={index}>
                    <td>
                      <strong className="table-target">
                        {edgeTypes.find(([type]) => type === edge.type)?.[1] ?? edge.type}
                      </strong>
                      <small>{edge.type}</small>
                    </td>
                    <td>{sentence}</td>
                    <td>
                      <button
                        type="button"
                        className="graph-peer-link"
                        data-graph-peer
                        data-type={edge.peerType}
                        data-id={edge.peerId}
                        title={edge.peerId}
                        onClick={() => onOpenPeer({ type: edge.peerType, id: edge.peerId })}
                      >
                        {shorten(edge.peerId, 34)}
                      </button>
                    </td>
                    <td>
                      {edge.txHash ? <code className="graph-code">{shorten(edge.txHash, 18)}</code> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="graph-result-actions">
        <button
          type="button"
          className="button button--secondary button--small"
          data-graph-report
          data-type={node.type}
          data-id={node.id}
          data-risk={node.risk}
          data-category={node.category ?? ""}
          onClick={() => onReport(node)}
        >
          Report this node
        </button>
        <span className="input-helper">Risk indicators, not a guarantee. Anyone on your plan sees the same graph.</span>
      </div>
    </section>
  );
}

export function GraphNodeNotFound({ type, id, onReport }: {
  type: string;
  id: string;
  onReport: () => void;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </span>
      <h2>We have never seen this {type}</h2>
      <p>
        <code className="graph-code">{shorten(id, 60)}</code> is not in the threat graph yet. If it did something
        suspicious, report it below.
      </p>
      <button type="button" className="button button--secondary" onClick={onReport}>
        Report it
      </button>
    </div>
  );
}
