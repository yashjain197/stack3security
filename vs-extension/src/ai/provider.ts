import type { Result, Stack3Client } from '../api/client';
import type { Level } from '../engine/types';
import type { SafeFinding } from '../verdict/redact';

/**
 * Anything that can turn redacted findings into a plain-English explanation. Providers only ever receive `SafeFinding`s
 * and only ever return text: they have no way to change a verdict. Swapping the model means adding a provider here,
 * nothing else. Every provider sends the findings off this computer, so D-5 (`explain.sendSnippets`) applies to all.
 */
export interface ExplainProvider {
  explain(level: Level, findings: SafeFinding[]): Promise<Result<{ explanation: string; fix: string }>>;
}

/** The Stack3 server's /explain endpoint as a provider. The server holds any model key. */
export function apiProvider(client: Pick<Stack3Client, 'explain'>): ExplainProvider {
  return { explain: (level, findings) => client.explain(level, findings) };
}
