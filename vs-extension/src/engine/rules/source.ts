import type { Finding, Rule, ScanContext, Severity, VirtualFile } from '../types';
import { findIndicatorsInText } from '../indicators';
import { finding } from './evidence';
import { GENERATED } from './paths';
import { SOURCE_REGEXES as RE } from './regexes';

const MAX_LINE = 4096;
const NEAR = 300;
const SOURCE_FILE = /\.(?:js|cjs|mjs|jsx|ts|cts|mts|tsx)$/i;
// Build and config code legitimately spawns processes.
const SPAWN_DIR = /(?:^|\/)(?:scripts|build|tools|config)\//;
/** A file name like `webpack.config.js`: `.config.` followed by more name. Not a regex over the whole path, which is quadratic. */
const isConfigFile = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const at = name.indexOf('.config.');
  return at >= 0 && at + '.config.'.length < name.length;
};
const spawnOk = (path: string): boolean => SPAWN_DIR.test(path) || isConfigFile(path);

type Signal = 'eval' | 'new-function' | 'base64-exec' | 'child-process' | 'raw-ip-url' | 'secret-path-read';

interface Hit {
  offset: number;
  line: number;
}

/**
 * A line that is only a comment is not code: documentation that names `.env` or `child_process` is not behaviour. A line
 * that closes a block comment (`*\/`) can carry code after it, so it is not skipped.
 */
const isCommentLine = (l: string): boolean => {
  const t = l.trimStart();
  return t.startsWith('//') || ((t.startsWith('*') || t.startsWith('/*')) && !l.includes('*/'));
};

/**
 * A line that is only a quoted name, as an item of a list (`'.env',`), is data: tools list `.env` in the deny list of a dev
 * server or an ignore list. A read puts the name inside a call, so it shares its line with one. (Splitting the name from
 * the call across lines would hide it from this signal; see DECISIONS D-16.)
 */
const isBareLiteral = (l: string): boolean => {
  const t = l.trim();
  const q = t[0];
  if (q !== '"' && q !== "'" && q !== '`') return false;
  const close = t.indexOf(q, 1);
  if (close < 2 || close > 201) return false;
  const rest = t.slice(close + 1).trimStart();
  return rest === '' || rest.startsWith('//') || rest.replace(/^,/, '').trim() === '' || rest.replace(/^,/, '').trimStart().startsWith('//');
};

const isLoopback = (ip: string): boolean => ip.startsWith('127.') || ip === '0.0.0.0';

function scan(file: VirtualFile): Map<Signal, Hit> {
  const text = file.text ?? '';
  const found = new Map<Signal, Hit>();
  const decodes: Hit[] = [];
  const sinks: Hit[] = [];
  const spawnAllowed = spawnOk(file.path);
  const note = (s: Signal, hit: Hit) => {
    if (!found.has(s)) found.set(s, hit);
  };

  let start = 0;
  for (let line = 1; start <= text.length; line++) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const l = text.slice(start, Math.min(end, start + MAX_LINE));
    const at = (i: number): Hit => ({ offset: start + i, line });
    if (isCommentLine(l)) {
      start = end + 1;
      continue;
    }

    const ev = RE.eval.exec(l);
    if (ev) (note('eval', at(ev.index)), sinks.push(at(ev.index)));
    const fn = RE.newFunction.exec(l);
    if (fn) (note('new-function', at(fn.index)), sinks.push(at(fn.index)));
    const cp = !spawnAllowed ? RE.childProcess.exec(l) : null;
    if (cp) (note('child-process', at(cp.index)), sinks.push(at(cp.index)));
    const b64 = RE.base64Decode.exec(l);
    if (b64 && decodes.length < 1000) decodes.push(at(b64.index));
    for (const m of l.matchAll(new RegExp(RE.rawIpUrl.source, 'g'))) {
      if (!isLoopback(m[1] ?? '')) {
        note('raw-ip-url', at(m.index));
        break;
      }
    }
    const sp = RE.secretPath.exec(l);
    if (sp && !isBareLiteral(l)) note('secret-path-read', at(sp.index));

    start = end + 1;
  }

  const pair = decodes.flatMap((d) => sinks.filter((s) => Math.abs(s.offset - d.offset) <= NEAR).map((s) => (s.offset < d.offset ? s : d)))[0];
  if (pair) note('base64-exec', pair);
  return found;
}

// Tests, playgrounds and fixtures are run on purpose, not by opening a folder or installing, and they spawn processes and
// mention `.env` all the time. Not a place where the decode-and-run combos below stop mattering (see classify).
const TESTISH = /(?:^|\/)(?:tests?|__tests__|specs?|e2e|playgrounds?|fixtures?|__fixtures__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
// Capabilities that only run code. Without a secret read, a decode or a raw-IP address there is nothing to steal or hide.
const EXEC_ONLY = new Set<Signal>(['eval', 'new-function', 'child-process']);

function classify(path: string, signals: Map<Signal, Hit>): { ruleId: string; severity: Severity; title: string } | undefined {
  const names = [...signals.keys()];
  if (names.length === 0) return undefined;
  if (signals.has('base64-exec') && signals.has('secret-path-read')) {
    return { ruleId: 'source.decode-exec-secret', severity: 'critical', title: 'Code decodes hidden text, runs it, and reads a secret location' };
  }
  if (names.length >= 2) {
    const quiet = !signals.has('base64-exec') && (TESTISH.test(path) || names.every((n) => EXEC_ONLY.has(n)));
    return { ruleId: 'source.multiple-signals', severity: quiet ? 'caution' : 'high', title: `Code combines several risky behaviours (${names.join(', ')})` };
  }
  return { ruleId: `source.${names[0]}`, severity: 'caution', title: `Code uses a risky pattern (${names[0]})` };
}

function sourceRule(file: VirtualFile, ctx: ScanContext): Finding[] {
  if (file.text === undefined || !SOURCE_FILE.test(file.path) || GENERATED.test(file.path)) return [];
  const signals = scan(file);
  const c = classify(file.path, signals);
  if (!c) return [];
  const first = Math.min(...[...signals.values()].map((h) => h.line));
  let evidence = `Signals: ${[...signals.keys()].join(', ')}`;
  if (c.severity !== 'caution') {
    // Wallets and endpoints named in a file that already combines risky behaviours: the report to the graph reads them from here.
    const found = findIndicatorsInText(file.text);
    if (found.addresses.length) evidence += `; wallets: ${found.addresses.slice(0, 3).join(' ')}`;
    if (found.endpoints.length) evidence += `; endpoints: ${found.endpoints.slice(0, 2).join(' ')}`;
  }
  return [finding(ctx, c.ruleId, c.severity, c.title, evidence, file.path, first)];
}

export const sourceRules: Rule[] = [(files, ctx) => files.flatMap((f) => sourceRule(f, ctx))];
