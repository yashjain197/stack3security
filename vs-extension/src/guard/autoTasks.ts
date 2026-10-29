import * as vscode from 'vscode';

export const PROMPTED_KEY = 'stack3.autoTaskPrompted';
const TURN_OFF = 'Turn off automatic tasks';
const NOT_NOW = 'Not now';

/**
 * D-7: offer, once, to set VS Code's `task.allowAutomaticTasks` to "off" for the user. A folder can declare tasks that
 * run the moment it opens; this stops that for every folder, not only the ones Stack3 neutralizes.
 *
 * The user's settings change only if they choose to. The question is asked at most once whatever the answer, and the
 * flag is set before asking so even a crash or a dismissed dialog cannot make it nag.
 */
export async function maybeOfferAutoTaskGuard(ctx: Pick<vscode.ExtensionContext, 'globalState'>): Promise<void> {
  if (ctx.globalState.get<boolean>(PROMPTED_KEY, false)) return;
  await ctx.globalState.update(PROMPTED_KEY, true);

  const config = vscode.workspace.getConfiguration('task');
  if (config.inspect<string>('allowAutomaticTasks')?.globalValue === 'off') return; // already how they want it

  const answer = await vscode.window.showInformationMessage(
    'Stack3: turn off automatic tasks in VS Code?',
    {
      modal: true,
      detail:
        'A project can contain tasks that start by themselves when you open its folder. Stack3 can set the VS Code setting "task.allowAutomaticTasks" to "off" for you, so that no folder can do this.\n\nYou can change it back any time in Settings. Stack3 asks only once.',
    },
    TURN_OFF,
    NOT_NOW,
  );
  if (answer !== TURN_OFF) return;

  try {
    await config.update('allowAutomaticTasks', 'off', vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage('Stack3: automatic tasks are now off. You can change this in Settings (task.allowAutomaticTasks).');
  } catch {
    void vscode.window.showErrorMessage('Stack3: could not change the setting. You can set task.allowAutomaticTasks to "off" in Settings.');
  }
}
