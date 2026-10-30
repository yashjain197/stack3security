import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/session";
import {
  edgeTypes,
  idRules,
  isNodeType,
  nodeTypes,
  riskLevels,
  seedExamples,
  validateNodeId,
} from "../lib/graph-model";
import type { GraphData, GraphNode, GraphNodeType } from "../types";
import { GraphNodeNotFound, GraphResult, type PeerRef } from "../components/graph";
import { ResultSkeleton } from "../components/ui";

type NodeDraft = {
  key: number;
  type: GraphNodeType;
  id: string;
  risk: string;
  category: string;
  label: string;
  impersonates: string;
};

type EdgeDraft = {
  key: number;
  type: string;
  fromId: string;
  toId: string;
  txHash: string;
};

let draftKey = 0;
const newNodeDraft = (prefill: Partial<NodeDraft> = {}): NodeDraft => ({
  key: ++draftKey,
  type: isNodeType(prefill.type) ? prefill.type : "domain",
  id: prefill.id ?? "",
  risk: (riskLevels as string[]).includes(prefill.risk ?? "") ? prefill.risk! : "high",
  category: prefill.category ?? "",
  label: "",
  impersonates: "",
});
const newEdgeDraft = (): EdgeDraft => ({ key: ++draftKey, type: "domain_drains_to", fromId: "", toId: "", txHash: "" });

type GraphState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: GraphData }
  | { status: "not_found"; type: string; id: string }
  | { status: "error"; error: ApiError | Error };

export function GraphPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const paramType = isNodeType(params.get("type")) ? (params.get("type") as GraphNodeType) : "wallet";
  const paramId = params.get("id") ?? "";

  const [lookupType, setLookupType] = useState<GraphNodeType>(paramType);
  const [lookupId, setLookupId] = useState(paramId);
  const [lookupError, setLookupError] = useState("");
  const [graph, setGraph] = useState<GraphState>({ status: "idle" });

  const [reason, setReason] = useState("");
  const [nodes, setNodes] = useState<NodeDraft[]>([newNodeDraft()]);
  const [edges, setEdges] = useState<EdgeDraft[]>([]);
  const [reportError, setReportError] = useState("");
  const [reportSuccess, setReportSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const reportPanelRef = useRef<HTMLElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLookupType(paramType);
    setLookupId(paramId);
    if (!paramId) {
      setGraph({ status: "idle" });
      return;
    }
    if (!isNodeType(params.get("type"))) return;
    const controller = new AbortController();
    setGraph({ status: "loading" });
    api
      .request<GraphData>(
        `/v1/graph/${encodeURIComponent(paramType)}/${encodeURIComponent(paramId)}`,
        { signal: controller.signal },
      )
      .then((data) => {
        if (!controller.signal.aborted) setGraph({ status: "ready", data });
      })
      .catch((error: ApiError | Error) => {
        if (controller.signal.aborted || error.name === "AbortError") return;
        if (error instanceof ApiError && error.status === 404 && error.code === "node_not_found") {
          setGraph({ status: "not_found", type: paramType, id: paramId });
        } else {
          setGraph({ status: "error", error });
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, paramType, paramId]);

  function openPeer(peer: PeerRef) {
    navigate(`/dashboard/graph?type=${encodeURIComponent(peer.type)}&id=${encodeURIComponent(peer.id)}`);
  }

  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validateNodeId(lookupType, lookupId.trim());
    if (invalid) {
      setLookupError(invalid);
      return;
    }
    setLookupError("");
    navigate(`/dashboard/graph?type=${encodeURIComponent(lookupType)}&id=${encodeURIComponent(lookupId.trim())}`);
  }

  function prefillReport(prefill: Partial<GraphNode>) {
    setNodes((current) => {
      const empty = current.findIndex((row) => !row.id.trim());
      const draft = newNodeDraft({
        type: prefill.type as GraphNodeType,
        id: prefill.id,
        risk: prefill.risk,
        category: prefill.category ?? "",
      });
      if (empty === -1) return [...current, draft];
      return current.map((row, index) => (index === empty ? draft : row));
    });
    reportPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    reasonRef.current?.focus({ preventScroll: true });
  }

  function updateNode(key: number, patch: Partial<NodeDraft>) {
    setNodes((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function updateEdge(key: number, patch: Partial<EdgeDraft>) {
    setEdges((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeNode(key: number) {
    setNodes((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : [newNodeDraft()]));
  }

  function collectReport():
    | { error: string; body?: undefined }
    | { error?: undefined; body: { reason: string; nodes: Record<string, string>[]; edges: Record<string, string>[] } } {
    const trimmedReason = reason.trim();
    if (!trimmedReason) return { error: "Describe why you are reporting this." };
    const reportNodes: Record<string, string>[] = [];
    for (const row of nodes) {
      const id = row.id.trim();
      const invalid = validateNodeId(row.type, id);
      if (invalid) return { error: invalid };
      const node: Record<string, string> = { type: row.type, id, risk: row.risk };
      if (row.category.trim()) node.category = row.category.trim();
      if (row.type === "wallet" && row.label.trim()) node.label = row.label.trim();
      if (row.type === "domain" && row.impersonates.trim()) node.impersonates = row.impersonates.trim();
      reportNodes.push(node);
    }
    if (!reportNodes.length) return { error: "Add at least one node." };
    const ids = new Set(reportNodes.map((node) => node.id));
    const reportEdges: Record<string, string>[] = [];
    for (const row of edges) {
      const edge: Record<string, string> = { type: row.type, fromId: row.fromId.trim(), toId: row.toId.trim() };
      if (!ids.has(edge.fromId) || !ids.has(edge.toId)) {
        return { error: "Each edge's from and to ids must match a node in this report." };
      }
      if (row.type === "funded" && row.txHash.trim()) edge.txHash = row.txHash.trim();
      reportEdges.push(edge);
    }
    return { body: { reason: trimmedReason, nodes: reportNodes, edges: reportEdges } };
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setReportError("");
    setReportSuccess("");
    const { error, body } = collectReport();
    if (error) {
      setReportError(error);
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.request<{ id: string; synced: boolean }>("/v1/report", { method: "POST", body });
      setReportSuccess(`Report ${result.id} submitted.${result.synced ? "" : " Saved — graph sync is pending."}`);
      setReason("");
      setNodes([newNodeDraft()]);
      setEdges([]);
    } catch (caught) {
      const failure = caught as ApiError | Error;
      if (failure.name === "AbortError") return;
      let text = failure.message;
      if (failure instanceof ApiError && failure.fields?.length) {
        text += ` ${failure.fields.map((item) => `${item.field}: ${item.message}`).join("; ")}`;
      }
      setReportError(text);
    } finally {
      setSubmitting(false);
    }
  }

  const nodeIds = [...new Set(nodes.map((row) => row.id.trim()).filter(Boolean))];

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THREAT INTELLIGENCE</div>
          <h1>Threat graph</h1>
          <p>
            Look up a wallet, domain, package, repo, or endpoint and see what it is connected to.
          </p>
        </div>
      </div>
      <section className="panel graph-lookup-panel">
        <div className="panel-header">
          <div>
            <span className="feature-kicker">LIVE LOOKUP</span>
            <h2>Look up a node</h2>
            <p>Connections come from reports and our graph database. Absence of edges is not proof of safety.</p>
          </div>
        </div>
        <form id="graph-form" className="form-stack" noValidate onSubmit={lookup}>
          <label htmlFor="graph-id">Node</label>
          <div className="graph-lookup-row">
            <select
              id="graph-type"
              name="type"
              aria-label="Node type"
              value={lookupType}
              onChange={(event) => setLookupType(event.target.value as GraphNodeType)}
            >
              {nodeTypes.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
            <input
              id="graph-id"
              name="id"
              type="text"
              value={lookupId}
              placeholder={idRules[lookupType].placeholder}
              aria-describedby="graph-helper graph-error"
              onChange={(event) => setLookupId(event.target.value)}
            />
            <button className="button button--primary" type="submit">Look up</button>
          </div>
          <small id="graph-helper" className="input-helper">{idRules[lookupType].hint}</small>
          <p id="graph-error" className="form-error" role="alert" hidden={!lookupError}>{lookupError}</p>
        </form>
        <div className="chip-row">
          <span>Try:</span>
          {seedExamples.map((example) => (
            <button
              key={example.id}
              type="button"
              className="chip"
              data-graph-example
              data-type={example.type}
              data-id={example.id}
              onClick={() => openPeer(example)}
            >
              {example.label}
            </button>
          ))}
        </div>
      </section>
      <section id="graph-result" className="result-region">
        {graph.status === "idle" ? (
          <div className="empty-state">
            <h2>Nothing loaded yet</h2>
            <p>Look up a node to draw it in the middle with every known connection around it.</p>
          </div>
        ) : null}
        {graph.status === "loading" ? (
          <ResultSkeleton label="Loading graph…" />
        ) : null}
        {graph.status === "ready" ? (
          <GraphResult data={graph.data} onOpenPeer={openPeer} onReport={(node) => prefillReport(node)} />
        ) : null}
        {graph.status === "not_found" ? (
          <GraphNodeNotFound
            type={graph.type}
            id={graph.id}
            onReport={() => prefillReport({ type: graph.type as GraphNodeType, id: graph.id })}
          />
        ) : null}
        {graph.status === "error" ? (
          <div className="form-error" role="alert">
            {graph.error.message}
            {graph.error instanceof ApiError && graph.error.requestId ? ` Reference: ${graph.error.requestId}.` : ""}
          </div>
        ) : null}
      </section>
      <section className="panel report-panel" ref={reportPanelRef}>
        <div className="panel-header">
          <div>
            <span className="feature-kicker">COMMUNITY REPORTS</span>
            <h2>Report something malicious</h2>
            <p>Add at least one node. Edges are optional and must connect ids listed in this report.</p>
          </div>
        </div>
        <form id="report-form" className="form-stack" noValidate onSubmit={(event) => void submitReport(event)}>
          <label htmlFor="report-reason">Why are you reporting this?</label>
          <textarea
            id="report-reason"
            name="reason"
            rows={2}
            maxLength={500}
            placeholder="e.g. this page asked for my seed phrase"
            value={reason}
            ref={reasonRef}
            onChange={(event) => setReason(event.target.value)}
          ></textarea>
          <div id="report-nodes">
            {nodes.map((row) => (
              <fieldset className="report-row" data-node-row key={row.key}>
                <legend>Node</legend>
                <div className="report-grid">
                  <label>
                    Type
                    <select
                      value={row.type}
                      onChange={(event) => updateNode(row.key, { type: event.target.value as GraphNodeType })}
                    >
                      {nodeTypes.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Id
                    <input
                      type="text"
                      value={row.id}
                      placeholder={idRules[row.type].placeholder}
                      onChange={(event) => updateNode(row.key, { id: event.target.value })}
                    />
                  </label>
                  <label>
                    Risk
                    <select value={row.risk} onChange={(event) => updateNode(row.key, { risk: event.target.value })}>
                      {riskLevels.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category
                    <input
                      type="text"
                      value={row.category}
                      placeholder="phishing, drainer…"
                      onChange={(event) => updateNode(row.key, { category: event.target.value })}
                    />
                  </label>
                  <label data-wallet-only hidden={row.type !== "wallet"}>
                    Label
                    <input
                      type="text"
                      value={row.label}
                      placeholder="e.g. Drainer collector"
                      onChange={(event) => updateNode(row.key, { label: event.target.value })}
                    />
                  </label>
                  <label data-domain-only hidden={row.type !== "domain"}>
                    Impersonates
                    <input
                      type="text"
                      value={row.impersonates}
                      placeholder="e.g. metamask"
                      onChange={(event) => updateNode(row.key, { impersonates: event.target.value })}
                    />
                  </label>
                </div>
                <button type="button" className="row-remove" onClick={() => removeNode(row.key)}>
                  Remove
                </button>
              </fieldset>
            ))}
          </div>
          <div id="report-edges">
            {edges.map((row) => (
              <fieldset className="report-row" data-edge-row key={row.key}>
                <legend>Edge</legend>
                <div className="report-grid">
                  <label>
                    Type
                    <select value={row.type} onChange={(event) => updateEdge(row.key, { type: event.target.value })}>
                      {edgeTypes.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    From id
                    <input
                      type="text"
                      list="report-node-ids"
                      placeholder="an id from the nodes above"
                      value={row.fromId}
                      onChange={(event) => updateEdge(row.key, { fromId: event.target.value })}
                    />
                  </label>
                  <label>
                    To id
                    <input
                      type="text"
                      list="report-node-ids"
                      placeholder="an id from the nodes above"
                      value={row.toId}
                      onChange={(event) => updateEdge(row.key, { toId: event.target.value })}
                    />
                  </label>
                  <label data-funded-only hidden={row.type !== "funded"}>
                    Tx hash
                    <input
                      type="text"
                      placeholder="0x… (optional)"
                      value={row.txHash}
                      onChange={(event) => updateEdge(row.key, { txHash: event.target.value })}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="row-remove"
                  onClick={() => setEdges((current) => current.filter((item) => item.key !== row.key))}
                >
                  Remove
                </button>
              </fieldset>
            ))}
          </div>
          <datalist id="report-node-ids">
            {nodeIds.map((value) => (
              <option key={value} value={value}></option>
            ))}
          </datalist>
          <div className="report-actions">
            <button
              type="button"
              className="button button--secondary button--small"
              id="report-add-node"
              onClick={() => setNodes((current) => [...current, newNodeDraft()])}
            >
              Add node
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              id="report-add-edge"
              onClick={() => setEdges((current) => [...current, newEdgeDraft()])}
            >
              Add edge
            </button>
            <button className="button button--primary" type="submit" id="report-submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit report"}
            </button>
          </div>
          <p id="report-error" className="form-error" role="alert" hidden={!reportError}>{reportError}</p>
          <p id="report-success" className="report-success" role="status" hidden={!reportSuccess}>{reportSuccess}</p>
        </form>
      </section>
    </>
  );
}
