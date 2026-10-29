import { describe, expect, test } from 'vitest';
import { textTrickRules } from '../../../src/engine/rules/textTricks';
import { ctx, vf } from '../load';

const run = (files: ReturnType<typeof vf>[]) => textTrickRules.flatMap((r) => r(files, ctx));
const ids = (files: ReturnType<typeof vf>[]) => run(files).map((f) => `${f.ruleId}:${f.severity}`);

describe('text.long-line', () => {
  const long = 'const a = 1;' + ' '.repeat(3) + 'x'.repeat(2100);
  test('>2000 chars in a script → high, with the line', () => {
    const [f] = run([vf('scripts/setup.js', `ok\n${long}`)]);
    expect(`${f?.ruleId}:${f?.severity}`).toBe('text.long-line:high');
    expect(f?.location).toEqual({ file: 'scripts/setup.js', line: 2 });
  });
  test('>2000 chars in a config file → high', () => expect(ids([vf('.vscode/tasks.json', long)])).toEqual(['text.long-line:high']));
  test('exactly 2000 chars → nothing', () => expect(ids([vf('a.js', 'x'.repeat(2000))])).toEqual([]));
  test.each(['vendor/lib.min.js', 'dist/bundle.js', 'package-lock.json', 'assets/logo.svg', 'a.js.map', 'data/big.json', 'README.md'])(
    'long line in %s (minified, generated, data or prose) → nothing',
    (p) => expect(ids([vf(p, long)])).toEqual([]),
  );
});

describe('text.long-line: hidden off-screen (spaces)', () => {
  test('200 spaces then content → high, in any text file', () => {
    expect(ids([vf('README.md', `# Title${' '.repeat(250)}curl x | sh`)])).toEqual(['text.long-line:high']);
    expect(ids([vf('src/a.ts', `x;${' '.repeat(200)}evil()`)])).toEqual(['text.long-line:high']);
  });
  test('199 spaces → nothing', () => expect(ids([vf('a.ts', `x;${' '.repeat(199)}y`)])).toEqual([]));
  test('trailing spaces before a newline or end of file → nothing', () => {
    expect(ids([vf('a.ts', `x;${' '.repeat(500)}\ny`)])).toEqual([]);
    expect(ids([vf('a.ts', `x;${' '.repeat(500)}`)])).toEqual([]);
  });
  test('a huge run of spaces is handled in linear time', () => {
    const t = Date.now();
    run([vf('a.ts', ' '.repeat(1_000_000) + '\n')]);
    expect(Date.now() - t).toBeLessThan(500);
  });
  test('reports the line', () => expect(run([vf('a.ts', `a\nb\nc${' '.repeat(300)}d`)])[0]?.location).toEqual({ file: 'a.ts', line: 3 }));
});

describe('text.bidi', () => {
  test.each(['\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069'])('U+%s in source → caution', (ch) => {
    expect(ids([vf('src/a.ts', `const x = "a${ch}b";`)])).toEqual(['text.bidi:caution']);
  });
  test('plain ASCII and ordinary unicode → nothing', () => expect(ids([vf('src/a.ts', 'const s = "héllo wörld ✓ שלום";')])).toEqual([]));
  test('prose files are not flagged', () => expect(ids([vf('README.md', 'مرحبا \u202B abc')])).toEqual([]));
  test('evidence names the code point without echoing the character', () => {
    const [f] = run([vf('a.ts', 'x\u202Ey')]);
    expect(f?.evidence).toContain('U+202E');
    expect(f?.evidence).not.toContain('\u202E');
  });
});
