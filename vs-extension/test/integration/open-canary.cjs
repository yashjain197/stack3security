// Runs INSIDE a real VS Code. Opens real windows on copies of a repo whose folderOpen task creates "<folder>.ran".
//  1. CONTROL   a raw copy, automatic tasks on        -> the marker MUST appear, or nothing below means anything
//  2. STACK3    the same repo via the real "open with auto-run disabled" handler -> the marker must NOT appear
//  3. V-4       a raw copy in a profile whose USER setting task.allowAutomaticTasks = off (what we offer) -> must NOT run
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const results = [];
const record = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: detail === undefined ? '' : String(detail) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms, step = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await wait(step);
  }
  return cond();
}

async function run() {
  try {
    const fixture = process.env.STACK3_CANARY_FIXTURE;
    // Each folder opens in its own VS Code instance (profile) whose user setting task.allowAutomaticTasks is given here.
    const control = await vscode.commands.executeCommand('stack3test.openCanary', fixture, 'raw', 'on');
    const stack3 = await vscode.commands.executeCommand('stack3test.openCanary', fixture, 'neutralized', 'on');

    const controlRan = await until(() => fs.existsSync(control.marker), 60_000);
    record('CONTROL: an un-neutralized copy runs its folderOpen task (the canary mechanism works)', controlRan, control.marker);
    if (!controlRan) {
      record('cannot conclude: the control never ran, so a missing marker proves nothing', false);
    } else {
      await wait(10_000); // give the neutralized window the same chance to run its task, and then some
      record('STACK3: the neutralized copy did NOT run its task (marker absent)', !fs.existsSync(stack3.marker), stack3.marker);
      const disabled = path.join(stack3.dir, '.stack3-disabled');
      record('STACK3: .vscode is gone from the root', !fs.existsSync(path.join(stack3.dir, '.vscode')));
      record('STACK3: the task file is preserved under .stack3-disabled', fs.existsSync(path.join(disabled, '.vscode', 'tasks.json')));
      record('STACK3: a README explains it', fs.existsSync(path.join(disabled, 'README.txt')));
      record('STACK3: the rest of the repo is untouched', fs.existsSync(path.join(stack3.dir, 'package.json')) && fs.existsSync(path.join(stack3.dir, 'README.md')));

      // V-4: the user-level setting we offer to change really stops folderOpen tasks.
      const off = await vscode.commands.executeCommand('stack3test.openCanary', fixture, 'raw', 'off');
      await wait(20_000);
      record('V-4: with task.allowAutomaticTasks = off (user scope) a raw copy does NOT run its task', !fs.existsSync(off.marker), off.marker);
    }
  } catch (e) {
    record('suite crashed', false, e && e.stack ? e.stack : e);
  }
  fs.writeFileSync(process.env.STACK3_RESULT, JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) throw new Error('open-canary checks failed; see ' + process.env.STACK3_RESULT);
}

module.exports = { run };
