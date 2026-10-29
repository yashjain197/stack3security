// Starts a real VS Code with this extension loaded, in a throwaway profile, runs suite.cjs inside its extension
// host, and prints the result. Needs a display (it opens a short-lived window) and `npm run build` first.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
const result = join(scratch, 'result.json');
const tmpForExt = join(scratch, 'tmp');
mkdirSync(tmpForExt);

// The editor's own terminal sets variables that would make Electron behave like plain Node or attach to the running editor.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VSCODE_') && k !== 'ELECTRON_RUN_AS_NODE'));
env.STACK3_RESULT = result;
env.TMPDIR = tmpForExt; // the extension's quarantine folder lands here, not in the real /tmp

const args = [
  `--extensionDevelopmentPath=${extensionRoot}`,
  `--extensionTestsPath=${join(here, 'suite.cjs')}`,
  `--user-data-dir=${join(scratch, 'user-data')}`,
  `--extensions-dir=${join(scratch, 'extensions')}`,
  '--disable-extensions', '--disable-workspace-trust', '--disable-gpu', '--no-sandbox', '--skip-welcome', '--skip-release-notes',
  join(here, 'workspace'),
];
console.log(`VS Code: ${exe}\nprofile: ${scratch}\n`);
const child = spawn(exe, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
const timer = setTimeout(() => { console.error('Timed out after 180 s; killing VS Code.'); child.kill('SIGKILL'); }, 180_000);

child.on('exit', (code) => {
  clearTimeout(timer);
  let rows = [];
  try { rows = JSON.parse(readFileSync(result, 'utf8')); } catch { /* reported below */ }
  for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`);
  if (rows.length === 0) console.error(`No results were written (exit ${code}). VS Code output:\n${log.split('\n').slice(-25).join('\n')}`);
  console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} checks passed (VS Code exit code ${code})`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(rows.length > 0 && rows.every((r) => r.ok) ? 0 : 1);
});
