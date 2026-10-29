import type { Result, Stack3Client } from '../api/client';
import type { Level } from '../engine/types';
import type { SafeFinding } from '../verdict/redact';

/**
 * Anything that can turn redacted findings into a plain-English explanation. Providers only ever receive `SafeFinding`s
 * and only ever return text: they have no way to change a verdict. Swapping the model (a local one now, a hosted one
 * later) means adding a provider here, nothing else.
 */
export interface ExplainProvider {
  /** True when nothing it is given leaves this computer (a model on loopback). */
  readonly isLocal: boolean;
  explain(level: Level, findings: SafeFinding[]): Promise<Result<{ explanation: string; fix: string }>>;
}

/** The Stack3 server's /explain endpoint as a provider. The server holds any model key. */
export function apiProvider(client: Pick<Stack3Client, 'explain'>): ExplainProvider {
  return { isLocal: false, explain: (level, findings) => client.explain(level, findings) };
}
