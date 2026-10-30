export type DangerSignal = 'network-tool' | 'pipe-to-shell' | 'base64' | 'node-eval' | 'raw-ip' | 'hidden-file';

// Longer input is not examined: bounds regex work on hostile input. A padded command still
// trips the long-line rule, and an auto-run task is already `high` without any signal.
const MAX_INPUT = 10_000;

const PATTERNS: [DangerSignal, RegExp | ((cmd: string) => boolean)][] = [
  ['network-tool', /\b(?:curl|wget|nc|ncat|netcat|iwr|irm|invoke-webrequest|invoke-restmethod|certutil|bitsadmin)\b/i],
  ['pipe-to-shell', /\|\s*(?:sudo\s+)?(?:[a-z]?sh|bash|powershell|pwsh|cmd|python3?|node|perl|ruby)\b/i],
  ['base64', /\bbase64\b|\batob\s*\(|frombase64string/i],
  ['node-eval', (cmd) => nodeEval(cmd)],
  ['raw-ip', /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  // A dot-directory or dot-file in a path, other than the usual tool dirs (./ and ../ never match).
  ['hidden-file', /(?:^|[\s/\\"'=])\.(?!(?:bin|venv|nvm)(?:[/\\\s"']|$))[A-Za-z0-9_][\w.-]*/],
];

const NODE_CMD = /\bnode(?:js)?\s/gi;
const EVAL_FLAG = /^-(?:e|p|-eval|-print)\b/i;
const MAX_FLAGS = 30;

/** `node -e …`, `node --no-warnings -p …`: an eval flag among the dash-options right after `node`. Walked token by token because `(?:-\S+\s+)*?` is cubic. */
function nodeEval(cmd: string): boolean {
  for (const m of cmd.matchAll(NODE_CMD)) {
    const from = m.index + m[0].length;
    for (const t of cmd.slice(from, from + 1000).split(/\s+/).slice(0, MAX_FLAGS)) {
      if (!t.startsWith('-')) break;
      if (EVAL_FLAG.test(t)) return true;
    }
  }
  return false;
}

/** Tags describing why a shell command line looks like a download-and-run payload. */
export function dangerSignals(cmd: string): DangerSignal[] {
  if (cmd.length > MAX_INPUT) return [];
  const out: DangerSignal[] = [];
  for (const [tag, re] of PATTERNS) if (typeof re === 'function' ? re(cmd) : re.test(cmd)) out.push(tag);
  return out;
}
