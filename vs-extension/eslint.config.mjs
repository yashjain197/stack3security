import tseslint from 'typescript-eslint';

const childProcess = ['child_process', 'node:child_process'];
const engineBanned = [
  ...childProcess,
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
  'net', 'node:net', 'http', 'node:http', 'https', 'node:https',
  'worker_threads', 'node:worker_threads', 'vscode',
];

const bannedSyntax = [
  'error',
  { selector: "CallExpression[callee.name='eval']", message: 'eval is banned (I-1).' },
  { selector: "NewExpression[callee.name='Function']", message: 'new Function is banned (I-1).' },
  { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: 'Render untrusted text with textContent (I-11).' },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'insertAdjacentHTML is banned (I-11).' },
  { selector: "CallExpression[callee.name='require'][arguments.0.type!='Literal']", message: 'Non-literal require is banned (I-1).' },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'test/fixtures/**', '*.mjs', 'vitest.config.ts'] },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-restricted-syntax': bannedSyntax,
      'no-restricted-imports': ['error', { paths: childProcess.map((name) => ({ name, message: 'Only src/quarantine/git.ts may spawn processes (I-1).' })) }],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: engineBanned.map((name) => ({ name, message: 'The engine is pure: no I/O (I-17).' })) }],
    },
  },
  { files: ['src/quarantine/git.ts'], rules: { 'no-restricted-imports': 'off' } },
  // The one test that runs real git against a fixture remote. Tests are not shipped.
  { files: ['test/quarantine/git.test.ts'], rules: { 'no-restricted-imports': 'off' } },
);
