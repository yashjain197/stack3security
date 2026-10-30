import { z } from 'zod';
import { cleanText } from '../engine/rules/evidence';
import { postJsonOnce } from '../api/client';
import type { Result } from '../api/client';
import { redactAll } from '../verdict/redact';
import { buildMessages } from './prompt';
import type { ExplainProvider } from './provider';

// Fixed on purpose: no setting or environment variable can point findings at another host.
export const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
export const CLAUDE_MODEL = 'claude-haiku-5-5';
const API_VERSION = '2026-10-21';
const TIMEOUT_MS = 30_000;
// Room for the JSON answer (about 180 words) plus any adaptive thinking the model does before it.
const MAX_TOKENS = 2000;

const Answer = z.object({ explanation: z.string(), fix: z.string() });
const Envelope = z.object({
  stop_reason: z.string().nullable().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

// A JSON schema keeps the reply on format; the answer is still parsed and bounded below.
const FORMAT = {
  type: 'object',
  properties: { explanation: { type: 'string' }, fix: { type: 'string' } },
  required: ['explanation', 'fix'],
  additionalProperties: false,
} as const;

/** Printable ASCII only, so a pasted key can never carry a line break into a header. */
export const isPlausibleClaudeKey = (key: string): boolean => /^[\x21-\x7e]{20,300}$/.test(key);

export interface ClaudeOptions {
  /** Read at request time, so a key set after start-up is picked up. Never logged or put in an error. */
  apiKey(): Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const fail = (reason: string): Result<never> => ({ ok: false, reason });
export const NO_KEY = 'No Claude API key is set. Run "Stack3: Set Claude API key" from the Command Palette.';

/** Explanations from Claude Haiku. One request, no retry, no tools, no identifying headers beyond the key. */
export function createClaudeProvider(opts: ClaudeOptions): ExplainProvider {
  return {
    async explain(level, findings) {
      const key = (await opts.apiKey())?.trim();
      if (!key) return fail(NO_KEY);
      if (!isPlausibleClaudeKey(key)) return fail('The Claude API key is not valid. Run "Stack3: Set Claude API key" to replace it.');

      // redactAll again at the sink: at most 20 findings, known fields, secrets removed, even if the caller forged one.
      const messages = buildMessages(level, redactAll(findings));
      const body = {
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n'),
        messages: messages.filter((m) => m.role === 'user'),
        output_config: { effort: 'low', format: { type: 'json_schema', schema: FORMAT } },
      };
      const attempt = await postJsonOnce(opts.fetchImpl ?? fetch, CLAUDE_URL, body, { 'x-api-key': key, 'anthropic-version': API_VERSION }, opts.timeoutMs ?? TIMEOUT_MS);
      if (!attempt.ok) {
        if (attempt.reason === 'API returned 401' || attempt.reason === 'API returned 403') return fail('Claude rejected the API key. Run "Stack3: Set Claude API key" to replace it.');
        if (attempt.reason === 'API returned 429') return fail('Claude is rate limited right now. Try again in a minute.');
        if (attempt.reason.startsWith('API returned ')) return fail(`Claude returned an error (${attempt.reason.slice(13)}).`);
        if (attempt.reason === 'Timed out') return fail('Claude took too long.');
        if (attempt.reason === 'Response too large') return fail('Claude returned too much data.');
        if (attempt.reason === 'Network error') return fail('Could not reach the Claude API. Check your internet connection.');
        return fail('Claude gave an unusable answer.');
      }

      const envelope = Envelope.safeParse(attempt.value);
      if (!envelope.success) return fail('Claude gave an unusable answer.');
      if (envelope.data.stop_reason === 'refusal') return fail('Claude declined to explain this result.');
      if (envelope.data.stop_reason === 'max_tokens') return fail('Claude gave an unusable answer.');

      const text = envelope.data.content.find((b) => b.type === 'text')?.text;
      let parsed: z.infer<typeof Answer> | undefined;
      try {
        const a = Answer.safeParse(JSON.parse(text ?? ''));
        if (a.success) parsed = a.data;
      } catch {
        // not JSON: handled below
      }
      if (!parsed) return fail('Claude gave an unusable answer.');
      return { ok: true, value: { explanation: cleanText(parsed.explanation, 4000), fix: cleanText(parsed.fix, 2000) } };
    },
  };
}
