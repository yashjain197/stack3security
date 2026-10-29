import { analyzeLockfiles } from './lockfiles';
import type { VirtualFile } from './types';

/** Lockfiles → package URLs for the registry scan, plus what could not be resolved. */
export function collectPurls(files: VirtualFile[]): { purls: string[]; notChecked: string[] } {
  const { purls, notChecked } = analyzeLockfiles(files);
  return { purls, notChecked };
}
