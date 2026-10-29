import * as esbuild from 'esbuild';

const common = { bundle: true, minify: false, sourcemap: false, logLevel: 'info', legalComments: 'none' };

await Promise.all([
  esbuild.build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] }),
  esbuild.build({ ...common, entryPoints: ['src/scan/worker.ts'], outfile: 'dist/worker.js', platform: 'node', format: 'cjs', target: 'node18' }),
]);
