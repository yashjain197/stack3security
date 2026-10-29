// Runs INSIDE a real VS Code extension host (started by run.mjs). It drives the real extension through the real API.
const vscode = require('vscode');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_ID = 'stack3.stack3-vscode';
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
