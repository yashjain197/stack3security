import type { Finding, Rule, ScanContext, Severity, VirtualFile } from '../types';
import { findIndicatorsInText } from '../indicators';
import { finding } from './evidence';
import { GENERATED } from './paths';
import { SOURCE_REGEXES as RE } from './regexes';

const MAX_LINE = 4096;
const NEAR = 300;
const SOURCE_FILE = /\.(?:js|cjs|mjs|jsx|ts|cts|mts|tsx)$/i;
// Build and config code legitimately spawns processes.
const SPAWN_OK = /(?:^|\/)(?:scripts|build|tools|config)\/|\.config\.[^/]+$/;

type Signal = 'eval' | 'new-function' | 'base64-exec' | 'child-process' | 'raw-ip-url' | 'secret-path-read';

interface Hit {
  offset: number;
  line: number;
}

const isLoopback = (ip: string): boolean => ip.startsWith('127.') || ip === '0.0.0.0';

function scan(file: VirtualFile): Map<Signal, Hit> {
  const text = file.text ?? '';
  const found = new Map<Signal, Hit>();
  const decodes: Hit[] = [];
  const sinks: Hit[] = [];
  const spawnAllowed = SPAWN_OK.test(file.path);
  const note = (s: Signal, hit: Hit) => {
    if (!found.has(s)) found.set(s, hit);
  };

  let start = 0;
  for (let line = 1; start <= text.length; line++) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const l = text.slice(start, Math.min(end, start + MAX_LINE));
    const at = (i: number): Hit => ({ offset: start + i, line });

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
    if (sp) note('secret-path-read', at(sp.index));

    start = end + 1;
  }

  const pair = decodes.flatMap((d) => sinks.filter((s) => Math.abs(s.offset - d.offset) <= NEAR).map((s) => (s.offset < d.offset ? s : d)))[0];
  if (pair) note('base64-exec', pair);
  return found;
}

function classify(signals: Map<Signal, Hit>): { ruleId: string; severity: Severity; title: string } | undefined {
  const names = [...signals.keys()];
  if (names.length === 0) return undefined;
  if (signals.has('base64-exec') && signals.has('secret-path-read')) {
    return { ruleId: 'source.decode-exec-secret', severity: 'critical', title: 'Code decodes hidden text, runs it, and reads a secret location' };
  }
  if (names.length >= 2) return { ruleId: 'source.multiple-signals', severity: 'high', title: `Code combines several risky behaviours (${names.join(', ')})` };
  return { ruleId: `source.${names[0]}`, severity: 'caution', title: `Code uses a risky pattern (${names[0]})` };
}

function sourceRule(file: VirtualFile, ctx: ScanContext): Finding[] {
  if (file.text === undefined || !SOURCE_FILE.test(file.path) || GENERATED.test(file.path)) return [];
  const signals = scan(file);
  const c = classify(signals);
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
