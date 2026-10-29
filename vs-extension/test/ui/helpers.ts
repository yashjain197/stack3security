import { vi } from 'vitest';
import type { ActionHandlers } from '../../src/ui/bridge';
import type { Finding, Level, Severity } from '../../src/engine/types';
import type { ScanRecord } from '../../src/quarantine/registry';
import { f } from '../engine/helpers';

export const SCAN_ID = 'ab'.repeat(32);

export function makeRec(level: Level, over: Partial<ScanRecord> = {}, findings?: Finding[]): ScanRecord {
  const sev = (level === 'critical' || level === 'high' || level === 'caution' ? level : undefined) as Severity | undefined;
  return {
    scanId: SCAN_ID,
    dir: '/tmp/stack3-quarantine/octo__hello__abcd1234',
    url: 'https://github.com/octo/hello',
    sha: 'c'.repeat(40),
    scanSetHash: 'h'.repeat(8),
    createdAt: 1,
    verdict: {
      level,
      target: { type: 'repo', id: 'github.com/octo/hello@ccccccc' },
      indicators: { addresses: [], domains: [] },
      actions: level === 'no_known_issues' ? [] : ['Review before running'],
      notChecked: level === 'unknown' ? ['Package scan unavailable'] : [],
      findings: findings ?? (sev ? [{ ...f(sev, 'tasks.folder-open'), title: 'Task runs a hidden command', evidence: 'curl x | sh', location: { file: '.vscode/tasks.json', line: 14 } }] : []),
    },
    ...over,
  };
}

export function makeHandlers() {
  const h = {
    openNeutralized: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    viewFile: vi.fn(async () => undefined),
    copyReport: vi.fn(async () => undefined),
  };
  return { h, handlers: h as unknown as ActionHandlers };
}

export const called = (h: ReturnType<typeof makeHandlers>['h']): string[] =>
  (Object.entries(h) as [string, { mock: { calls: unknown[] } }][]).filter(([, fn]) => fn.mock.calls.length > 0).map(([k]) => k);
