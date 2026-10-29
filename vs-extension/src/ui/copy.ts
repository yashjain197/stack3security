import type { Level } from '../engine/types';

// Every user-facing string lives here or in webview/main.ts. None may claim safety (I-15), and nothing is styled green.

export const LEVEL_LABEL: Record<Level, string> = {
  critical: 'Critical risk',
  high: 'High risk',
  caution: 'Caution',
  unknown: 'Could not check fully',
  no_known_issues: 'No known issues found',
};

export const HEADLINE: Record<Level, string> = {
  critical: 'Do not open this folder in VS Code.',
  high: 'Open only with auto-run disabled.',
  caution: 'Review before running anything.',
  unknown: 'Some checks could not be completed, so this result is not complete.',
  no_known_issues: 'No known issues found. This is not a guarantee.',
};

export type ActionName = 'openNeutralized' | 'open' | 'delete' | 'viewFile' | 'copyReport';

export const BUTTON_LABEL: Record<ActionName, string> = {
  openNeutralized: 'Open with auto-run disabled',
  open: 'Open',
  delete: 'Delete clone',
  viewFile: 'View file',
  copyReport: 'Copy report',
};

/** At high and critical, a plain Open is named for what it is. */
export const OPEN_ANYWAY = 'Open anyway';

export const SECTION = {
  findings: 'Findings',
  notChecked: 'Not checked',
  guidance: 'What to do',
  noFindings: 'No findings.',
  more: (n: number) => `${n} more finding${n === 1 ? '' : 's'} not shown. Copy the report for the full list.`,
} as const;

export const CONFIRM = {
  openTitle: (repo: string) => `Open ${repo} anyway?`,
  neutralizedTitle: (repo: string) => `Open ${repo} with auto-run disabled?`,
  openDetail: (label: string, top: string) =>
    `${label}. ${top}\n\nOpening this folder normally can run code from the repository. Stack3 cannot stop it once the folder is open.`,
  neutralizedDetail: (label: string, top: string) =>
    `${label}. ${top}\n\nAuto-run files will be moved aside before the folder opens. The code in the repository is still untrusted.`,
  openButton: OPEN_ANYWAY,
  neutralizedButton: 'Open with auto-run disabled',
} as const;

export const NOTICE = {
  notAvailableYet: 'This action is not available yet.',
  reportCopied: 'Stack3: report copied to the clipboard.',
  fileUnavailable: '[Stack3: this file cannot be shown]',
  fileTruncated: '[Stack3: file truncated at 1 MiB]',
  binary: (bytes: number) => `[Stack3: binary file, ${bytes} bytes, not shown]`,
} as const;

export const EXPLAIN = {
  label: 'AI explanation: may be wrong. The verdict above is decided by rules.',
  pending: 'Generating a plain-language explanation…',
  unavailable: (reason: string) => `Explanation unavailable: ${reason}`,
  fixLead: 'What to do:',
} as const;
