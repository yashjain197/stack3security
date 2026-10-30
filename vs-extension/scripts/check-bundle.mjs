// Fails when a built bundle can run text as code. Banned in our own source by lint; this checks what was actually
// shipped, which also covers bundled dependencies. Usage: node scripts/check-bundle.mjs [dir]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url));

const BANNED = [
  { name: 'eval(', re: /(?<![\w$.])eval\s*\(/ },
  { name: 'new Function(', re: /\bnew\s+Function\s*\(/ },
  { name: 'Function(', re: /(?<![\w$.])Function\s*\(\s*['"`]/ },
  { name: 'string-argument setTimeout/setInterval', re: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/ },
  { name: 'innerHTML/outerHTML assignment', re: /\.(?:inner|outer)HTML\s*=(?!=)/ },
];

const files = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : /\.(?:js|cjs|mjs)$/.test(e.name) ? [join(d, e.name)] : []));

let bundles;
try {
  bundles = files(dir);
} catch {
  console.error(`check-bundle: ${dir} does not exist. Run "npm run build" first.`);
  process.exit(2);
}
if (bundles.length === 0) {
  console.error(`check-bundle: no .js files in ${dir}.`);
  process.exit(2);
}

const hits = [];
for (const file of bundles) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((text, i) => {
    for (const { name, re } of BANNED) if (re.test(text)) hits.push(`${file}:${i + 1}: ${name}: ${text.trim().slice(0, 120)}`);
  });
}

if (hits.length > 0) {
  console.error(`check-bundle: ${hits.length} banned construct(s) in the built bundles:\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`check-bundle: ${bundles.length} bundle(s) clean (${bundles.map((b) => b.slice(dir.length + 1)).join(', ')}).`);
