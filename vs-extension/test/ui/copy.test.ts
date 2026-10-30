import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as copy from '../../src/ui/copy';
import { buildReport, buildView } from '../../src/ui/view';
import { makeRec } from './helpers';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SAFE = /\bsafe\b/i; // I-15: no UI string says "safe"

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'function') {
    for (const a of [1, 'x']) {
      try { strings((v as (n: never) => unknown)(a as never), out); } catch { /* not callable that way */ }
    }
  } else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

describe('copy (I-15)', () => {
  test('no exported UI string says "safe"', () => {
    const all = strings(copy);
    expect(all.length).toBeGreaterThan(20);
    for (const s of all) expect(s, s).not.toMatch(SAFE);
  });
  test('no string in any UI source file, the webview source, or a built view says "safe"', () => {
    const files = [...readdirSync(join(root, 'src/ui')).map((n) => join(root, 'src/ui', n)), join(root, 'webview/main.ts')];
    for (const p of files) expect(readFileSync(p, 'utf8'), p).not.toMatch(SAFE);
    for (const level of ['critical', 'high', 'caution', 'unknown', 'no_known_issues'] as const) {
      const rec = makeRec(level);
      expect(JSON.stringify(buildView(rec)), level).not.toMatch(SAFE);
      expect(buildReport(rec), level).not.toMatch(SAFE);
    }
  });
  test('the all-clear wording says it is not a guarantee', () => {
    expect(copy.HEADLINE.no_known_issues).toMatch(/not a guarantee/i);
  });
});

describe('styles: nothing is green (I-15)', () => {
  const css = readFileSync(join(root, 'webview/styles.css'), 'utf8');
  const PKG_OK = '2e7d32'; // package-ok marker only; not a safety claim
  test('no green keyword and no green-dominant color except the package-ok marker', () => {
    expect(css).not.toMatch(/green|lime|teal|#0f0\b/i);
    const hexes = [...css.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => m[1]!);
    expect(hexes.length).toBeGreaterThan(0);
    expect(hexes.map((h) => h.toLowerCase())).toContain(PKG_OK);
    for (const h of hexes) {
      if (h.toLowerCase() === PKG_OK) continue;
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
      expect(g > r + 15 && g > b + 15, `#${h} looks green`).toBe(false);
    }
  });
  test('uses no remote resources and no inline-style dependence', () => {
    expect(css).not.toMatch(/url\(\s*['"]?https?:|@import/i);
  });
  test('layout scales with the panel instead of a single fixed column', () => {
    expect(css).toMatch(/clamp\(/);
    expect(css).toMatch(/@media \(max-width: 480px\)/);
    expect(css).toMatch(/@media \(min-width: 720px\)/);
    expect(css).toMatch(/@media \(min-width: 1100px\)/);
    expect(css).toMatch(/overflow-x:\s*hidden/);
  });
});

describe('the AI explanation label', () => {
  test('is the fixed wording from the plan, and the webview shows exactly that', () => {
    expect(copy.EXPLAIN.label).toBe('AI explanation: may be wrong. The verdict above is decided by rules.');
    const src = readFileSync(join(root, 'webview/main.ts'), 'utf8');
    expect(src).toContain(copy.EXPLAIN.label);
    expect(src).toContain(copy.EXPLAIN.pending);
    expect(src).toContain(copy.EXPLAIN.fixLead);
  });
  test('the webview draws model text with textContent only (it goes through el(), never innerHTML)', () => {
    const src = readFileSync(join(root, 'webview/main.ts'), 'utf8');
    expect(src).toMatch(/el\('p', 'prose', m\.explanation\)/);
    expect(src).toMatch(/el\('p', 'prose', `What to do: \$\{m\.fix\}`\)/);
  });
});

describe('the webview page script', () => {
  const src = readFileSync(join(root, 'webview/main.ts'), 'utf8');
  test('builds text with textContent only: no innerHTML, outerHTML, insertAdjacentHTML, document.write, eval or Function', () => {
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function|dangerouslySetInnerHTML|setAttribute\(\s*['"]on|\.href\s*=/);
    expect(src).toMatch(/textContent/);
  });
  test('creates no anchors or images from data', () => {
    expect(src).not.toMatch(/createElement\(\s*['"](a|img|iframe|script|link|object|embed)['"]/i);
  });
  test('the clone-scan panel lets the user search the packages that were checked', () => {
    expect(src).toContain("section('Packages')");
    expect(src).toContain("q.placeholder = 'Search packages'");
    expect(src).toContain("q.addEventListener('input', draw)");
    expect(src.indexOf("section('Packages')")).toBeLessThan(src.indexOf("section('Findings')"));
    expect(src).toContain("package${packagesScanned === 1 ? '' : 's'} scanned");
    expect(src).toContain("p.flagged ? 'package flagged' : 'package ok'");
  });
});
