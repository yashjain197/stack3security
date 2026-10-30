// Runs in the page's MAIN world at document_start: wraps the wallet provider's
// request() so transaction and signing prompts are reviewed BEFORE the wallet opens.
// The request is held until the user picks "Continue to wallet" or "Reject" in the
// Stack3 panel. If the extension does not answer quickly (disabled, reloading,
// crashed) the request goes straight to the wallet, so dapps never break.
// Nothing here can alter the request: it is either forwarded unchanged or rejected.

import { isAddress, tokenAddressOf } from "../utils/decode";
import type { ContractFacts, TxReview } from "../utils/types";

const HOOK = "stack3-wallet-hook";
const RELAY = "stack3-wallet-relay";

// How long to wait for the extension to confirm it is showing the review.
const ACK_TIMEOUT = 1500;
// Budget for the read-only RPC lookups made before the review is shown.
const FACTS_TIMEOUT = 1200;

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

type RequestArgs = { method: string; params?: unknown[] };
type ProviderRequest = (args: RequestArgs) => Promise<unknown>;
type Provider = { request?: ProviderRequest; chainId?: unknown };

function clamp(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value ? value.slice(0, max) : undefined;
}

function parseChainId(value: unknown): number | null {
  const parsed =
    typeof value === "string" ? Number.parseInt(value, value.startsWith("0x") ? 16 : 10) : Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

/** personal_sign messages arrive hex encoded; show text when it decodes cleanly. */
function decodeSignMessage(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (!/^0x[0-9a-fA-F]*$/.test(value)) return value.slice(0, 8000);
  try {
    const bytes = new Uint8Array((value.slice(2).match(/.{2}/g) ?? []).map((pair) => Number.parseInt(pair, 16)));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Keep the hex form when the bytes are not readable text.
    return /^[\P{C}\s]*$/u.test(text) && text ? text.slice(0, 8000) : value.slice(0, 8000);
  } catch {
    return value.slice(0, 8000);
  }
}

function buildReview(method: string, params: unknown[], chainId: number): TxReview | null {
  const review: TxReview = { chainId, method };
  const first = (params[0] ?? null) as Record<string, unknown> | string | null;
  const second = (params[1] ?? null) as Record<string, unknown> | string | null;

  if (method === "eth_sendTransaction" || method === "eth_signTransaction") {
    if (!first || typeof first !== "object") return null;
    review.from = clamp(first.from, 42);
    review.to = clamp(first.to, 42);
    review.value = clamp(first.value, 78);
    review.data = clamp(first.data ?? first.input, 48_000);
  } else if (method === "personal_sign") {
    // Some dapps send the params in the wrong order; the address is the one that looks like one.
    const [message, address] = isAddress(first) && !isAddress(second) ? [second, first] : [first, second];
    review.message = decodeSignMessage(message);
    review.from = clamp(address, 42);
  } else if (method === "eth_sign") {
    review.from = clamp(first, 42);
    review.message = decodeSignMessage(second);
  } else if (method.startsWith("eth_signTypedData")) {
    review.from = clamp(first, 42);
    const raw = typeof second === "string" ? second : JSON.stringify(second ?? null);
    if (raw && raw.length <= 48_000) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") review.typedData = parsed;
      } catch {
        // Unparsable typed data is simply not sent.
      }
    }
  } else if (method === "wallet_sendCalls") {
    if (!first || typeof first !== "object") return null;
    review.from = clamp(first.from, 42);
    const batchChain = parseChainId(first.chainId);
    if (batchChain) review.chainId = batchChain;
    const calls = Array.isArray(first.calls) ? first.calls.slice(0, 8) : [];
    review.calls = calls
      .filter((call): call is Record<string, unknown> => !!call && typeof call === "object")
      .map((call) => ({
        to: clamp(call.to, 42),
        value: clamp(call.value, 78),
        data: clamp(call.data, 48_000),
      }));
  }
  return review;
}

/** Decodes an ABI string return value, or a bytes32 one (older tokens such as MKR). */
function decodeAbiString(hex: unknown): string | undefined {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex) || hex.length < 66) return undefined;
  const body = hex.slice(2);
  try {
    let bytes: string;
    if (body.length >= 128 && Number.parseInt(body.slice(0, 64), 16) === 32) {
      const length = Number.parseInt(body.slice(64, 128), 16);
      if (length > 64) return undefined;
      bytes = body.slice(128, 128 + length * 2);
    } else {
      bytes = body.slice(0, 64).replace(/(00)+$/, "");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array((bytes.match(/.{2}/g) ?? []).map((pair) => Number.parseInt(pair, 16))),
    );
    return text && /^[\P{C}]+$/u.test(text) ? text.slice(0, 40) : undefined;
  } catch {
    return undefined;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** Read-only lookups through the wallet's own RPC: is the target a contract, and which token is it. */
async function gatherFacts(original: ProviderRequest, review: TxReview): Promise<ContractFacts> {
  const address = isAddress(review.to)
    ? review.to
    : (review.calls?.find((call) => isAddress(call.to))?.to ?? null);
  const tokenAddress = tokenAddressOf(review);
  const call = (to: string, data: string) => original({ method: "eth_call", params: [{ to, data }, "latest"] });

  const [code, name, symbol, decimals] = await Promise.all([
    address ? withTimeout(original({ method: "eth_getCode", params: [address, "latest"] }), FACTS_TIMEOUT) : null,
    tokenAddress ? withTimeout(call(tokenAddress, "0x06fdde03"), FACTS_TIMEOUT) : null,
    tokenAddress ? withTimeout(call(tokenAddress, "0x95d89b41"), FACTS_TIMEOUT) : null,
    tokenAddress ? withTimeout(call(tokenAddress, "0x313ce567"), FACTS_TIMEOUT) : null,
  ]);

  const tokenSymbol = decodeAbiString(symbol);
  const parsedDecimals =
    typeof decimals === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(decimals) ? Number.parseInt(decimals, 16) : NaN;
  return {
    address,
    isContract: typeof code === "string" ? code !== "0x" && code !== "0x0" && code !== "" : null,
    token:
      tokenAddress && tokenSymbol
        ? {
            address: tokenAddress,
            symbol: tokenSymbol,
            name: decodeAbiString(name),
            decimals: Number.isInteger(parsedDecimals) && parsedDecimals <= 36 ? parsedDecimals : undefined,
          }
        : null,
  };
}

function userRejected(): Error {
  // EIP-1193 code 4001: dapps and libraries (viem, ethers) treat it as a normal user rejection.
  return Object.assign(new Error("User rejected the request. (Stack3 Security)"), { code: 4001 });
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  world: "MAIN",
  allFrames: true,
  main() {
    const wrapped = new WeakMap<object, ProviderRequest>();
    // Requests already reviewed, so a provider wrapped twice (wallet + dapp wrapper) asks only once.
    const approved = new WeakSet<object>();
    const acks = new Map<number, () => void>();
    const decisions = new Map<number, (proceed: boolean) => void>();
    let port: MessagePort | null = null;
    let nextId = 1;

    // The relay hands over a private MessagePort at document_start, before any page script runs.
    // Only the first port is accepted, so a page cannot later impersonate the extension.
    window.addEventListener("message", (event) => {
      if (port || event.source !== window || !event.ports[0]) return;
      const data = event.data as { source?: string; kind?: string } | null;
      if (data?.source !== RELAY || data.kind !== "port") return;
      port = event.ports[0];
      port.onmessage = (message) => {
        const reply = message.data as { kind?: string; id?: number; proceed?: boolean } | null;
        if (!reply || typeof reply.id !== "number") return;
        if (reply.kind === "ack") acks.get(reply.id)?.();
        if (reply.kind === "decision") {
          decisions.get(reply.id)?.(reply.proceed === true);
          decisions.delete(reply.id);
        }
      };
      port.postMessage({ kind: "ready" });
    });
    window.postMessage({ source: HOOK, kind: "hello" }, "*");

    /** Resolves true when the wallet should be called, false when the user rejected. */
    async function review(provider: Provider, original: ProviderRequest, args: RequestArgs): Promise<boolean> {
      const channel = port;
      if (!channel) return true;
      let chainId = parseChainId(provider.chainId);
      if (!chainId) chainId = parseChainId(await withTimeout(original({ method: "eth_chainId" }), FACTS_TIMEOUT));
      const built = buildReview(args.method, Array.isArray(args.params) ? args.params : [], chainId ?? 1);
      if (!built) return true;
      const facts = await gatherFacts(original, built).catch(() => null);

      const id = nextId++;
      const decision = new Promise<boolean>((resolve) => decisions.set(id, resolve));
      const acked = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), ACK_TIMEOUT);
        acks.set(id, () => {
          clearTimeout(timer);
          resolve(true);
        });
        channel.postMessage({ kind: "review", id, review: built, facts });
      });
      acks.delete(id);
      if (!acked) {
        // The extension is not responding: never block the user's wallet.
        decisions.delete(id);
        return true;
      }
      return decision;
    }

    function hook(provider: Provider | undefined | null) {
      if (!provider || typeof provider !== "object" || typeof provider.request !== "function") return;
      if (wrapped.get(provider) === provider.request) return;
      const original = provider.request.bind(provider) as ProviderRequest;
      const replacement: ProviderRequest = function (args: RequestArgs) {
        if (args && typeof args.method === "string" && REVIEWED_METHODS.has(args.method) && !approved.has(args)) {
          return review(provider, original, args)
            .catch(() => true)
            .then((proceed) => {
              if (!proceed) throw userRejected();
              approved.add(args);
              return original(args);
            });
        }
        return original(args);
      };
      try {
        provider.request = replacement;
        if (provider.request !== replacement) {
          Object.defineProperty(provider, "request", { value: replacement, configurable: true, writable: true });
        }
        if (provider.request === replacement) wrapped.set(provider, replacement);
      } catch {
        // A frozen provider cannot be reviewed.
      }
    }

    const hookKnownProviders = () => {
      const win = window as { ethereum?: Provider & { providers?: Provider[] } };
      hook(win.ethereum);
      // Some wallets (e.g. Coinbase alongside MetaMask) expose several providers here.
      if (Array.isArray(win.ethereum?.providers)) win.ethereum.providers.forEach(hook);
    };

    hookKnownProviders();
    window.addEventListener("ethereum#initialized", hookKnownProviders);
    window.addEventListener("eip6963:announceProvider", (event) => {
      hook((event as CustomEvent<{ provider?: Provider }>).detail?.provider);
    });
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Wallets inject at their own pace and dapps may swap request(); re-check for a while.
    let attempts = 0;
    const timer = setInterval(() => {
      hookKnownProviders();
      if (++attempts >= 40) clearInterval(timer);
    }, 500);
  },
});
