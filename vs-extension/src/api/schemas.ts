import { z } from 'zod';

const SeveritySchema = z.enum(['critical', 'high', 'caution']);
const LevelSchema = z.enum(['critical', 'high', 'caution', 'unknown', 'no_known_issues']);

// z.object strips unknown keys, so a server-sent `level` never survives parsing (I-4).
export const FindingSchema = z.object({
  ruleId: z.string().max(200),
  layer: z.enum(['repo-file', 'dependency', 'secret', 'source', 'site', 'contract', 'tx', 'intent', 'graph']),
  severity: SeveritySchema,
  title: z.string().max(500),
  evidence: z.string().max(2000),
  location: z.object({ file: z.string().max(1000), line: z.number().int().positive().optional() }).optional(),
  source: z.enum(['rules', 'socket', 'sourcify', 'graph']),
  checkedAt: z.string().max(64),
});

export const IndicatorsSchema = z.object({
  addresses: z.array(z.string().max(100)).max(1000),
  domains: z.array(z.string().max(253)).max(1000),
});

export const VerdictSchema = z.object({
  level: LevelSchema,
  target: z.object({ type: z.enum(['repo', 'package', 'site', 'contract', 'tx']), id: z.string().max(1000) }),
  findings: z.array(FindingSchema).max(5000),
  indicators: IndicatorsSchema,
  notChecked: z.array(z.string().max(500)).max(100),
  actions: z.array(z.string().max(500)).max(20),
  explanation: z.string().max(4000).optional(),
});

export const ScanPackageResponseSchema = z.object({ findings: z.array(FindingSchema).max(5000) });

export const ExplainResponseSchema = z.object({ explanation: z.string(), fix: z.string() });

export const ReportResponseSchema = z.object({ accepted: z.number().int().nonnegative() });
