import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LIMITS } from '../../src/config/settings';
import { isInside } from '../../src/scan/paths';
import { walk } from '../../src/scan/walker';
import { CANARY, link, put, sandbox } from './tree';

const seg = fc.constantFrom('a', 'b', 'c', '.vscode', 'node_modules', '.git');
const entry = fc.record({
  path: fc.array(seg, { minLength: 1, maxLength: 4 }).map((s) => s.join('/') + '/f'),
  kind: fc.constantFrom('file', 'abs-link', 'rel-link', 'dir-link'),
});

describe('walker containment (I-8)', () => {
  test('every returned file is inside the root and the canary never leaks', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(entry, { maxLength: 12 }), async (entries) => {
        const { root, base, canary } = sandbox();
        const seen = new Set<string>();
        for (const e of entries) {
          if ([...seen].some((s) => e.path.startsWith(s + '/') || s.startsWith(e.path + '/')) || seen.has(e.path)) continue;
          seen.add(e.path);
          if (e.kind === 'file') put(root, e.path, 'ok');
          else if (e.kind === 'abs-link') link(root, e.path, canary);
          else if (e.kind === 'rel-link') link(root, e.path, '../'.repeat(e.path.split('/').length) + 'secret.txt');
          else link(root, e.path, base);
        }
        for (const nm of ['committed', 'skip'] as const) {
          const r = await walk(root, DEFAULT_LIMITS, { includeGitConfig: true, nodeModules: nm });
          expect(JSON.stringify(r)).not.toContain(CANARY);
          for (const f of r.files) expect(isInside(realpathSync(root), realpathSync(join(root, f.path)))).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  });
});
