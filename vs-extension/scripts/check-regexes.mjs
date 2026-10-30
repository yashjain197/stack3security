// ReDoS check (I-14): every regular expression in the source is run through recheck, which reports patterns whose
// matching time can blow up on crafted input. Regex literals are found with the TypeScript parser, so no pattern has
// to be listed by hand. Patterns built at run time from a template are skipped and listed, so they cannot hide.
// Usage: node scripts/check-regexes.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { check } from '@makenowjust-labo/recheck';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(root, 'src');
// A pattern may be listed here only with the reason it cannot be abused. Keyed by the pattern text, not its line.
const ALLOWED = new Map([
  [String.raw`\batob\s*\(|\bb64decode\b|Buffer\.from\([^\n]{0,200}["']base64["']`, 'the 200-character gap is a hard bound and the line is cut to 4096 characters, so at most ~800k steps; the bound is what defeats the checker'],
]);

const sources = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []));

const found = [];
const dynamic = [];
for (const file of sources(SRC)) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const where = (n) => `${relative(root, file).split('\\').join('/')}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const visit = (n) => {
    if (ts.isRegularExpressionLiteral(n)) {
      const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(n.text);
      found.push({ at: where(n), source: m[1], flags: m[2] });
    } else if (ts.isNewExpression(n) && n.expression.getText(sf) === 'RegExp' && n.arguments?.length) {
      const [pattern, flags] = n.arguments;
      if (ts.isStringLiteralLike(pattern) && (!flags || ts.isStringLiteralLike(flags))) found.push({ at: where(n), source: pattern.text, flags: flags?.text ?? '' });
      else dynamic.push(where(n));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

let bad = 0;
for (const r of found) {
  const res = await check(r.source, r.flags.replace(/[gy]/g, ''), { timeout: 60_000 });
  if (res.status === 'safe' || ALLOWED.has(r.source)) continue;
  bad++;
  console.error(`${r.at}: ${res.status}${res.complexity ? ` (${res.complexity.summary})` : ''}${res.error ? ` ${res.error.message}` : ''}\n  /${r.source}/${r.flags}${res.attack ? `\n  attack: ${res.attack.pattern}` : ''}`);
}
if (dynamic.length) console.log(`check-regexes: ${dynamic.length} pattern(s) built at run time were not checked: ${dynamic.join(', ')}`);
console.log(`check-regexes: ${found.length} patterns checked, ${bad} problem(s).`);
process.exit(bad ? 1 : 0);
