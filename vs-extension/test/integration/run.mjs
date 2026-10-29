// Starts a real VS Code with this extension loaded, in a throwaway profile, runs suite.cjs inside its extension
// host, and prints the result. Needs a display (it opens a short-lived window) and `npm run build` first.
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '../..');
const candidates = [process.env.VSCODE_EXECUTABLE, '/snap/code/current/usr/share/code/code', '/usr/share/code/code', '/opt/visual-studio-code/code'].filter(Boolean);
const exe = candidates.find((p) => existsSync(p));
if (!exe) {
  console.error('No VS Code executable found. Set VSCODE_EXECUTABLE to the Electron binary (e.g. /usr/share/code/code).');
  process.exit(2);
}
if (!existsSync(join(extensionRoot, 'dist/extension.js'))) {
  console.error('dist/extension.js is missing. Run `npm run build` first.');
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), 'stack3-it-'));
// The window opens a scratch COPY of the workspace, so tests can create and delete files without touching the repo.
const workspaceDir = join(scratch, 'workspace');
cpSync(join(here, 'workspace'), workspaceDir, { recursive: true });
const result = join(scratch, 'result.json');
const tmpForExt = join(scratch, 'tmp');
mkdirSync(tmpForExt);

// The editor's own terminal sets variables that would make Electron behave like plain Node or attach to the running editor.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VSCODE_') && k !== 'ELECTRON_RUN_AS_NODE'));
env.STACK3_RESULT = result;
env.TMPDIR = tmpForExt; // the extension's quarantine folder lands here, not in the real /tmp

// `node run.mjs` runs suite.cjs against the real extension. `node run.mjs webview-xss` runs webview-xss.cjs against a
// test-only extension that opens the real verdict panel with hostile text.
const suite = process.argv[2] ?? 'suite';
if (!/^[a-z0-9-]+$/.test(suite) || !existsSync(join(here, `${suite}.cjs`))) {
  console.error(`Unknown suite "${suite}".`);
  process.exit(2);
}
let devPath = extensionRoot;
const needsTestExtension = suite === 'webview-xss' || suite === 'open-canary';
if (needsTestExtension) {
  devPath = join(scratch, 'xss-ext');
  mkdirSync(devPath);
  await build({ entryPoints: [join(here, 'xss-ext/entry.ts')], outfile: join(devPath, 'extension.js'), bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], mainFields: ['module', 'main'], logLevel: 'silent' });
  writeFileSync(join(devPath, 'package.json'), JSON.stringify({ name: 'stack3-test', publisher: 'stack3test', version: '0.0.0', engines: { vscode: '^1.90.0' }, main: './extension.js', activationEvents: ['onStartupFinished'], contributes: { commands: [{ command: 'stack3test.showHostile', title: 'Stack3 test: show hostile verdict' }] } }));
  env.STACK3_WEBVIEW_ROOT = join(extensionRoot, 'dist/webview');
  env.STACK3_CANARY_FIXTURE = join(extensionRoot, 'test/fixtures/repos/canary-open');
  if (!existsSync(join(env.STACK3_WEBVIEW_ROOT, 'main.js'))) {
    console.error('dist/webview is missing. Run `npm run build` first.');
    process.exit(2);
  }
}

const args = [
  `--extensionDevelopmentPath=${devPath}`,
  `--extensionTestsPath=${join(here, `${suite}.cjs`)}`,
  `--user-data-dir=${join(scratch, 'user-data')}`,
  `--extensions-dir=${join(scratch, 'extensions')}`,
  '--disable-extensions', '--disable-workspace-trust', '--disable-gpu', '--no-sandbox', '--skip-welcome', '--skip-release-notes',
  workspaceDir,
];
console.log(`VS Code: ${exe}\nprofile: ${scratch}\n`);
// Folders the test asks to have opened (see xss-ext/entry.ts). Each is opened in its OWN VS Code instance and profile,
// because every window of the test instance would inherit the test runner. The profile's user settings choose whether
// automatic tasks are on or off, exactly where the user-level setting lives.
const requests = join(scratch, 'open-requests.txt');
writeFileSync(requests, '');
env.STACK3_OPEN_REQUESTS = requests;
let handled = 0;
const launched = [];
const requestWatcher = setInterval(() => {
  const lines = readFileSync(requests, 'utf8').split('\n').filter(Boolean);
  for (const line of lines.slice(handled)) {
    const [setting, dir] = line.split('\t');
    if (!['on', 'off'].includes(setting) || !dir) continue;
    const ud = join(scratch, `profile-${launched.length}`);
    mkdirSync(join(ud, 'User'), { recursive: true });
    writeFileSync(join(ud, 'User/settings.json'), JSON.stringify({ 'task.allowAutomaticTasks': setting, 'security.workspace.trust.enabled': false, 'window.restoreWindows': 'none', 'telemetry.telemetryLevel': 'off', 'update.mode': 'none' }));
    console.log(`opening ${dir} in its own VS Code (task.allowAutomaticTasks=${setting})`);
    const p = spawn(exe, [`--user-data-dir=${ud}`, `--extensions-dir=${join(scratch, 'extensions')}`, '--disable-extensions', '--disable-workspace-trust', '--disable-gpu', '--no-sandbox', '--new-window', dir], { env: { ...env, STACK3_OPEN_REQUESTS: undefined }, stdio: 'ignore', detached: true });
    p.unref();
    launched.push(p.pid);
  }
  handled = lines.length;
}, 300);

const child = spawn(exe, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const killGroup = (sig) => { for (const pid of [child.pid, ...launched]) { try { process.kill(-pid, sig); } catch { /* already gone */ } } };
// Windows opened by the tests can keep VS Code alive after the run: stop it once results are written.
const watcher = setInterval(() => { if (existsSync(result)) { clearInterval(watcher); setTimeout(() => killGroup('SIGTERM'), 4000); setTimeout(() => killGroup('SIGKILL'), 9000); } }, 500);
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
const timer = setTimeout(() => { console.error('Timed out after 240 s; killing VS Code.'); killGroup('SIGKILL'); }, 240_000);

child.on('exit', (code) => {
  clearTimeout(timer);
  clearInterval(watcher);
  clearInterval(requestWatcher);
  killGroup('SIGKILL');
  let rows = [];
  try { rows = JSON.parse(readFileSync(result, 'utf8')); } catch { /* reported below */ }
  for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`);
  if (rows.length === 0) console.error(`No results were written (exit ${code}). VS Code output:\n${log.split('\n').slice(-25).join('\n')}`);
  console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} checks passed (VS Code exit code ${code})`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(rows.length > 0 && rows.every((r) => r.ok) ? 0 : 1);
});
