import { describe, expect, test } from 'vitest';
import { engineScan } from '../../src/engine';
import { extractIndicators } from '../../src/engine/indicators';
import { aggregate } from '../../src/engine/verdict';
import { buildGraphReport, validateGraphReport } from '../../src/report/graphReport';
import { ctx, loadRepo } from '../engine/load';
import { T } from '../engine/helpers';

const DEMO_WALLET = '0x9f00000000000000000000000000000000000001';

describe('the demo repositories', () => {
  test('the fake-interview repo yields exactly the demo attacker wallet and the exfiltration endpoint, token stripped', async () => {
    const files = await loadRepo('interview-task');
    const r = engineScan(files, ctx);
    const indicators = extractIndicators(r.findings);
    expect(indicators.addresses).toEqual([DEMO_WALLET]);
    expect(indicators.domains).toEqual(['api.telegram.org/bot123456']);
    expect(JSON.stringify(indicators)).not.toContain('FAKE-TOKEN');
    expect(aggregate(r.findings, r.notChecked, T, indicators).indicators).toEqual(indicators);
  });
  test('and builds a valid report for the API: the package, the wallet it drains to, the endpoint it sends to', async () => {
    const r = engineScan(await loadRepo('interview-task'), ctx);
    const report = buildGraphReport({ owner: 'octo', repo: 'interview-task', findings: r.findings, packageFor: () => ({ name: 'interview-task', version: '1.0.0', root: true }) })!;
    expect(report).toBeDefined();
    expect(validateGraphReport(report)).toBeUndefined();
    expect(report.nodes.filter((n) => n.type === 'wallet').map((n) => n.id)).toEqual([`1:${DEMO_WALLET}`]);
    expect(report.nodes.filter((n) => n.type === 'package').map((n) => n.id)).toEqual(['pkg:npm/interview-task@1.0.0']);
    expect(report.edges.map((e) => e.type).sort()).toEqual(['package_drains_to', 'package_sends_to']);
    expect(JSON.stringify(report)).not.toContain('FAKE-TOKEN');
  });
  test('a well-known router in a comment of an ordinary file produces no indicator and no report', async () => {
    const r = engineScan(await loadRepo('router-comment'), ctx);
    expect(extractIndicators(r.findings)).toEqual({ addresses: [], domains: [] });
    expect(buildGraphReport({ owner: 'o', repo: 'r', findings: r.findings, packageFor: () => ({ name: 'router-comment', version: '1.0.0', root: true }) })).toBeUndefined();
  });
  test('the clean template yields nothing to report', async () => {
    const r = engineScan(await loadRepo('clean-template'), ctx);
    expect(extractIndicators(r.findings)).toEqual({ addresses: [], domains: [] });
    expect(buildGraphReport({ owner: 'o', repo: 'r', findings: r.findings, packageFor: () => ({ name: 'clean-template', version: '0.1.0', root: true }) })).toBeUndefined();
  });
});
