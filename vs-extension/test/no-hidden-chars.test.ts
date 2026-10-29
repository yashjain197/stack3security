import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Our own source must not contain the invisible characters our rules look for (Trojan Source).
// The pattern is built from code points, so this file contains none of them and passes its own check.
const HIDDEN = new RegExp(`[${['200B-200F', '202A-202E', '2066-2069', 'FEFF'].map((r) => r.split('-').map((h) => String.fromCharCode(parseInt(h, 16))).join('-')).join('')}]`);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'fixtures' ? [] : sources(p);
    return /\.(?:ts|mjs|json)$/.test(e.name) ? [p] : [];
  });
}

describe('source hygiene', () => {
  test('no bidi, zero-width or BOM characters in src/ or test/', () => {
    const bad = [...sources('src'), ...sources('test')].filter((p) => HIDDEN.test(readFileSync(p, 'utf8')));
    expect(bad).toEqual([]);
  });
});
