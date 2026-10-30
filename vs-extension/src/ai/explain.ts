import { cleanText, clip } from '../engine/rules/evidence';
import type { Stack3Settings } from '../config/settings';
import type { ScanRecord } from '../quarantine/registry';
import type { ExplanationMessage } from '../ui/panel';
import { redactAll } from '../verdict/redact';
import type { ExplainProvider } from './provider';

export const REASSURANCE_WITHHELD = 'The AI explanation was withheld because it contradicted the rule-based result.';

// Text that tells the reader a flagged repository is fine. The model may be fooled by text inside the repo, and the
// explanation sits next to the verdict, so reassurance at critical, high or caution is dropped rather than shown.
// "not safe to open" and "isn't safe" are honest warnings and are kept.
// Matches "not" or "n't" (straight or curly apostrophe) just before, so "not safe to open" is kept as an honest warning.
const CURLY = String.fromCharCode(0x2019);
const NOT = `(?<!\\bnot\\s)(?<!n['${CURLY}]t\\s)`;
const REASSURANCE = [
  new RegExp(`${NOT}\\b(?:is|are|was|were|looks?|seems?|appears?|totally|completely|perfectly|entirely|quite|be)\\s+(?:safe|harmless|benign|legitimate|trustworthy|fine|clean|ok|okay)\\b`, 'i'),
  new RegExp(`${NOT}\\b(?:safe|fine|ok|okay)\\s+to\\s+(?:open|run|use|install|clone|execute|trust|ignore)\\b`, 'i'),
  /\b(?:safely|securely)\s+(?:run|open|use|install|execute)\b/i,
  /\bno\s+(?:risk|danger|threat|harm|issues?|problems?)\b/i,
  /\bnothing\s+(?:to\s+worry|suspicious|malicious|dangerous|wrong)\b/i,
  /\bfalse[- ]positives?\b/i,
  /\b(?:scanner|scan|rules?|result|verdict)\s+(?:is|are|was)\s+(?:wrong|incorrect|mistaken)\b/i,
];
export const contradictsVerdict = (text: string): boolean => REASSURANCE.some((re) => re.test(text));

export interface ExplainDeps {
  settings(): Pick<Stack3Settings, 'explainMode' | 'explainProvider'>;
  providers: { claude(): ExplainProvider; api(): ExplainProvider };
  post(scanId: string, msg: ExplanationMessage): void;
}

/** Repositories cloned from a public GitHub URL (D-5). A folder opened from disk is not. */
const isPublicSource = (rec: ScanRecord): boolean => /^https:\/\/github\.com\//.test(rec.url);

/**
 * Ask a provider to explain a verdict, and tell the panel what came back. Never throws, never touches the verdict:
 * the explanation is text beside the result, decided by rules (I-4).
 *
 * D-5: snippets go to a provider only as the user allows. Both providers send them off this computer, so `publicOnly`
 * holds back a folder opened from disk and `never` turns every explanation off.
 */
export async function explainRecord(rec: ScanRecord, deps: ExplainDeps): Promise<void> {
  const s = deps.settings();
  if (s.explainMode === 'never' || rec.verdict.findings.length === 0) return;
  if (s.explainMode === 'publicOnly' && !isPublicSource(rec)) return;

  const provider = s.explainProvider === 'claude' ? deps.providers.claude() : deps.providers.api();

  deps.post(rec.scanId, { state: 'pending' });
  let result;
  try {
    result = await provider.explain(rec.verdict.level, redactAll(rec.verdict.findings));
  } catch {
    result = { ok: false as const, reason: 'The explanation could not be generated.' };
  }
  if (!result.ok) {
    deps.post(rec.scanId, { state: 'unavailable', reason: clip(result.reason, 200) });
    return;
  }

  const guard = rec.verdict.level === 'critical' || rec.verdict.level === 'high' || rec.verdict.level === 'caution';
  const check = (text: string) => (guard && contradictsVerdict(text) ? REASSURANCE_WITHHELD : text);
  deps.post(rec.scanId, {
    state: 'ready',
    explanation: check(cleanText(result.value.explanation, 4000)),
    fix: check(cleanText(result.value.fix, 2000)),
  });
}
