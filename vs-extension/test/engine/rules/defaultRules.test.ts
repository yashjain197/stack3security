import { describe, expect, test } from 'vitest';
import { engineScan } from '../../../src/engine';
import { aggregate } from '../../../src/engine/verdict';
import { ctx, loadRepo } from '../load';
import { I, T } from '../helpers';

// The default rule set over the fixture repos: the demo attack is critical, a clean template stays quiet.
describe('default RULES on fixture repos', () => {
  test('interview-task is critical', async () => {
    const r = engineScan(await loadRepo('interview-task'), ctx);
    expect(aggregate(r.findings, r.notChecked, T, I).level).toBe('critical');
  });
  test('clean-template has no high or critical finding and nothing unchecked', async () => {
    const r = engineScan(await loadRepo('clean-template'), ctx);
    expect(r.findings.filter((f) => f.severity !== 'caution')).toEqual([]);
    expect(r.notChecked).toEqual([]);
  });
});
