import { describe, expect, test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '../src/api/client';
import { buildVerdict, PACKAGE_SCAN_UNAVAILABLE } from '../src/api/merge';
import { DEFAULT_LIMITS } from '../src/config/settings';
import { engineScan } from '../src/engine';
import { extractIndicators } from '../src/engine/indicators';
import { aggregate } from '../src/engine/verdict';
import { scanJob } from '../src/scan/scanJob';
import { ctx, loadRepo } from './engine/load';
import { T } from './engine/helpers';
import { recorder } from './api/helpers';
import { sandbox } from './scan/tree';

// ARCHITECTURE.md Part 5 "Rehearsal", the items that run without a person. Each test states the rehearsal line it checks.

describe('rehearsal 1: the demo interview repo says "do not run", with its three pieces of evidence', () => {
  test('critical, tasks.json:14, the install script that reads secrets, and the attacker wallet', async () => {
    const r = engineScan(await loadRepo('interview-task'), ctx);
    const indicators = extractIndicators(r.findings);
    const v = aggregate(r.findings, r.notChecked, T, indicators);
    expect(v.level).toBe('critical');
    expect(v.actions).toEqual(['Do not open this folder in VS Code']);
    expect(r.findings).toContainEqual(expect.objectContaining({ ruleId: 'tasks.folder-open', severity: 'critical', location: { file: '.vscode/tasks.json', line: 14 } }));
    expect(r.findings).toContainEqual(expect.objectContaining({ ruleId: 'scripts.lifecycle', severity: 'critical', location: { file: 'package.json', line: 7 } }));
    const secret = r.findings.find((f) => f.ruleId === 'source.decode-exec-secret')!;
    expect(secret.severity).toBe('critical');
    expect(secret.evidence).toContain('secret-path-read');
    expect(secret.location?.file).toBe('scripts/.cache/setup.js');
    expect(indicators.addresses).toEqual(['0x9f00000000000000000000000000000000000001']); // what /report receives (test/report/demo.test.ts builds the payload)
  });
});

describe('rehearsal 4: pulling the network gives unknown, with no crash', () => {
  const none = { addresses: [], domains: [] };
  test('a real scan of a repo with a lockfile, a real client whose fetch fails: nothing thrown, never "no known issues"', async () => {
    const local = engineScan(await loadRepo('clean-template'), ctx);
    expect(local.purls.length).toBeGreaterThan(0); // there is something to look up, so the network matters
    const offline = createClient({ baseUrl: 'https://api.stack3.example', allowLocalhost: false, fetchImpl: recorder(new TypeError('fetch failed')).fetch });
    const remote = await offline.scanPackage(local.purls);
    expect(remote.ok).toBe(false);
    const v = buildVerdict(local, remote, T, none);
    expect(v.notChecked).toContain(PACKAGE_SCAN_UNAVAILABLE);
    expect(v.level).not.toBe('no_known_issues');
  });
  test('with nothing else found locally the level is exactly unknown; a local finding is never lowered', async () => {
    const local = engineScan(await loadRepo('clean-template'), ctx);
    const offline = createClient({ baseUrl: 'https://api.stack3.example', allowLocalhost: false, fetchImpl: recorder(new TypeError('fetch failed')).fetch });
    const remote = await offline.scanPackage(local.purls);
    expect(buildVerdict({ ...local, findings: [] }, remote, T, none).level).toBe('unknown');
    expect(buildVerdict(local, remote, T, none).level).toBe('caution'); // its own "prepare: husky" finding outranks unknown
  });
});

const none = { addresses: [], domains: [] };

describe('rehearsal 8: the huge-repo fixture stays bounded', () => {
  test('more files than the limit and a file over the per-file cap: bounded, flagged unknown, within the time limit', async () => {
    const { root } = sandbox();
    for (let d = 0; d < 21; d++) {
      const dir = join(root, 'src', `d${d}`);
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 1000; i++) writeFileSync(join(dir, `f${i}.js`), `export const v${i} = ${i};\n`);
    } // 21 000 files > maxFiles 20 000
    writeFileSync(join(root, 'big.js'), `${'a'.repeat(99)}\n`.repeat(Math.ceil((DEFAULT_LIMITS.maxFileBytes * 3) / 100)));

    const started = Date.now();
    const r = await scanJob({ root, ctx, limits: DEFAULT_LIMITS });
    expect(Date.now() - started).toBeLessThan(DEFAULT_LIMITS.timeoutMs);
    expect(r.notChecked.join('|')).toMatch(/file limit/);
    expect(aggregate(r.findings, r.notChecked, T, none).level).toBe('unknown');
  }, 60_000);
  test('a tree deeper than the depth limit is bounded and flagged', async () => {
    const { root } = sandbox();
    mkdirSync(join(root, Array.from({ length: DEFAULT_LIMITS.maxDepth + 5 }, (_, i) => `n${i}`).join('/')), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}');
    const r = await scanJob({ root, ctx, limits: DEFAULT_LIMITS });
    expect(r.notChecked.join('|')).toMatch(/depth limit/);
  });
});
