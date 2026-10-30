import type { Finding, Rule, ScanContext, VirtualFile } from '../types';
import { finding } from './evidence';
import { findMnemonics, HEX_KEY, isByteArray, maskHex, PEM_HEADER, SOLANA_ARRAY } from '../secretPatterns';

const MAX_LINE = 4096;
const MAX_PER_FILE = 10;

// Someone else's leak in a clone (possibly bait); your own mistake in a workspace.
const severityFor = (ctx: ScanContext) => (ctx.mode === 'clone' ? 'caution' : 'high');

// A 64-hex value is only a key when something nearby says so; otherwise it is a hash.
// "private" alone is not context: it is a visibility keyword in Solidity, TypeScript and Java (`bytes32 private constant TYPEHASH = 0x...`).
const KEY_CONTEXT = /private[\s_-]?key|priv_?key|secret|mnemonic|seed|wallet|signer|deployer|\bpk\b|\bkey\b/i;
const KEY_FILE = /(?:^|\/)(?:\.env[^/]*|[^/]*\.(?:key|pk)|id_[a-z0-9]+)$/i;

function lines(text: string): { line: number; text: string }[] {
  return text.split('\n').map((t, i) => ({ line: i + 1, text: t.slice(0, MAX_LINE) }));
}

const lineAt = (text: string, offset: number): number => {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

function evmKey(file: VirtualFile, ctx: ScanContext): Finding[] {
  const out: Finding[] = [];
  const keyFile = KEY_FILE.test(file.path);
  for (const l of lines(file.text ?? '')) {
    if (out.length >= MAX_PER_FILE) break;
    if (!keyFile && !KEY_CONTEXT.test(l.text)) continue;
    for (const m of l.text.matchAll(HEX_KEY)) {
      out.push(finding(ctx, 'secret.evm-key', severityFor(ctx), 'A wallet private key is committed in this repo', `Private key ${maskHex(m[1] ?? '')}`, file.path, l.line));
    }
  }
  return out;
}

function mnemonic(file: VirtualFile, ctx: ScanContext): Finding[] {
  const out: Finding[] = [];
  const budget = { left: 5000 };
  for (const l of lines(file.text ?? '')) {
    if (out.length >= MAX_PER_FILE || budget.left <= 0) break;
    for (const s of findMnemonics(l.text, budget)) {
      out.push(finding(ctx, 'secret.mnemonic', severityFor(ctx), 'A wallet recovery phrase is committed in this repo', `${s.words}-word recovery phrase (checksum valid)`, file.path, l.line));
    }
  }
  return out;
}

function pem(file: VirtualFile, ctx: ScanContext): Finding[] {
  const out: Finding[] = [];
  for (const l of lines(file.text ?? '')) {
    const m = PEM_HEADER.exec(l.text);
    if (!m || out.length >= MAX_PER_FILE) continue;
    const kind = (m[1] ?? '').trim();
    out.push(finding(ctx, 'secret.pem', severityFor(ctx), 'A private key file is committed in this repo', `PEM private key${kind ? ` (${kind})` : ''}`, file.path, l.line));
  }
  return out;
}

function solanaKeypair(file: VirtualFile, ctx: ScanContext): Finding[] {
  const text = file.text ?? '';
  const wholeFile = file.path.endsWith('.json');
  const out: Finding[] = [];
  for (const m of text.matchAll(SOLANA_ARRAY)) {
    if (out.length >= MAX_PER_FILE || !isByteArray(m[0])) continue;
    // A bare 64-number array is common (lookup tables). Require the file to be the array, or a keypair-ish word on its line.
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const lineText = text.slice(lineStart, m.index + 1);
    const isWholeFile = wholeFile && text.trim() === m[0];
    if (!isWholeFile && !/keypair|secret|solana|wallet|signer/i.test(lineText)) continue;
    out.push(finding(ctx, 'secret.solana-keypair', severityFor(ctx), 'A Solana wallet keypair is committed in this repo', 'Solana keypair (64-byte array)', file.path, lineAt(text, m.index)));
  }
  return out;
}

function keystore(file: VirtualFile, ctx: ScanContext): Finding[] {
  const text = file.text ?? '';
  if (!/"cipher"\s*:/i.test(text) || !/"ciphertext"\s*:/i.test(text) || !/"kdf"\s*:/i.test(text)) return [];
  return [finding(ctx, 'secret.keystore', severityFor(ctx), 'An encrypted wallet keystore is committed in this repo', 'Encrypted wallet keystore (protected only by its password)', file.path)];
}

const DOTENV_FILE = /(?:^|\/)\.env(?:\.[\w.-]+)?$/;
const DOTENV_TEMPLATE = /\.(?:example|sample|template|dist|defaults|schema)$/i;
const SECRET_NAME = /KEY|SECRET|TOKEN|PASS|PWD|PRIVATE|MNEMONIC|SEED|CRED|AUTH/i;
const CREDENTIAL_URL = /:\/\/[^/\s:@]+:[^/\s@]+@/;
const PLACEHOLDER = /^(?:|your[-_\w]*|change[-_\w]*|replace[-_\w]*|example\S*|xxx+|\*+|todo|<.*>|\$\{.*\})$/i;

function dotenv(file: VirtualFile, ctx: ScanContext): Finding[] {
  if (!DOTENV_FILE.test(file.path) || DOTENV_TEMPLATE.test(file.path)) return [];
  const names: string[] = [];
  let first = 0;
  for (const l of lines(file.text ?? '')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(l.text);
    if (!m) continue;
    const raw = (m[2] ?? '').trim();
    const quoted = /^(["'])(.*)\1/.exec(raw);
    const comment = raw.search(/\s#/); // a trailing ` # comment`; search, not a `\s+#.*$` replace, which is quadratic
    const value = quoted ? (quoted[2] ?? '') : (comment < 0 ? raw : raw.slice(0, comment)).trim();
    if (PLACEHOLDER.test(value)) continue;
    if (SECRET_NAME.test(m[1] ?? '') || CREDENTIAL_URL.test(value)) {
      names.push(m[1] ?? '');
      first ||= l.line;
    }
  }
  if (!names.length) return [];
  const shown = names.length > 8 ? `${names.slice(0, 8).join(', ')} (+${names.length - 8} more)` : names.join(', ');
  // Names only: the values are never read into a finding (I-7).
  return [finding(ctx, 'secret.dotenv', severityFor(ctx), 'A .env file with credentials is committed in this repo', `Sets ${names.length} secret-looking variable(s): ${shown}`, file.path, first)];
}

const eachText = (detect: (f: VirtualFile, c: ScanContext) => Finding[]): Rule => (files, ctx) =>
  files.flatMap((f) => (f.text === undefined ? [] : detect(f, ctx)));

export const secretRules: Rule[] = [evmKey, mnemonic, pem, solanaKeypair, keystore, dotenv].map(eachText);
