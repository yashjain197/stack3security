// Local, offline decoding of wallet requests into a plain-language summary.
// Runs before any API call so the user always sees what they are about to sign,
// even when the extension is not linked or the API is unreachable.

import { nativeSymbol } from "./chains";
import type { ContractFacts, Level, TxReview } from "./types";

export type SummaryWarning = { level: Level; text: string };

export type TxSummary = {
  title: string;
  description: string;
  details: [string, string][];
  warnings: SummaryWarning[];
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// Allowances at or above 2^128 are effectively unlimited (covers uint256 and Permit2's uint160 max).
const UNLIMITED = 1n << 128n;

const levelRank: Record<Level, number> = { no_known_issues: 0, unknown: 0, caution: 1, high: 2, critical: 3 };

export const rankOf = (level: Level) => levelRank[level];

export function worstLevel(...levels: (Level | null | undefined)[]): Level {
  return levels.reduce<Level>(
    (worst, level) => (level && levelRank[level] > levelRank[worst] ? level : worst),
    "no_known_issues",
  );
}

export const isAddress = (value: unknown): value is string => typeof value === "string" && ADDRESS.test(value);

export const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

const sameAddress = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

function toBig(value: unknown): bigint | null {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
    if (typeof value === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(value.trim())) return BigInt(value.trim());
  } catch {
    // Fall through.
  }
  return null;
}

function formatUnits(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** Formats a token amount; without decimals the raw integer is shown. */
export function formatAmount(raw: bigint | null, decimals?: number, symbol?: string): string {
  if (raw === null) return "an unknown amount";
  if (raw >= UNLIMITED) return `Unlimited ${symbol ?? "tokens"}`;
  if (decimals === undefined) return `${raw.toString()} ${symbol ?? "units (raw)"}`;
  return `${formatUnits(raw, decimals)} ${symbol ?? "tokens"}`;
}

function formatNative(value: string | undefined, chainId: number): string | null {
  const raw = toBig(value);
  if (!raw) return null;
  return `${formatUnits(raw, 18)} ${nativeSymbol(chainId)}`;
}

function formatDeadline(value: unknown): string | null {
  const raw = toBig(value);
  if (raw === null) return null;
  if (raw >= 1n << 47n) return "Never expires";
  return new Date(Number(raw) * 1000).toLocaleString();
}

/** The token whose name, symbol and decimals help explain the request. */
export function tokenAddressOf(review: TxReview): string | null {
  if (review.typedData) {
    const domain = (review.typedData.domain ?? {}) as Record<string, unknown>;
    const message = (review.typedData.message ?? {}) as Record<string, unknown>;
    const details = message.details as Record<string, unknown> | undefined;
    const permitted = message.permitted as Record<string, unknown> | undefined;
    if (details && isAddress(details.token)) return details.token;
    if (permitted && isAddress(permitted.token)) return permitted.token;
    return isAddress(domain.verifyingContract) ? domain.verifyingContract : null;
  }
  if (isAddress(review.to)) return review.to;
  return review.calls?.find((call) => isAddress(call.to))?.to ?? null;
}

/** The contract the user is interacting with: transaction target or typed-data verifying contract. */
export function subjectContractOf(review: TxReview): string | null {
  if (isAddress(review.to)) return review.to;
  const call = review.calls?.find((entry) => isAddress(entry.to));
  if (call?.to) return call.to;
  const domain = (review.typedData?.domain ?? {}) as Record<string, unknown>;
  return isAddress(domain.verifyingContract) ? domain.verifyingContract : null;
}

// ---------- Calldata ----------

type Words = { word(index: number): string | null; address(index: number): string | null; uint(index: number): bigint | null };

function readWords(data: string): Words {
  const body = data.slice(10);
  const word = (index: number) => {
    const chunk = body.slice(index * 64, index * 64 + 64);
    return chunk.length === 64 ? chunk : null;
  };
  return {
    word,
    address: (index) => {
      const chunk = word(index);
      return chunk ? `0x${chunk.slice(24)}` : null;
    },
    uint: (index) => {
      const chunk = word(index);
      return chunk ? BigInt(`0x${chunk}`) : null;
    },
  };
}

type Decoded = { title: string; description: string; details: [string, string][]; warnings: SummaryWarning[] };

function decodeCall(
  to: string | undefined,
  data: string | undefined,
  value: string | undefined,
  chainId: number,
  from: string | undefined,
  facts: ContractFacts | null,
): Decoded {
  const details: [string, string][] = [];
  const warnings: SummaryWarning[] = [];
  const native = formatNative(value, chainId);
  const token = facts?.token && sameAddress(facts.token.address, to) ? facts.token : null;
  const symbol = token?.symbol;
  const decimals = token?.decimals;
  const tokenLabel = symbol ?? (to ? shortAddress(to) : "this token");

  if (!to) {
    return {
      title: "Deploy a new contract",
      description: "This transaction has no recipient, so it publishes new contract code from your wallet.",
      details,
      warnings: [{ level: "caution", text: "Only deploy contracts you built or fully trust." }],
    };
  }

  if (!data || data === "0x") {
    const toContract = facts?.isContract === true && sameAddress(facts.address, to);
    if (toContract) {
      warnings.push({ level: "caution", text: "This sends funds straight to a contract with no function call. Make sure the contract is meant to receive them." });
    }
    return {
      title: native ? `Send ${native}` : "Send a transaction",
      description: `Transfers ${native ?? "nothing"} to ${toContract ? "the contract" : "the address"} ${shortAddress(to)}.`,
      details,
      warnings,
    };
  }

  const selector = data.slice(0, 10).toLowerCase();
  const words = readWords(data);
  const withValue = (text: string) => (native ? `${text} It also sends ${native}.` : text);

  switch (selector) {
    case "0x095ea7b3": // approve(address,uint256)
    case "0x39509351": { // increaseAllowance(address,uint256)
      const spender = words.address(0);
      const amount = words.uint(1);
      const isNft = token !== null && token.decimals === undefined;
      if (amount === 0n && selector === "0x095ea7b3") {
        return { title: `Revoke ${tokenLabel} approval`, description: `Removes ${spender ? shortAddress(spender) : "the spender"}'s permission to spend your ${tokenLabel}.`, details, warnings };
      }
      if (spender) details.push(["Spender", spender]);
      if (isNft) {
        details.push(["Token id", String(amount)]);
        warnings.push({ level: "caution", text: `${spender ? shortAddress(spender) : "The spender"} will be able to transfer this NFT out of your wallet.` });
        return { title: `Approve one NFT from ${tokenLabel}`, description: withValue(`Lets ${spender ? shortAddress(spender) : "another address"} transfer token #${amount} from your wallet.`), details, warnings };
      }
      const formatted = formatAmount(amount, decimals, symbol);
      details.push(["Allowance", formatted]);
      if (amount !== null && amount >= UNLIMITED) {
        warnings.push({ level: "high", text: `Unlimited approval: ${spender ? shortAddress(spender) : "the spender"} can take all of your ${tokenLabel}, now or at any time later, until you revoke it.` });
      } else {
        warnings.push({ level: "caution", text: "Approvals let another address move your tokens without asking again. Only approve contracts you trust." });
      }
      return { title: `Approve ${tokenLabel} spending`, description: withValue(`Lets ${spender ? shortAddress(spender) : "another address"} spend ${formatted} from your wallet.`), details, warnings };
    }
    case "0xa22cb465": { // setApprovalForAll(address,bool)
      const operator = words.address(0);
      const approved = words.uint(1) !== 0n;
      if (operator) details.push(["Operator", operator]);
      if (!approved) {
        return { title: `Revoke collection access for ${tokenLabel}`, description: `Removes ${operator ? shortAddress(operator) : "the operator"}'s access to your NFTs in this collection.`, details, warnings };
      }
      warnings.push({ level: "high", text: `${operator ? shortAddress(operator) : "The operator"} will control EVERY item you own in this collection, including ones you receive later. This is the most common NFT drainer request.` });
      return { title: `Give full access to your ${tokenLabel} collection`, description: withValue(`Approves ${operator ? shortAddress(operator) : "another address"} to transfer all of your NFTs from this collection.`), details, warnings };
    }
    case "0xa9059cbb": { // transfer(address,uint256)
      const recipient = words.address(0);
      const formatted = formatAmount(words.uint(1), decimals, symbol);
      if (recipient) details.push(["Recipient", recipient]);
      details.push(["Amount", formatted]);
      return { title: `Send ${formatted}`, description: withValue(`Transfers ${formatted} from your wallet to ${recipient ? shortAddress(recipient) : "another address"}.`), details, warnings };
    }
    case "0x23b872dd": // transferFrom(address,address,uint256)
    case "0x42842e0e": // safeTransferFrom(address,address,uint256)
    case "0xb88d4fde": { // safeTransferFrom(address,address,uint256,bytes)
      const source = words.address(0);
      const recipient = words.address(1);
      const amount = words.uint(2);
      const isNft = selector !== "0x23b872dd" || (token !== null && token.decimals === undefined);
      const what = isNft ? `token #${amount} of ${tokenLabel}` : formatAmount(amount, decimals, symbol);
      if (source) details.push(["From", source]);
      if (recipient) details.push(["Recipient", recipient]);
      if (sameAddress(source, from) && recipient && !sameAddress(recipient, from)) {
        warnings.push({ level: "caution", text: `This moves ${what} out of your wallet to ${shortAddress(recipient)}.` });
      }
      return { title: `Transfer ${what}`, description: withValue(`Moves ${what} from ${source ? shortAddress(source) : "an address"} to ${recipient ? shortAddress(recipient) : "another address"}.`), details, warnings };
    }
    case "0x87517c45": { // Permit2 approve(address,address,uint160,uint48)
      const tokenAddress = words.address(0);
      const spender = words.address(1);
      const amount = words.uint(2);
      const tokenInfo = facts?.token && sameAddress(facts.token.address, tokenAddress) ? facts.token : null;
      const formatted = formatAmount(amount, tokenInfo?.decimals, tokenInfo?.symbol);
      if (tokenAddress) details.push(["Token", tokenAddress]);
      if (spender) details.push(["Spender", spender]);
      details.push(["Allowance", formatted], ["Expires", formatDeadline(words.uint(3)) ?? "Unknown"]);
      if (amount !== null && amount >= UNLIMITED) warnings.push({ level: "high", text: "Unlimited Permit2 allowance: the spender can take all of this token until the approval expires." });
      return { title: "Approve spending through Permit2", description: `Lets ${spender ? shortAddress(spender) : "another address"} spend ${formatted} via the Permit2 contract.`, details, warnings };
    }
    case "0xd505accf": // permit(...)
      return { title: "Submit a signed token approval", description: withValue("Puts a previously signed permit on-chain, granting a spender access to your tokens."), details, warnings };
    case "0xd0e30db0": // deposit()
      return { title: `Wrap ${native ?? nativeSymbol(chainId)}`, description: `Deposits ${native ?? "funds"} into the wrapped-token contract ${shortAddress(to)}.`, details, warnings };
    case "0x2e1a7d4d": // withdraw(uint256)
      return { title: "Withdraw / unwrap", description: `Withdraws ${formatAmount(words.uint(0), decimals ?? 18, symbol)} from ${shortAddress(to)}.`, details, warnings };
    case "0xac9650d8": // multicall(bytes[])
    case "0x5ae401dc": // multicall(uint256,bytes[])
    case "0x1f0464d1": // multicall(bytes32,bytes[])
    case "0x3593564c": // execute(bytes,bytes[],uint256) – Universal Router
    case "0x24856bc3": // execute(bytes,bytes[])
      return { title: "Run a batch of contract actions", description: withValue(`Calls ${shortAddress(to)} with several bundled actions, typical of swap routers and aggregators.`), details, warnings };
    default: {
      details.push(["Function", selector]);
      if (native) {
        warnings.push({ level: "caution", text: `Sends ${native} together with a contract function the extension cannot decode. Drainer sites often disguise theft as a "claim" or "verify" call.` });
      }
      return { title: "Call a contract function", description: withValue(`Calls function ${selector} on ${facts?.isContract === false ? "the address" : "the contract"} ${shortAddress(to)}.`), details, warnings };
    }
  }
}

// ---------- Messages and typed data ----------

function decodeMessage(review: TxReview): Decoded {
  const message = review.message ?? "";
  const details: [string, string][] = [];
  const warnings: SummaryWarning[] = [];
  if (/^0x[0-9a-fA-F]{64}$/.test(message)) {
    warnings.push({ level: "high", text: "This message is a raw 32-byte hash. Signing an unreadable hash can authorize something you cannot see." });
    return { title: "Sign an unreadable hash", description: "The site asks you to sign data that is not human readable.", details, warnings };
  }
  const siwe = message.match(/^(\S+) wants you to sign in with your (?:Ethereum|Solana)? ?account/i);
  if (siwe) {
    const claimed = siwe[1].replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    const actual = review.origin ? new URL(review.origin).host.toLowerCase() : null;
    if (actual && claimed !== actual) {
      warnings.push({ level: "critical", text: `The sign-in request names "${claimed}", but you are on "${actual}". This is how phishing sites steal logins.` });
    }
    return { title: "Sign in with your wallet", description: "A standard sign-in message. It proves you own the address and does not move funds.", details, warnings };
  }
  if (/(transfer|withdraw|approve|private key|seed phrase|validate your wallet|rectify|airdrop claim)/i.test(message)) {
    warnings.push({ level: "caution", text: "The message mentions moving funds or wallet secrets. Read it carefully before signing." });
  }
  return { title: "Sign a message", description: "Signing a message does not send funds by itself, but it can log you in or authorize off-chain actions.", details, warnings };
}

function decodeTypedData(review: TxReview, facts: ContractFacts | null): Decoded {
  const typed = review.typedData ?? {};
  const domain = (typed.domain ?? {}) as Record<string, unknown>;
  const message = (typed.message ?? {}) as Record<string, unknown>;
  const primaryType = typeof typed.primaryType === "string" ? typed.primaryType : "data";
  const details: [string, string][] = [];
  const warnings: SummaryWarning[] = [];
  const appName = typeof domain.name === "string" ? domain.name : null;
  if (appName) details.push(["App / token", appName]);
  if (isAddress(domain.verifyingContract)) details.push(["Verifying contract", domain.verifyingContract]);
  const domainChain = toBig(domain.chainId);
  if (domainChain !== null && Number(domainChain) !== review.chainId) {
    warnings.push({ level: "caution", text: `The signature is for chain ${domainChain}, but your wallet is on chain ${review.chainId}.` });
  }
  const tokenFor = (address: unknown) => (facts?.token && sameAddress(facts.token.address, address) ? facts.token : null);
  const gasless = "Off-chain signatures cost no gas and show nothing on-chain until the spender uses them, which is why drainers prefer them.";

  if (primaryType === "Permit") {
    const token = tokenFor(domain.verifyingContract);
    const amount = toBig(message.value);
    const spender = isAddress(message.spender) ? message.spender : null;
    const formatted = formatAmount(amount, token?.decimals, token?.symbol ?? appName ?? undefined);
    if (spender) details.push(["Spender", spender]);
    details.push(["Allowance", formatted], ["Deadline", formatDeadline(message.deadline) ?? "Unknown"]);
    warnings.push({ level: amount !== null && amount >= UNLIMITED ? "high" : "caution", text: `This is a token approval disguised as a signature. ${gasless}` });
    return { title: `Permit ${spender ? shortAddress(spender) : "a spender"} to spend ${formatted}`, description: "Signing grants a token allowance without a transaction.", details, warnings };
  }
  if (primaryType === "PermitSingle" || primaryType === "PermitBatch") {
    const entries = (Array.isArray(message.details) ? message.details : [message.details]).filter(Boolean) as Record<string, unknown>[];
    const spender = isAddress(message.spender) ? message.spender : null;
    if (spender) details.push(["Spender", spender]);
    let unlimited = false;
    for (const entry of entries.slice(0, 5)) {
      const token = tokenFor(entry.token);
      const amount = toBig(entry.amount);
      if (amount !== null && amount >= UNLIMITED) unlimited = true;
      details.push([token?.symbol ?? (isAddress(entry.token) ? shortAddress(entry.token) : "Token"), `${formatAmount(amount, token?.decimals, token?.symbol)} · expires ${formatDeadline(entry.expiration) ?? "?"}`]);
    }
    warnings.push({ level: unlimited ? "high" : "caution", text: `Permit2 allowance signature. ${gasless}` });
    return { title: `Permit2: let ${spender ? shortAddress(spender) : "a spender"} spend your tokens`, description: `Grants a Permit2 allowance for ${entries.length} token${entries.length === 1 ? "" : "s"}.`, details, warnings };
  }
  if (primaryType === "PermitTransferFrom" || primaryType === "PermitBatchTransferFrom" || primaryType === "PermitWitnessTransferFrom") {
    const permitted = (Array.isArray(message.permitted) ? message.permitted : [message.permitted]).filter(Boolean) as Record<string, unknown>[];
    const spender = isAddress(message.spender) ? message.spender : null;
    if (spender) details.push(["Spender", spender]);
    for (const entry of permitted.slice(0, 5)) {
      const token = tokenFor(entry.token);
      details.push([token?.symbol ?? (isAddress(entry.token) ? shortAddress(entry.token) : "Token"), formatAmount(toBig(entry.amount), token?.decimals, token?.symbol)]);
    }
    warnings.push({ level: "high", text: `Signing lets ${spender ? shortAddress(spender) : "the spender"} pull these tokens from your wallet directly. ${gasless}` });
    return { title: "Authorize a token transfer by signature", description: "A Permit2 signature transfer moves tokens out of your wallet once submitted.", details, warnings };
  }
  if (primaryType === "OrderComponents" || primaryType === "Order") {
    const offerer = message.offerer ?? message.maker;
    const consideration = Array.isArray(message.consideration) ? (message.consideration as Record<string, unknown>[]) : [];
    const offer = Array.isArray(message.offer) ? message.offer.length : 0;
    details.push(["Items offered", String(offer)], ["Payment entries", String(consideration.length)]);
    if (consideration.length && !consideration.some((item) => sameAddress(item.recipient, offerer))) {
      warnings.push({ level: "critical", text: "None of the payment for this order goes to you. Signing it can give your items away for free." });
    } else {
      warnings.push({ level: "caution", text: "This creates a marketplace order anyone can fill. Check the price before signing." });
    }
    return { title: "List items on a marketplace", description: "Signing creates a sell order for your NFTs or tokens.", details, warnings };
  }
  return { title: `Sign structured data (${primaryType})`, description: `A typed-data signature${appName ? ` for ${appName}` : ""}. Check that you expected this request from the site.`, details, warnings };
}

/** Plain-language summary of a wallet request, computed locally. */
export function summarizeReview(review: TxReview, facts: ContractFacts | null): TxSummary {
  let decoded: Decoded;
  switch (review.method) {
    case "eth_sendTransaction":
    case "eth_signTransaction":
      decoded = decodeCall(review.to, review.data, review.value, review.chainId, review.from, facts);
      break;
    case "wallet_sendCalls": {
      const calls = (review.calls ?? []).map((call) => decodeCall(call.to, call.data, call.value, review.chainId, review.from, facts));
      decoded = {
        title: `Batch of ${calls.length} call${calls.length === 1 ? "" : "s"}`,
        description: calls.map((call, index) => `${index + 1}. ${call.title}`).join("  "),
        details: calls.flatMap((call) => call.details),
        warnings: calls.flatMap((call) => call.warnings),
      };
      break;
    }
    case "personal_sign":
      decoded = decodeMessage(review);
      break;
    case "eth_sign":
      decoded = {
        title: "Sign a raw hash (eth_sign)",
        description: "eth_sign signs arbitrary data that can encode a full transaction.",
        details: [],
        warnings: [{ level: "critical", text: "eth_sign can authorize transfers you cannot read. Legitimate dapps almost never need it. Reject unless you are certain." }],
      };
      break;
    default:
      decoded = review.method.startsWith("eth_signTypedData")
        ? decodeTypedData(review, facts)
        : { title: "Wallet request", description: review.method, details: [], warnings: [] };
  }
  return { title: decoded.title, description: decoded.description, details: decoded.details, warnings: decoded.warnings };
}
