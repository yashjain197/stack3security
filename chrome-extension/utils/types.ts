// Shared contracts between the extension and the Stack3 API (camelCase JSON).

export type Level = "critical" | "high" | "caution" | "unknown" | "no_known_issues";

export type Finding = {
  layer: string;
  severity: Level;
  title: string;
  evidence: string;
  location?: { file?: string | null; line?: number | null } | null;
  source: "rules" | "graph" | "socket" | "sourcify";
  checkedAt: string;
};

export type Verdict = {
  level: Level;
  target: { type: "repo" | "package" | "site" | "contract" | "tx"; id: string };
  findings: Finding[];
  indicators: { addresses: string[]; domains: string[] };
  notChecked: string[];
  actions: string[];
  explanation?: string | null;
};

export type RulesBundle = {
  version: string;
  ttlSeconds: number;
  brands: { name: string; domains: string[] }[];
  homoglyphs: Record<string, string>;
  selectors: Record<string, string>;
  blocklistCount: number;
  blocklistEtag: string;
  blocklistPath: string;
};

export type Blocklist = {
  version: string;
  domains: string[];
};

export type PageSignals = {
  seedPhraseField: boolean;
  recoveryWordCount: number | null;
  asksForPrivateKey: boolean;
  passwordField: boolean;
  walletConnect: boolean;
  externalScriptHosts: string[];
  brandInTitle: string | null;
  hiddenIframe: boolean;
  clipboardRead: boolean;
  fullscreenOverlay: boolean;
};

export type TxReview = {
  chainId: number;
  method: string;
  origin?: string;
  from?: string;
  to?: string;
  value?: string;
  data?: string;
  message?: string;
  typedData?: Record<string, unknown>;
  calls?: { to?: string; value?: string; data?: string }[];
};

export type LinkStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type TokenPair = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string | null;
  refreshExpiresIn: number;
  sessionId: string;
  user: { id: string; email: string };
};

export type AuthStatus = {
  linked: boolean;
  email: string | null;
  apiBaseUrl: string;
};

export type PageCapture = {
  origin: string;
  signals: PageSignals;
  scripts: string[];
  capturedAt: number;
};

export type TabCheckResult = {
  host: string;
  domain: Verdict | null;
  page: Verdict | null;
  scripts: Verdict | null;
  errors: string[];
};

// Facts the MAIN-world hook reads through the wallet's own RPC before the prompt opens.
// Kept apart from TxReview because the API rejects unknown fields.
export type ContractFacts = {
  address: string | null;
  isContract: boolean | null;
  token: { address: string; name?: string; symbol?: string; decimals?: number } | null;
};

export type SourcifyInfo = { verified: boolean; name: string | null; match: string | null };

// What the background answers when a wallet request is reviewed.
export type WalletReviewResult = {
  review: TxReview;
  facts: ContractFacts | null;
  receivedAt: number;
  linked: boolean;
  tx: Verdict | null;
  contract: Verdict | null;
  sourcify: SourcifyInfo | null;
  errors: string[];
};

// A phishing warning pushed from the background to the page's content script.
export type PageAlert = {
  origin: string;
  host: string;
  level: Level;
  reasons: string[];
  detailsUrl: string;
};

// Messages between popup/content and the background worker.
export type ExtensionMessage =
  | { type: "page-capture"; capture: PageCapture }
  | { type: "get-status" }
  | { type: "link-start" }
  | { type: "link-poll" }
  | { type: "unlink" }
  | { type: "check-tab"; tabId: number; url: string }
  | { type: "scan-contract"; chainId: number; address: string }
  | { type: "review-tx"; review: TxReview }
  | { type: "wallet-request"; review: TxReview; facts: ContractFacts | null }
  | { type: "get-wallet-review"; tabId: number | null }
  | { type: "dismiss-page-alert"; origin: string };

// Messages from the background to a tab's content script.
export type TabMessage = { type: "page-alert"; alert: PageAlert };
