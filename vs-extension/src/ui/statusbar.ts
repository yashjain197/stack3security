import * as vscode from 'vscode';
import { LEVEL_LABEL } from './copy';
import type { Level } from '../engine/types';

const ORDER: Level[] = ['no_known_issues', 'unknown', 'caution', 'high', 'critical'];

export interface StatusBar {
  /** Show the worst level across the open folders, or hide the item when there is nothing to show. */
  update(levels: Level[], detail?: string): void;
  dispose(): void;
}

/**
 * A small status bar item. It uses the editor's own error and warning colors for problems and no color at all when
 * nothing was found: there is no all-clear color and no reassuring wording (I-15).
 */
export function createStatusBar(): StatusBar {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  item.command = 'workbench.actions.view.problems';
  return {
    update(levels, detail) {
      if (levels.length === 0) {
        item.hide();
        return;
      }
      const worst = levels.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a));
      item.text = `$(shield) Stack3: ${LEVEL_LABEL[worst]}`;
      item.tooltip = detail ? `${LEVEL_LABEL[worst]}\n${detail}` : LEVEL_LABEL[worst];
      item.backgroundColor =
        worst === 'critical' || worst === 'high'
          ? new vscode.ThemeColor('statusBarItem.errorBackground')
          : worst === 'caution' || worst === 'unknown'
            ? new vscode.ThemeColor('statusBarItem.warningBackground')
            : undefined;
      item.show();
    },
    dispose: () => item.dispose(),
  };
}
