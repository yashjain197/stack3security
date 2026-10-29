import { posix } from 'node:path';
import type { Node } from 'jsonc-parser';
import { lineAtOffset, lineOf, nodeAt, parseJsonc, parseJsoncTree, type JsoncDoc } from '../parsers/jsonc';
import type { Finding, Rule, VirtualFile } from '../types';
import { finding } from './evidence';
import { dangerSignals } from './signals';

const TASKS_FILE = /(?:^|\/)\.vscode\/tasks\.json$/;
const SETTINGS_FILE = /(?:^|\/)\.vscode\/settings\.json$/;
const EXTENSIONS_FILE = /(?:^|\/)\.vscode\/extensions\.json$/;
const WORKSPACE_FILE = /\.code-workspace$/;
const DEVCONTAINER_FILE = /(?:^|\/)(?:\.devcontainer\/(?:[^/]+\/)?devcontainer\.json|\.devcontainer\.json)$/;

const isConfig = (p: string): boolean =>
  TASKS_FILE.test(p) || SETTINGS_FILE.test(p) || EXTENSIONS_FILE.test(p) || WORKSPACE_FILE.test(p) || DEVCONTAINER_FILE.test(p);

const MAX_DEPTH = 24;

// One parse per file, shared by every rule in a scan.
const docs = new WeakMap<VirtualFile, JsoncDoc>();
function docOf(file: VirtualFile): JsoncDoc | undefined {
  if (file.text === undefined) return undefined;
  let d = docs.get(file);
  if (!d) {
    d = parseJsoncTree(file.text);
    docs.set(file, d);
  }
  return d;
}

const strOf = (n: Node | undefined): string | undefined => (n?.type === 'string' ? String(n.value) : undefined);
const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const children = (n: Node | undefined): Node[] => n?.children ?? [];
const entries = (n: Node | undefined): [string, Node][] =>
  n?.type !== 'object'
    ? []
    : children(n).flatMap((p) => {
        const [k, v] = p.children ?? [];
        return k && v ? [[String(k.value), v] as [string, Node]] : [];
      });

// ---------------------------------------------------------------------------
// config.unparseable: a file we cannot parse is never reported as clean (I-5).

const unparseableRule: Rule = (files, ctx) => {
  const out: Finding[] = [];
  for (const f of files) {
    if (!isConfig(f.path)) continue;
    const d = docOf(f);
    if (d && d.errors > 0) {
      out.push(finding(ctx, 'config.unparseable', 'caution', 'Configuration file could not be parsed', `${f.path} has ${d.errors} syntax error(s); its contents were not fully checked`, f.path));
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// tasks.folder-open

interface Segment {
  text: string;
  node: Node;
}

const COMMAND_KEYS = new Set(['command', 'args', 'options', 'shell', 'executable', 'windows', 'linux', 'osx', 'value']);

function collectCommands(node: Node, out: Segment[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (node.type === 'string') out.push({ text: String(node.value), node });
  else if (node.type === 'array') for (const c of children(node)) collectCommands(c, out, depth + 1);
  else if (node.type === 'object') for (const [k, v] of entries(node)) if (COMMAND_KEYS.has(k)) collectCommands(v, out, depth + 1);
}

function dependsOnNames(task: Node): string[] {
  const dep = nodeAt(task, ['dependsOn']);
  if (!dep) return [];
  const one = (n: Node): string[] => {
    const s = strOf(n);
    if (s !== undefined) return [s];
    return [strOf(nodeAt(n, ['task'])), strOf(nodeAt(n, ['label']))].filter((x): x is string => x !== undefined);
  };
  return dep.type === 'array' ? children(dep).flatMap(one) : one(dep);
}

function tasksIn(file: VirtualFile, d: JsoncDoc): { tasks: Node[]; root: string } | undefined {
  const base = TASKS_FILE.test(file.path) ? [] : WORKSPACE_FILE.test(file.path) ? ['tasks'] : undefined;
  if (!base) return undefined;
  const arr = nodeAt(d.root, [...base, 'tasks']);
  if (arr?.type !== 'array') return undefined;
  const root = TASKS_FILE.test(file.path) ? dirOf(dirOf(file.path)) : dirOf(file.path);
  return { tasks: children(arr).filter((c) => c.type === 'object'), root };
}

function npmScript(task: Node, root: string, files: VirtualFile[]): Segment | undefined {
  if (strOf(nodeAt(task, ['type'])) !== 'npm') return undefined;
  const scriptNode = nodeAt(task, ['script']);
  const script = strOf(scriptNode);
  if (!scriptNode || script === undefined) return undefined;
  const pkgPath = posix.normalize(posix.join(root, strOf(nodeAt(task, ['path'])) ?? '', 'package.json'));
  if (pkgPath.startsWith('..')) return undefined;
  const pkg = files.find((f) => f.path === pkgPath);
  if (pkg?.text === undefined) return undefined;
  const scripts = (parseJsonc(pkg.text).value as { scripts?: Record<string, unknown> } | undefined)?.scripts;
  const text = scripts && Object.hasOwn(scripts, script) ? scripts[script] : undefined;
  return typeof text === 'string' ? { text, node: scriptNode } : undefined;
}

const tasksRule: Rule = (files, ctx) => {
  const out: Finding[] = [];
  for (const file of files) {
    if (!TASKS_FILE.test(file.path) && !WORKSPACE_FILE.test(file.path)) continue;
    const d = docOf(file);
    if (!d?.text) continue;

    if (d.errors > 0) {
      // The tree cannot be trusted, so fall back to the raw text rather than treat the file as clean.
      const at = d.text.indexOf('folderOpen');
      if (at >= 0) {
        const window = d.text.slice(Math.max(0, at - 1500), at + 1500);
        const signals = dangerSignals(window);
        out.push(finding(ctx, 'tasks.folder-open', signals.length ? 'critical' : 'high', 'Task runs automatically when the folder opens', window, file.path, lineAtOffset(d.text, at)));
      }
      continue;
    }

    const found = tasksIn(file, d);
    if (!found) continue;
    const byLabel = new Map<string, Node[]>();
    for (const t of found.tasks) {
      const label = strOf(nodeAt(t, ['label'])) ?? strOf(nodeAt(t, ['taskName']));
      if (label !== undefined) byLabel.set(label, [...(byLabel.get(label) ?? []), t]);
    }

    const closure = (start: Node): Segment[] => {
      const segs: Segment[] = [];
      const seen = new Set<Node>();
      const stack = [start];
      while (stack.length) {
        const t = stack.pop()!;
        if (seen.has(t)) continue;
        seen.add(t);
        collectCommands(t, segs);
        const npm = npmScript(t, found.root, files);
        if (npm) segs.push(npm);
        for (const name of dependsOnNames(t)) stack.push(...(byLabel.get(name) ?? []));
      }
      return segs;
    };

    for (const t of found.tasks) {
      const runOn = nodeAt(t, ['runOptions', 'runOn']);
      if (strOf(runOn) !== 'folderOpen') continue;
      const segs = closure(t);
      const joined = segs.map((s) => s.text).join(' ');
      const signals = new Set([...dangerSignals(joined), ...segs.flatMap((s) => dangerSignals(s.text))]);
      const hot = segs.find((s) => dangerSignals(s.text).length > 0);
      const label = strOf(nodeAt(t, ['label'])) ?? 'task';
      out.push(
        signals.size
          ? finding(ctx, 'tasks.folder-open', 'critical', `Auto-run task uses a risky command (${[...signals].join(', ')})`, `${label}: ${joined}`, file.path, lineOf(d.text, (hot ?? segs[0])?.node ?? runOn))
          : finding(ctx, 'tasks.folder-open', 'high', 'Task runs automatically when the folder opens', `${label}: ${joined}`, file.path, lineOf(d.text, runOn)),
      );
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// settings.*

const SHELL_KEY = /^terminal\.integrated\.(?:profiles|shell|shellargs|env|automationprofile|automationshell)(?:\.|$)/i;
const EXECUTABLE_KEY = /(?:\.path|Path|\.runtime)$/;

/** Workspace-relative path a setting value points at, or undefined when it is absolute, uses another variable, or leaves the root. */
function repoPath(value: string, baseDir: string): string | undefined {
  let v = value.trim().replace(/\\/g, '/');
  const m = /^\$\{workspace(?:Folder|Root)(?::[^}]*)?\}/.exec(v);
  if (m) v = v.slice(m[0].length).replace(/^\/+/, '');
  else if (v.startsWith('/') || v.startsWith('~') || /^[A-Za-z]:\//.test(v)) return undefined;
  if (v.includes('${')) return undefined;
  const rel = posix.normalize(posix.join(baseDir, v));
  return rel === '.' || rel.startsWith('..') ? undefined : rel;
}

const settingsRule: Rule = (files, ctx) => {
  const out: Finding[] = [];
  const isInRepo = (p: string) => files.some((f) => f.path === p || f.path.startsWith(`${p}/`));
  for (const file of files) {
    const isWorkspace = WORKSPACE_FILE.test(file.path);
    if (!SETTINGS_FILE.test(file.path) && !isWorkspace) continue;
    const d = docOf(file);
    if (!d?.text || d.errors > 0) continue;
    const baseDir = isWorkspace ? dirOf(file.path) : dirOf(dirOf(file.path));
    for (const [key, val] of entries(nodeAt(d.root, isWorkspace ? ['settings'] : []))) {
      const line = lineOf(d.text, val);
      const shown = `${key}: ${JSON.stringify(val.value ?? null)}`;
      if (SHELL_KEY.test(key)) {
        out.push(finding(ctx, 'settings.shell-override', 'high', 'Workspace overrides the terminal shell or environment', shown, file.path, line));
      }
      if (key === 'task.allowAutomaticTasks' && val.value === 'on') {
        out.push(finding(ctx, 'settings.auto-tasks-on', 'high', 'Workspace turns on automatic tasks', shown, file.path, line));
      }
      if (EXECUTABLE_KEY.test(key) && typeof val.value === 'string') {
        const target = repoPath(val.value, baseDir);
        if (target !== undefined && isInRepo(target)) {
          out.push(finding(ctx, 'settings.repo-executable', 'high', 'Setting points an editor tool at a file inside this repo', shown, file.path, line));
        }
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// devcontainer.*

const LIFECYCLE_KEYS = ['postCreateCommand', 'postStartCommand', 'postAttachCommand', 'onCreateCommand', 'updateContentCommand'];

function commandText(node: Node | undefined, depth = 0): string {
  if (!node || depth > MAX_DEPTH) return '';
  if (node.type === 'string') return String(node.value);
  return children(node)
    .map((c) => commandText(node.type === 'object' ? c.children?.[1] : c, depth + 1))
    .join(' ');
}

const devcontainerRule: Rule = (files, ctx) => {
  const out: Finding[] = [];
  for (const file of files) {
    if (!DEVCONTAINER_FILE.test(file.path)) continue;
    const d = docOf(file);
    if (!d?.text || d.errors > 0) continue;
    const init = nodeAt(d.root, ['initializeCommand']);
    if (init) {
      const text = commandText(init);
      const signals = dangerSignals(text);
      out.push(
        finding(ctx, 'devcontainer.initialize-command', signals.length ? 'critical' : 'high', 'Dev container command runs on your computer, outside the container', text, file.path, lineOf(d.text, init)),
      );
    }
    for (const key of LIFECYCLE_KEYS) {
      const node = nodeAt(d.root, [key]);
      const text = commandText(node);
      if (node && dangerSignals(text).includes('network-tool')) {
        out.push(finding(ctx, 'devcontainer.post-create-network', 'caution', `Dev container ${key} downloads from the network`, text, file.path, lineOf(d.text, node)));
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// extensions.recommendations

const KNOWN_PUBLISHERS = new Set([
  'microsoft', 'ms-python', 'ms-vscode', 'ms-vscode-remote', 'ms-azuretools', 'ms-dotnettools', 'ms-toolsai',
  'ms-kubernetes-tools', 'ms-playwright', 'github', 'redhat', 'golang', 'rust-lang', 'hashicorp', 'vue', 'svelte', 'angular',
]);
const KNOWN_IDS = new Set([
  'dbaeumer.vscode-eslint', 'esbenp.prettier-vscode', 'editorconfig.editorconfig', 'eamodio.gitlens', 'bradlc.vscode-tailwindcss',
  'streetsidesoftware.code-spell-checker', 'davidanson.vscode-markdownlint', 'pkief.material-icon-theme', 'vitest.explorer',
  'prisma.prisma', 'tamasfe.even-better-toml', 'timonwong.shellcheck', 'foxundermoon.shell-format', 'christian-kohler.path-intellisense',
  'formulahendry.auto-rename-tag', 'nomicfoundation.hardhat-solidity', 'juanblanco.solidity', 'unifiedjs.vscode-mdx', 'yoavbls.pretty-ts-errors',
]);

function isKnownExtension(id: string): boolean {
  const lower = id.toLowerCase();
  return KNOWN_IDS.has(lower) || KNOWN_PUBLISHERS.has(lower.split('.')[0] ?? '');
}

const extensionsRule: Rule = (files, ctx) => {
  const out: Finding[] = [];
  for (const file of files) {
    const isWorkspace = WORKSPACE_FILE.test(file.path);
    if (!EXTENSIONS_FILE.test(file.path) && !isWorkspace) continue;
    const d = docOf(file);
    if (!d?.text || d.errors > 0) continue;
    const list = nodeAt(d.root, isWorkspace ? ['extensions', 'recommendations'] : ['recommendations']);
    const unknown = children(list).filter((n) => {
      const id = strOf(n);
      return id !== undefined && !isKnownExtension(id);
    });
    if (unknown.length) {
      out.push(finding(ctx, 'extensions.recommendations', 'caution', 'Repo recommends extensions that are not widely known', `Recommends: ${unknown.map((n) => String(n.value)).join(', ')}`, file.path, lineOf(d.text, unknown[0])));
    }
  }
  return out;
};

export const vscodeFileRules: Rule[] = [unparseableRule, tasksRule, settingsRule, devcontainerRule, extensionsRule];
