import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** `<owner>__<repo>__<8 hex>`: the only names this extension ever creates, and the only ones it will delete. */
export const QUARANTINE_DIR_NAME = /^[A-Za-z0-9-]{1,39}__[A-Za-z0-9._-]{1,100}__[0-9a-f]{8}$/;

const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const STRICT_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(\.git)?\/?$/;
const MAX_INPUT = 300;

// GitHub pages a pasted URL may legitimately point into. Anything else under owner/repo is not a repository URL.
const REPO_SUBPATHS = new Set([
  'tree', 'blob', 'blame', 'raw', 'commit', 'commits', 'pull', 'pulls', 'issues', 'releases', 'tags', 'branches', 'compare',
  'actions', 'wiki', 'discussions', 'projects', 'security', 'pulse', 'graphs', 'network', 'forks', 'stargazers', 'watchers',
]);

const USAGE = 'Enter a public GitHub repository URL like https://github.com/owner/repo.';

export const isStrictRepoUrl = (url: string): boolean => STRICT_URL.test(url);
export const isValidOwner = (s: string): boolean => OWNER.test(s) && !s.startsWith('-');
export const isValidRepo = (s: string): boolean => REPO.test(s) && !s.startsWith('-') && s !== '.' && !s.includes('..');

/**
 * Turn what a person pastes into `https://github.com/<owner>/<repo>`, or say why not (Review Focus 1).
 * The result is the only thing ever passed to git, and it is re-checked against the strict regex.
 */
export function validateRepoUrl(input: string): { owner: string; repo: string; url: string } | { error: string } {
  const fail = (error: string = USAGE) => ({ error });
  if (typeof input !== 'string') return fail();
  const s = input.trim();
  if (!s) return fail();
  if (s.length > MAX_INPUT) return fail('That URL is too long. ' + USAGE);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Whitespace, control and non-ASCII characters (look-alike letters) cannot appear in a GitHub URL.
    if (c <= 0x20 || c >= 0x7f) return fail('The URL contains spaces or unusual characters. ' + USAGE);
  }
  if (s.startsWith('-') || s.includes('..') || s.includes('%') || s.includes('\\')) return fail();

  const scp = /^git@github\.com:(.+)$/i.exec(s);
  const web = scp ? null : /^(?:https?:\/\/|ssh:\/\/git@)?(?:www\.)?github\.com\/(.+)$/i.exec(s);
  const rest = scp?.[1] ?? web?.[1];
  if (rest === undefined) return fail('Only public GitHub repositories are supported. ' + USAGE);

  const segments = (rest.split(/[?#]/)[0] ?? '').split('/');
  if (segments.at(-1) === '') segments.pop();
  if (segments.length < 2 || segments.some((x) => x === '')) return fail();
  const [owner = '', repoRaw = '', ...extra] = segments;
  if (extra.length > 0 && (scp || !REPO_SUBPATHS.has((extra[0] ?? '').toLowerCase()))) return fail('That is not a repository URL. ' + USAGE);

  const repo = repoRaw.endsWith('.git') ? repoRaw.slice(0, -4) : repoRaw;
  if (repo.endsWith('.git') || !isValidOwner(owner) || !isValidRepo(repo)) return fail();
  const url = `https://github.com/${owner}/${repo}`;
  return STRICT_URL.test(url) ? { owner, repo, url } : fail();
}

export function quarantineRoot(): string {
  return path.join(os.tmpdir(), 'stack3-quarantine');
}

/**
 * Create the root if needed and refuse to use one we do not fully own: a symlink, a non-directory, or
 * another user's folder in a shared temp dir would let someone else steer where clones and deletes happen.
 */
export async function ensureQuarantineRoot(): Promise<string> {
  const root = quarantineRoot();
  try {
    await fs.mkdir(root, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  const st = await fs.lstat(root);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('The quarantine folder is not a normal folder, so Stack3 will not use it.');
  if (process.platform !== 'win32') {
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Error('The quarantine folder belongs to another user, so Stack3 will not use it.');
    if ((st.mode & 0o777) !== 0o700) await fs.chmod(root, 0o700);
  }
  return root;
}

export async function createQuarantineDir(owner: string, repo: string): Promise<string> {
  if (!isValidOwner(owner) || !isValidRepo(repo)) throw new Error('Invalid repository name.');
  const root = await ensureQuarantineRoot();
  for (let attempt = 0; attempt < 5; attempt++) {
    const dir = path.join(root, `${owner}__${repo}__${randomBytes(4).toString('hex')}`);
    try {
      await fs.mkdir(dir, { mode: 0o700 });
      if (process.platform !== 'win32') await fs.chmod(dir, 0o700); // mkdir's mode is masked by umask
      return dir;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  throw new Error('Could not create a quarantine folder.');
}

export interface CloneHelpers {
  hooksDir: string;
  templateDir: string;
  home: string;
  gitConfig: string;
}

async function emptyDir(root: string, name: string): Promise<string> {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  for (const entry of await fs.readdir(dir)) await fs.rm(path.join(dir, entry), { recursive: true, force: true });
  return dir;
}

/** Empty hooks/template/HOME dirs and an empty global config, all inside the quarantine root, so git reads nothing of the user's. */
export async function ensureCloneHelpers(): Promise<CloneHelpers> {
  const root = await ensureQuarantineRoot();
  const gitConfig = path.join(root, '.empty-gitconfig');
  await fs.writeFile(gitConfig, '', { mode: 0o600 });
  return {
    hooksDir: await emptyDir(root, '.empty-hooks'),
    templateDir: await emptyDir(root, '.empty-template'),
    home: await emptyDir(root, '.empty-home'),
    gitConfig,
  };
}
