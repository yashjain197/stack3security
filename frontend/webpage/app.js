import { contractExample, demoNotice, reports, transactionExample } from "./mock-data.js";
import {
  analyzeSampleTransaction,
  getDashboardData,
  getReport,
  reviewSampleContract,
  scanWebsite,
} from "./security-service.js";
import { createApiClient } from "./api.js";
import { accountPaths, createAccountUI } from "./account.js";
import { createGraphUI } from "./graph.js";
import { escapeHtml } from "./html.js";

const app = document.querySelector("#app");
let api;
let accountUI;
let graphUI;
let renderVersion = 0;
let startupError = null;
let initialized = false;
const routeTitles = {
  "/": "Stack3 Security — Verify what happens underneath",
  "/pricing": "Pricing — Stack3 Security",
  "/how-it-works": "How it works — Stack3 Security",
  "/dashboard": "Security overview — Stack3 Security",
  "/dashboard/scanner": "Website scanner — Stack3 Security",
  "/dashboard/transactions": "Transaction analyzer — Stack3 Security",
  "/dashboard/contracts": "Contract overview — Stack3 Security",
  "/dashboard/graph": "Threat graph — Stack3 Security",
  "/dashboard/reports": "Scan reports — Stack3 Security",
  "/dashboard/settings": "Settings — Stack3 Security",
  "/login": "Sign in — Stack3 Security",
  "/account/billing": "Billing — Stack3 Security",
  "/account/sessions": "Devices — Stack3 Security",
  "/account/team": "Team — Stack3 Security",
  "/billing/return": "Payment confirmation — Stack3 Security",
  "/link": "Link a device — Stack3 Security",
  "/teams/join": "Join a team — Stack3 Security",
};

const navItems = [
  { path: "/dashboard", label: "Overview", icon: "grid" },
  { path: "/dashboard/scanner", label: "Website scanner", icon: "scan" },
  { path: "/dashboard/transactions", label: "Transactions", icon: "arrows" },
  { path: "/dashboard/contracts", label: "Contracts", icon: "blocks" },
  { path: "/dashboard/graph", label: "Threat graph", icon: "graph" },
  { path: "/dashboard/reports", label: "Reports", icon: "file" },
  { path: "/dashboard/settings", label: "Settings", icon: "settings" },
  { path: "/account/billing", label: "Billing", icon: "file" },
  { path: "/account/team", label: "Team", icon: "grid" },
  { path: "/account/sessions", label: "Devices", icon: "lock" },
];

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10M12 7v10"/>',
  arrows: '<path d="M7 7h13l-3-3M17 17H4l3 3"/><path d="M17 4l3 3-3 3M7 14l-3 3 3 3"/>',
  blocks: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.4 7.5-4.4M12 12.2V21"/>',
  graph: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.5 6h9M6.3 8.2l4.4 7.6M17.7 8.2l-4.4 7.6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  external: '<path d="M14 3h7v7M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  spark: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2L12 3ZM19 14l1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14Z"/>',
};

const svg = (name, className = "") =>
  `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ""}</svg>`;

function verdictLabel(verdict) {
  return {
    critical: "Critical",
    high: "High risk",
    caution: "Caution",
    unknown: "Unknown",
    no_known_issues: "No known issues found",
  }[verdict] ?? "Unknown";
}

function badge(verdict) {
  return `<span class="verdict verdict--${escapeHtml(verdict)}"><span class="verdict-dot"></span>${verdictLabel(verdict)}</span>`;
}

function demoBanner(text = demoNotice) {
  return `<div class="demo-banner">${svg("shield")}<span>${escapeHtml(text)}</span></div>`;
}

function buttonLink(path, label, style = "button button--primary", icon = "") {
  return `<a class="${style}" href="${path}" data-link>${escapeHtml(label)}${icon ? svg(icon) : ""}</a>`;
}

function publicHeader() {
  return `<header class="public-header"><a class="brand" href="/" data-link><span class="brand-mark">${svg("shield")}</span><span>stack3<span class="brand-light"> security</span></span></a><nav class="public-nav" aria-label="Main navigation"><a href="/#product" data-link>Product</a><a href="/how-it-works" data-link>How it works</a><a href="/pricing" data-link>Pricing</a></nav><div class="public-actions"><a class="sign-in" href="${api?.signedIn ? "/dashboard/settings" : "/login"}" data-link>${api?.signedIn ? "Account" : "Sign in"}</a>${buttonLink("/dashboard", "Open dashboard", "button button--primary button--small")}</div><button class="menu-toggle" aria-label="Open navigation menu" aria-expanded="false">${svg("grid")}</button></header>`;
}

function publicFooter() {
  return `<footer class="public-footer"><div class="footer-main"><a class="brand" href="/" data-link><span class="brand-mark">${svg("shield")}</span><span>stack3<span class="brand-light"> security</span></span></a><p>Web3 security for developers and users.</p></div><div class="footer-links"><a href="/#product" data-link>Product</a><a href="/how-it-works" data-link>How it works</a><a href="/pricing" data-link>Pricing</a><a href="/dashboard/settings" data-link>Privacy</a><a href="mailto:hello@stack3security.example">Contact</a></div><p class="footer-disclaimer">Stack3 Security provides risk indicators and security information, not a guarantee that software, websites, transactions, or smart contracts are safe. Always review wallet requests carefully.</p><span class="footer-copy">© Stack3 Security · Demo experience</span></footer>`;
}

function landingPage() {
  return `<div class="public-shell">${publicHeader()}<main>
    <section class="hero"><div class="hero-copy"><div class="eyebrow"><span class="eyebrow-line"></span> SECURITY BEFORE YOU TRUST</div><h1>Don't trust the interface.<br /><span>Verify what happens underneath.</span></h1><p class="hero-description">A website can look legitimate while asking your wallet to do something very different. A code repository can look ordinary while hiding a malicious install script.</p><p class="hero-description hero-description--second">Stack3 Security helps developers inspect suspicious code and helps Web3 users understand websites, contracts, and wallet requests before they act.</p><div class="hero-actions">${buttonLink("/dashboard", "Explore the dashboard", "button button--primary button--large", "arrow")}${buttonLink("/how-it-works", "See how it works", "button button--secondary button--large")}</div><div class="hero-note">${svg("lock")}<span>Demo experience — checks shown in the dashboard are illustrative until live scanning is connected.</span></div></div>
    <div class="hero-visual" aria-label="Illustration of a website request and its security findings"><div class="visual-glow"></div><div class="visual-top"><span class="visual-dot"></span><span class="visual-dot"></span><span class="visual-dot"></span><span class="visual-url">app.example.test</span><span class="visual-lock">${svg("lock")}</span></div><div class="visual-body"><div class="visual-sidebar"><span class="mini-mark">${svg("shield")}</span><i></i><i></i><i></i></div><div class="visual-content"><div class="visual-caption">WALLET REQUEST REVIEW</div><div class="visual-title">Transaction intent</div><div class="visual-claim"><span class="claim-icon">${svg("spark")}</span><div><span class="mini-label">WEBSITE SAYS</span><strong>Claim your reward</strong></div><span class="claim-check">✓</span></div><div class="visual-divider"><span>but the wallet request is</span></div><div class="visual-approval"><span class="approval-icon">${svg("arrows")}</span><div><span class="mini-label">DECODED REQUEST</span><strong>Approve token spending</strong></div></div><div class="visual-warning"><span class="warning-symbol">!</span><div><strong>Intent mismatch</strong><span>Review the requested permission before signing.</span></div></div><div class="visual-foot">${badge("high")}<span>Illustrative example</span></div></div></div><div class="floating-note">${svg("shield")}<span>Evidence over assumptions</span></div></div></section>
    <section class="proof-strip" aria-label="Product capabilities"><span>Developer-side code inspection</span><span>Website and phishing signals</span><span>Transaction intent review</span><span>Smart-contract risk context</span></section>
    <section class="section section--layers" id="product"><div class="section-heading"><span class="eyebrow">ONE SECURITY MINDSET</span><h2>Two layers. One clearer picture.</h2><p>Understand risk at the code you run and the Web3 interactions you review.</p></div><div class="feature-grid"><article class="feature-card"><div class="feature-icon feature-icon--blue">${svg("blocks")}</div><span class="feature-kicker">FOR DEVELOPERS</span><h3>Developer Guard</h3><h4>Catch suspicious code before you run it.</h4><p>Inspect project files and npm dependencies for suspicious install scripts, risky configuration, exposed secrets, and known package risk indicators.</p><a href="/how-it-works" data-link class="text-link">Explore developer protection ${svg("arrow")}</a></article><article class="feature-card"><div class="feature-icon feature-icon--navy">${svg("shield")}</div><span class="feature-kicker">FOR WEB3 USERS</span><h3>Web3 Guard</h3><h4>Understand what a website asks you to approve.</h4><p>Review suspicious page behavior, recovery-phrase phishing signals, transaction requests, and available smart-contract risk indicators.</p><a href="/dashboard/scanner" data-link class="text-link">Try the sample scanner ${svg("arrow")}</a></article></div></section>
    <section class="intent-section"><div class="intent-copy"><span class="eyebrow">LOOK BENEATH THE BUTTON</span><h2>The interface says one thing.<br /><span>The transaction may say another.</span></h2><p>A “Claim reward” button might trigger a token approval or an unexpected transfer request. Stack3 aims to make the difference understandable before you approve.</p><p class="intent-disclaimer">An approval is not automatically malicious. The spender, scope, contract behavior, and context matter.</p>${buttonLink("/dashboard/transactions", "Review the example", "text-link")}</div><div class="intent-card"><div class="intent-card-header"><span>ILLUSTRATIVE EXAMPLE</span>${badge("high")}</div><div class="intent-row"><span class="intent-marker intent-marker--neutral">01</span><div><small>WEBSITE PROMISE</small><strong>“Claim your reward.”</strong></div></div><div class="intent-arrow-down">${svg("arrow")}</div><div class="intent-row"><span class="intent-marker intent-marker--amber">02</span><div><small>WALLET REQUEST</small><strong>Approve token spending</strong><span>Permission within the approval's scope</span></div></div><div class="intent-card-footer">${svg("shield")}<span>Review what the request encodes before deciding.</span></div></div></section>
    <section class="evidence-section"><div class="section-heading"><span class="eyebrow">EXPLAIN THE EVIDENCE</span><h2>Not just a score. A reason to decide.</h2><p>A useful warning should help answer the important questions.</p></div><div class="evidence-grid"><article><span class="evidence-number">01</span><h3>What was detected?</h3><p>See the finding and its severity in plain language.</p></article><article><span class="evidence-number">02</span><h3>What supports it?</h3><p>Review evidence and source when available.</p></article><article><span class="evidence-number">03</span><h3>What was not checked?</h3><p>Understand limitations instead of filling gaps with assumptions.</p></article><article><span class="evidence-number">04</span><h3>What can I do next?</h3><p>Get practical recommendations to guide your review.</p></article></div></section>
    <section class="decisions-section"><div class="section-heading"><span class="eyebrow">DESIGNED FOR REAL DECISIONS</span><h2>A little more context, before you act.</h2></div><div class="decision-grid"><article><span class="decision-icon">${svg("blocks")}</span><h3>Before you run</h3><p>Review suspicious project configuration and dependency signals before running unfamiliar code.</p></article><article><span class="decision-icon">${svg("scan")}</span><h3>Before you enter</h3><p>Identify pages that appear to request recovery phrases in suspicious contexts.</p></article><article><span class="decision-icon">${svg("arrows")}</span><h3>Before you sign</h3><p>Review decoded methods, permissions, and intent mismatches before approving.</p></article><article><span class="decision-icon">${svg("shield")}</span><h3>Before you trust</h3><p>Review available information about verification, proxy behavior, and permissions.</p></article></div><p class="section-footnote">These checks depend on available data and supported networks. They cannot guarantee the absence of malicious behavior.</p></section>
    <section class="closing-cta"><div class="closing-icon">${svg("shield")}</div><span class="eyebrow">MAKE YOUR NEXT DECISION WITH BETTER INFORMATION</span><h2>See what's underneath.</h2><p>Explore the Stack3 demo and see how code, website, and transaction risks can be explained in one clear experience.</p>${buttonLink("/dashboard", "Open the dashboard", "button button--light button--large", "arrow")}</section>
  </main>${publicFooter()}</div>`;
}

function appShell(content, activePath) {
  const links = navItems
    .map(
      (item) =>
        `<a class="side-link ${activePath === item.path || (item.path === "/dashboard" && activePath === "/dashboard") ? "is-active" : ""}" href="${item.path}" data-link>${svg(item.icon)}<span>${item.label}</span>${item.path === "/dashboard/scanner" ? '<span class="side-pill">DEMO</span>' : ""}</a>`,
    )
    .join("");
  const email = api?.user?.email;
  const initial = escapeHtml(email?.charAt(0).toUpperCase() ?? "D");
  return `<div class="app-shell"><aside class="sidebar"><a class="brand" href="/" data-link><span class="brand-mark">${svg("shield")}</span><span>stack3<span class="brand-light"> security</span></span></a><div class="workspace-label">WORKSPACE</div><nav class="side-nav" aria-label="Dashboard navigation">${links}</nav><div class="sidebar-bottom"><div class="sidebar-help"><span class="help-icon">${svg("spark")}</span><strong>Security, with context.</strong><p>Review evidence before you decide.</p><a href="/how-it-works" data-link>How it works ${svg("arrow")}</a></div><button class="user-profile" type="button" aria-label="Account settings" data-navigate="/dashboard/settings"><span class="avatar">${initial}</span><span class="user-info"><strong>${escapeHtml(email ?? "Demo workspace")}</strong><small>${email ? "Signed in" : "Demo mode"}</small></span><span class="profile-more">···</span></button><button class="sidebar-signout" type="button" data-account-action="logout">${svg("logout")}<span>Sign out</span></button></div></aside><div class="app-main"><header class="app-topbar"><button class="mobile-menu" aria-label="Toggle menu" aria-expanded="false">${svg("grid")}</button><div class="breadcrumbs"><a href="/dashboard" data-link>Workspace</a><span>/</span><strong>${escapeHtml(navItems.find((item) => item.path === activePath)?.label ?? "Account")}</strong></div><div class="topbar-right"><span class="demo-mode">${svg("shield")} ${activePath === "/dashboard/graph" ? "LIVE DATA" : activePath.startsWith("/dashboard") && activePath !== "/dashboard/settings" ? "DEMO SCANS" : "LIVE ACCOUNT"}</span><span class="topbar-avatar">${initial}</span></div></header><main class="dashboard-content">${content}</main><footer class="app-footer"><span>Stack3 Security · Scanning results are illustrative</span><span>Risk indicators, not a guarantee of safety.</span></footer></div></div>`;
}

function pageHeading(eyebrow, title, subtitle, action = "") {
  return `<div class="page-heading"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${action}</div>`;
}

function dashboardPage() {
  const data = getDashboardData();
  const cards = [
    ["Scans reviewed", data.scansReviewed, "Sample scan records in this demo", "grid", "stat-blue"],
    ["Critical findings", data.criticalFindings, "Sample findings classified critical", "shield", "stat-red"],
    ["Needs review", data.needsReview, "High-risk and caution findings", "scan", "stat-amber"],
    ["No known issues", data.noKnownIssues, "Not a guarantee of safety", "spark", "stat-green"],
  ];
  return appShell(`${demoBanner()}${pageHeading("YOUR SECURITY WORKSPACE", "Security overview", "Review recent findings across code, websites, transactions, and contracts.", buttonLink("/dashboard/scanner", "Scan a website", "button button--primary", "arrow"))}<section class="stats-grid">${cards.map(([label, count, note, icon, color]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${svg(icon)}</span></div><strong>${count}</strong><small>${note}</small></article>`).join("")}</section><div class="dashboard-grid"><section class="panel activity-panel"><div class="panel-header"><div><h2>Recent activity</h2><p>Illustrative records from the local demo dataset.</p></div><a href="/dashboard/reports" data-link class="text-link">View reports ${svg("arrow")}</a></div>${reportTable(data.reports.slice(0, 4), false)}</section><section class="panel findings-panel"><div class="panel-header"><div><h2>Findings by severity</h2><p>Based on sample report verdicts.</p></div></div><div class="severity-list">${severityRow("Critical", data.criticalFindings, "severity-red")}${severityRow("High risk", data.reports.filter((item) => item.verdict === "high").length, "severity-orange")}${severityRow("Caution", data.reports.filter((item) => item.verdict === "caution").length, "severity-blue")}${severityRow("Unknown", data.reports.filter((item) => item.verdict === "unknown").length, "severity-gray")}</div><div class="panel-divider"></div><a href="/dashboard/transactions" data-link class="risk-prompt">${svg("arrows")}<span><strong>Review transaction intent</strong><small>Compare the website's promise with the request.</small></span>${svg("arrow")}</a></section></div><section class="quick-actions"><div><h2>Quick actions</h2><p>Explore an illustrative demo flow.</p></div><div class="quick-action-list">${quickAction("scan", "Scan a website", "Try the sample recovery-site scan.", "/dashboard/scanner")}${quickAction("arrows", "Review a transaction", "Understand an illustrative approval.", "/dashboard/transactions")}${quickAction("blocks", "Explore contract details", "See what is and is not known.", "/dashboard/contracts")}</div></section>`, "/dashboard");
}

function severityRow(label, count, className) {
  return `<div class="severity-row"><span class="severity-label"><i class="${className}"></i>${label}</span><strong>${count}</strong></div>`;
}

function quickAction(icon, title, description, path) {
  return `<a class="quick-action" href="${path}" data-link><span class="quick-action-icon">${svg(icon)}</span><span><strong>${title}</strong><small>${description}</small></span>${svg("arrow")}</a>`;
}

function reportTable(items, showView = true) {
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Target</th><th>Scan type</th><th>Verdict</th><th>Findings</th><th>Date</th>${showView ? "<th></th>" : ""}</tr></thead><tbody>${items.map((report) => `<tr><td><strong class="table-target">${escapeHtml(report.target)}</strong><small>Illustrative demo record</small></td><td>${escapeHtml(report.type)}</td><td>${badge(report.verdict)}</td><td>${report.findings}</td><td>${escapeHtml(report.date)}</td>${showView ? `<td><a class="table-action" href="/dashboard/reports?target=${encodeURIComponent(report.target)}" data-link aria-label="View report for ${escapeHtml(report.target)}">${svg("arrow")}</a></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}

function findingCard(finding, index = 1) {
  return `<article class="finding-card"><div class="finding-card-top"><span class="finding-index">0${index}</span>${badge(finding.severity)}<span class="finding-layer">${escapeHtml(finding.layer)} signal</span></div><h3>${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.evidence)}</p><details class="technical-details"><summary>View technical details</summary><div class="technical-body"><div><strong>Evidence source</strong><span>${escapeHtml(finding.source ?? "Not available in demo")}</span></div>${finding.recommendation ? `<div><strong>Recommended action</strong><span>${escapeHtml(finding.recommendation)}</span></div>` : ""}</div></details></article>`;
}

function scannerPage() {
  return appShell(`${demoBanner()}${pageHeading("WEB3 GUARD", "Website risk scanner", "Inspect a domain for suspicious identity, page behavior, and recovery-phrase requests.")}<div class="scanner-layout"><section class="panel scanner-form-panel"><div class="panel-header"><div><span class="feature-kicker">DEMO SCAN</span><h2>Inspect a website</h2><p>Try the sample fixture to see how findings and evidence are presented.</p></div><span class="scanner-icon">${svg("scan")}</span></div><form id="scanner-form" class="form-stack" novalidate><label for="website-url">Website URL</label><div class="input-with-icon">${svg("external")}<input id="website-url" name="website" type="text" inputmode="url" autocomplete="url" placeholder="https://example.com" aria-describedby="scanner-helper scanner-error" /><button class="button button--primary" type="submit">Scan website ${svg("arrow")}</button></div><small id="scanner-helper" class="input-helper">Sample supported: demo-recovery-site.test</small><p id="scanner-error" class="form-error" role="alert" hidden></p></form><div class="privacy-note">${svg("lock")}<span>Never enter a seed phrase or private key. This sample scan does not send the entered URL to the API.</span></div></section><section class="panel inspection-panel"><div class="panel-header"><div><h2>What the scanner may inspect</h2><p>Checks depend on available signals and supported data.</p></div></div><ul class="check-list"><li>${checkIcon()}<span>Lookalike or suspicious domain patterns</span></li><li>${checkIcon()}<span>Recovery-phrase or private-key prompts</span></li><li>${checkIcon()}<span>Suspicious form destinations</span></li><li>${checkIcon()}<span>Wallet-brand impersonation signals</span></li><li>${checkIcon()}<span>Relevant page-script indicators, when supported</span></li></ul></section></div><section id="scanner-result" class="result-region" aria-live="polite"></section>`, "/dashboard/scanner");
}

function checkIcon() {
  return '<span class="check-icon">✓</span>';
}

function scannerResult(result) {
  return `<section class="result-panel"><div class="result-header"><div><div class="result-label">ILLUSTRATIVE DEMO RESULT — NOT A LIVE DOMAIN ASSESSMENT</div><h2>${escapeHtml(result.target.id)}</h2></div>${badge(result.level)}</div><div class="result-explanation"><span class="result-explanation-icon">${svg("shield")}</span><p>${escapeHtml(result.explanation)}</p></div><div class="finding-list">${result.findings.map((finding, index) => findingCard(finding, index + 1)).join("")}</div><div class="limitations"><h3>Checks not performed</h3><ul>${result.notChecked.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></section>`;
}

function transactionsPage() {
  return appShell(`${demoBanner()}${pageHeading("WEB3 GUARD", "Transaction intent analyzer", "Understand the wallet request, what it authorizes, and whether it matches the website's stated action.", '<span class="mode-chip">DEMONSTRATION MODE</span>')}<div class="transaction-intro"><div class="panel transaction-start"><div class="panel-header"><div><h2>Analyze a sample request</h2><p>This example runs locally and will not connect to a wallet or submit a transaction.</p></div></div><div class="sample-fields"><div class="field-pair"><span>Network</span><strong>Ethereum (illustrative)</strong></div><div class="field-pair"><span>Website's stated action</span><strong>“Claim your reward.”</strong></div><div class="field-pair"><span>Request status</span><strong class="status-pending">Pending wallet request · not submitted</strong></div></div><button id="analyze-transaction" class="button button--primary">Analyze sample request ${svg("arrow")}</button></div><div class="transaction-side-note">${svg("lock")}<div><strong>Your secrets stay yours.</strong><p>Never enter a seed phrase or private key. This demo uses a fixed sample request only.</p></div></div></div><section id="transaction-result" class="result-region">${transactionResult(transactionExample)}</section>`, "/dashboard/transactions");
}

function transactionResult(result) {
  const finding = result.findings[0];
  return `<section class="result-panel"><div class="result-header"><div><div class="result-label">ILLUSTRATIVE EXAMPLE · PENDING REQUEST</div><h2>Website intent and wallet request</h2></div>${badge(result.level)}</div><div class="transaction-compare"><div class="compare-card"><span>WEBSITE SAYS</span><strong>${escapeHtml(result.websiteAction)}</strong></div><div class="compare-connector">${svg("arrow")}</div><div class="compare-card compare-card--risk"><span>DECODED WALLET REQUEST</span><strong>${escapeHtml(result.method)}</strong><small>ERC-20 token approval</small></div></div><div class="meaning-box"><span class="meaning-icon">${svg("arrows")}</span><div><h3>What this request means</h3><p>The transaction requests permission for a spender to access a token within the allowance's scope. Depending on the token, spender, and amount, that permission may create meaningful financial risk.</p></div></div>${findingCard(finding)}<details class="technical-details transaction-details"><summary>View technical details</summary><div class="detail-grid">${detailItem("Network", result.network)}${detailItem("Method / function", result.method)}${detailItem("Target contract", result.targetAddress)}${detailItem("Token address", result.tokenAddress)}${detailItem("Spender address", result.spenderAddress)}${detailItem("Allowance", result.allowance)}${detailItem("Decode source", "Illustrative fixture")}${detailItem("Request status", "Pending · no transaction hash")}</div></details><div class="limitations"><h3>Checks not performed</h3><ul>${result.notChecked.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div><p class="subtle-disclaimer">A decoded method does not prove what every contract will do in all circumstances. An approval is not automatically malicious; review the spender, scope, contract behavior, and context.</p></section>`;
}

function detailItem(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function contractsPage() {
  return appShell(`${demoBanner()}${pageHeading("WEB3 GUARD", "Smart-contract overview", "Review available contract information and risk indicators before interacting.")}<section class="panel contract-search-panel"><div class="panel-header"><div><h2>Review a contract</h2><p>Live verification is not connected. Enter the sample fixture to see the illustrative view.</p></div><span class="scanner-icon">${svg("blocks")}</span></div><form id="contract-form" class="form-stack" novalidate><label for="contract-address">Contract address</label><div class="input-with-icon">${svg("blocks")}<input id="contract-address" name="contract" type="text" placeholder="Paste a public contract address" aria-describedby="contract-error" /><button class="button button--primary" type="submit">Review contract ${svg("arrow")}</button></div><p id="contract-error" class="form-error" role="alert" hidden></p><span class="input-helper">Sample fixture: sample-contract. No address lookup is performed.</span></form></section><section id="contract-result" class="result-region">${contractResult()}</section>`, "/dashboard/contracts");
}

function contractResult(result = contractExample) {
  return `<section class="result-panel"><div class="result-header"><div><div class="result-label">ILLUSTRATIVE DEMO DATA</div><h2>${escapeHtml(result.target)}</h2><p>${escapeHtml(result.network)}</p></div>${badge(result.verdict)}</div><div class="contract-facts">${detailItem("Source verification", result.sourceVerification)}${detailItem("Proxy status", result.proxyStatus)}${detailItem("Owner permissions", result.ownerPermissions)}${detailItem("Deployment age", result.deploymentAge)}</div><div class="result-explanation"><span class="result-explanation-icon">${svg("shield")}</span><p>${escapeHtml(result.explanation)}</p></div><div class="limitations"><h3>Checks not performed</h3><ul>${result.notChecked.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></section>`;
}

function reportsPage() {
  const params = new URLSearchParams(location.search);
  const target = params.get("target");
  const report = target ? getReport(target) : null;
  const detail = report
    ? `<section class="report-detail panel"><div class="report-detail-header"><div><div class="result-label">ILLUSTRATIVE DEMO REPORT</div><h2>${escapeHtml(report.target)}</h2><p>${escapeHtml(report.type)} · ${escapeHtml(report.date)}</p></div>${badge(report.verdict)}</div><p class="report-summary">${escapeHtml(report.detail)}</p><div class="report-findings"><strong>${report.findings} ${report.findings === 1 ? "finding" : "findings"}</strong><span>Evidence, sources, and recommendations are illustrative.</span></div>${report.findingDetails.map((finding, index) => findingCard(finding, index + 1)).join("")}<div class="limitations"><h3>Checks not performed</h3><ul>${report.notChecked.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div><a href="/dashboard/reports" data-link class="text-link">${svg("arrow")} Back to all reports</a></section>`
    : target
      ? `<div class="empty-state"><span class="empty-state-icon">${svg("file")}</span><h2>Report not found</h2><p>This target is not included in the local demo report set.</p>${buttonLink("/dashboard/reports", "View all reports", "button button--secondary")}</div>`
      : `<section class="panel reports-panel"><div class="panel-header"><div><h2>Recent scan reports</h2><p>Review what was checked, what was found, and what remains unknown.</p></div></div>${reportTable(reports)}</section>`;
  return appShell(`${demoBanner()}${pageHeading("YOUR SECURITY WORKSPACE", "Scan reports", "Review findings, evidence, and checks not performed.")}${detail}`, "/dashboard/reports");
}

function howItWorksPage() {
  const steps = [
    ["01", "Inspect the signals", "The developer side examines suspicious repository files and dependency risk indicators. The user side examines page behavior, transaction requests, and available contract information."],
    ["02", "Connect the context", "Where evidence supports it, signals such as a suspicious domain, package, contract, or wallet address can provide additional context. A relationship alone is not proof of wrongdoing."],
    ["03", "Explain the finding", "Stack3 presents severity, evidence, source, limitations, and recommended next steps. AI may help translate technical findings, grounded in checks and evidence."],
    ["04", "Let the user decide", "The goal is to help users pause, investigate, reject a request, or proceed with a clearer understanding. Stack3 should not make irreversible wallet decisions on your behalf."],
  ];
  return `<div class="public-shell">${publicHeader()}<main class="public-subpage"><section class="subpage-hero"><span class="eyebrow">HOW IT WORKS</span><h1>Security should start before the click, install, or signature.</h1><p>Stack3 is designed to inspect risk at two points: when developers evaluate code and when users interact with Web3 websites and wallet requests.</p>${buttonLink("/dashboard", "Explore the demo", "button button--primary button--large", "arrow")}</section><section class="steps-list">${steps.map(([number, title, description]) => `<article class="step-item"><span>${number}</span><div><h2>${title}</h2><p>${description}</p></div></article>`).join("")}</section><section class="not-promises"><div class="eyebrow">IMPORTANT LIMITATIONS</div><h2>What Stack3 does not promise</h2><ul><li>It cannot detect every scam or malicious package.</li><li>A verified contract or older deployment is not automatically trustworthy.</li><li>A website with no known reputation signals is not necessarily legitimate.</li><li>A transaction explanation is only as accurate as the decoded data and available context.</li><li>AI explanations can be wrong and should be grounded in inspectable evidence.</li></ul></section></main>${publicFooter()}</div>`;
}

function notFoundPage() {
  return `<div class="public-shell">${publicHeader()}<main class="not-found"><span class="eyebrow">NOT FOUND</span><h1>This page isn't in the demo.</h1><p>Choose an available section to continue exploring Stack3 Security.</p>${buttonLink("/dashboard", "Go to dashboard", "button button--primary")}</main>${publicFooter()}</div>`;
}

function navigate(path, replace = false) {
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  void render();
  window.scrollTo(0, 0);
}

function accountShell(content, path) {
  return ["/pricing", "/login", "/link", "/teams/join", "/billing/return"].includes(path)
    ? `<div class="public-shell">${publicHeader()}<main class="${path === "/pricing" ? "pricing-page" : "account-page"}">${content}</main>${publicFooter()}</div>`
    : appShell(content, path);
}

async function render() {
  if (!initialized) return;
  const version = ++renderVersion;
  accountUI.stop();
  graphUI.stop();
  if (api.signedIn) startupError = null;
  const path = location.pathname.replace(/\/+$/, "") || "/";
  document.title = routeTitles[path] ?? "Stack3 Security";
  if (accountPaths.has(path) || path === "/pricing") {
    if (path !== "/login" && path !== "/pricing" && !api.signedIn) {
      navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, true);
      return;
    }
    app.innerHTML = accountShell('<div class="account-loading" role="status"><span class="spinner" aria-hidden="true"></span> Loading account data…</div>', path);
    try {
      const content = await accountUI.page(path, new URLSearchParams(location.search));
      if (version !== renderVersion) return;
      app.innerHTML = accountShell(content, path);
      accountUI.mount(path);
    } catch (error) {
      if (version !== renderVersion || error.name === "AbortError") return;
      if (error.status === 401) {
        navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, true);
        return;
      }
      app.innerHTML = accountShell('<div id="account-message" role="alert" tabindex="-1"></div><button type="button" class="button button--primary" data-account-action="reload">Try again</button>', path);
      accountUI.showError(error);
    }
    return;
  }
  if (path.startsWith("/dashboard") && !api.signedIn) {
    navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, true);
    return;
  }
  if (path === "/") app.innerHTML = landingPage();
  else if (path === "/how-it-works") app.innerHTML = howItWorksPage();
  else if (path === "/dashboard") app.innerHTML = dashboardPage();
  else if (path === "/dashboard/scanner") app.innerHTML = scannerPage();
  else if (path === "/dashboard/transactions") app.innerHTML = transactionsPage();
  else if (path === "/dashboard/contracts") app.innerHTML = contractsPage();
  else if (path === "/dashboard/graph") {
    const params = new URLSearchParams(location.search);
    app.innerHTML = appShell(graphUI.page(params), "/dashboard/graph");
    graphUI.mount(params);
  }
  else if (path === "/dashboard/reports") app.innerHTML = reportsPage();
  else app.innerHTML = notFoundPage();
  if (startupError) {
    const notice = document.createElement("div");
    notice.className = "account-message account-message--error";
    notice.setAttribute("role", "alert");
    notice.textContent = `${startupError.message} Account services are unavailable; scanning pages remain illustrative demos.`;
    app.prepend(notice);
  }
}

function setLoading(button, label) {
  button.disabled = true;
  button.dataset.originalLabel = button.innerHTML;
  button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label}`;
}

function clearLoading(button) {
  button.disabled = false;
  button.innerHTML = button.dataset.originalLabel ?? button.innerHTML;
  delete button.dataset.originalLabel;
}

app.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a[data-link]");
  if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
    const href = link.getAttribute("href");
    if (href?.startsWith("/#")) {
      event.preventDefault();
      navigate("/");
      requestAnimationFrame(() => document.getElementById(href.slice(2))?.scrollIntoView({ behavior: "smooth" }));
      return;
    }
    if (href?.startsWith("/")) {
      event.preventDefault();
      navigate(href);
    }
  }

  const navButton = target?.closest("[data-navigate]");
  if (navButton) {
    navigate(navButton.dataset.navigate);
  }

  if (target?.closest(".mobile-menu")) {
    document.querySelector(".sidebar")?.classList.toggle("sidebar--open");
  }

  if (target?.closest(".menu-toggle")) {
    const nav = document.querySelector(".public-nav");
    const toggle = target.closest(".menu-toggle");
    const open = nav?.classList.toggle("public-nav--open") ?? false;
    toggle.setAttribute("aria-expanded", String(open));
  }
});

app.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.dataset.accountForm) return;
  event.preventDefault();

  if (form.id === "scanner-form") {
    const input = form.elements.namedItem("website");
    const errorElement = document.querySelector("#scanner-error");
    const resultElement = document.querySelector("#scanner-result");
    const button = form.querySelector('button[type="submit"]');
    errorElement.hidden = true;
    resultElement.innerHTML = "";
    setLoading(button, "Checking sample…");
    await new Promise((resolve) => setTimeout(resolve, 650));
    try {
      resultElement.innerHTML = scannerResult(scanWebsite(input.value));
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    } finally {
      clearLoading(button);
    }
  }

  if (form.id === "contract-form") {
    const input = form.elements.namedItem("contract");
    const errorElement = document.querySelector("#contract-error");
    const resultElement = document.querySelector("#contract-result");
    const button = form.querySelector('button[type="submit"]');
    errorElement.hidden = true;
    setLoading(button, "Checking sample…");
    await new Promise((resolve) => setTimeout(resolve, 450));
    try {
      resultElement.innerHTML = contractResult(reviewSampleContract(input.value));
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    } finally {
      clearLoading(button);
    }
  }
});

app.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("#analyze-transaction");
  if (!button) return;
  const resultElement = document.querySelector("#transaction-result");
  setLoading(button, "Analyzing sample…");
  await new Promise((resolve) => setTimeout(resolve, 500));
  resultElement.innerHTML = transactionResult(analyzeSampleTransaction());
  clearLoading(button);
});

window.addEventListener("popstate", render);

async function start() {
  app.innerHTML = '<div class="account-loading" role="status">Connecting to Stack3…</div>';
  try {
    const response = await fetch("/config.json", { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Unable to load webpage API configuration.");
    const config = await response.json();
    const base = new URL(config.apiBaseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Invalid API base URL.");
    api = createApiClient({
      baseUrl: base.href.replace(/\/$/, ""),
      onSignedOut() {
        if (initialized && accountPaths.has(location.pathname) && location.pathname !== "/login") {
          navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, true);
        }
      },
      onError(error) {
        startupError = error;
        if (error.status === 401) navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, true);
        else if (document.querySelector("#account-message")) accountUI.showError(error);
        else void render();
      },
    });
    accountUI = createAccountUI({ api, navigate, render });
    accountUI.bind(app);
    graphUI = createGraphUI({ api, navigate });
    try {
      await api.initialize();
    } catch (error) {
      startupError = error;
    }
    initialized = true;
    await render();
  } catch (error) {
    app.textContent = `Unable to initialize Stack3: ${error.message} Reload to try again.`;
  }
}

void start();
