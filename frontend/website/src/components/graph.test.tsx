import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraphResult } from "./graph";
import type { GraphData } from "../types";

const seedWallet = "1:0x658729879fca881d9526480b82ae00efc54b5c2d";
const seedGraph: GraphData = {
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

const noop = () => {};

test("graph result renders the node, risk badge, source, and clickable peers", () => {
  const openPeer = vi.fn();
  const { container } = render(<GraphResult data={seedGraph} onOpenPeer={openPeer} onReport={noop} />);
  expect(container.querySelector(".verdict--critical")).not.toBeNull();
  expect(container.textContent).toContain("SOURCE: TIGERGRAPH");
  expect(container.textContent).toContain(seedWallet);
  expect(container.textContent).toContain("Ledger Connect Kit collector");
  expect(container.textContent).toContain("Package drains to wallet");
  // The peer is clickable both in the diagram and the edge table.
  const peers = container.querySelectorAll(
    '[data-graph-peer][data-type="package"][data-id="pkg:npm/@ledgerhq/connect-kit@1.1.7"]',
  );
  expect(peers.length).toBe(2);
  (peers[1] as HTMLButtonElement).click();
  expect(openPeer).toHaveBeenCalledWith({ type: "package", id: "pkg:npm/@ledgerhq/connect-kit@1.1.7" });
  // direction "in" draws the peer pointing at this node.
  expect(container.textContent).toContain("package · pkg:npm/@ledgerhq/conn…t@1.1.7 → this node");
});

test("graph result escapes malicious API text and draws the same for the database source", () => {
  const { container } = render(
    <GraphResult
      data={{
        node: {
          type: "domain",
          id: "<img src=x onerror=alert(1)>",
          risk: "high",
          category: "<b>phishing</b>",
          reportCount: 0,
        },
        edges: [],
        source: "database",
      }}
      onOpenPeer={noop}
      onReport={noop}
    />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("b")).toBeNull();
  expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(container.textContent).toContain("SOURCE: DATABASE");
  expect(container.textContent).toContain("No connections recorded");
});

test("the funded edge keeps its transaction hash and out direction", () => {
  const { container } = render(
    <GraphResult
      data={{
        node: { type: "wallet", id: seedWallet, risk: "high", reportCount: 2 },
        edges: [
          {
            type: "funded",
            direction: "out",
            peerType: "wallet",
            peerId: "1:0x1111111111111111111111111111111111111111",
            txHash: "0xabcdef1234567890abcdef1234567890",
          },
        ],
        source: "database",
      }}
      onOpenPeer={noop}
      onReport={noop}
    />,
  );
  expect(container.textContent).toContain("this node → wallet");
  expect(container.textContent).toContain("0xabcdef12…4567890");
  expect(screen.getByText("Wallet funded wallet")).toBeInTheDocument();
});
