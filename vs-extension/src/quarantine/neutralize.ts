import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { resolveQuarantineDir, OutsideQuarantineError } from './remove';

export const DISABLED_DIR = '.stack3-disabled';

// What VS Code reads from a folder the moment it opens: tasks (including folderOpen ones), settings, recommended
// extensions, and the dev-container offer. Moved whether or not a rule flagged them (D-4).
export const AUTO_RUN_ENTRIES = ['.vscode', '.devcontainer', '.devcontainer.json'] as const;

const README = `Stack3 moved these items out of this folder's root before opening it:

${AUTO_RUN_ENTRIES.map((e) => `  ${e}`).join('\n')}

VS Code reads them when a folder opens, and they can start tasks, change settings or offer to run a dev container.
Nothing in this repository has been run by Stack3.

To use them again, review them first, then move them back to the root of this folder.
`;

/**
 * Move the auto-run items of a quarantined clone into .stack3-disabled/ and write a README there. Works whatever the
 * workspace-trust state is, so it does not depend on VS Code's prompts. Returns the new locations.
 *
 * Only a Stack3 quarantine directory is accepted. Items are renamed as they are (a symlink is moved, never followed),
 * and anything the repository itself placed at .stack3-disabled is removed first, since it could redirect the move.
 */
export async function neutralize(dir: string): Promise<string[]> {
  const root = await resolveQuarantineDir(dir);
  if (root === undefined) throw new OutsideQuarantineError(`Not a quarantine folder: ${dir.slice(0, 200)}`);

  const present: string[] = [];
  for (const name of AUTO_RUN_ENTRIES) {
    try {
      await fs.lstat(path.join(root, name));
      present.push(name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  if (present.length === 0) return [];

  const disabled = path.join(root, DISABLED_DIR);
  await fs.rm(disabled, { recursive: true, force: true });
  await fs.mkdir(disabled, { mode: 0o700 });

  const moved: string[] = [];
  for (const name of present) {
    const to = path.join(disabled, name);
    await fs.rename(path.join(root, name), to);
    moved.push(to);
  }
  await fs.writeFile(path.join(disabled, 'README.txt'), README, { mode: 0o600 });
  return moved;
}

/** True when none of the auto-run items remain at the root of the clone. */
export async function isNeutralized(dir: string): Promise<boolean> {
  for (const name of AUTO_RUN_ENTRIES) {
    try {
      await fs.lstat(path.join(dir, name));
      return false;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return false;
    }
  }
  return true;
}
