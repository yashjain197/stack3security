import { isValidMnemonic, isWord, MNEMONIC_LENGTHS } from './bip39';

// Shared by the secret rules (which report where a secret is) and the redactor (which removes it before anything is sent).

/** Hex keys: any run of 64 or more hex digits, optionally 0x-prefixed. Longer runs are removed too (they contain a key). */
export const HEX_RUN = /(?:0x)?[0-9a-fA-F]{64,}/g;
/** Exactly 64 hex digits (a 32-byte key), not part of a longer run. */
export const HEX_KEY = /(?<![0-9a-fA-F])(?:0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/g;

export const PEM_HEADER = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY(?: BLOCK)?-----/;
/** A whole PEM private key, or from its header to the end of the text when it is cut off. */
export const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g;

/** A JSON array of 64 integers: a Solana keypair file. Values above 255 are rejected by `isByteArray`. */
export const SOLANA_ARRAY = /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*,?\s*\]/g;
export const isByteArray = (s: string): boolean => (s.match(/\d+/g) ?? []).every((n) => Number(n) <= 255);

const TOKENS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JSON web token; starts at the beginning of a token run, so it is linear
  /(?<![0-9])\d{8,10}:[A-Za-z0-9_-]{30,}/g, // Telegram bot token, also inside /bot<id>:<token> URLs
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  /\b[1-9A-HJ-NP-Za-km-z]{85,90}\b/g, // base58 secret key
];

/** `0x3f…a91`: enough to recognise a key by eye, nowhere near enough to use it. */
export function maskHex(hex: string): string {
  const digits = hex.replace(/^0x/i, '');
  return `0x${digits.slice(0, 2)}…${digits.slice(-3)}`;
}

const MAX_WORDS_PER_RUN = 4096;
const WORD_RUN = /\b[a-z]{3,8}\b(?:[ \t]+\b[a-z]{3,8}\b){11,}/g;

export interface MnemonicSpan {
  start: number;
  end: number;
  words: number;
}

/**
 * Valid BIP-39 phrases (12/15/18/21/24 words, checksum correct) in `text`. A random run of wordlist
 * words fails the checksum, so ordinary prose and word lists are not reported. `budget.left` bounds
 * the checksum work on hostile input.
 */
export function findMnemonics(text: string, budget: { left: number } = { left: 5000 }): MnemonicSpan[] {
  const out: MnemonicSpan[] = [];
  for (const run of text.matchAll(WORD_RUN)) {
    const words: { w: string; start: number }[] = [];
    for (const m of run[0].matchAll(/[a-z]+/g)) {
      if (words.length >= MAX_WORDS_PER_RUN) break;
      words.push({ w: m[0], start: run.index + m.index });
    }
    let i = 0;
    while (i < words.length) {
      let hit = 0;
      if (isWord(words[i]!.w)) {
        for (const len of MNEMONIC_LENGTHS) {
          if (i + len > words.length || budget.left <= 0) continue;
          const window = words.slice(i, i + len);
          if (!window.every((x) => isWord(x.w))) continue;
          budget.left--;
          if (isValidMnemonic(window.map((x) => x.w))) {
            hit = len;
            out.push({ start: window[0]!.start, end: window[len - 1]!.start + window[len - 1]!.w.length, words: len });
            break;
          }
        }
      }
      i += hit || 1;
    }
  }
  return out;
}

const MAX_SCAN = 20_000;

/** Replace every secret-shaped substring with a fixed marker. Used on every string that may leave the machine (I-6, I-7). */
export function redactSecrets(input: string): string {
  let t = input.slice(0, MAX_SCAN);
  t = t.replace(PEM_BLOCK, '[private key redacted]');
  t = t.replace(SOLANA_ARRAY, (m) => (isByteArray(m) ? '[keypair redacted]' : m));
  t = t.replace(HEX_RUN, '[key redacted]');
  for (const re of TOKENS) t = t.replace(re, '[token redacted]');
  const spans = findMnemonics(t);
  for (const s of spans.reverse()) t = `${t.slice(0, s.start)}[recovery phrase redacted]${t.slice(s.end)}`;
  return t;
}
