// The single place the tests spawn real git (eslint exempts only this file and quarantine/git.test.ts).
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildCloneArgs } from '../../src/quarantine/git';

export const hasGit = spawnSync('git', ['--version']).status === 0;

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString();

/** Commit a copy of `src` into a fresh bare repo under `tmp`, and return the bare repo's path. */
export function makeBareRemote(src: string, tmp: string, name = 'remote'): string {
  const work = join(tmp, `${name}-work`);
  mkdirSync(work, { recursive: true });
  cpSync(src, work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '-A');
  git(work, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
  const bare = join(tmp, `${name}.git`);
  git(tmp, 'clone', '-q', '--bare', work, bare);
  return bare;
}

/** The real hardened argv, with only `file` additionally allowed so a local remote can stand in for GitHub. */
export function hardenedLocalClone(bare: string, dest: string, hooksDir: string, templateDir: string): { sha: string } {
  const args = buildCloneArgs(`file://${bare}`, dest, hooksDir, templateDir);
  args.splice(args.indexOf('clone'), 0, '-c', 'protocol.file.allow=always');
  execFileSync('git', args, { env, stdio: 'pipe' });
  return { sha: git(dest, 'rev-parse', 'HEAD').trim() };
}
