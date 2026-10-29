import type { Finding, Rule } from '../types';
import { finding } from './evidence';

const GIT_CONFIG = /(?:^|\/)\.git\/config$/;
const GIT_HOOK = /(?:^|\/)\.git\/hooks\/([^/]+)$/;

// `core.fsmonitor` may also be a plain boolean; those are not commands.
const BOOLEAN = new Set(['', 'true', 'false', 'yes', 'no', 'on', 'off', '0', '1']);
const CORE_EXEC = new Set(['fsmonitor', 'sshcommand', 'pager', 'editor', 'hookspath']);
const FILTER_EXEC = new Set(['clean', 'smudge', 'process']);

interface Entry {
  section: string;
  subsection?: string;
  key: string;
  value: string;
  line: number;
}

/** Minimal git-config reader: sections, `[a "b"]` and legacy `[a.b]` subsections, comments, bare keys. */
function parseGitConfig(text: string): Entry[] {
  const out: Entry[] = [];
  let section = '';
  let subsection: string | undefined;
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) return;
    if (line.startsWith('[')) {
      const m = /^\[\s*([^\s\]"]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line);
      if (!m) return;
      const name = (m[1] ?? '').toLowerCase();
      const dot = name.indexOf('.');
      if (m[2] !== undefined) [section, subsection] = [name, m[2]];
      else if (dot > 0) [section, subsection] = [name.slice(0, dot), name.slice(dot + 1)];
      else [section, subsection] = [name, undefined];
      return;
    }
    const eq = line.indexOf('=');
    const key = (eq < 0 ? line : line.slice(0, eq)).trim().toLowerCase();
    const value = eq < 0 ? '' : line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
    if (key && section) out.push({ section, subsection, key, value, line: i + 1 });
  });
  return out;
}

function isExecKey(e: Entry): boolean {
  if (e.section === 'core') return CORE_EXEC.has(e.key) && !BOOLEAN.has(e.value.toLowerCase());
  if (e.section === 'filter') return FILTER_EXEC.has(e.key) && e.value !== '';
  if (e.section === 'diff') return e.subsection === undefined && e.key === 'external' && e.value !== '';
  if (e.section === 'alias') return e.value.startsWith('!');
  return false;
}

export const gitConfigRules: Rule[] = [
  (files, ctx) => {
    const out: Finding[] = [];
    for (const f of files) {
      if (!GIT_CONFIG.test(f.path) || f.text === undefined) continue;
      for (const e of parseGitConfig(f.text)) {
        if (!isExecKey(e)) continue;
        const name = [e.section, e.subsection, e.key].filter(Boolean).join('.');
        out.push(finding(ctx, 'gitconfig.exec-key', 'critical', 'The repo .git/config makes git run a command', `${name} = ${e.value}`, f.path, e.line));
      }
    }
    return out;
  },
  (files, ctx) =>
    files.flatMap((f) => {
      const hook = GIT_HOOK.exec(f.path)?.[1];
      return hook && !hook.endsWith('.sample') ? [finding(ctx, 'githooks.present', 'high', 'The repo ships a git hook that runs on git actions', `.git/hooks/${hook}`, f.path)] : [];
    }),
];
