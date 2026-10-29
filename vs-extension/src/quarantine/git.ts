import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { Result } from '../api/client';
import { ensureCloneHelpers, ensureQuarantineRoot, isStrictRepoUrl, QUARANTINE_DIR_NAME, quarantineRoot } from './paths';
import { removeQuarantined } from './remove';

const CLONE_TIMEOUT_MS = 120_000;
const QUICK_TIMEOUT_MS = 15_000;
const MAX_CLONE_BYTES = 500 * 1024 * 1024;
const MAX_ENTRIES = 500_000;
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export interface ExecOptions {
  shell?: false;
  cwd: string;
  timeout: number;
  env: Record<string, string | undefined>;
  maxBuffer?: number;
  killSignal?: NodeJS.Signals;
  windowsHide?: boolean;
}
export type ExecFn = (file: string, args: string[], opts: ExecOptions) => Promise<{ stdout: string; stderr: string }>;

const realExec: ExecFn = (file, args, opts) => promisify(execFile)(file, args, { ...opts, encoding: 'utf8' });

/** First patched release of each series for CVE-2024-32002 and related (D-10, V-9). Later series are all patched. */
const PATCHED_PATCH_LEVEL: Record<number, number> = { 39: 4, 40: 2, 41: 1, 42: 2, 43: 4, 44: 1, 45: 1 };

export function parseGitVersion(output: string): { major: number; minor: number; patch: number } | undefined {
  const m = /(?:^|\s)(\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) } : undefined;
}

export function gitVersionOk(versionOutput: string): boolean {
  const v = parseGitVersion(versionOutput);
  if (!v || v.major < 2) return false;
  if (v.major > 2 || v.minor >= 46) return true;
  const need = PATCHED_PATCH_LEVEL[v.minor];
  return need !== undefined && v.patch >= need;
}

/** The exact argv for the hardened clone (blueprint §2.6). `--` stops the url or destination being read as an option. */
export function buildCloneArgs(url: string, dest: string, hooksDir: string, templateDir: string): string[] {
  return [
    '-c', 'core.symlinks=false', '-c', `core.hooksPath=${hooksDir}`, '-c', 'core.fsmonitor=false',
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'submodule.recurse=false',
    '-c', 'transfer.fsckObjects=true', 'clone', '--depth', '1', '--single-branch',
    '--no-recurse-submodules', `--template=${templateDir}`, '--', url, dest,
  ];
}

// Only what a network call needs. Everything else, and in particular every GIT_* variable, is dropped:
// GIT_CONFIG_COUNT/KEY/VALUE, GIT_SSH_COMMAND, GIT_EXEC_PATH, GIT_ASKPASS and friends can all make git run something.
const PASS_THROUGH = [
  'PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR',
  'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE',
];

export function cloneEnv(base: Record<string, string | undefined>, gitConfig: string, home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of PASS_THROUGH) {
    const v = base[k];
    if (v !== undefined) env[k] = v;
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_LFS_SKIP_SMUDGE: '1',
  };
}

export interface CloneDeps {
  exec?: ExecFn;
  maxBytes?: number;
}

async function treeBytes(dir: string, max: number): Promise<number> {
  let total = 0;
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (++seen > MAX_ENTRIES) return Infinity;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (!e.isSymbolicLink()) total += (await fs.lstat(p)).size;
      if (total > max) return total;
    }
  }
  return total;
}

function describeCloneFailure(e: unknown): string {
  const err = e as { killed?: boolean; signal?: string; stderr?: string };
  if (err.killed || err.signal) return 'Cloning took longer than 2 minutes and was stopped.';
  const text = String(err.stderr ?? '');
  if (/not found|authentication failed|could not read (username|password)|terminal prompts disabled|\b40[134]\b/i.test(text)) {
    return 'Repository not found, or it is private. Only public GitHub repositories can be cloned.';
  }
  if (/could not resolve host|unable to access|connection (refused|timed out|reset)|network is unreachable/i.test(text)) {
    return 'Could not reach GitHub. Check your connection and try again.';
  }
  return 'Cloning failed.';
}

/**
 * Hardened clone into an existing, empty quarantine directory. Returns the commit id, or a short reason.
 * Raw git output is never returned: it can contain paths and URLs.
 */
export async function cloneRepo(url: string, dest: string, deps: CloneDeps = {}): Promise<Result<{ sha: string }>> {
  const exec = deps.exec ?? realExec;
  if (!isStrictRepoUrl(url)) return { ok: false, reason: 'That is not a valid GitHub repository URL.' };

  const root = path.resolve(quarantineRoot());
  const abs = path.resolve(dest);
  if (path.dirname(abs) !== root || !QUARANTINE_DIR_NAME.test(path.basename(abs))) return { ok: false, reason: 'The clone destination is not a quarantine folder.' };

  let helpers;
  try {
    await ensureQuarantineRoot();
    const st = await fs.lstat(abs);
    if (st.isSymbolicLink() || !st.isDirectory() || (await fs.readdir(abs)).length > 0) throw new Error('not an empty directory');
    helpers = await ensureCloneHelpers();
  } catch {
    return { ok: false, reason: 'The quarantine folder is not ready for a clone.' };
  }

  const env = cloneEnv(process.env, helpers.gitConfig, helpers.home);
  const base = { shell: false as const, cwd: root, env, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' as const, windowsHide: true };
  const cleanup = () => removeQuarantined(abs).catch(() => undefined);

  let versionOut: string;
  try {
    versionOut = (await exec('git', ['--version'], { ...base, timeout: QUICK_TIMEOUT_MS })).stdout;
  } catch (e) {
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'Git is not installed or not on PATH.' : 'Could not run git.' };
  }
  if (!gitVersionOk(versionOut)) {
    const v = parseGitVersion(versionOut);
    const found = v ? `${v.major}.${v.minor}.${v.patch}` : 'an unknown version';
    return { ok: false, reason: `Git ${found} is too old to clone safely. Install git 2.45.1 or newer (or a patched 2.39.4, 2.40.2, 2.41.1, 2.42.2, 2.43.4 or 2.44.1).` };
  }

  try {
    await exec('git', buildCloneArgs(url, abs, helpers.hooksDir, helpers.templateDir), { ...base, timeout: CLONE_TIMEOUT_MS });
  } catch (e) {
    await cleanup();
    return { ok: false, reason: describeCloneFailure(e) };
  }

  if ((await treeBytes(abs, deps.maxBytes ?? MAX_CLONE_BYTES).catch(() => Infinity)) > (deps.maxBytes ?? MAX_CLONE_BYTES)) {
    await cleanup();
    return { ok: false, reason: 'The repository is too large to scan (over 500 MB).' };
  }

  // The only other git call, run in our own fresh clone with the same hardening.
  try {
    const sha = (
      await exec('git', ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${helpers.hooksDir}`, '-C', abs, '--no-optional-locks', 'rev-parse', 'HEAD'], { ...base, timeout: QUICK_TIMEOUT_MS })
    ).stdout.trim();
    if (!SHA.test(sha)) throw new Error('not a commit id');
    return { ok: true, value: { sha } };
  } catch {
    await cleanup();
    return { ok: false, reason: 'Could not read the commit id of the clone.' };
  }
}
