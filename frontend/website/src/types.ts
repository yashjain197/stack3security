export type Verdict = "critical" | "high" | "caution" | "unknown" | "no_known_issues";

export type Finding = {
  layer: "package" | "repository" | "website" | "transaction" | "contract";
  severity: Verdict;
  title: string;
  evidence: string;
  location?: string;
  source?: string;
  recommendation?: string;
};

export type ScanResult = {
  level: Verdict;
  target: {
    type: string;
    id: string;
  };
  findings: Finding[];
  explanation: string;
  notChecked: string[];
  actions?: string[];
};

export type TransactionResult = {
  level: Verdict;
  websiteAction: string;
  network: string;
  method: string;
  targetAddress: string;
  tokenAddress: string;
  spenderAddress: string;
  allowance: string;
  findings: Finding[];
  notChecked: string[];
};

export type ContractResult = {
  target: string;
  network: string;
  sourceVerification: string;
  proxyStatus: string;
  ownerPermissions: string;
  deploymentAge: string;
  verdict: Verdict;
  explanation: string;
  notChecked: string[];
};

export type Report = {
  target: string;
  type: string;
  verdict: Verdict;
  findings: number;
  date: string;
  detail: string;
  findingDetails: Finding[];
  notChecked: string[];
};

export type User = {
  id: string;
  email: string;
};

export type Account = {
  user: User;
  plan: string;
  status: string;
  features: string[];
  limits: Record<string, number>;
  team: { id: string; name: string } | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type PlanPrice = {
  interval: "month" | "year";
  currency: string;
  amountCents: number;
  perSeat?: boolean;
  includedSeats?: number;
  available?: boolean;
};

export type Plan = {
  code: string;
  name: string;
  isPaid: boolean;
  minSeats: number;
  trialDays?: number | null;
  features: { code?: string; description: string; monthlyLimit: number | null }[];
  prices: PlanPrice[];
};

export type Subscription = {
  plan: string;
  interval: string;
  status: string;
  seats: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type SessionInfo = {
  id: string;
  client: string;
  deviceName?: string | null;
  createdIp?: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
};

export type TeamMember = {
  userId: string;
  email: string;
  role: "owner" | "admin" | "member";
  joinedAt?: string;
};

export type TeamInvite = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
};

export type Team = {
  id: string;
  name: string;
  myRole: "owner" | "admin" | "member";
  seatsUsed: number;
  seats: number | null;
  subscriptionStatus: string | null;
  members: TeamMember[];
  invites: TeamInvite[];
};

export type LinkDetails = {
  userCode: string;
  client: string;
  deviceName?: string | null;
  requestedIp?: string | null;
  createdAt: string;
  expiresAt: string;
  status: string;
};

export type HealthCheck = {
  status: string;
  checks?: Record<string, string>;
};

export type GraphNodeType = "wallet" | "domain" | "package" | "repo" | "endpoint";
export type GraphRisk = "unknown" | "caution" | "high" | "critical";

export type GraphNode = {
  type: GraphNodeType | string;
  id: string;
  risk: GraphRisk | string;
  category?: string | null;
  attributes?: Record<string, unknown>;
  reportCount?: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
};

export type GraphEdge = {
  type: string;
  direction: "in" | "out";
  peerType: string;
  peerId: string;
  txHash?: string | null;
};

export type GraphData = {
  node: GraphNode;
  edges?: GraphEdge[];
  source?: string;
};
