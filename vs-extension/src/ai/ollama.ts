import { z } from 'zod';
import { cleanText } from '../engine/rules/evidence';
import { postJsonOnce } from '../api/client';
import type { Result } from '../api/client';
import { redactAll } from '../verdict/redact';
import { buildMessages } from './prompt';
import type { ExplainProvider } from './provider';

export const OLLAMA_URL = 'http://127.0.0.1:11434';
// A CPU-only machine can take a minute or two for a 7B model; the explanation arrives in the background.
const TIMEOUT_MS = 120_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The model must run on this computer: only a loopback host is accepted, so findings can never be sent elsewhere. */
export function validateOllamaUrl(input: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (url.username || url.password) return undefined;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  return LOOPBACK.has(url.hostname) ? url : undefined;
}

const Answer = z.object({ explanation: z.string(), fix: z.string() });
const Envelope = z.object({ message: z.object({ content: z.string() }) });

// Ollama can constrain a reply to a JSON schema, which keeps small models on format.
const FORMAT = {
  type: 'object',
  properties: { explanation: { type: 'string' }, fix: { type: 'string' } },
  required: ['explanation', 'fix'],
} as const;

export interface OllamaOptions {
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const fail = (reason: string): Result<never> => ({ ok: false, reason });

/** Explanations from a model running in Ollama on this computer. One request, no retry, no tools, no identifying headers. */
export function createOllamaProvider(opts: OllamaOptions): ExplainProvider {
  return {
    isLocal: true,
    async explain(level, findings) {
      const base = validateOllamaUrl(opts.baseUrl ?? OLLAMA_URL);
      if (!base) return fail('The local model must run on this computer (127.0.0.1 or localhost).');

      const body = {
        model: opts.model,
        stream: false,
        keep_alive: '5m',
        format: FORMAT,
        options: { temperature: 0.2, num_predict: 700 },
        // redactAll again at the sink: at most 20 findings, known fields, secrets removed, even if the caller forged one.
        messages: buildMessages(level, redactAll(findings)),
      };
      const attempt = await postJsonOnce(opts.fetchImpl ?? fetch, `${base.origin}/api/chat`, body, {}, opts.timeoutMs ?? TIMEOUT_MS);
      if (!attempt.ok) {
        if (attempt.reason === 'API returned 404') return fail(`The model "${opts.model}" is not installed. Run: ollama pull ${opts.model}`);
        if (attempt.reason.startsWith('API returned ')) return fail(`The local model returned an error (${attempt.reason.slice(13)}).`);
        if (attempt.reason === 'Timed out') return fail('The local model took too long.');
        if (attempt.reason === 'Response too large') return fail('The local model returned too much data.');
        if (attempt.reason === 'Network error') return fail('Ollama is not running. Start it with: ollama serve');
        return fail('The local model gave an unusable answer.');
      }

      const envelope = Envelope.safeParse(attempt.value);
      let parsed: z.infer<typeof Answer> | undefined;
      if (envelope.success) {
        try {
          const a = Answer.safeParse(JSON.parse(envelope.data.message.content));
          if (a.success) parsed = a.data;
        } catch {
          // not JSON: handled below
        }
      }
      if (!parsed) return fail('The local model gave an unusable answer.');
      return { ok: true, value: { explanation: cleanText(parsed.explanation, 4000), fix: cleanText(parsed.fix, 2000) } };
    },
  };
}
