import type { Registry, ScanRecord } from '../quarantine/registry';
import { isNeutralized } from '../quarantine/neutralize';
import type { ActionHandlers } from '../ui/bridge';

export interface ActionDeps {
  registry: Pick<Registry, 'get' | 'remove' | 'markOpened'>;
  /** sha-256 of the clone's auto-run surface, as at scan time. */
  hash(dir: string): Promise<string>;
  /** Scan the clone again and show the new verdict (nothing is opened). */
  rescan(rec: ScanRecord): Promise<unknown>;
  /** Throws unless `dir` is a Stack3 quarantine directory; returns its real path. */
  checkDir(dir: string): Promise<string>;
  neutralize(dir: string): Promise<string[]>;
  openFolder(dir: string): PromiseLike<unknown>;
  removeDir(dir: string): Promise<void>;
  closePanel(scanId: string): void;
  /** The one-time automatic-tasks offer. Asked before the first folder is opened. */
  offerAutoTaskGuard(): Promise<void>;
  viewFile(rec: ScanRecord, file: string): Promise<void>;
  copyReport(rec: ScanRecord): Promise<void>;
  info(message: string): void;
  error(message: string): void;
}

/** The effects behind the verdict panel's buttons. The bridge has already validated and authorised the request. */
export function createActionHandlers(deps: ActionDeps): ActionHandlers {
  const running = new Set<string>();

  // One run per scan at a time: a double click must not open two windows or move files twice.
  const once = (action: string, fn: (rec: ScanRecord) => Promise<void>) => async (rec: ScanRecord) => {
    const key = `${rec.scanId}:${action}`;
    if (running.has(key)) return;
    running.add(key);
    try {
      await fn(rec);
    } finally {
      running.delete(key);
    }
  };

  const openClone = (mode: 'plain' | 'neutralized') =>
    once(`open-${mode}`, async (rec) => {
      const current = deps.registry.get(rec.scanId);
      if (!current || current.sha !== rec.sha) return deps.error('This scan is no longer available. Clone the repository again.');

      let dir: string;
      try {
        dir = await deps.checkDir(current.dir);
      } catch {
        return deps.error('This folder is not a Stack3 quarantine folder, so it was not opened.');
      }

      // TOCTOU: the files must still be exactly what was scanned. If not, scan again and open nothing.
      if ((await deps.hash(dir)) !== current.scanSetHash) {
        deps.info('The files changed after the scan, so Stack3 is scanning them again. Nothing was opened.');
        await deps.rescan(current);
        return;
      }

      if (mode === 'neutralized') {
        try {
          await deps.neutralize(dir);
          if (!(await isNeutralized(dir))) throw new Error('auto-run items remain');
        } catch {
          return deps.error('Stack3 could not disable the auto-run files, so the folder was not opened.');
        }
      }

      // Ask before the first open, so the answer can still protect this very folder. Never blocks an open if it fails.
      await deps.offerAutoTaskGuard().catch(() => undefined);

      try {
        await deps.openFolder(dir);
        await deps.registry.markOpened(current.scanId);
      } catch {
        deps.error('VS Code could not open the folder.');
      }
    });

  return {
    open: openClone('plain'),
    openNeutralized: openClone('neutralized'),
    delete: once('delete', async (rec) => {
      try {
        await deps.removeDir(rec.dir);
      } catch {
        return deps.error('The clone could not be deleted. It was left where it is.');
      }
      await deps.registry.remove(rec.scanId);
      deps.closePanel(rec.scanId);
      deps.info('The clone was deleted.');
    }),
    viewFile: deps.viewFile,
    copyReport: deps.copyReport,
  };
}
