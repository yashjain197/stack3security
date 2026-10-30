import assert from "node:assert/strict";
import test from "node:test";
import { createGraphUI, renderGraphResult, validateNodeId } from "./graph.js";

const seedWallet = "1:0x658729879fca881d9526480b82ae00efc54b5c2d";
const seedGraph = {
  node: {
    type: "wallet",
    id: seedWallet,
    risk: "critical",
    category: "drainer",
    attributes: { chain_id: "1", label: "Ledger Connect Kit collector" },
    reportCount: 1,
    firstSeen: "2026-10-30T00:00:00Z",
    lastSeen: "2026-10-30T00:00:00Z",
  },
  edges: [
    {
      type: "package_drains_to",
      direction: "in",
      peerType: "package",
      peerId: "pkg:npm/@ledgerhq/connect-kit@1.1.7",
      txHash: null,
    },
  ],
  source: "tigergraph",
};

test("node id validation matches the documented formats", () => {
  assert.equal(validateNodeId("wallet", seedWallet), null);
  assert.equal(validateNodeId("domain", "metamask-verify.io"), null);
  assert.equal(validateNodeId("package", "pkg:npm/@ledgerhq/connect-kit@1.1.7"), null);
  assert.equal(validateNodeId("repo", "github:owner/name"), null);
  assert.equal(validateNodeId("endpoint", "https://collector.example/api"), null);
  assert.match(validateNodeId("wallet", "0x1234"), /does not look like a wallet id/);
  assert.match(validateNodeId("repo", "owner/name"), /github:owner\/name/);
  assert.match(validateNodeId("endpoint", "http://insecure.example"), /https:\/\//);
  assert.match(validateNodeId("domain", ""), /Enter a domain id/);
});

test("graph result renders the node, risk badge, source, and clickable peers", () => {
  const html = renderGraphResult(seedGraph);
  assert.match(html, /verdict--critical/);
  assert.match(html, /SOURCE: TIGERGRAPH/);
  assert.match(html, new RegExp(seedWallet));
  assert.match(html, /Ledger Connect Kit collector/);
  assert.match(html, /Package drains to wallet/);
  // The peer is clickable both in the diagram and the edge table.
  const peerMatches = html.match(/data-graph-peer data-type="package" data-id="pkg:npm\/@ledgerhq\/connect-kit@1\.1\.7"/g);
  assert.equal(peerMatches.length, 2);
  // direction "in" draws the peer pointing at this node.
  assert.match(html, /package · pkg:npm\/@ledgerhq\/conn…t@1\.1\.7 → this node/);
});

test("graph result escapes malicious API text and draws the same for the database source", () => {
  const html = renderGraphResult({
    node: { type: "domain", id: '<img src=x onerror=alert(1)>', risk: "high", category: "<b>phishing</b>", reportCount: 0 },
    edges: [],
    source: "database",
  });
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<b>phishing/);
  assert.match(html, /&lt;img/);
  assert.match(html, /SOURCE: DATABASE/);
  assert.match(html, /No connections recorded/);
});

test("the funded edge keeps its transaction hash and out direction", () => {
  const html = renderGraphResult({
    node: { type: "wallet", id: seedWallet, risk: "high", reportCount: 2 },
    edges: [{ type: "funded", direction: "out", peerType: "wallet", peerId: "1:0x1111111111111111111111111111111111111111", txHash: "0xabcdef1234567890abcdef1234567890" }],
    source: "database",
  });
  assert.match(html, /this node → wallet/);
  assert.match(html, /0xabcdef12…4567890/);
});

test("the page renders the lookup form, seed examples, and the report form", () => {
  const ui = createGraphUI({ api: {}, navigate: () => {} });
  const html = ui.page(new URLSearchParams());
  assert.match(html, /id="graph-form"/);
  assert.match(html, new RegExp(`data-graph-example data-type="wallet" data-id="${seedWallet}"`));
  assert.match(html, /pkg:npm\/@ledgerhq\/connect-kit@1\.1\.7/);
  assert.match(html, /id="report-form"/);
  assert.match(html, /this page asked for my seed phrase/);
  // There is no "safe" level anywhere in the risk choices.
  assert.doesNotMatch(html, /no_known_issues|>Safe</);
  assert.match(html, /Nothing loaded yet/);
});

test("a deep link pre-fills the lookup form and skips the empty state", () => {
  const ui = createGraphUI({ api: {}, navigate: () => {} });
  const html = ui.page(new URLSearchParams(`type=package&id=${encodeURIComponent("pkg:npm/evil@1.0.0")}`));
  assert.match(html, /<option value="package" selected>/);
  assert.match(html, /value="pkg:npm\/evil@1\.0\.0"/);
  assert.doesNotMatch(html, /Nothing loaded yet/);
});
