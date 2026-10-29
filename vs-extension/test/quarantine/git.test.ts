import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCloneArgs, cloneEnv, cloneRepo, gitVersionOk, type ExecFn } from '../../src/quarantine/git';
import { createQuarantineDir, quarantineRoot } from '../../src/quarantine/paths';

const U = 'https://github.com/octo/hello';
const D = '/tmp/q/octo__hello__abcd1234';
const H = '/tmp/q/.empty-hooks';
const T = '/tmp/q/.empty-template';
const SHA = 'a'.repeat(40);

let tmp: string;
let prevTmp: string | undefined;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'stack3-qtest-'));
  prevTmp = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
});
afterEach(() => {
  if (prevTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = prevTmp;
});

describe('buildCloneArgs', () => {
  test('exact argv', () => {
    expect(buildCloneArgs(U, D, H, T)).toEqual([
      '-c', 'core.symlinks=false', '-c', `core.hooksPath=${H}`, '-c', 'core.fsmonitor=false',
      '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'submodule.recurse=false',
      '-c', 'transfer.fsckObjects=true', 'clone', '--depth', '1', '--single-branch',
      '--no-recurse-submodules', `--template=${T}`, '--', U, D,
    ]);
  });
  test('the url and destination come after "--", so they can never be read as options', () => {
    const args = buildCloneArgs('--upload-pack=x', '-dest', H, T);
    expect(args.slice(args.indexOf('--'))).toEqual(['--', '--upload-pack=x', '-dest']);
  });
});

describe('cloneEnv: spawn env scrubbed', () => {
  const hostile = {
    PATH: '/usr/bin', HOME: '/home/me', HTTPS_PROXY: 'http://proxy:3128', SSL_CERT_FILE: '/etc/ca.pem',
    GIT_ASKPASS: '/bin/evil', SSH_ASKPASS: '/bin/evil', GIT_SSH_COMMAND: 'evil', GIT_PROXY_COMMAND: 'evil', GIT_EXEC_PATH: '/evil',
    GIT_DIR: '/evil', GIT_WORK_TREE: '/evil', GIT_TEMPLATE_DIR: '/evil', GIT_CONFIG_PARAMETERS: "'core.pager=evil'",
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.editor', GIT_CONFIG_VALUE_0: 'evil', GIT_EXTERNAL_DIFF: 'evil',
    LD_PRELOAD: '/evil.so', DYLD_INSERT_LIBRARIES: '/evil', NODE_OPTIONS: '--require /evil.js', GITHUB_TOKEN: 'ghp_secret', npm_config_x: 'y',
  };
  const env = cloneEnv(hostile, '/tmp/q/.empty-gitconfig', '/tmp/q/.empty-home');
  test('sets the hardening variables', () => {
    expect(env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/tmp/q/.empty-gitconfig', GIT_LFS_SKIP_SMUDGE: '1', HOME: '/tmp/q/.empty-home' });
  });
  test('drops everything git could be steered by, and every secret', () => {
    for (const k of ['GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_SSH_COMMAND', 'GIT_PROXY_COMMAND', 'GIT_EXEC_PATH', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_TEMPLATE_DIR',
      'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_EXTERNAL_DIFF', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES',
      'NODE_OPTIONS', 'GITHUB_TOKEN', 'npm_config_x']) expect(env, k).not.toHaveProperty(k);
  });
  test('keeps what a network call needs: PATH, proxy and CA settings', () => {
    expect(env).toMatchObject({ PATH: '/usr/bin', HTTPS_PROXY: 'http://proxy:3128', SSL_CERT_FILE: '/etc/ca.pem' });
  });
  test('the user HOME is never passed through', () => expect(env.HOME).not.toBe('/home/me'));
});

describe('gitVersionOk (D-10, V-9)', () => {
  test.each([
    ['git version 2.39.0', false], ['git version 2.39.3', false], ['git version 2.39.4', true],
    ['git version 2.40.1', false], ['git version 2.40.2', true],
    ['git version 2.41.0', false], ['git version 2.41.1', true],
    ['git version 2.42.1', false], ['git version 2.42.2', true],
    ['git version 2.43.0', false], ['git version 2.43.3', false], ['git version 2.43.4', true],
    ['git version 2.44.0', false], ['git version 2.44.1', true], ['git version 2.44.4', true],
    ['git version 2.45.0', false], ['git version 2.45.1', true], ['git version 2.45.2', true],
    ['git version 2.46.0', true], ['git version 2.47.1', true], ['git version 2.100.0', true], ['git version 3.0.0', true],
    ['git version 2.38.5', false], ['git version 2.30.0', false], ['git version 1.9.0', false],
    ['git version 2.47.1.windows.1', true], ['git version 2.39.5 (Apple Git-154)', true], ['git version 2.43.0 (Apple Git-9)', false],
    ['git version 2.45', false], ['git version 2.46', true],
    ['', false], ['git: command not found', false], ['git version dev', false], ['2.47.1', true],
  ])('%j → %s', (out, expected) => expect(gitVersionOk(out)).toBe(expected));
});

describe('cloneRepo with an injected exec', () => {
  interface Call { file: string; args: string[]; opts: { shell?: boolean; cwd?: string; timeout?: number; env?: Record<string, string | undefined> } }
  function fakeExec(handler: (c: Call) => { stdout?: string; stderr?: string } | Error): { exec: ExecFn; calls: Call[] } {
    const calls: Call[] = [];
    const exec: ExecFn = async (file, args, opts) => {
      const call = { file, args, opts: opts as Call['opts'] };
      calls.push(call);
      const r = handler(call);
      if (r instanceof Error) throw r;
      return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    return { exec, calls };
  }
  const happy = (c: Call) => (c.args.includes('--version') ? { stdout: 'git version 2.47.1\n' } : c.args.includes('rev-parse') ? { stdout: `${SHA}\n` } : {});

  test('runs --version, the hardened clone, then rev-parse, and returns the sha', async () => {
    const dest = await createQuarantineDir('octo', 'hello');
    const { exec, calls } = fakeExec(happy);
    expect(await cloneRepo(U, dest, { exec })).toEqual({ ok: true, value: { sha: SHA } });
    expect(calls.map((c) => c.args.find((a) => ['--version', 'clone', 'rev-parse'].includes(a)))).toEqual(['--version', 'clone', 'rev-parse']);
    const clone = calls[1]!;
    expect(clone.file).toBe('git');
    expect(clone.args.slice(-3)).toEqual(['--', U, dest]);
    expect(clone.args).toContain('protocol.allow=never');
  });
  test('every spawn: no shell, cwd in the quarantine root, scrubbed env; the clone has a 120 s timeout', async () => {
    const dest = await createQuarantineDir('octo', 'hello');
    const { exec, calls } = fakeExec(happy);
    await cloneRepo(U, dest, { exec });
    for (const c of calls) {
      expect(c.opts.shell).toBe(false);
      expect(c.opts.cwd).toBe(quarantineRoot());
      expect(c.opts.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_LFS_SKIP_SMUDGE: '1' });
      expect(c.opts.env).not.toHaveProperty('GIT_ASKPASS');
      expect(c.opts.timeout).toBeGreaterThan(0);
    }
    expect(calls[1]!.opts.timeout).toBe(120_000);
  });
  test('the hooks/template/config helpers are empty and live inside the quarantine root', async () => {
    const dest = await createQuarantineDir('octo', 'hello');
    const { exec, calls } = fakeExec(happy);
    await cloneRepo(U, dest, { exec });
    const hooks = calls[1]!.args.find((a) => a.startsWith('core.hooksPath='))!.split('=')[1]!;
    const template = calls[1]!.args.find((a) => a.startsWith('--template='))!.split('=')[1]!;
    for (const p of [hooks, template, calls[1]!.opts.env!.GIT_CONFIG_GLOBAL!]) {
      expect(p.startsWith(quarantineRoot())).toBe(true);
      expect(existsSync(p)).toBe(true);
    }
    expect(readdirSync(hooks)).toEqual([]);
    expect(readdirSync(template)).toEqual([]);
    expect(readFileSync(calls[1]!.opts.env!.GIT_CONFIG_GLOBAL!, 'utf8')).toBe('');
  });
  test('git too old → refused with an actionable message; clone is never run', async () => {
    const dest = await createQuarantineDir('octo', 'hello');
    const { exec, calls } = fakeExec(() => ({ stdout: 'git version 2.43.0\n' }));
    const r = await cloneRepo(U, dest, { exec });
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/2\.43\.0/);
    expect((r as { reason: string }).reason).toMatch(/2\.45\.1/);
    expect(calls).toHaveLength(1);
  });
  test('git missing → a clear failure', async () => {
    const dest = await createQuarantineDir('octo', 'hello');
    const { exec } = fakeExec(() => Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
    expect(await cloneRepo(U, dest, { exec })).toEqual({ ok: false, reason: 'Git is not installed or not on PATH.' });
  });
  test('a url that is not the strict github form never reaches git', async () => {
    const dest = await createQuarantineDir('octo', 'hello');
    for (const bad of ['--upload-pack=x', 'file:///etc/passwd', 'https://github.com/o/../r', 'https://evil.example/o/r', 'ext::sh']) {
      const { exec, calls } = fakeExec(happy);
      expect(await cloneRepo(bad, dest, { exec })).toMatchObject({ ok: false });
      expect(calls).toHaveLength(0);
    }
  });
  test('a destination outside the quarantine root, or the root itself, is refused', async () => {
    await createQuarantineDir('octo', 'hello');
    for (const bad of [join(tmp, 'elsewhere'), quarantineRoot(), join(quarantineRoot(), '..', 'x'), '/etc']) {
      const { exec, calls } = fakeExec(happy);
      expect(await cloneRepo(U, bad, { exec })).toMatchObject({ ok: false });
      expect(calls).toHaveLength(0);
    }
  });
  test('clone failure → ok:false with a short message, no raw stderr, and the half-made dir is removed', async () => {
    const dest = await createQuarantineDir('octo', 'hello');
    const { exec } = fakeExec((c) => (c.args.includes('--version') ? { stdout: 'git version 2.47.1' } : Object.assign(new Error('Command failed'), { stderr: "fatal: repository 'https://github.com/octo/hello/' not found\n/home/me/secret/path" })));
    const r = await cloneRepo(U, dest, { exec });
    expect(r).toEqual({ ok: false, reason: 'Repository not found, or it is private. Only public GitHub repositories can be cloned.' });
    expect(existsSync(dest)).toBe(false);
  });
  test('timeout → a timeout message and cleanup', async () => {
    const dest = await createQuarantineDir('octo', 'hello');
    const { exec } = fakeExec((c) => (c.args.includes('--version') ? { stdout: 'git version 2.47.1' } : Object.assign(new Error('timed out'), { killed: true, signal: 'SIGKILL' })));
    const r = await cloneRepo(U, dest, { exec });
    expect(r).toEqual({ ok: false, reason: 'Cloning took longer than 2 minutes and was stopped.' });
    expect(existsSync(dest)).toBe(false);
  });
  test('a clone over the size cap is removed', async () => {
    const dest = await createQuarantineDir('octo', 'hello');
    const { exec } = fakeExec((c) => {
      if (c.args.includes('clone')) writeFileSync(join(dest, 'big.bin'), Buffer.alloc(5000));
      return happy(c);
    });
    const r = await cloneRepo(U, dest, { exec, maxBytes: 1000 });
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/too large/i);
    expect(existsSync(dest)).toBe(false);
  });
  test('rev-parse output that is not a commit id is a failure', async () => {
    const dest = await createQuarantineDir('octo', 'hello');
    const { exec } = fakeExec((c) => (c.args.includes('rev-parse') ? { stdout: '--upload-pack=x\n' } : happy(c)));
    expect(await cloneRepo(U, dest, { exec })).toMatchObject({ ok: false });
  });
});

// Real git. These prove the argv does what the unit tests assume it does.
const hasGit = spawnSync('git', ['--version']).status === 0;
describe.skipIf(!hasGit)('real git against a local fixture remote', () => {
  const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, stdio: 'pipe' }).toString();

  function fixtureRemote(): string {
    const work = join(tmp, 'work');
    mkdirSync(work);
    sh(work, 'init', '-q', '-b', 'main');
    writeFileSync(join(work, 'README.md'), 'hi');
    writeFileSync(join(work, 'target.txt'), 'real');
    symlinkSync('/etc/hostname', join(work, 'link-out'));
    mkdirSync(join(work, '.githooks'));
    writeFileSync(join(work, '.githooks', 'post-checkout'), '#!/bin/sh\ntouch "$HOME/stack3-hook-ran"\n', { mode: 0o755 });
    sh(work, 'add', '-A');
    sh(work, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    const bare = join(tmp, 'remote.git');
    sh(tmp, 'clone', '-q', '--bare', work, bare);
    return bare;
  }

  test('a file:// remote is REFUSED by the hardened argv (protocol.allow=never works)', () => {
    const bare = fixtureRemote();
    const dest = join(tmp, 'dest');
    const r = spawnSync('git', buildCloneArgs(`file://${bare}`, dest, join(tmp, 'h'), join(tmp, 't')), { env: gitEnv, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/transport 'file' not allowed|protocol/i);
    expect(existsSync(join(dest, 'README.md'))).toBe(false);
  });
  test('when file is explicitly allowed for the test: no hooks are installed and symlinks arrive as plain files', () => {
    const bare = fixtureRemote();
    const dest = join(tmp, 'dest');
    const hooks = join(tmp, 'h');
    const template = join(tmp, 't');
    mkdirSync(hooks);
    mkdirSync(template);
    const args = buildCloneArgs(`file://${bare}`, dest, hooks, template);
    args.splice(args.indexOf('clone'), 0, '-c', 'protocol.file.allow=always');
    const r = spawnSync('git', args, { env: gitEnv, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dest, 'README.md'), 'utf8')).toBe('hi');
    const st = lstatSync(join(dest, 'link-out'));
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.isFile()).toBe(true);
    expect(readFileSync(join(dest, 'link-out'), 'utf8')).toBe('/etc/hostname');
    const installed = existsSync(join(dest, '.git', 'hooks')) ? readdirSync(join(dest, '.git', 'hooks')).filter((n) => !n.endsWith('.sample')) : [];
    expect(installed).toEqual([]);
    expect(existsSync(join(process.env.HOME ?? '/nonexistent', 'stack3-hook-ran'))).toBe(false);
    // `-c` before `clone` applies to that one process only, so nothing is saved in the clone's config. The
    // follow-up rev-parse therefore passes its own hardening flags (see cloneRepo).
    expect(() => sh(dest, 'config', '--local', '--get', 'core.hooksPath')).toThrow();
  });
});
