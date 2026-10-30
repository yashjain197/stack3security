// Isolated-world bridge for the MAIN-world wallet hook. It hands the hook a private
// MessagePort, shows the Stack3 review panel for every held wallet request, asks the
// background worker for the live checks, and sends the user's decision back.
// The page origin is stamped here, where the page cannot forge it.

import { summarizeReview } from "../utils/decode";
import { showTxPanel } from "../utils/overlay";
import type { ContractFacts, TxReview, WalletReviewResult } from "../utils/types";

const HOOK = "stack3-wallet-hook";
const RELAY = "stack3-wallet-relay";

// A page queuing more prompts than this is spamming; the extras are rejected.
const MAX_QUEUE = 10;

const REVIEWED_METHODS = new Set([
  "eth_sendTransaction",
  "eth_signTransaction",
  "personal_sign",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "wallet_sendCalls",
]);

type Pending = { id: number; review: TxReview; facts: ContractFacts | null };
type BackgroundReply = { ok: true; data: WalletReviewResult } | { ok: false; error: string };

function isReview(value: unknown): value is TxReview {
  if (!value || typeof value !== "object") return false;
  const review = value as TxReview;
  return (
    typeof review.method === "string" &&
    REVIEWED_METHODS.has(review.method) &&
    Number.isInteger(review.chainId) &&
    review.chainId >= 1
  );
}

function isFacts(value: unknown): value is ContractFacts {
  return !!value && typeof value === "object" && "isContract" in value;
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  allFrames: true,
  main() {
    const candidates: MessagePort[] = [];
    let port: MessagePort | null = null;
    const queue: Pending[] = [];
    let showing = false;

    const decide = (id: number, proceed: boolean) => port?.postMessage({ kind: "decision", id, proceed });

    function onPortMessage(this: MessagePort, event: MessageEvent) {
      const data = event.data as { kind?: string; id?: unknown; review?: unknown; facts?: unknown } | null;
      if (!data) return;
      if (data.kind === "ready" && !port) {
        // The hook claimed this port; drop any other offers.
        port = this;
        for (const other of candidates) if (other !== this) other.close();
        candidates.length = 0;
        return;
      }
      if (this !== port || data.kind !== "review" || typeof data.id !== "number" || !isReview(data.review)) return;
      port.postMessage({ kind: "ack", id: data.id });
      if (queue.length >= MAX_QUEUE) {
        decide(data.id, false);
        return;
      }
      queue.push({
        id: data.id,
        review: { ...data.review, origin: location.origin },
        facts: isFacts(data.facts) ? data.facts : null,
      });
      void showNext();
    }

    function offerPort() {
      const channel = new MessageChannel();
      channel.port1.onmessage = onPortMessage;
      candidates.push(channel.port1);
      window.postMessage({ source: RELAY, kind: "port" }, "*", [channel.port2]);
    }

    // Whichever script loads first, the hook ends up with a port: offer one now and
    // another when the hook says hello, until it claims one.
    window.addEventListener("message", (event) => {
      if (port || event.source !== window) return;
      const data = event.data as { source?: string; kind?: string } | null;
      if (data?.source === HOOK && data.kind === "hello") offerPort();
    });
    offerPort();

    async function showNext() {
      if (showing) return;
      const next = queue.shift();
      if (!next) return;
      showing = true;
      // The panel needs a body; at document_start it may not exist yet.
      if (!document.body) await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));

      const panel = showTxPanel({
        review: next.review,
        summary: summarizeReview(next.review, next.facts),
        onDecision(proceed) {
          decide(next.id, proceed);
          showing = false;
          void showNext();
        },
      });

      try {
        const reply = (await browser.runtime.sendMessage({
          type: "wallet-request",
          review: next.review,
          facts: next.facts,
        })) as BackgroundReply | undefined;
        if (reply?.ok) panel.update(reply.data);
        else panel.update(null, reply?.error);
      } catch {
        panel.update(null, "The extension's background worker is unavailable. Rely on the summary above.");
      }
    }
  },
});
