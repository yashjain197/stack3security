// In-page UI rendered from content scripts: the pre-signing review panel and phishing warnings.
// Everything lives in a closed shadow root so page CSS cannot restyle it and page scripts
// cannot read it. Text from the page or the API is only ever set via textContent.

import { chainName, explorerAddressUrl } from "./chains";
import { contractDetailsUrl, levelLabels } from "./api";
import { rankOf, shortAddress, subjectContractOf, worstLevel, type TxSummary } from "./decode";
import type { Level, PageAlert, Verdict, WalletReviewResult } from "./types";

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.backdrop { position: fixed; inset: 0; background: rgba(5, 8, 15, 0.62); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 2147483647; }
.card { width: min(440px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column; overflow: hidden; background: #0f141d; color: #e7ecf3; border: 1px solid #263041; border-radius: 14px; box-shadow: 0 24px 64px rgba(0,0,0,.5); font-size: 13px; line-height: 1.45; }
.head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid #1d2532; }
.brand { font-weight: 700; letter-spacing: .01em; }
.brand span { color: #8b98ab; font-weight: 500; }
.pill { margin-left: auto; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; background: #263041; color: #c6d0de; }
.pill.critical { background: #b42318; color: #fff; }
.pill.high { background: #dc6803; color: #fff; }
.pill.caution { background: #b5850b; color: #fff; }
.pill.no_known_issues { background: #067647; color: #fff; }
.body { padding: 14px 16px; display: grid; gap: 12px; overflow: auto; min-height: 0; flex: 1 1 auto; }
.head, .foot { flex: none; }
h2 { margin: 0; font-size: 16px; line-height: 1.3; color: #fff; }
p { margin: 0; }
.muted { color: #8b98ab; }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
.facts dt { color: #8b98ab; }
.facts dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.warn { padding: 8px 10px; border-radius: 8px; border-left: 3px solid #b5850b; background: rgba(181,133,11,.12); }
.warn.high { border-color: #dc6803; background: rgba(220,104,3,.14); }
.warn.critical { border-color: #f04438; background: rgba(240,68,56,.16); }
.section { border: 1px solid #1d2532; border-radius: 10px; padding: 10px 12px; display: grid; gap: 6px; }
.section h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #8b98ab; display: flex; align-items: center; gap: 8px; }
.section h3 .pill { margin-left: auto; }
.finding strong { display: block; color: #fff; }
.message { max-height: 96px; overflow: auto; white-space: pre-wrap; background: #0a0e15; border-radius: 8px; padding: 8px; font-family: ui-monospace, monospace; font-size: 11px; color: #c6d0de; }
.links { display: flex; flex-wrap: wrap; gap: 12px; }
a { color: #7cb4ff; text-decoration: none; }
a:hover { text-decoration: underline; }
.foot { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #1d2532; }
button { flex: 1; padding: 10px 12px; border-radius: 9px; border: 1px solid #344054; background: #1a2230; color: #e7ecf3; font-size: 13px; font-weight: 600; cursor: pointer; }
button:hover { filter: brightness(1.15); }
button.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
button.danger { background: #b42318; border-color: #b42318; color: #fff; }
.spinner { width: 12px; height: 12px; border: 2px solid #344054; border-top-color: #7cb4ff; border-radius: 50%; display: inline-block; animation: spin .8s linear infinite; vertical-align: -2px; margin-right: 6px; }
@keyframes spin { to { transform: rotate(360deg); } }
.banner { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647; display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; background: #dc6803; color: #fff; font-size: 13px; line-height: 1.45; box-shadow: 0 6px 24px rgba(0,0,0,.35); }
.banner.critical { background: #b42318; }
.banner .text { flex: 1; display: grid; gap: 4px; }
.banner ul { margin: 0; padding-left: 18px; }
.banner a { color: #fff; text-decoration: underline; }
.banner button { flex: none; background: rgba(255,255,255,.16); border-color: rgba(255,255,255,.4); color: #fff; padding: 6px 10px; }
.banner button.solid { background: #fff; color: #7a1a12; border-color: #fff; }
.interstitial .card { border-color: #f04438; }
.interstitial ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
`;

type Child = Node | string | null | undefined | false;

function h(tag: string, props: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") element.textContent = value;
    else element.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return element;
}

function link(href: string, text: string): HTMLElement {
  return h("a", { href, target: "_blank", rel: "noopener noreferrer", text });
}

function mount(id: string): { host: HTMLElement; root: ShadowRoot } {
  document.getElementById(id)?.remove();
  const host = document.createElement("stack3-security-ui");
  host.id = id;
  const root = host.attachShadow({ mode: "closed" });
  root.append(h("style", { text: STYLES }));
  (document.body ?? document.documentElement).append(host);
  return { host, root };
}

const pillText = (level: Level | "checking") => (level === "checking" ? "Checking…" : levelLabels[level]);

// ---------- Transaction review panel ----------

export type TxPanel = { update(result: WalletReviewResult | null, failure?: string): void; close(): void };

function verdictSection(title: string, verdict: Verdict): HTMLElement {
  const findings = verdict.findings
    .slice()
    .sort((a, b) => rankOf(b.severity) - rankOf(a.severity))
    .slice(0, 4);
  return h(
    "div",
    { class: "section" },
    h("h3", {}, title, h("span", { class: `pill ${verdict.level}`, text: levelLabels[verdict.level] })),
    verdict.explanation ? h("p", { text: verdict.explanation }) : null,
    ...findings.map((finding) =>
      h("div", { class: "finding" }, h("strong", { text: finding.title }), h("span", { class: "muted", text: finding.evidence })),
    ),
    verdict.actions.length ? h("p", { class: "muted", text: verdict.actions.join(" ") }) : null,
  );
}

export function showTxPanel(options: {
  review: WalletReviewResult["review"];
  summary: TxSummary;
  onDecision(proceed: boolean): void;
}): TxPanel {
  const { review, summary } = options;
  const { host, root } = mount("stack3-tx-panel");
  const contract = subjectContractOf(review);
  const localLevel = worstLevel(...summary.warnings.map((warning) => warning.level));

  const pill = h("span", { class: "pill", text: pillText("checking") });
  const contractBox = h("div", { class: "section" }, h("h3", { text: "Contract & risk checks" }), h("p", { class: "muted" }, h("span", { class: "spinner" }), "Checking the contract and transaction…"));
  const continueButton = h("button", { class: "primary", type: "button", text: "Continue to wallet" });
  const rejectButton = h("button", { type: "button", text: "Reject" });

  const facts: [string, string][] = [
    ["Chain", `${chainName(review.chainId)} (${review.chainId})`],
  ];
  if (review.origin) facts.push(["Site", review.origin.replace(/^https?:\/\//, "")]);
  if (contract) facts.push(["Contract", contract]);
  if (review.from) facts.push(["Your wallet", shortAddress(review.from)]);
  facts.push(...summary.details);

  const links = h("div", { class: "links" }, link(contractDetailsUrl(review.chainId, contract), "Full details on Stack3 ↗"));
  const explorer = contract ? explorerAddressUrl(review.chainId, contract) : null;
  if (explorer) links.append(link(explorer, "View on block explorer ↗"));

  const applyLevel = (level: Level | "checking") => {
    pill.className = `pill ${level === "checking" ? "" : level}`;
    pill.textContent = pillText(level);
    const dangerous = level !== "checking" && rankOf(level) >= rankOf("high");
    continueButton.className = dangerous ? "danger" : "primary";
    continueButton.textContent = dangerous ? "Continue anyway" : "Continue to wallet";
    rejectButton.className = dangerous ? "primary" : "";
  };

  const card = h(
    "div",
    { class: "card", role: "dialog", "aria-modal": "true", "aria-label": "Stack3 Security transaction review" },
    h("div", { class: "head" }, h("span", { class: "brand" }, "stack3", h("span", { text: " security · review before you sign" })), pill),
    h(
      "div",
      { class: "body" },
      h("div", {}, h("h2", { text: summary.title }), h("p", { class: "muted", text: summary.description })),
      ...summary.warnings.map((warning) => h("div", { class: `warn ${warning.level}`, text: warning.text })),
      review.message ? h("div", { class: "message", text: review.message.slice(0, 2000) }) : null,
      h("dl", { class: "facts" }, ...facts.flatMap(([label, value]) => [h("dt", { text: label }), h("dd", { text: value })])),
      contractBox,
      links,
    ),
    h("div", { class: "foot" }, rejectButton, continueButton),
  );
  root.append(h("div", { class: "backdrop" }, card));

  let decided = false;
  const decide = (proceed: boolean) => {
    if (decided) return;
    decided = true;
    host.remove();
    options.onDecision(proceed);
  };
  rejectButton.addEventListener("click", () => decide(false));
  continueButton.addEventListener("click", () => decide(true));
  rejectButton.focus();

  return {
    update(result, failure) {
      contractBox.replaceChildren(h("h3", { text: "Contract & risk checks" }));
      if (!result) {
        contractBox.append(h("p", { class: "muted", text: failure ?? "Live checks are unavailable. Rely on the summary above." }));
        applyLevel(localLevel === "no_known_issues" ? "unknown" : localLevel);
        return;
      }
      const lines: string[] = [];
      if (result.facts?.isContract === false) lines.push("The target is a regular wallet address, not a contract.");
      if (result.facts?.token?.symbol) {
        const { name, symbol } = result.facts.token;
        lines.push(`Token: ${name ? `${name} (${symbol})` : symbol}`);
      }
      if (result.sourcify) {
        lines.push(
          result.sourcify.verified
            ? `Source code verified on Sourcify${result.sourcify.name ? ` as "${result.sourcify.name}"` : ""}.`
            : "Source code is not verified on Sourcify.",
        );
      }
      for (const line of lines) contractBox.append(h("p", { text: line }));
      if (result.contract) contractBox.append(verdictSection("Contract scan", result.contract));
      if (result.tx) contractBox.append(verdictSection("Transaction review", result.tx));
      if (!result.linked) {
        contractBox.append(h("p", { class: "muted", text: "Link the extension (toolbar icon → Link this device) for the full Stack3 contract scan, threat-graph and drainer checks." }));
      }
      for (const message of result.errors) contractBox.append(h("p", { class: "muted", text: message }));
      if (!lines.length && !result.contract && !result.tx && result.linked && !result.errors.length) {
        contractBox.append(h("p", { class: "muted", text: "No contract information was returned." }));
      }
      const level = worstLevel(localLevel, result.tx?.level, result.contract?.level);
      applyLevel(level === "no_known_issues" && !result.tx && !result.contract ? "unknown" : level);
    },
    close() {
      decide(false);
    },
  };
}

// ---------- Phishing warnings ----------

function leaveSite() {
  if (history.length > 1) history.back();
  else location.replace("about:blank");
}

/** High risk: a dismissible banner. Critical: a full-page interstitial. */
export function showPageAlert(alert: PageAlert, onDismiss: () => void): void {
  const { host, root } = mount("stack3-page-alert");
  const dismiss = () => {
    host.remove();
    onDismiss();
  };
  const reasons = h("ul", {}, ...alert.reasons.slice(0, 5).map((reason) => h("li", { text: reason })));

  if (alert.level === "critical") {
    const leave = h("button", { class: "primary", type: "button", text: "Get me out of here" });
    const stay = h("button", { type: "button", text: "I understand the risk, continue" });
    leave.addEventListener("click", leaveSite);
    stay.addEventListener("click", dismiss);
    root.append(
      h(
        "div",
        { class: "backdrop interstitial" },
        h(
          "div",
          { class: "card", role: "alertdialog", "aria-modal": "true", "aria-label": "Stack3 Security phishing warning" },
          h("div", { class: "head" }, h("span", { class: "brand" }, "stack3", h("span", { text: " security" })), h("span", { class: "pill critical", text: "Likely phishing" })),
          h(
            "div",
            { class: "body" },
            h("h2", { text: `Do not connect your wallet to ${alert.host}` }),
            h("p", { class: "muted", text: "This page shows strong signs of a crypto phishing or wallet-drainer scam:" }),
            reasons,
            h("div", { class: "links" }, link(alert.detailsUrl, "Why was this flagged? Details on Stack3 ↗")),
          ),
          h("div", { class: "foot" }, stay, leave),
        ),
      ),
    );
    leave.focus();
    return;
  }

  const close = h("button", { type: "button", text: "Dismiss" });
  const leave = h("button", { class: "solid", type: "button", text: "Leave site" });
  close.addEventListener("click", dismiss);
  leave.addEventListener("click", leaveSite);
  root.append(
    h(
      "div",
      { class: `banner ${alert.level}`, role: "alert" },
      h(
        "div",
        { class: "text" },
        h("strong", { text: `Stack3 Security: ${alert.host} looks suspicious (${levelLabels[alert.level]})` }),
        reasons,
        link(alert.detailsUrl, "Details on Stack3"),
      ),
      leave,
      close,
    ),
  );
}
