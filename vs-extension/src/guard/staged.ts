import { constants, promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { secretRules } from '../engine/rules/secrets';
import type { VirtualFile } from '../engine/types';
import { isInside } from '../scan/paths';

const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 50;
const DEBOUNCE_MS = 500;
// git extension Status.INDEX_DELETED. Everything else in `indexChanges` is content that is about to be committed.
const INDEX_DELETED = 2;

/** The slice of the built-in git extension's API that is used. Read-only: nothing here asks git to do anything. */
export interface GitRepository {
  rootUri: { fsPath: string };
  state: {
    indexChanges: { uri: { fsPath: string }; status: number }[];
    onDidChange(cb: () => void): { dispose(): void };
  };
}
export interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository(cb: (r: GitRepository) => void): { dispose(): void };
}

export interface StagedDeps {
  getGitApi(): Promise<GitApi | undefined>;
  notify(message: string): void;
  debounceMs?: number;
}

const realDeps: StagedDeps = {
  async getGitApi() {
    const ext = vscode.extensions.getExtension<{ getAPI(v: number): GitApi }>('vscode.git');
    if (!ext) return undefined;
    const exports = ext.isActive ? ext.exports : await ext.activate();
    return exports.getAPI(1);
  },
  notify: (m) => void vscode.window.showWarningMessage(m),
};

async function readInside(root: string, file: string): Promise<string | undefined> {
  try {
    const realRoot = await fs.realpath(root);
    const st = await fs.lstat(file);
    if (st.isSymbolicLink() || !st.isFile() || !isInside(realRoot, await fs.realpath(file))) return undefined;
    const fh = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const buf = Buffer.alloc(Math.min(st.size, MAX_BYTES));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const bytes = buf.subarray(0, bytesRead);
      return bytes.subarray(0, 8192).includes(0) ? undefined : new TextDecoder().decode(bytes);
    } finally {
      await fh.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * Warn before a secret is committed (the PDF's "warn before committing secrets"). It uses VS Code's own git extension
 * for the list of staged files and reads those files as data. Stack3 never runs git: a hostile `.git/config` in the
 * workspace could make that dangerous (V-3). The check looks at the working-tree copy, which is what is staged unless
 * the file was edited after `git add`. Each secret is reported once per session, by type and place only, never by value.
 */
export function registerStagedSecretWarning(_ctx: Pick<vscode.ExtensionContext, 'subscriptions'>, deps: StagedDeps = realDeps): vscode.Disposable {
  const subs: { dispose(): void }[] = [];
  const warned = new Set<string>();
  const timers = new Map<GitRepository, ReturnType<typeof setTimeout>>();
  let disposed = false;

  async function check(repo: GitRepository): Promise<void> {
    if (disposed) return;
    const staged = (repo.state.indexChanges ?? []).filter((c) => c.status !== INDEX_DELETED).slice(0, MAX_FILES);
    const root = repo.rootUri.fsPath;
    const files: VirtualFile[] = [];
    for (const c of staged) {
      const text = await readInside(root, c.uri.fsPath);
      if (text === undefined) continue;
      files.push({ path: path.relative(root, c.uri.fsPath).split(path.sep).join('/'), text, binary: false, size: text.length, truncated: false });
    }
    const ctx = { mode: 'workspace' as const, checkedAt: new Date().toISOString() };
    for (const rule of secretRules) {
      for (const f of rule(files, ctx)) {
        const key = `${root}\0${f.ruleId}\0${f.location?.file}\0${f.location?.line}`;
        if (warned.has(key) || disposed) continue;
        warned.add(key);
        const kind = f.ruleId.replace('secret.', '').replace('-', ' ');
        deps.notify(`Stack3: a possible ${kind} is staged in ${f.location?.file}${f.location?.line ? `:${f.location.line}` : ''}. Check it before committing. The value is not shown here.`);
      }
    }
  }

  function watch(repo: GitRepository): void {
    const trigger = () => {
      const t = timers.get(repo);
      if (t) clearTimeout(t);
      // A timer must never throw: a quirk in the git API would otherwise become an unhandled rejection in the editor.
      timers.set(repo, setTimeout(() => void check(repo).catch(() => undefined), deps.debounceMs ?? DEBOUNCE_MS));
    };
    subs.push(repo.state.onDidChange(trigger));
    trigger();
  }

  void deps.getGitApi().then((api) => {
    if (!api || disposed) return;
    api.repositories.forEach(watch);
    subs.push(api.onDidOpenRepository(watch));
  }).catch(() => undefined);

  return {
    dispose() {
      disposed = true;
      for (const t of timers.values()) clearTimeout(t);
      for (const s of subs) s.dispose();
    },
  };
}
