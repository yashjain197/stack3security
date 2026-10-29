// Every regex the source rules run, exported so a test can bound its worst case on hostile input.
// Non-global on purpose: callers get no lastIndex state.
export const SOURCE_REGEXES = {
  eval: /\beval\s*\(/,
  newFunction: /\bnew\s+Function\s*\(/,
  childProcess: /\bchild_process\b/,
  // Decoding only. Bounded gap so a long line cannot make the match scan far.
  base64Decode: /\batob\s*\(|\bb64decode\b|Buffer\.from\([^\n]{0,200}["']base64["']/,
  rawIpUrl: /https?:\/\/((?:\d{1,3}\.){3}\d{1,3})\b/,
  // `.env` must look like a path (quoted or after a slash), so `process.env` does not match.
  secretPath: /["'`/\\]\.env(?:\.\w+)?(?=["'`\s)\]])|keystore|\.config\/solana\/id\.json|\.ssh\/|Local Extension Settings/i,
} as const;
