import { expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { makeApi, renderPage } from "../test/helpers";
import { GraphPage } from "./GraphPage";
import type { GraphData } from "../types";

const seedWallet = "1:0x658729879fca881d9526480b82ae00efc54b5c2d";

test("the page renders the lookup form, seed examples, and the report form", () => {
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

test("a deep link pre-fills the lookup form, skips the empty state, and loads the node", async () => {
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
  const select = container.querySelector("#graph-type") as HTMLSelectElement;
  expect(select.value).toBe("package");
  const input = container.querySelector("#graph-id") as HTMLInputElement;
  expect(input.value).toBe("pkg:npm/evil@1.0.0");
  expect(container.textContent).not.toContain("Nothing loaded yet");
  await screen.findByText("SOURCE: DATABASE", { exact: false });
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
