import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ExplainResponseSchema, ReportResponseSchema, ScanPackageResponseSchema, VerdictSchema } from '../../src/api/schemas';

const dir = fileURLToPath(new URL('../../mocks/', import.meta.url));
const schemas: Record<string, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }> = {
  'verdict.json': VerdictSchema,
  'scan-package.json': ScanPackageResponseSchema,
  'explain.json': ExplainResponseSchema,
  'report.json': ReportResponseSchema,
};

describe('mocks', () => {
  test('there is one mock per endpoint plus the verdict example', () => {
    expect(readdirSync(dir).sort()).toEqual(Object.keys(schemas).sort());
  });
  test.each(Object.keys(schemas))('%s parses with its schema', (name) => {
    const r = schemas[name]!.safeParse(JSON.parse(readFileSync(dir + name, 'utf8')));
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
  });
  test('scan-package schema strips a server-sent level', () => {
    const r = ScanPackageResponseSchema.parse({ level: 'no_known_issues', findings: [] }) as Record<string, unknown>;
    expect(r.level).toBeUndefined();
  });
});
