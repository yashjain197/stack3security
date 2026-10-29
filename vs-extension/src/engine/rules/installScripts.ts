import type { Node } from 'jsonc-parser';
import { lineOf, nodeAt, parseJsoncTree } from '../parsers/jsonc';
import type { Finding, Rule } from '../types';
import { finding } from './evidence';
import { dangerSignals } from './signals';

const LIFECYCLE = new Set(['preinstall', 'install', 'postinstall', 'prepare']);
const isPackageJson = (p: string): boolean => p === 'package.json' || p.endsWith('/package.json');

export const installScriptRules: Rule[] = [
  (files, ctx) => {
    const out: Finding[] = [];
    for (const file of files) {
      if (!isPackageJson(file.path) || file.text === undefined) continue;
      const d = parseJsoncTree(file.text);
      if (d.errors > 0) {
        out.push(finding(ctx, 'config.unparseable', 'caution', 'Configuration file could not be parsed', `${file.path} has ${d.errors} syntax error(s); its install scripts were not checked`, file.path));
        continue;
      }
      const scripts = nodeAt(d.root, ['scripts']);
      if (scripts?.type !== 'object') continue;
      // Every property, not a key lookup: npm keeps the LAST of duplicate keys, so a lookup could miss the payload.
      for (const prop of scripts.children ?? []) {
        const [k, v]: (Node | undefined)[] = prop.children ?? [];
        const key = k && String(k.value);
        if (!key || !LIFECYCLE.has(key) || v?.type !== 'string') continue;
        const cmd = String(v.value);
        const signals = dangerSignals(cmd);
        out.push(
          signals.length
            ? finding(ctx, 'scripts.lifecycle', 'critical', `Install script ${key} looks like a download-and-run payload (${signals.join(', ')})`, `${key}: ${cmd}`, file.path, lineOf(d.text, v))
            : finding(ctx, 'scripts.lifecycle', 'caution', `Install script ${key} runs automatically on npm install`, `${key}: ${cmd}`, file.path, lineOf(d.text, v)),
        );
      }
    }
    return out;
  },
];
