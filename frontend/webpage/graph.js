import { escapeHtml as escape } from "./html.js";

export const nodeTypes = ["wallet", "domain", "package", "repo", "endpoint"];
const riskLevels = ["unknown", "caution", "high", "critical"];
const riskLabels = { critical: "Critical", high: "High risk", caution: "Caution", unknown: "Unknown" };
const riskColors = { critical: "#b42318", high: "#b54708", caution: "#315e9b", unknown: "#697586" };
const riskFills = { critical: "#fff0ef", high: "#fff4e8", caution: "#edf3fb", unknown: "#eff2f5" };
const edgeTypes = [
  ["package_drains_to", "Package drains to wallet"],
  ["domain_drains_to", "Domain drains to wallet"],
  ["package_sends_to", "Package sends to URL"],
  ["domain_sends_to", "Domain sends to URL"],
  ["loads_script", "Domain loads package"],
  ["depends_on", "Repo depends on package"],
  ["funded", "Wallet funded wallet"],
];
const edgeShortLabels = {
  package_drains_to: "drains to", domain_drains_to: "drains to",
  package_sends_to: "sends to", domain_sends_to: "sends to",
  loads_script: "loads", depends_on: "depends on", funded: "funded",
};
const idRules = {
  wallet: { pattern: /^\d+:0x[0-9a-fA-F]{40}$/, hint: "chainId:0x + 40 hex characters, e.g. 1:0x658729879fca881d9526480b82ae00efc54b5c2d", placeholder: "1:0x…" },
  domain: { pattern: /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i, hint: "a hostname, e.g. metamask-verify.io", placeholder: "example.io" },
  package: { pattern: /^pkg:npm\/\S+@\S+$/, hint: "pkg:npm/name@version, e.g. pkg:npm/@ledgerhq/connect-kit@1.1.7", placeholder: "pkg:npm/name@1.2.3" },
  repo: { pattern: /^github:[^/\s]+\/[^/\s]+$/, hint: "github:owner/name", placeholder: "github:owner/name" },
  endpoint: { pattern: /^https:\/\/\S+$/, hint: "an https:// URL", placeholder: "https://…" },
};
const seedExamples = [
  { type: "wallet", id: "1:0x658729879fca881d9526480b82ae00efc54b5c2d", label: "Seed wallet" },
  { type: "package", id: "pkg:npm/@ledgerhq/connect-kit@1.1.7", label: "connect-kit package" },
];

export function validateNodeId(type, id) {
  const rule = idRules[type];
  if (!rule) return "Choose a node type.";
  if (!id) return `Enter a ${type} id (${rule.hint}).`;
  return rule.pattern.test(id) ? null : `That does not look like a ${type} id. Expected ${rule.hint}.`;
}

function riskBadge(risk) {
  const level = riskLevels.includes(risk) ? risk : "unknown";
  return `<span class="verdict verdict--${level}"><span class="verdict-dot"></span>${riskLabels[level]}</span>`;
}

const date = (value) => (value ? new Date(value).toLocaleString() : "Not recorded");
const shorten = (value, max = 24) => (value.length <= max ? value : `${value.slice(0, max - 8)}…${value.slice(-7)}`);
const fact = (label, value) => `<div><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
const peerButton = (type, id, label = shorten(id, 34)) =>
  `<button type="button" class="graph-peer-link" data-graph-peer data-type="${escape(type)}" data-id="${escape(id)}" title="${escape(id)}">${escape(label)}</button>`;

function graphSvg(node, edges) {
  const shown = edges.slice(0, 12);
  if (!shown.length) {
    return '<div class="graph-empty-edges">No connections recorded for this node yet.</div>';
  }
  const W = 720;
  const H = 460;
  const cx = W / 2;
  const cy = H / 2;
  const radiusX = 260;
  const radiusY = 160;
  const centerR = 54;
  const peerR = 36;
  const color = riskColors[node.risk] ?? riskColors.unknown;
  const fill = riskFills[node.risk] ?? riskFills.unknown;
  const parts = [];
  const peers = shown.map((edge, index) => {
    const angle = (2 * Math.PI * index) / shown.length - Math.PI / 2;
    return { edge, x: cx + radiusX * Math.cos(angle), y: cy + radiusY * Math.sin(angle) };
  });
  for (const { edge, x, y } of peers) {
    const dx = x - cx;
    const dy = y - cy;
    const length = Math.hypot(dx, dy) || 1;
    const sx = cx + (dx / length) * (centerR + 5);
    const sy = cy + (dy / length) * (centerR + 5);
    const ex = x - (dx / length) * (peerR + 7);
    const ey = y - (dy / length) * (peerR + 7);
    const [x1, y1, x2, y2] = edge.direction === "in" ? [ex, ey, sx, sy] : [sx, sy, ex, ey];
    parts.push(
      `<line class="graph-edge-line" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" marker-end="url(#graph-arrow)" />`,
      `<text class="graph-edge-label" x="${((sx + ex) / 2).toFixed(1)}" y="${((sy + ey) / 2 - 5).toFixed(1)}">${escape(edgeShortLabels[edge.type] ?? edge.type)}</text>`,
    );
  }
  for (const { edge, x, y } of peers) {
    parts.push(
      `<g class="graph-peer" role="link" tabindex="0" data-graph-peer data-type="${escape(edge.peerType)}" data-id="${escape(edge.peerId)}" aria-label="Open ${escape(edge.peerType)} ${escape(edge.peerId)}">`,
      `<title>${escape(edge.peerType)}: ${escape(edge.peerId)}</title>`,
      `<circle class="graph-peer-circle" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${peerR}" />`,
      `<text class="graph-peer-type" x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}">${escape(edge.peerType.toUpperCase())}</text>`,
      `<text class="graph-peer-id" x="${x.toFixed(1)}" y="${(y + peerR + 15).toFixed(1)}">${escape(shorten(edge.peerId, 26))}</text>`,
      "</g>",
    );
  }
  parts.push(
    `<g class="graph-center"><circle cx="${cx}" cy="${cy}" r="${centerR}" fill="${fill}" stroke="${color}" stroke-width="2" />`,
    `<text class="graph-center-type" x="${cx}" y="${cy - 6}" fill="${color}">${escape(node.type.toUpperCase())}</text>`,
    `<text class="graph-center-id" x="${cx}" y="${cy + 10}">${escape(shorten(node.id, 18))}</text></g>`,
  );
  const overflow = edges.length > shown.length
    ? `<p class="input-helper">Showing ${shown.length} of ${edges.length} connections in the diagram. All of them are listed below.</p>`
    : "";
  return `<div class="graph-svg-wrap"><svg class="graph-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Connections of ${escape(node.id)}"><defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="#8aa0bd" /></marker></defs>${parts.join("")}</svg></div>${overflow}`;
}

export function renderGraphResult(data) {
  const { node, edges = [], source } = data;
  const attributes = node.attributes ?? {};
  const facts = [
    fact("Reports", String(node.reportCount ?? 0)),
    fact("First seen", date(node.firstSeen)),
    fact("Last seen", date(node.lastSeen)),
    fact("Category", node.category ?? "Not set"),
    ...Object.entries(attributes).map(([key, value]) => fact(key.replaceAll("_", " "), String(value))),
  ];
  const rows = edges.map((edge) => {
    const [peerLabel, nodeLabel] = [`${edge.peerType} · ${shorten(edge.peerId, 30)}`, "this node"];
    const sentence = edge.direction === "in"
      ? `${peerLabel} → ${nodeLabel}`
      : `${nodeLabel} → ${peerLabel}`;
    return `<tr><td><strong class="table-target">${escape(edgeTypes.find(([type]) => type === edge.type)?.[1] ?? edge.type)}</strong><small>${escape(edge.type)}</small></td><td>${escape(sentence)}</td><td>${peerButton(edge.peerType, edge.peerId)}</td><td>${edge.txHash ? `<code class="graph-code">${escape(shorten(edge.txHash, 18))}</code>` : "—"}</td></tr>`;
  }).join("");
  const edgeTable = edges.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Relationship</th><th>Direction</th><th>Peer</th><th>Tx hash</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : "";
  return `<section class="result-panel graph-result"><div class="result-header"><div><div class="result-label">LIVE THREAT GRAPH · SOURCE: ${escape((source ?? "database").toUpperCase())}</div><h2 class="graph-node-id">${escape(node.id)}</h2><p>${escape(node.type)}${node.category ? ` · ${escape(node.category)}` : ""}</p></div>${riskBadge(node.risk)}</div><div class="contract-facts">${facts.join("")}</div>${graphSvg(node, edges)}${edgeTable}<div class="graph-result-actions"><button type="button" class="button button--secondary button--small" data-graph-report data-type="${escape(node.type)}" data-id="${escape(node.id)}" data-risk="${escape(node.risk)}" data-category="${escape(node.category ?? "")}">Report this node</button><span class="input-helper">Risk indicators, not a guarantee. Anyone on your plan sees the same graph.</span></div></section>`;
}

function nodeNotFound(type, id) {
  return `<div class="empty-state"><span class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span><h2>We have never seen this ${escape(type)}</h2><p><code class="graph-code">${escape(shorten(id, 60))}</code> is not in the threat graph yet. If it did something suspicious, report it below.</p><button type="button" class="button button--secondary" data-graph-report data-type="${escape(type)}" data-id="${escape(id)}">Report it</button></div>`;
}

function selectOptions(values, selected) {
  return values
    .map((value) => {
      const [id, label] = Array.isArray(value) ? value : [value, value];
      return `<option value="${escape(id)}"${id === selected ? " selected" : ""}>${escape(label)}</option>`;
    })
    .join("");
}

function nodeRow(prefill = {}) {
  const type = nodeTypes.includes(prefill.type) ? prefill.type : "domain";
  const risk = riskLevels.includes(prefill.risk) ? prefill.risk : "high";
  return `<fieldset class="report-row" data-node-row><legend>Node</legend><div class="report-grid"><label>Type<select data-node-field="type">${selectOptions(nodeTypes, type)}</select></label><label>Id<input data-node-field="id" type="text" value="${escape(prefill.id ?? "")}" placeholder="${escape(idRules[type].placeholder)}" /></label><label>Risk<select data-node-field="risk">${selectOptions(riskLevels, risk)}</select></label><label>Category<input data-node-field="category" type="text" value="${escape(prefill.category ?? "")}" placeholder="phishing, drainer…" /></label><label data-wallet-only ${type === "wallet" ? "" : "hidden"}>Label<input data-node-field="label" type="text" placeholder="e.g. Drainer collector" /></label><label data-domain-only ${type === "domain" ? "" : "hidden"}>Impersonates<input data-node-field="impersonates" type="text" placeholder="e.g. metamask" /></label></div><button type="button" class="row-remove" data-remove-node>Remove</button></fieldset>`;
}

function edgeRow() {
  return `<fieldset class="report-row" data-edge-row><legend>Edge</legend><div class="report-grid"><label>Type<select data-edge-field="type">${selectOptions(edgeTypes, "domain_drains_to")}</select></label><label>From id<input data-edge-field="fromId" type="text" list="report-node-ids" placeholder="an id from the nodes above" /></label><label>To id<input data-edge-field="toId" type="text" list="report-node-ids" placeholder="an id from the nodes above" /></label><label data-funded-only hidden>Tx hash<input data-edge-field="txHash" type="text" placeholder="0x… (optional)" /></label></div><button type="button" class="row-remove" data-remove-edge>Remove</button></fieldset>`;
}

export function createGraphUI({ api, navigate }) {
  let controller;

  function page(params) {
    const type = nodeTypes.includes(params.get("type")) ? params.get("type") : "wallet";
    const id = params.get("id") ?? "";
    const chips = seedExamples
      .map((example) => `<button type="button" class="chip" data-graph-example data-type="${escape(example.type)}" data-id="${escape(example.id)}">${escape(example.label)}</button>`)
      .join("");
    return `<div class="page-heading"><div><div class="eyebrow">THREAT INTELLIGENCE</div><h1>Threat graph</h1><p>Look up a wallet, domain, package, repo, or endpoint and see what it is connected to. Live data — not a demo.</p></div></div>
<section class="panel graph-lookup-panel"><div class="panel-header"><div><span class="feature-kicker">LIVE LOOKUP</span><h2>Look up a node</h2><p>Connections come from reports and our graph database. Absence of edges is not proof of safety.</p></div></div><form id="graph-form" class="form-stack" novalidate><label for="graph-id">Node</label><div class="graph-lookup-row"><select id="graph-type" name="type" aria-label="Node type">${selectOptions(nodeTypes, type)}</select><input id="graph-id" name="id" type="text" value="${escape(id)}" placeholder="${escape(idRules[type].placeholder)}" aria-describedby="graph-helper graph-error" /><button class="button button--primary" type="submit">Look up</button></div><small id="graph-helper" class="input-helper">${escape(idRules[type].hint)}</small><p id="graph-error" class="form-error" role="alert" hidden></p></form><div class="chip-row"><span>Try:</span>${chips}</div></section>
<section id="graph-result" class="result-region">${id ? "" : '<div class="empty-state"><h2>Nothing loaded yet</h2><p>Look up a node to draw it in the middle with every known connection around it.</p></div>'}</section>
<section class="panel report-panel"><div class="panel-header"><div><span class="feature-kicker">COMMUNITY REPORTS</span><h2>Report something malicious</h2><p>Add at least one node. Edges are optional and must connect ids listed in this report.</p></div></div><form id="report-form" class="form-stack" novalidate><label for="report-reason">Why are you reporting this?</label><textarea id="report-reason" name="reason" rows="2" maxlength="2000" placeholder="e.g. this page asked for my seed phrase"></textarea><div id="report-nodes">${nodeRow()}</div><div id="report-edges"></div><datalist id="report-node-ids"></datalist><div class="report-actions"><button type="button" class="button button--secondary button--small" id="report-add-node">Add node</button><button type="button" class="button button--secondary button--small" id="report-add-edge">Add edge</button><button class="button button--primary" type="submit" id="report-submit">Submit report</button></div><p id="report-error" class="form-error" role="alert" hidden></p><p id="report-success" class="report-success" role="status" hidden></p></form></section>`;
  }

  async function loadGraph(type, id) {
    const region = document.querySelector("#graph-result");
    if (!region) return;
    region.innerHTML = '<div class="account-loading" role="status"><span class="spinner" aria-hidden="true"></span> Loading graph…</div>';
    try {
      const data = await api.request(`/v1/graph/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { signal: controller?.signal });
      region.innerHTML = renderGraphResult(data);
    } catch (error) {
      if (error.name === "AbortError") return;
      region.innerHTML = error.status === 404 && error.code === "node_not_found"
        ? nodeNotFound(type, id)
        : `<div class="form-error" role="alert">${escape(error.message)}${error.requestId ? ` Reference: ${escape(error.requestId)}.` : ""}</div>`;
    }
  }

  function refreshNodeIdList() {
    const list = document.querySelector("#report-node-ids");
    if (!list) return;
    const ids = [...document.querySelectorAll('[data-node-field="id"]')]
      .map((input) => input.value.trim())
      .filter(Boolean);
    list.innerHTML = [...new Set(ids)].map((value) => `<option value="${escape(value)}"></option>`).join("");
  }

  function prefillReport({ type, id, risk, category }) {
    const rows = [...document.querySelectorAll("[data-node-row]")];
    let row = rows.find((candidate) => !candidate.querySelector('[data-node-field="id"]').value.trim());
    if (!row) {
      document.querySelector("#report-nodes").insertAdjacentHTML("beforeend", nodeRow());
      row = document.querySelector("#report-nodes [data-node-row]:last-child");
    }
    const set = (field, value) => {
      const input = row.querySelector(`[data-node-field="${field}"]`);
      if (input && value) input.value = value;
    };
    set("type", type);
    set("id", id);
    set("risk", risk);
    set("category", category);
    syncNodeRow(row);
    refreshNodeIdList();
    document.querySelector(".report-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector("#report-reason")?.focus({ preventScroll: true });
  }

  function syncNodeRow(row) {
    const type = row.querySelector('[data-node-field="type"]').value;
    row.querySelector("[data-wallet-only]").hidden = type !== "wallet";
    row.querySelector("[data-domain-only]").hidden = type !== "domain";
    row.querySelector('[data-node-field="id"]').placeholder = idRules[type].placeholder;
  }

  function collectReport() {
    const reason = document.querySelector("#report-reason").value.trim();
    if (!reason) return { error: "Describe why you are reporting this." };
    const nodes = [];
    for (const row of document.querySelectorAll("[data-node-row]")) {
      const value = (field) => row.querySelector(`[data-node-field="${field}"]`).value.trim();
      const type = value("type");
      const id = value("id");
      const invalid = validateNodeId(type, id);
      if (invalid) return { error: invalid };
      const node = { type, id, risk: value("risk") };
      const category = value("category");
      if (category) node.category = category;
      if (type === "wallet" && value("label")) node.label = value("label");
      if (type === "domain" && value("impersonates")) node.impersonates = value("impersonates");
      nodes.push(node);
    }
    if (!nodes.length) return { error: "Add at least one node." };
    const ids = new Set(nodes.map((node) => node.id));
    const edges = [];
    for (const row of document.querySelectorAll("[data-edge-row]")) {
      const value = (field) => row.querySelector(`[data-edge-field="${field}"]`).value.trim();
      const edge = { type: value("type"), fromId: value("fromId"), toId: value("toId") };
      if (!ids.has(edge.fromId) || !ids.has(edge.toId)) {
        return { error: "Each edge's from and to ids must match a node in this report." };
      }
      if (edge.type === "funded" && value("txHash")) edge.txHash = value("txHash");
      edges.push(edge);
    }
    return { body: { reason, nodes, edges } };
  }

  async function submitReport() {
    const errorElement = document.querySelector("#report-error");
    const successElement = document.querySelector("#report-success");
    const button = document.querySelector("#report-submit");
    errorElement.hidden = true;
    successElement.hidden = true;
    const { error, body } = collectReport();
    if (error) {
      errorElement.textContent = error;
      errorElement.hidden = false;
      return;
    }
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Submitting…";
    try {
      const result = await api.request("/v1/report", { method: "POST", body, signal: controller?.signal });
      successElement.textContent = `Report ${result.id} submitted.${result.synced ? "" : " Saved — graph sync is pending."}`;
      successElement.hidden = false;
      document.querySelector("#report-reason").value = "";
      document.querySelector("#report-nodes").innerHTML = nodeRow();
      document.querySelector("#report-edges").innerHTML = "";
      refreshNodeIdList();
    } catch (requestError) {
      if (requestError.name === "AbortError") return;
      let text = requestError.message;
      if (requestError.fields?.length) {
        text += ` ${requestError.fields.map((item) => `${item.field}: ${item.message}`).join("; ")}`;
      }
      errorElement.textContent = text;
      errorElement.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function openPeer(element) {
    navigate(`/dashboard/graph?type=${encodeURIComponent(element.dataset.type)}&id=${encodeURIComponent(element.dataset.id)}`);
  }

  function mount(params) {
    controller = new AbortController();
    const { signal } = controller;
    const container = document.querySelector("#app");
    const typeSelect = document.querySelector("#graph-type");
    const idInput = document.querySelector("#graph-id");

    typeSelect?.addEventListener("change", () => {
      document.querySelector("#graph-helper").textContent = idRules[typeSelect.value].hint;
      idInput.placeholder = idRules[typeSelect.value].placeholder;
    }, { signal });

    document.querySelector("#graph-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const errorElement = document.querySelector("#graph-error");
      const invalid = validateNodeId(typeSelect.value, idInput.value.trim());
      if (invalid) {
        errorElement.textContent = invalid;
        errorElement.hidden = false;
        return;
      }
      errorElement.hidden = true;
      navigate(`/dashboard/graph?type=${encodeURIComponent(typeSelect.value)}&id=${encodeURIComponent(idInput.value.trim())}`);
    }, { signal });

    container?.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const peer = target?.closest("[data-graph-peer]");
      if (peer) return openPeer(peer);
      const example = target?.closest("[data-graph-example]");
      if (example) return openPeer(example);
      const report = target?.closest("[data-graph-report]");
      if (report) return prefillReport(report.dataset);
      if (target?.closest("#report-add-node")) {
        document.querySelector("#report-nodes").insertAdjacentHTML("beforeend", nodeRow());
        return;
      }
      if (target?.closest("#report-add-edge")) {
        document.querySelector("#report-edges").insertAdjacentHTML("beforeend", edgeRow());
        return;
      }
      const removeNode = target?.closest("[data-remove-node]");
      if (removeNode) {
        const row = removeNode.closest("[data-node-row]");
        if (document.querySelectorAll("[data-node-row]").length > 1) row.remove();
        else row.outerHTML = nodeRow();
        refreshNodeIdList();
        return;
      }
      const removeEdge = target?.closest("[data-remove-edge]");
      if (removeEdge) removeEdge.closest("[data-edge-row]").remove();
    }, { signal });

    container?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const peer = event.target instanceof Element ? event.target.closest("g[data-graph-peer]") : null;
      if (peer) {
        event.preventDefault();
        openPeer(peer);
      }
    }, { signal });

    document.querySelector("#report-form")?.addEventListener("input", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches('[data-node-field="id"]')) refreshNodeIdList();
      if (target?.matches('[data-node-field="type"]')) syncNodeRow(target.closest("[data-node-row]"));
      if (target?.matches('[data-edge-field="type"]')) {
        const row = target.closest("[data-edge-row]");
        row.querySelector("[data-funded-only]").hidden = target.value !== "funded";
      }
    }, { signal });

    document.querySelector("#report-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitReport();
    }, { signal });

    const type = params.get("type");
    const id = params.get("id");
    if (nodeTypes.includes(type) && id) void loadGraph(type, id);
  }

  function stop() {
    controller?.abort();
  }

  return { page, mount, stop };
}
