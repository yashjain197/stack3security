export type Verdict =
  | "critical"
  | "high"
  | "caution"
  | "unknown"
  | "no_known_issues";

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
  explanation?: string;
  notChecked?: string[];
  actions?: string[];
};
