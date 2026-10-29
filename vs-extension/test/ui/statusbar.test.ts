import { beforeEach, describe, expect, test } from 'vitest';
import { createStatusBar } from '../../src/ui/statusbar';
import { __guard, __reset } from '../mocks/vscode';

beforeEach(() => __reset());
const item = () => __guard.statusItems[0]!;

describe('status bar', () => {
  test('is hidden until there is something to show, and opens the Problems view when clicked', () => {
    const sb = createStatusBar();
    expect(item().visible).toBe(false);
    expect(item().command).toBe('workbench.actions.view.problems');
    sb.update([]);
    expect(item().visible).toBe(false);
  });
  test('shows the worst level across folders', () => {
    const sb = createStatusBar();
    sb.update(['no_known_issues', 'critical', 'caution']);
    expect(item().visible).toBe(true);
    expect(item().text).toBe('$(shield) Stack3: Critical risk');
  });
  test.each([
    ['critical', 'statusBarItem.errorBackground'],
    ['high', 'statusBarItem.errorBackground'],
    ['caution', 'statusBarItem.warningBackground'],
    ['unknown', 'statusBarItem.warningBackground'],
  ] as const)('%s uses the editor\'s own problem color', (level, color) => {
    createStatusBar().update([level]);
    expect(item().backgroundColor?.id).toBe(color);
  });
  test('"no known issues" has no color at all and says it is not a guarantee in the tooltip only if given', () => {
    createStatusBar().update(['no_known_issues']);
    expect(item().backgroundColor).toBeUndefined();
    expect(item().text).toBe('$(shield) Stack3: No known issues found');
  });
  test('the color is cleared again when the level improves', () => {
    const sb = createStatusBar();
    sb.update(['critical']);
    sb.update(['no_known_issues']);
    expect(item().backgroundColor).toBeUndefined();
  });
  test('no wording says "safe", and nothing uses a green theme color', () => {
    const sb = createStatusBar();
    for (const l of ['critical', 'high', 'caution', 'unknown', 'no_known_issues'] as const) {
      sb.update([l], 'detail');
      expect(`${item().text} ${item().tooltip}`).not.toMatch(/\bsafe\b/i);
      expect(item().backgroundColor?.id ?? '').not.toMatch(/green|success|testing\.iconPassed/i);
    }
  });
  test('disposes the item', () => {
    createStatusBar().dispose();
    expect(item().disposed).toBe(true);
  });
});
