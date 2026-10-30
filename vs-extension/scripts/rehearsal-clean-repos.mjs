// Rehearsal 3 (ARCHITECTURE Part 5): ten well-known clean repositories must not give critical or high.
// Clones each with the extension's own hardened clone and scans it with the same engine and limits the server uses
// (mode "clone"), then prints a table and lists everything that is not `no_known_issues`.
//
// This is the LOCAL engine only: no package lookup (no Socket key, no Stack3 API), so a repo with packages would read
// "unknown" in the product when that lookup is down. Only the local rules are exercised here.
//
// Usage: node scripts/rehearsal-clean-repos.mjs [--json out.json] [owner/name ...]   (needs network and git)
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const DEFAULT_REPOS = [
  'expressjs/express',
  'fastify/fastify',
  'vitejs/vite',
  'ethers-io/ethers.js',
  'scaffold-eth/scaffold-eth-2', // wevm/viem was dropped: its clone stalled on this network even with plain git
  'wevm/wagmi',
  'NomicFoundation/hardhat',
  'OpenZeppelin/openzeppelin-contracts',
  'Uniswap/v3-core',
  'safe-global/safe-smart-account',
];

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : undefined;
const repos = args.length ? args : DEFAULT_REPOS;

// Bundle the real modules (the TypeScript sources) into one temporary file; nothing in the repo is changed.
const tmp = mkdtempSync(join(tmpdir(), 'stack3-rehearsal-'));
const entry = join(tmp, 'entry.ts');
const rel = (p) => JSON.stringify(join(root, p));
writeFileSync(entry, `
export { cloneRepo } from ${rel('src/quarantine/git.ts')};
export { createQuarantineDir } from ${rel('src/quarantine/paths.ts')};
export { removeQuarantined } from ${rel('src/quarantine/remove.ts')};
export { scanJob } from ${rel('src/scan/scanJob.ts')};
export { aggregate } from ${rel('src/engine/verdict.ts')};
export { extractIndicators } from ${rel('src/engine/indicators.ts')};
export { DEFAULT_LIMITS } from ${rel('src/config/limits.ts')};
`);
const out = join(tmp, 'entry.cjs');
await build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'cjs', target: 'node22', mainFields: ['module', 'main'], external: ['vscode'], logLevel: 'silent', absWorkingDir: root });
const m = await import(pathToFileURL(out).href);

const results = [];
for (const slug of repos) {
  const url = `https://github.com/${slug}`;
  const started = Date.now();
  const row = { repo: slug, level: 'error', findings: [], notChecked: [], seconds: 0 };
  let dir;
  try {
    dir = await m.createQuarantineDir(slug.split('/')[0], slug.split('/')[1]);
    const cloned = await m.cloneRepo(url, dir);
    if (!cloned.ok) {
      row.error = cloned.reason;
    } else {
      row.sha = cloned.value.sha.slice(0, 7);
      const r = await m.scanJob({ root: dir, ctx: { mode: 'clone', checkedAt: new Date().toISOString() }, limits: m.DEFAULT_LIMITS });
      const v = m.aggregate(r.findings, r.notChecked, { type: 'repo', id: slug }, m.extractIndicators(r.findings));
      row.level = v.level;
      row.notChecked = v.notChecked;
      row.packages = r.purls.length;
      row.findings = v.findings.map((f) => ({ ruleId: f.ruleId, severity: f.severity, file: f.location?.file, line: f.location?.line, evidence: f.evidence.slice(0, 160) }));
    }
  } catch (e) {
    row.error = `crashed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    if (dir) await m.removeQuarantined(dir).catch(() => undefined);
  }
  row.seconds = Math.round((Date.now() - started) / 100) / 10;
  results.push(row);
  console.error(`${row.level.padEnd(16)} ${slug} (${row.seconds}s)`);
}

console.log('\n| Repo | Commit | Level | Findings | Not checked | Packages | Time |\n|---|---|---|---|---|---|---|');
for (const r of results) console.log(`| ${r.repo} | ${r.sha ?? '-'} | ${r.level} | ${r.findings.length} | ${r.notChecked.length} | ${r.packages ?? '-'} | ${r.seconds}s |`);

const odd = results.filter((r) => r.level !== 'no_known_issues');
console.log(`\n${results.length - odd.length} of ${results.length} are no_known_issues. Not no_known_issues: ${odd.length}`);
for (const r of odd) {
  console.log(`\n### ${r.repo}: ${r.level}${r.error ? ` (${r.error})` : ''}`);
  for (const f of r.findings) console.log(`- [${f.severity}] ${f.ruleId} ${f.file ?? ''}${f.line ? `:${f.line}` : ''}: ${f.evidence}`);
  for (const n of r.notChecked) console.log(`- not checked: ${n}`);
}
const bad = results.filter((r) => r.level === 'critical' || r.level === 'high');
console.log(`\nREHEARSAL 3 (no critical or high): ${bad.length === 0 ? 'PASS' : `FAIL (${bad.map((r) => r.repo).join(', ')})`}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
process.exitCode = bad.length === 0 ? 0 : 1;
