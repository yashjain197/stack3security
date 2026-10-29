// Shared verdict contract (PDF "Shared contract"). Yash's and Ivo's code reads the same shape.

export type Level = 'critical' | 'high' | 'caution' | 'unknown' | 'no_known_issues';
export type Severity = 'critical' | 'high' | 'caution';
export type Layer = 'repo-file' | 'dependency' | 'secret' | 'source' | 'site' | 'contract' | 'tx' | 'intent' | 'graph';
export type FindingSource = 'rules' | 'socket' | 'sourcify' | 'graph';
export type TargetType = 'repo' | 'package' | 'site' | 'contract' | 'tx';

export interface Finding {
  ruleId: string;
  layer: Layer;
  severity: Severity;
  title: string;
  evidence: string;
  location?: { file: string; line?: number };
  source: FindingSource;
  checkedAt: string;
}

export interface Indicators {
  addresses: string[];
  domains: string[];
}

export interface Verdict {
  level: Level;
  target: { type: TargetType; id: string };
  findings: Finding[];
  indicators: Indicators;
  notChecked: string[];
  actions: string[];
  explanation?: string;
}

/** One file of the scanned tree. `path` is POSIX and relative to the scan root. */
export interface VirtualFile {
  path: string;
  text?: string;
  binary: boolean;
  size: number;
  truncated: boolean;
}

export interface ScanContext {
  mode: 'clone' | 'workspace' | 'quick';
  checkedAt: string;
}

export interface EngineResult {
  findings: Finding[];
  notChecked: string[];
  purls: string[];
}

export type Rule = (files: VirtualFile[], ctx: ScanContext) => Finding[];
