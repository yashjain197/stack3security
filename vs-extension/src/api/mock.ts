import { cleanText } from '../engine/rules/evidence';
import explainMock from '../../mocks/explain.json';
import scanMock from '../../mocks/scan-package.json';
import type { Stack3Client } from './client';
import { ExplainResponseSchema, ScanPackageResponseSchema } from './schemas';

/** Purl the scan mock reports as malware, so a demo has something deterministic to find. */
export const MOCK_MALWARE_PURL = 'pkg:npm/some-lib@1.0.3';

/** `STACK3_MOCK=1`: serves mocks/*.json through the real schemas. No network, no API key. */
export function createMockClient(): Stack3Client {
  return {
    scanPackage: async (purls) => {
      if (!purls.includes(MOCK_MALWARE_PURL)) return { ok: true, value: [] };
      return { ok: true, value: ScanPackageResponseSchema.parse(scanMock).findings.map((f) => ({ ...f, source: 'socket' as const })) };
    },
    explain: async () => {
      const e = ExplainResponseSchema.parse(explainMock);
      return { ok: true, value: { explanation: cleanText(e.explanation, 4000), fix: cleanText(e.fix, 2000) } };
    },
    report: async () => ({ ok: true, value: undefined }),
  };
}
