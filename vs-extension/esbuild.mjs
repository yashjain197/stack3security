import * as esbuild from 'esbuild';

// Prefer ESM entries: jsonc-parser's UMD main loads its modules with a dynamic require that cannot be bundled.
const common = { mainFields: ['module', 'main'], bundle: true, minify: false, sourcemap: false, logLevel: 'info', legalComments: 'none' };

await Promise.all([
  esbuild.build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] }),
  // The verdict panel's page script and styles. Browser code: no Node, no vscode module.
  esbuild.build({ ...common, entryPoints: ['webview/main.ts', 'webview/styles.css'], outdir: 'dist/webview', platform: 'browser', format: 'iife', target: 'es2022' }),
  // The repo-scan service, run in Docker. dist/worker.js must sit beside it.
  esbuild.build({ ...common, entryPoints: ['src/server/main.ts'], outfile: 'dist/server.js', platform: 'node', format: 'cjs', target: 'node22' }),
  esbuild.build({ ...common, entryPoints: ['src/scan/worker.ts'], outfile: 'dist/worker.js', platform: 'node', format: 'cjs', target: 'node18' }),
]);
