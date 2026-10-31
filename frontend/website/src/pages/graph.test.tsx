import { afterEach, expect, test } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { makeApi, renderPage } from "../test/helpers";
import { GraphPage } from "./GraphPage";
import type { GraphData, ScanRecord } from "../types";

const seedWallet = "1:0x658729879fca881d9526480b82ae00efc54b5c2d";
const drainer = "0x1111111111111111111111111111111111111111";

afterEach(() => localStorage.clear());

function saveHistory(records: ScanRecord[]) {
  localStorage.setItem("stack3.scanHistory.user-1", JSON.stringify(records));
}

const websiteScan: ScanRecord = {
  id: "scan-1",
  kind: "website",
  target: "metamask-verify.io",
  createdAt: "2026-10-30T10:00:00Z",
  verdict: {
    level: "critical",
    target: { type: "site", id: "metamask-verify.io" },
    findings: [
      { layer: "site", severity: "critical", title: "Page asks for a seed phrase", evidence: "Form field named mnemonic.", source: "rules", checkedAt: "2026-10-30T10:00:00Z" },
    ],
    indicators: { addresses: [drainer], domains: ["cdn-wallet.io"] },
    notChecked: [],
    actions: [],
  },
};

const contractScan: ScanRecord = {
  id: "scan-2",
  kind: "contract",
  target: "0x2222222222222222222222222222222222222222",
  chainId: 8453,
  createdAt: "2026-10-30T09:00:00Z",
  verdict: {
    level: "high",
    target: { type: "contract", id: "0x2222222222222222222222222222222222222222" },
    findings: [
      { layer: "contract", severity: "high", title: "Owner can pause transfers", evidence: "pause() is onlyOwner.", source: "rules", checkedAt: "2026-10-30T09:00:00Z" },
    ],
    indicators: { addresses: [drainer], domains: [] },
    notChecked: [],
    actions: [],
  },
};

test("with no history the page opens on the lookup, with seed examples and the report form", () => {
  const api = makeApi(async () => { throw new Error("no request expected"); });
  const { container } = renderPage("/dashboard/graph", <GraphPage />, api, "/dashboard/graph");
  expect(container.querySelector("#graph-form")).not.toBeNull();
  expect(
    container.querySelector(`[data-graph-example][data-type="wallet"][data-id="${seedWallet}"]`),
  ).not.toBeNull();
  expect(container.textContent).toContain("connect-kit package");
  expect(container.querySelector("#report-form")).not.toBeNull();
  expect(container.querySelector('[placeholder="e.g. this page asked for my seed phrase"]')).not.toBeNull();
  // There is no "safe" level anywhere in the risk choices.
  expect(container.innerHTML).not.toMatch(/no_known_issues|>Safe</);
  expect(container.textContent).toContain("Nothing loaded yet");
});

test("a deep link selects the type, skips the empty state, and loads the node", async () => {
  const graph: GraphData = {
    node: { type: "package", id: "pkg:npm/evil@1.0.0", risk: "high", reportCount: 1 },
    edges: [],
    source: "database",
  };
  const api = makeApi(async (path) => {
    expect(path).toBe(`/v1/graph/package/${encodeURIComponent("pkg:npm/evil@1.0.0")}`);
    return graph;
  });
  const { container } = renderPage(
    "/dashboard/graph",
    <GraphPage />,
    api,
    `/dashboard/graph?type=package&id=${encodeURIComponent("pkg:npm/evil@1.0.0")}`,
  );
  expect(container.querySelector('[role="radio"][data-type="package"]')).toHaveAttribute("aria-checked", "true");
  const input = container.querySelector("#graph-id") as HTMLInputElement;
  expect(input.value).toBe("pkg:npm/evil@1.0.0");
  expect(container.textContent).not.toContain("Nothing loaded yet");
  await screen.findByText("SOURCE: DATABASE", { exact: false });
});

test("auto-detect turns a pasted URL or address into the canonical id before looking it up", async () => {
  const paths: string[] = [];
  const api = makeApi(async (path) => {
    paths.push(path);
    return { node: { type: "repo", id: "github:owner/name", risk: "high" }, edges: [], source: "database" };
  });
  const { container } = renderPage("/dashboard/graph", <GraphPage />, api, "/dashboard/graph?view=lookup");
  const input = container.querySelector("#graph-id") as HTMLInputElement;

  fireEvent.change(input, { target: { value: "https://github.com/Owner/Name.git" } });
  expect(container.querySelector("#graph-helper")).toHaveTextContent("Detected repo github:owner/name");
  fireEvent.submit(container.querySelector("#graph-form")!);
  await screen.findByText("SOURCE: DATABASE", { exact: false });
  expect(paths).toEqual([`/v1/graph/repo/${encodeURIComponent("github:owner/name")}`]);

  // A bare address asks for its chain.
  fireEvent.change(input, { target: { value: drainer.toUpperCase().replace("0X", "0x") } });
  const chain = container.querySelector("#graph-chain") as HTMLSelectElement;
  fireEvent.change(chain, { target: { value: "8453" } });
  expect(container.querySelector("#graph-helper")).toHaveTextContent(`Detected wallet 8453:${drainer}`);
});

test("lookup errors say what is wrong instead of sending a request", () => {
  const api = makeApi(async () => { throw new Error("no request expected"); });
  const { container } = renderPage("/dashboard/graph", <GraphPage />, api, "/dashboard/graph?view=lookup");
  const input = container.querySelector("#graph-id") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "evil" } });
  fireEvent.click(container.querySelector('[role="radio"][data-type="package"]')!);
  fireEvent.submit(container.querySelector("#graph-form")!);
  expect(screen.getByRole("alert")).toHaveTextContent("Add the version, e.g. evil@1.0.0");
});

test("an unknown node offers the report flow", async () => {
  const { ApiError } = await import("../lib/api");
  const api = makeApi(async () => {
    throw new ApiError("Not found", { status: 404, code: "node_not_found" });
  });
  renderPage(
    "/dashboard/graph",
    <GraphPage />,
    api,
    "/dashboard/graph?type=domain&id=metamask-verify.io",
  );
  await screen.findByText(/We have never seen this domain/);
  expect(screen.getByText("Report it")).toBeInTheDocument();
});

test("an unknown type in the link shows an error instead of loading forever", async () => {
  const api = makeApi(async () => { throw new Error("no request expected"); });
  renderPage("/dashboard/graph", <GraphPage />, api, "/dashboard/graph?type=planet&id=mars");
  expect(await screen.findByText(/Unknown node type/)).toBeInTheDocument();
});

test("with history the page opens on your scans, linking scans through shared indicators", () => {
  saveHistory([websiteScan, contractScan]);
  const api = makeApi(async () => { throw new Error("no request expected"); });
  const { container } = renderPage("/dashboard/graph", <GraphPage />, api, "/dashboard/graph");

  expect(screen.getByRole("tab", { name: /Your scans \(2\)/ })).toHaveAttribute("aria-selected", "true");
  expect(container.querySelector('[data-scan-node="scan-1"]')).not.toBeNull();
  expect(container.querySelector('[data-scan-node="scan-2"]')).not.toBeNull();
  // The drainer address appears in both scans, on their own chains.
  expect(container.querySelector(`[data-indicator-node="wallet:1:${drainer}"]`)).not.toBeNull();
  expect(container.querySelector(`[data-indicator-node="wallet:8453:${drainer}"]`)).not.toBeNull();
  expect(container.querySelector('[data-indicator-node="domain:cdn-wallet.io"]')).not.toBeNull();
  expect(screen.getByText("Page asks for a seed phrase")).toBeInTheDocument();
  expect(screen.getByText("Owner can pause transfers")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Critical" }));
  expect(container.querySelector('[data-scan-node="scan-2"]')).toBeNull();
  expect(screen.queryByText("Owner can pause transfers")).toBeNull();
});

test("clicking an indicator looks it up in the threat graph", async () => {
  saveHistory([websiteScan]);
  const api = makeApi(async (path) => {
    expect(path).toBe(`/v1/graph/domain/${encodeURIComponent("cdn-wallet.io")}`);
    return { node: { type: "domain", id: "cdn-wallet.io", risk: "high" }, edges: [], source: "tigergraph" };
  });
  const { container } = renderPage("/dashboard/graph", <GraphPage />, api, "/dashboard/graph");
  fireEvent.click(container.querySelector('[data-indicator-node="domain:cdn-wallet.io"]')!);
  await screen.findByText("SOURCE: TIGERGRAPH", { exact: false });
  expect(screen.getByRole("tab", { name: "Look up a node" })).toHaveAttribute("aria-selected", "true");
});
