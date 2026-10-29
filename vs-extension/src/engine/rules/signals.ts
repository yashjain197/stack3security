export type DangerSignal = 'network-tool' | 'pipe-to-shell' | 'base64' | 'node-eval' | 'raw-ip' | 'hidden-file';

// Longer input is not examined: bounds regex work on hostile input. A padded command still
// trips the long-line rule, and an auto-run task is already `high` without any signal.
const MAX_INPUT = 10_000;

const PATTERNS: [DangerSignal, RegExp][] = [
  ['network-tool', /\b(?:curl|wget|nc|ncat|netcat|iwr|irm|invoke-webrequest|invoke-restmethod|certutil|bitsadmin)\b/i],
  ['pipe-to-shell', /\|\s*(?:sudo\s+)?(?:[a-z]?sh|bash|powershell|pwsh|cmd|python3?|node|perl|ruby)\b/i],
  ['base64', /\bbase64\b|\batob\s*\(|frombase64string/i],
  ['node-eval', /\bnode(?:js)?\s+(?:-\S+\s+)*?(?:-e|-p|--eval|--print)\b/i],
  ['raw-ip', /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  // A dot-directory or dot-file in a path, other than the usual tool dirs (./ and ../ never match).
  ['hidden-file', /(?:^|[\s/\\"'=])\.(?!(?:bin|venv|nvm)(?:[/\\\s"']|$))[A-Za-z0-9_][\w.-]*/],
];

/** Tags describing why a shell command line looks like a download-and-run payload. */
export function dangerSignals(cmd: string): DangerSignal[] {
  if (cmd.length > MAX_INPUT) return [];
  const out: DangerSignal[] = [];
  for (const [tag, re] of PATTERNS) if (re.test(cmd)) out.push(tag);
  return out;
}
