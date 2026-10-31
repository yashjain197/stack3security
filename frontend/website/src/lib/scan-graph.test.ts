// @vitest-environment node
import { expect, test } from "vitest";
import { buildScanGraph } from "./scan-graph";
import type { ScanRecord, Verdict } from "../types";

function scan(id: string, target: string, level: Verdict, addresses: string[] = [], severities: Verdict[] = []): ScanRecord {
  return {
    id,
    kind: "website",
    target,
    createdAt: "2026-10-30T10:00:00Z",
    verdict: {
      level,
      target: { type: "site", id: target },
      findings: severities.map((severity) => ({
        layer: "site", severity, title: `${severity} finding`, evidence: "", source: "rules", checkedAt: "2026-10-30T10:00:00Z",
      })),
      indicators: { addresses, domains: [] },
      notChecked: [],
      actions: [],
    },
  };
}

const shared = "0x1111111111111111111111111111111111111111";

test("only the latest scan of each target is drawn, and shared indicators link scans", () => {
  const graph = buildScanGraph([
    scan("new", "a.io", "critical", [shared], ["critical", "caution"]),
    scan("old", "A.io", "unknown"),
    scan("b", "b.io", "high", [shared], ["high"]),
  ]);
  expect(graph.scans.map((item) => item.key)).toEqual(["new", "b"]);
  expect(graph.indicators).toHaveLength(1);
  expect(graph.indicators[0]).toMatchObject({ key: `wallet:1:${shared}`, level: "critical", scanKeys: ["new", "b"] });
  expect(graph.links).toEqual([{ scan: "new", indicator: `wallet:1:${shared}` }, { scan: "b", indicator: `wallet:1:${shared}` }]);
  expect(graph.findings.map((item) => item.finding.severity)).toEqual(["critical", "high", "caution"]);
  expect(graph.totals).toMatchObject({ critical: 1, high: 1, caution: 1 });
});

test("limits keep the diagram readable and report what was left out", () => {
  const records = Array.from({ length: 5 }, (_, index) => scan(`s${index}`, `site${index}.io`, "caution"));
  const graph = buildScanGraph(records, { maxScans: 3 });
  expect(graph.scans).toHaveLength(3);
  expect(graph.hiddenScans).toBe(2);
});

test("old records without indicators do not break the graph", () => {
  const record = scan("x", "x.io", "unknown");
  // @ts-expect-error older history entries may lack indicators
  delete record.verdict.indicators;
  expect(buildScanGraph([record]).indicators).toEqual([]);
});
