import type * as vscode from 'vscode';
import { PACKAGE_SCAN_UNAVAILABLE, buildVerdict } from '../api/merge';
import type { PackageResult, Stack3Client } from '../api/client';
import { clip } from '../engine/rules/evidence';
import { locatePackageFindings } from '../engine/purls';
import type { EngineResult, Finding, Indicators, Verdict } from '../engine/types';

/** Files whose change can change a verdict. Everything is matched under every workspace folder. */
export const WATCH_GLOB = '**/{package.json,package-lock.json,yarn.lock,pnpm-lock.yaml,bun.lock,.npmrc,.yarnrc,.yarnrc.yml,.pnpmfile.cjs,*.code-workspace,.vscode/*.json}';
export const DEBOUNCE_MS = 500;

const NO_INDICATORS: Indicators = { addresses: [], domains: [] };
// A remote finding names its package by purl in its text; that is how it is tied to the package it is about.
const PURL_IN_TEXT = /pkg:npm\/[^\s,;)"']+/;

export interface RootInfo {
  path: string;
  name: string;
}

export interface Watch {
  dispose(): void;
}

export interface WatcherDeps {
  roots(): RootInfo[];
  scan(root: string): Promise<EngineResult>;
  /** Created per scan, so a changed API setting applies to the next one. */
  client(): Pick<Stack3Client, 'scanPackage'>;
  publish(root: RootInfo, verdict: Verdict): void;
  clear(root: RootInfo): void;
  /** The root is passed so the caller can stay quiet about a folder it has just warned about. */
  notify(message: string, root: RootInfo): void;
  watch(root: RootInfo, glob: string, onEvent: (fsPath: string) => void): Watch;
  onRootsChanged(cb: () => void): Watch;
  isTrusted(): boolean;
  onTrusted(cb: () => void): Watch;
  debounceMs?: number;
}

interface RootState {
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  dirty: boolean;
  watch: Watch;
  /** purls already checked successfully, so only new ones are sent again */
  queried: Set<string>;
  byPurl: Map<string, Finding[]>;
  /** findings that did not name a package: kept while any purl of their batch is still in use */
  unattributed: { purls: Set<string>; findings: Finding[] }[];
  seen: Set<string>;
  verdict?: Verdict;
}

const findingKey = (f: Finding): string => `${f.ruleId}\0${f.location?.file ?? ''}\0${f.location?.line ?? ''}\0${f.title}`;

/**
 * Flow 3. When a manifest, lockfile or config changes, scan again after a pause, ask the API only about packages it has
 * not been asked about, and publish the result as diagnostics. A burst of saves is one scan; a scan already running is
 * followed by exactly one more. Nothing here runs git or any code from the folder.
 */
export function registerWatchers(_ctx: Pick<vscode.ExtensionContext, 'subscriptions'>, deps: WatcherDeps): vscode.Disposable {
  const debounce = deps.debounceMs ?? DEBOUNCE_MS;
  const states = new Map<string, RootState>();
  let disposed = false;

  const schedule = (root: RootInfo) => {
    const st = states.get(root.path);
    if (!st || disposed) return;
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(() => void run(root), debounce);
  };

  async function scanOnce(root: RootInfo, st: RootState): Promise<void> {
    let local: EngineResult;
    try {
      local = await deps.scan(root.path);
    } catch {
      local = { findings: [], notChecked: ['Scan failed'], purls: [] };
    }
    if (disposed || !states.has(root.path)) return;

    const current = new Set(local.purls);
    for (const p of [...st.byPurl.keys()]) if (!current.has(p)) st.byPurl.delete(p);
    for (const p of [...st.queried]) if (!current.has(p)) st.queried.delete(p);
    st.unattributed = st.unattributed.filter((b) => [...b.purls].some((p) => current.has(p)));

    const fresh = [...current].filter((p) => !st.queried.has(p));
    let remote: PackageResult = { ok: true, value: [] };
    if (fresh.length > 0) {
      remote = await deps.client().scanPackage(fresh);
      if (disposed || !states.has(root.path)) return;
      if (remote.ok) {
        const loose: Finding[] = [];
        for (const f of locatePackageFindings(remote.value, local.purlLocations ?? {})) {
          const purl = PURL_IN_TEXT.exec(`${f.evidence} ${f.title}`)?.[0];
          if (purl === undefined) loose.push(f);
          else if (current.has(purl)) st.byPurl.set(purl, [...(st.byPurl.get(purl) ?? []), f]);
        }
        if (loose.length) st.unattributed.push({ purls: new Set(fresh), findings: loose });
        for (const p of fresh) st.queried.add(p);
      }
    }

    // What is known stays visible even when the latest lookup failed; the failure is reported as not checked.
    const known = [...st.byPurl.values()].flat().concat(st.unattributed.flatMap((b) => b.findings));
    const failed = fresh.length > 0 && !remote.ok;
    const verdict = buildVerdict(
      failed ? { ...local, notChecked: [...local.notChecked, ...(remote.notChecked ?? [PACKAGE_SCAN_UNAVAILABLE])] } : local,
      { ok: true, value: known },
      { type: 'repo', id: `workspace:${clip(root.name, 80)}` },
      NO_INDICATORS,
    );

    const serious = verdict.findings.filter((f) => (f.severity === 'critical' || f.severity === 'high') && !st.seen.has(findingKey(f)));
    st.seen = new Set(verdict.findings.map(findingKey));
    st.verdict = verdict;
    deps.publish(root, verdict);
    if (serious.length > 0) {
      const top = serious.find((f) => f.severity === 'critical') ?? serious[0]!;
      const where = top.location ? ` (${clip(top.location.file, 80)}${top.location.line ? `:${top.location.line}` : ''})` : '';
      deps.notify(`Stack3: ${serious.length} new serious problem${serious.length === 1 ? '' : 's'} in ${clip(root.name, 60)}. ${clip(top.title, 120)}${where}. See the Problems panel.`, root);
    }
  }

  async function run(root: RootInfo): Promise<void> {
    const st = states.get(root.path);
    if (!st || disposed) return;
    st.timer = undefined;
    if (st.running) {
      st.dirty = true; // one more scan after the current one, not one per event
      return;
    }
    st.running = true;
    try {
      do {
        st.dirty = false;
        await scanOnce(root, st);
      } while (st.dirty && !disposed && states.has(root.path));
    } finally {
      st.running = false;
    }
  }

  const ignored = (p: string) => /(?:^|[\\/])(?:node_modules|\.git)[\\/]/.test(p);

  function reconcile(): void {
    if (disposed) return;
    const wanted = new Map(deps.roots().map((r) => [r.path, r]));
    for (const [path, st] of [...states]) {
      if (wanted.has(path)) continue;
      if (st.timer) clearTimeout(st.timer);
      st.watch.dispose();
      states.delete(path);
      deps.clear({ path, name: path });
    }
    if (!deps.isTrusted()) return; // an untrusted folder is the quick scan's job (Flow 2)
    for (const root of wanted.values()) {
      if (states.has(root.path)) continue;
      const st: RootState = {
        running: false,
        dirty: false,
        queried: new Set(),
        byPurl: new Map(),
        unattributed: [],
        seen: new Set(),
        watch: deps.watch(root, WATCH_GLOB, (p) => {
          if (!ignored(p)) schedule(root);
        }),
      };
      states.set(root.path, st);
      schedule(root); // the first scan gives the baseline
    }
  }

  reconcile();
  const rootsWatch = deps.onRootsChanged(reconcile);
  const trustWatch = deps.onTrusted(reconcile);

  return {
    dispose() {
      disposed = true;
      rootsWatch.dispose();
      trustWatch.dispose();
      for (const st of states.values()) {
        if (st.timer) clearTimeout(st.timer);
        st.watch.dispose();
      }
      states.clear();
    },
  };
}
