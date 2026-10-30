import type { Finding, Rule, ScanContext, VirtualFile } from '../types';
import { clip, finding } from './evidence';
import { GENERATED } from './paths';
import { SOURCE_REGEXES as RE } from './regexes';

const MAX_LINE = 2000;
const MAX_SPACE_RUN = 200;

const SCRIPT = /\.(?:js|cjs|mjs|jsx|ts|cts|mts|tsx|sh|bash|zsh|ps1|bat|cmd|py|rb|pl|php|lua|ya?ml|toml|ini|cfg|conf|code-workspace)$/i;
const CONFIG_NAME = /(?:^|\/)(?:\.npmrc|\.yarnrc(?:\.yml)?|\.pnpmfile\.cjs|Makefile|Dockerfile|foundry\.toml|package\.json|tsconfig[^/]*\.json|jsconfig\.json|\.vscode\/[^/]+\.json|\.devcontainer\/(?:[^/]+\/)?devcontainer\.json|\.devcontainer\.json)$/;
const PROSE = /\.(?:md|markdown|txt|rst|adoc|po|csv|tsv)$/i;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/;

// Ordinary source files hold long lines of data all the time (word lists, embedded bytecode, test vectors). A long line there
// is only "hiding" something when the part of it that is off-screen runs code, so it needs a code sink on the line to be high.
const SOURCE = /\.(?:js|cjs|mjs|jsx|ts|cts|mts|tsx)$/i;
const MAX_SCAN = 100_000;
const hasSink = (line: string): boolean => {
  const l = line.slice(0, MAX_SCAN);
  return RE.eval.test(l) || RE.newFunction.test(l) || RE.childProcess.test(l) || RE.base64Decode.test(l);
};

const isLongLineCandidate = (p: string): boolean => !GENERATED.test(p) && (SCRIPT.test(p) || CONFIG_NAME.test(p));

/** First position where non-whitespace text follows a run of >= MAX_SPACE_RUN spaces or tabs. Linear: no backtracking. */
function hiddenAfterSpaces(text: string): { offset: number; line: number } | undefined {
  let run = 0;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9) {
      run++;
      continue;
    }
    if (c !== 10 && c !== 13 && run >= MAX_SPACE_RUN) return { offset: i, line };
    run = 0;
    if (c === 10) line++;
  }
  return undefined;
}

function longLine(text: string): { length: number; line: number; sink: boolean } | undefined {
  let start = 0;
  for (let line = 1; start <= text.length; line++) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    if (end - start > MAX_LINE) return { length: end - start, line, sink: hasSink(text.slice(start, end)) };
    start = end + 1;
  }
  return undefined;
}

function longLineRule(file: VirtualFile, ctx: ScanContext): Finding[] {
  const text = file.text;
  if (text === undefined) return [];
  const out: Finding[] = [];
  const hidden = hiddenAfterSpaces(text);
  if (hidden) {
    out.push(finding(ctx, 'text.long-line', 'high', 'Text is pushed off-screen behind a long run of spaces', `Content after ${MAX_SPACE_RUN}+ spaces: ${clip(text.slice(hidden.offset, hidden.offset + 120))}`, file.path, hidden.line));
  }
  const long = isLongLineCandidate(file.path) ? longLine(text) : undefined;
  if (long) {
    const dataLike = SOURCE.test(file.path) && !long.sink;
    out.push(finding(ctx, 'text.long-line', dataLike ? 'caution' : 'high', 'A line is long enough to hide content off-screen', `Line of ${long.length} characters${long.sink ? ', and it runs code' : ''}`, file.path, long.line));
  }
  return out;
}

function bidiRule(file: VirtualFile, ctx: ScanContext): Finding[] {
  const text = file.text;
  if (text === undefined || PROSE.test(file.path)) return [];
  const m = BIDI.exec(text);
  if (!m) return [];
  const code = `U+${m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  const line = text.slice(0, m.index).split('\n').length;
  return [finding(ctx, 'text.bidi', 'caution', 'Hidden text-direction characters can make code read differently from how it runs', `${code} at line ${line}`, file.path, line)];
}

export const textTrickRules: Rule[] = [
  (files, ctx) => files.flatMap((f) => longLineRule(f, ctx)),
  (files, ctx) => files.flatMap((f) => bidiRule(f, ctx)),
];
