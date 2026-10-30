import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { vscode: fileURLToPath(new URL('./test/mocks/vscode.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    testTimeout: 20000,
    // The rule engine decides every verdict, so it is the part held to a coverage floor (blueprint, coverage targets).
    coverage: { provider: 'v8', include: ['src/engine/**/*.ts'], reporter: ['text-summary', 'json-summary'], thresholds: { lines: 90 } },
  },
});
