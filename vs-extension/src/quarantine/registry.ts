import { createHash } from 'node:crypto';
import type { Verdict } from '../engine/types';
import { removeQuarantined } from './remove';

export interface ScannedPackage {
  purl: string;
  file?: string;
}

export interface ScanRecord {
  scanId: string;
  dir: string;
  url: string;
  sha: string;
  verdict: Verdict;
  scanSetHash: string;
  createdAt: number;
  /** Packages the clone scan sent to Socket, so the panel can list and search them. */
  packages?: ScannedPackage[];
  /** Set when the user opened the clone. Such a clone is theirs now and is not deleted automatically. */
  openedAt?: number;
}

/** The slice of `vscode.Memento` the registry needs, so it can be tested without VS Code. */
export interface KeyValueStore {
  get<V>(key: string, defaultValue: V): V;
  update(key: string, value: unknown): PromiseLike<void>;
}

const KEY = 'stack3.quarantine.records';
const MAX_RECORDS = 50;

const isRecordShape = (r: unknown): r is ScanRecord => {
  if (typeof r !== 'object' || r === null) return false;
  const x = r as Record<string, unknown>;
  return ['scanId', 'dir', 'url', 'sha', 'scanSetHash'].every((k) => typeof x[k] === 'string') && Number.isFinite(x.createdAt) && typeof x.verdict === 'object' && x.verdict !== null;
};

/** Binds a verdict to the exact commit and engine that produced it (S8). */
export function scanIdFor(url: string, sha: string, engineVersion: string): string {
  return createHash('sha256').update(JSON.stringify([url, sha, engineVersion])).digest('hex');
}

/** Quarantine bookkeeping in `globalState`: which clone is which verdict, and when it is due for deletion. */
export class Registry {
  constructor(
    private readonly store: KeyValueStore,
    private readonly removeDir: (dir: string) => Promise<void> = removeQuarantined,
  ) {}

  list(): ScanRecord[] {
    const raw = this.store.get<unknown>(KEY, []);
    return (Array.isArray(raw) ? raw.filter(isRecordShape) : []).sort((a, b) => a.createdAt - b.createdAt);
  }

  get(scanId: string): ScanRecord | undefined {
    return this.list().find((r) => r.scanId === scanId);
  }

  async add(rec: ScanRecord): Promise<void> {
    const next = [...this.list().filter((r) => r.scanId !== rec.scanId), rec].sort((a, b) => a.createdAt - b.createdAt);
    await this.store.update(KEY, next.slice(-MAX_RECORDS));
  }

  async markOpened(scanId: string, now: number = Date.now()): Promise<void> {
    await this.store.update(KEY, this.list().map((r) => (r.scanId === scanId ? { ...r, openedAt: now } : r)));
  }

  /** Directories of clones the user opened. */
  openedDirs(): Set<string> {
    return new Set(this.list().filter((r) => r.openedAt !== undefined).map((r) => r.dir));
  }

  async remove(scanId: string): Promise<void> {
    await this.store.update(KEY, this.list().filter((r) => r.scanId !== scanId));
  }

  /** Delete clones older than `days` and forget them. A clone that cannot be deleted keeps its record so it is retried. */
  async pruneOlderThan(days: number, now: number = Date.now()): Promise<string[]> {
    const dropped: string[] = [];
    for (const r of this.list()) {
      if (r.openedAt !== undefined || now - r.createdAt <= days * 86_400_000) continue;
      try {
        await this.removeDir(r.dir);
        dropped.push(r.scanId);
      } catch (e) {
        if ((e as Error).name === 'OutsideQuarantineError') dropped.push(r.scanId); // a bad record is not worth keeping
      }
    }
    if (dropped.length) await this.store.update(KEY, this.list().filter((r) => !dropped.includes(r.scanId)));
    return dropped;
  }
}
