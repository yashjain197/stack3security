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

// Messages between popup/content and the background worker.
export type ExtensionMessage =
  | { type: "page-capture"; capture: PageCapture }
  | { type: "get-status" }
  | { type: "link-start" }
  | { type: "link-poll" }
  | { type: "unlink" }
  | { type: "check-tab"; tabId: number; url: string }
  | { type: "scan-contract"; chainId: number; address: string }
  | { type: "review-tx"; review: TxReview };
