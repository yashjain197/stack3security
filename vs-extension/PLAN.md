# Stack3 VS Code Extension: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that clones a GitHub repo into quarantine, scans it without executing anything, and shows a verdict before the folder can be opened. It then keeps guarding the workspace while the developer works.

**Architecture:** A pure rule engine (`src/engine`, no I/O) scans `VirtualFile[]` produced by a symlink-safe, bounded walker that runs in a worker thread. The extension host owns the only process spawn (a hardened `git clone`), the API client, and the merge step. Remote input can only raise the level. A CSP-locked webview renders verdicts as text and sends actions through a closed message schema.

**Tech Stack:** TypeScript (strict), Node LTS, npm, esbuild, vitest, fast-check, ESLint, zod, jsonc-parser, yaml, `@vscode/test-electron`, `@vscode/vsce`.

**Spec:** [`ARCHITECTURE.md`](./ARCHITECTURE.md). Decisions are in [`DECISIONS.md`](./DECISIONS.md).

**Layout note:** All code lives in the existing `vs-extension/` folder, at the user's request. This answers D-1 for now with the flat layout. `src/engine/` is kept I/O-free by lint, so it can later move to `packages/engine` unchanged.

## Global Constraints

- Level order: `critical > high > caution > unknown > no_known_issues`. Overall level = max finding severity. A non-empty `notChecked` raises it to at least `unknown`.
- `child_process` is imported only in `src/quarantine/git.ts`. `src/engine/**` imports no `fs`, `net`, `child_process`, `worker_threads` or `vscode`.
- Banned everywhere: `eval`, `new Function`, `innerHTML`/`outerHTML`/`insertAdjacentHTML` assignment, non-literal `require`.
- Every `stack3.*` setting has `"scope": "application"`. Settings are read via `inspect().globalValue ?? default`, never from workspace values.
- `package.json`: `capabilities.untrustedWorkspaces = { "supported": true, "restrictedConfigurations": ["stack3.apiUrl","stack3.dev.allowLocalhost","stack3.explain.sendSnippets","stack3.report.mode","stack3.scan.limits"] }`.
- Scan limits: `maxFiles 20000`, `maxFileBytes 1048576`, `maxTotalBytes 52428800`, `maxDepth 32`, `timeoutMs 30000`. Worker heap is `maxOldGenerationSizeMb: 256`.
- Egress: evidence ≤300 chars per snippet, ≤20 snippets per request. Secret values are never sent.
- API: HTTPS only (`http://localhost` only when `stack3.dev.allowLocalhost`). 8000 ms timeout, 1 retry, response cap 1 MiB. The client ignores any server `level`.
- `/explain` output: `explanation` ≤4000 chars, `fix` ≤2000 chars, rendered as plain text with no clickable links.
- Clone URL regex: `^https://github\.com/([A-Za-z0-9-]{1,39})/([A-Za-z0-9._-]{1,100}?)(\.git)?/?$`. Reject `..` and a leading `-`. Clone timeout 120000 ms. Quarantine dirs mode `0o700`, deleted after 7 days.
- Watcher debounce 500 ms. Diagnostic message ≤200 chars, with control and bidi chars stripped.
- UI copy never matches `/\bsafe\b/i` and nothing is green.
- `.npmrc` in `vs-extension/` contains `ignore-scripts=true`. Runtime dependencies are limited to `zod`, `jsonc-parser`, `yaml`.

## Review Focus

1. **Pasted URL variants** (`github.com/x/y`, `https://github.com/x/y/tree/main`, `git@github.com:x/y.git`, trailing `.git` or `/`) should normalize to `https://github.com/x/y` or give a clear error message, never a silent failure. *Test: Task 11, `validateRepoUrl normalizes common forms`.*
2. **A repo with no `package.json` or lockfile at all** should give `no_known_issues` when nothing else is found, not `unknown`, because there were no packages to check. *Test: Task 8, `no manifest → no notChecked`.*
3. **Clone failure** (404, private repo, network down) should show an error notification and **no** verdict panel. It must never show a panel reading "No known issues found". *Test: Task 12, `clone failure shows error, no panel`.*
4. **Windows paths** (`C:\` vs `c:\`, `\` separators): the containment checks for walker and delete must hold with case-insensitive drive letters. *Test: Task 3, `isInside handles win32 drive case`.*
5. **Non-UTF-8 files** (UTF-16 with BOM, Latin-1) must not crash the walker. UTF-16 BOM files are decoded, and undecodable bytes are replaced. *Test: Task 3, `decodes UTF-16 BOM files`.*

---

### Task 1: Scaffold, lint guards and settings contract

**Files:**
- Create: `vs-extension/package.json`, `tsconfig.json`, `.npmrc`, `.eslintrc.cjs`, `esbuild.mjs`, `vitest.config.ts`, `src/extension.ts`, `src/config/settings.ts`
- Test: `vs-extension/test/settings.test.ts`, `vs-extension/test/lint-guards.test.ts`
- Delete: `vs-extension/test.txt` (if restored)

**Interfaces:**
- Produces: `getSettings(): Stack3Settings` with `Stack3Settings = { apiUrl: string; allowLocalhost: boolean; explainMode: 'publicOnly'|'always'|'never'; reportMode: 'publicAuto'|'ask'|'never'; limits: ScanLimits }`. Also `ScanLimits = { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; maxDepth: number; timeoutMs: number }` exported from `src/config/settings.ts`.

- [ ] **Step 1: Write failing tests**

```ts
// settings.test.ts
test('every stack3.* contribution is application scope', () => {
  const props = pkg.contributes.configuration.properties;
  for (const [k, v] of Object.entries(props)) if (k.startsWith('stack3.')) expect(v.scope).toBe('application');
});
test('untrustedWorkspaces supported with restrictedConfigurations', () => {
  expect(pkg.capabilities.untrustedWorkspaces.supported).toBe(true);
  expect(pkg.capabilities.untrustedWorkspaces.restrictedConfigurations).toContain('stack3.apiUrl');
});
test('getSettings ignores workspaceValue', () => {
  mockInspect('apiUrl', { globalValue: undefined, workspaceValue: 'https://evil.example', defaultValue: 'https://api.stack3.dev' });
  expect(getSettings().apiUrl).toBe('https://api.stack3.dev');
});
// lint-guards.test.ts: runs ESLint on fixture snippets
test('engine importing fs fails lint', ...)          // expect errorCount > 0
test('child_process outside quarantine/git.ts fails lint', ...)
test('innerHTML assignment fails lint', ...)
```

- [ ] **Step 2:** Run `cd vs-extension && npx vitest run test/settings.test.ts test/lint-guards.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Add the five `stack3.*` settings with the Global Constraints defaults. Add the ESLint `no-restricted-imports` and `no-restricted-syntax` rules. Implement `getSettings()` via `inspect()`. `extension.ts` exports an empty `activate`/`deactivate`.
- [ ] **Step 4:** Run the same command. Expected: PASS. Also run `npx tsc --noEmit && npx eslint src`, which should show no errors.
- [ ] **Step 5:** Commit: `git add vs-extension && git commit -m "feat(vscode): scaffold with lint guards and application-scoped settings"`

### Task 2: Verdict contract, aggregation and mocks

**Files:**
- Create: `src/engine/types.ts`, `src/engine/verdict.ts`, `src/api/schemas.ts`, `src/api/mock.ts`, `mocks/*.json` (one per endpoint)
- Test: `test/engine/verdict.test.ts`, `test/engine/verdict.prop.test.ts`, `test/api/mocks.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type Level = 'critical'|'high'|'caution'|'unknown'|'no_known_issues'`
  - `type Severity = 'critical'|'high'|'caution'`
  - `type Layer = 'repo-file'|'dependency'|'secret'|'source'|'graph'`
  - `interface Finding { ruleId: string; layer: Layer; severity: Severity; title: string; evidence: string; location?: { file: string; line?: number }; source: 'rules'|'socket'|'graph'; checkedAt: string }`
  - `interface Indicators { addresses: string[]; domains: string[] }`
  - `interface Verdict { level: Level; target: { type: 'repo'|'package'; id: string }; findings: Finding[]; indicators: Indicators; notChecked: string[]; actions: string[]; explanation?: string }`
  - `interface VirtualFile { path: string; text?: string; binary: boolean; size: number; truncated: boolean }` (path is POSIX, relative to the root)
  - `interface ScanContext { mode: 'clone'|'workspace'|'quick'; checkedAt: string }`
  - `interface EngineResult { findings: Finding[]; notChecked: string[]; purls: string[] }`
  - `type Rule = (files: VirtualFile[], ctx: ScanContext) => Finding[]`
- Produces (`verdict.ts`): `LEVEL_ORDER: Level[]`, `maxLevel(a: Level, b: Level): Level`, `aggregate(findings: Finding[], notChecked: string[], target: Verdict['target'], indicators: Indicators): Verdict`
- Produces (`schemas.ts`): zod `VerdictSchema`, `FindingSchema`, `ScanPackageResponseSchema` (`{ findings: Finding[] }`, extra keys stripped), `ExplainResponseSchema`.

- [ ] **Step 1: Write failing tests**

```ts
test('level is max severity', () => expect(aggregate([f('caution'), f('critical')], [], T, I).level).toBe('critical'));
test('empty → no_known_issues', () => expect(aggregate([], [], T, I).level).toBe('no_known_issues'));
test('notChecked floors at unknown', () => expect(aggregate([], ['x'], T, I).level).toBe('unknown'));
test('notChecked does not lower critical', () => expect(aggregate([f('critical')], ['x'], T, I).level).toBe('critical'));
// prop: for any findings A and any extra B, level(A∪B) >= level(A)
test('every mocks/*.json parses with its schema', ...)
```

- [ ] **Step 2:** Run `npx vitest run test/engine/verdict test/api/mocks`. Expected: FAIL.
- [ ] **Step 3:** Implement. `actions` comes from a fixed map per level: critical → `["Do not open this folder in VS Code"]`, high → `["Open with auto-run disabled"]`, caution → `["Review before running"]`, unknown → `["Could not check fully"]`, no_known_issues → `[]`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): verdict contract, aggregate, mocks`, then **push and send `src/engine/types.ts` + `mocks/` to Yash and Ivo.**

### Task 3: Safe walker

**Files:**
- Create: `src/scan/walker.ts`, `src/scan/paths.ts`
- Test: `test/scan/walker.test.ts`, `test/scan/walker.prop.test.ts`, fixtures under `test/fixtures/walker/`

**Interfaces:**
- Consumes: `ScanLimits` (Task 1), `VirtualFile`, `Finding` (Task 2)
- Produces:
  - `isInside(root: string, p: string, platform?: NodeJS.Platform): boolean` (pure; compares normalized realpaths, case-insensitive on win32)
  - `walk(root: string, limits: ScanLimits, opts: { includeGitConfig: boolean }): Promise<{ files: VirtualFile[]; notChecked: string[]; findings: Finding[] }>`

- [ ] **Step 1: Write failing tests**

```ts
test('skips symlinks; canary content never in output', ...)   // symlink → canary file outside root
test('skips .git/objects; reads .git/config only when includeGitConfig', ...)
test('file > maxFileBytes is truncated and flagged', ...)
test('maxFiles exceeded → notChecked contains "file limit"', ...)
test('maxDepth exceeded → notChecked contains "depth limit"', ...)
test('NUL in first 8192 bytes → binary, no text', ...)
test('decodes UTF-16 BOM files', ...)                          // Review Focus 5
test('isInside handles win32 drive case', () => expect(isInside('C:\\a', 'c:\\a\\b', 'win32')).toBe(true)); // Review Focus 4
test('committed node_modules: only package.json read + caution finding', ...)
// prop: random trees with .., absolute and symlinked entries → every file path isInside(root)
```

- [ ] **Step 2:** Run `npx vitest run test/scan/walker`. Expected: FAIL.
- [ ] **Step 3:** Implement a BFS using `fs.lstat` (never `stat`). Read at most `maxFileBytes` via `fs.open` + `read`. Check containment on `fs.realpath` of each directory.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(scan): bounded symlink-safe walker`

### Task 4: Scan worker and scheduler

**Files:**
- Create: `src/scan/worker.ts`, `src/scan/scheduler.ts`, `src/engine/index.ts`
- Test: `test/scan/scheduler.test.ts`

**Interfaces:**
- Consumes: `walk` (Task 3), `Rule`, `EngineResult` (Task 2)
- Produces:
  - `engineScan(files: VirtualFile[], ctx: ScanContext): EngineResult` in `src/engine/index.ts`. It runs `RULES: Rule[]` (empty until Task 5) and `collectPurls` (Task 8). Until Task 8 lands, `collectPurls` is a stub returning `{ purls: [], notChecked: [] }`.
  - `runScan(root: string, ctx: ScanContext, limits: ScanLimits): Promise<EngineResult>` in `scheduler.ts`. It uses a single-flight per root.

- [ ] **Step 1: Write failing tests:** `timeout → { findings: [], purls: [], notChecked: ['Scan timed out'] }` (using a stub worker that never answers); `worker crash → notChecked ['Scan failed']`; `two calls on the same root share one run`.
- [ ] **Step 2:** Run `npx vitest run test/scan/scheduler`. Expected: FAIL.
- [ ] **Step 3:** Implement using `new Worker(dist/worker.js, { resourceLimits: { maxOldGenerationSizeMb: 256 } })` and `worker.terminate()` at `limits.timeoutMs`. Add the worker entry to `esbuild.mjs`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(scan): worker isolation with timeout`

### Task 5: VS Code config rules (tasks, workspace, settings, devcontainer, extensions)

**Files:**
- Create: `src/engine/parsers/jsonc.ts`, `src/engine/rules/vscodeFiles.ts`, `src/engine/rules/signals.ts`
- Modify: `src/engine/index.ts` (add the rules to `RULES`)
- Test: `test/engine/rules/vscodeFiles.test.ts`, fixtures `test/fixtures/repos/{interview-task,clean-template}/`

**Interfaces:**
- Produces:
  - `parseJsonc(text: string): { value: unknown; errors: number }` (jsonc-parser with `allowTrailingComma: true`, `disallowComments: false`)
  - `dangerSignals(cmd: string): string[]` in `signals.ts`. It returns tags from `['network-tool','pipe-to-shell','base64','node-eval','raw-ip','hidden-file']`. Task 7 reuses it.
  - `vscodeFileRules: Rule[]`
- Rule IDs and levels (from ARCHITECTURE §2.7):
  - `tasks.folder-open` → high, escalated to critical when `dangerSignals` is non-empty. It applies to `.vscode/tasks.json` and `*.code-workspace` `.tasks`, follows `dependsOn` transitively, and checks `command`, `args`, `options.shell` and the `windows`/`linux`/`osx` overrides.
  - `settings.shell-override` (`terminal.integrated.*` profile, shell, env or automationProfile keys) → high.
  - `settings.repo-executable` (any `*.path`, `*Path`, `*.runtime` or `defaultInterpreterPath` value that starts with `./`, `${workspaceFolder}` or a relative path) → high.
  - `settings.auto-tasks-on` (`task.allowAutomaticTasks: "on"`) → high.
  - `devcontainer.initialize-command` → high. `devcontainer.post-create-network` → caution.
  - `extensions.recommendations` → caution.
  - `config.unparseable` (parse errors > 0) → caution, plus `notChecked`.

- [ ] **Step 1: Write failing tests**

```ts
test('interview-task repo: critical at .vscode/tasks.json:14', () => {
  const r = engineScan(load('interview-task'), ctx);
  expect(aggregate(r.findings, r.notChecked, T, I).level).toBe('critical');
  expect(r.findings).toContainEqual(expect.objectContaining({ ruleId: 'tasks.folder-open', location: { file: '.vscode/tasks.json', line: 14 } }));
});
test('payload hidden in dependsOn task is found', ...)
test('payload in linux override is found', ...)
test('tasks inside x.code-workspace are found', ...)
test('clean-template repo: no high or critical', ...)
test('invalid JSONC → caution + notChecked', ...)
```

- [ ] **Step 2:** Run `npx vitest run test/engine/rules/vscodeFiles`. Expected: FAIL.
- [ ] **Step 3:** Implement. Build `interview-task` so its `folderOpen` task is `curl … | sh` at line 14, but the fixture is **never executed**: it points at `http://127.0.0.1:9/never`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): VS Code auto-run rules`

### Task 6: Package-manager, git-config and text-trick rules

**Files:**
- Create: `src/engine/rules/pmConfig.ts`, `src/engine/rules/gitConfig.ts`, `src/engine/rules/textTricks.ts`
- Modify: `src/engine/index.ts`
- Test: `test/engine/rules/{pmConfig,gitConfig,textTricks}.test.ts`

**Interfaces:**
- Produces `pmConfigRules`, `gitConfigRules` and `textTrickRules`, each of type `Rule[]`. Rule IDs and levels:
  - `npmrc.dangerous-key` (`script-shell`, `node-options`, `registry` ≠ `https://registry.npmjs.org/`) → high
  - `yarn.repo-binary` (`.yarnrc.yml` `yarnPath`/`plugins[].path`, `.yarnrc` `yarn-path`) → high
  - `pnpmfile.present` → caution, `pnpmfile.dangerous` (`child_process`, `fetch(`, `http.request`) → critical
  - `foundry.ffi` → caution
  - `gitconfig.exec-key` (`core.fsmonitor|sshCommand|pager|editor|hooksPath`, `filter.*.clean|smudge|process`, `diff.external`, an alias starting with `!`) → critical. Only applies when `.git/config` is present (Flow 2).
  - `githooks.present` → high
  - `text.long-line` (>2000 chars in a non-minified config or script file, or ≥200 consecutive spaces followed by non-space) → high
  - `text.bidi` (U+202A–U+202E, U+2066–U+2069) → caution

- [ ] **Step 1:** Write one positive and one negative fixture test per rule ID above.
- [ ] **Step 2:** Run `npx vitest run test/engine/rules/{pmConfig,gitConfig,textTricks}`. Expected: FAIL.
- [ ] **Step 3:** Implement. Parse `.gitconfig` INI and `.npmrc` with a line splitter, and `.yarnrc.yml` with `yaml` (`maxAliasCount: 50`).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): package-manager, git-config and text-trick rules`

### Task 7: Install-script and source-pattern rules

**Files:**
- Create: `src/engine/rules/installScripts.ts`, `src/engine/rules/source.ts`
- Modify: `src/engine/index.ts`
- Test: `test/engine/rules/{installScripts,source}.test.ts`

**Interfaces:**
- Consumes: `dangerSignals` (Task 5)
- Produces `installScriptRules` and `sourceRules` (`Rule[]`):
  - `scripts.lifecycle` (`preinstall`/`install`/`postinstall`/`prepare` in **every** `package.json`) → caution. With a `dangerSignals` hit → critical.
  - `source.*` signals: `eval`, `new-function`, `base64-exec` (base64 decode within 300 chars of eval, Function or child_process), `child-process` (outside paths matching `/(^|\/)(scripts|build|tools|config)\//` or `*.config.*`), `raw-ip-url`, `secret-path-read` (`.env`, `keystore`, `.config/solana/id.json`, `.ssh/`, `Local Extension Settings`). One signal per file → caution. Two or more distinct signals in one file → high. `base64-exec` combined with `secret-path-read` → critical.

- [ ] **Step 1:** Write a fixture-matrix test with signal combinations against the expected levels above, plus `child_process in scripts/build.js → no finding`.
- [ ] **Step 2:** Run `npx vitest run test/engine/rules/{installScripts,source}`. Expected: FAIL.
- [ ] **Step 3:** Implement. Each regex runs on lines truncated to 4096 chars.
- [ ] **Step 4:** Run the same command. Expected: PASS. Add CI step `npx recheck` over the exported regex list (`src/engine/rules/regexes.ts`). Expected: no vulnerable patterns.
- [ ] **Step 5:** Commit `feat(engine): install-script and source rules`

### Task 8: Lockfile parsers and dependency rules

**Files:**
- Create: `src/engine/parsers/lockfiles/{npm,yarn1,yarnBerry,pnpm,bun}.ts`, `src/engine/rules/deps.ts`, `src/engine/purls.ts`
- Modify: `src/engine/index.ts`
- Test: `test/engine/lockfiles.test.ts`, `test/engine/rules/deps.test.ts`, golden fixtures for each format

**Interfaces:**
- Produces:
  - `collectPurls(files: VirtualFile[]): { purls: string[]; notChecked: string[] }`. PURL format is `pkg:npm/%40scope/name@1.2.3`.
  - `depRules: Rule[]`:
    - `deps.unverified-source` (`git+`, `github:`, `http(s)://` tarball, `file:`, `link:`) → caution
    - `deps.foreign-registry` (`resolved` host ≠ `registry.npmjs.org`/`registry.yarnpkg.com`) → high
    - `deps.no-integrity` → caution

- [ ] **Step 1: Write failing tests:** golden PURL lists for each format. `package.json without lockfile → notChecked ["Exact package versions unresolved"]`. `bun.lockb only → notChecked`. `no manifest → no notChecked` (Review Focus 2). `fake file: package flagged with network off`.
- [ ] **Step 2:** Run `npx vitest run test/engine/lockfiles test/engine/rules/deps`. Expected: FAIL.
- [ ] **Step 3:** Implement. Do not include `file:` and `link:` dependencies in `purls`, because Socket cannot know them. Their folders are already covered by Tasks 5–7 through the walker.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): lockfile parsers and dependency rules`

### Task 9: Secret rules and redactor

**Files:**
- Create: `src/engine/rules/secrets.ts`, `src/engine/bip39.ts` (English word list plus checksum), `src/verdict/redact.ts`
- Modify: `src/engine/index.ts`
- Test: `test/engine/rules/secrets.test.ts`, `test/verdict/redact.test.ts`

**Interfaces:**
- Produces:
  - `secretRules: Rule[]`. Rule IDs: `secret.evm-key`, `secret.mnemonic` (12/15/18/21/24 words, checksum valid), `secret.pem`, `secret.solana-keypair` (JSON array of 64 ints 0–255), `secret.keystore`, `secret.dotenv`. Severity is caution in `ctx.mode === 'clone'` and high otherwise. Evidence holds the masked form only, e.g. `0x3f…a91`.
  - `type SafeFinding = Finding & { readonly __safe: true }`
  - `redact(f: Finding): SafeFinding`, which masks every secret-pattern match in `title` and `evidence`, strips control and bidi chars, and truncates evidence to 300.
  - `redactAll(fs: Finding[]): SafeFinding[]`, which caps the list at 20 (highest severity first).

- [ ] **Step 1: Write failing tests:** `valid mnemonic flagged; 12 random English words with bad checksum not flagged`. `redact masks a key embedded in a tasks.json evidence string`. `redactAll returns ≤20, critical first`. `evidence never contains a full 64-hex key`.
- [ ] **Step 2:** Run `npx vitest run test/engine/rules/secrets test/verdict/redact`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: secret rules and egress redactor`

### Task 10: API client and merge

**Files:**
- Create: `src/api/client.ts`, `src/api/merge.ts`
- Test: `test/api/client.test.ts`, `test/api/merge.test.ts`

**Interfaces:**
- Consumes: `getSettings` (Task 1), schemas (Task 2), `SafeFinding` (Task 9), `aggregate` (Task 2)
- Produces:
  - `type Result<T> = { ok: true; value: T } | { ok: false; reason: string }`
  - `createClient(opts: { baseUrl: string; allowLocalhost: boolean; fetchImpl?: typeof fetch }): Stack3Client`, where `Stack3Client` has:
    - `scanPackage(purls: string[]): Promise<Result<Finding[]>>`
    - `explain(level: Level, findings: SafeFinding[]): Promise<Result<{ explanation: string; fix: string }>>`
    - `report(p: ReportPayload): Promise<Result<void>>`
  - `buildVerdict(local: EngineResult, remote: Result<Finding[]>, target: Verdict['target'], indicators: Indicators): Verdict`. On `ok:false` it adds `notChecked: 'Package scan unavailable'`.
  - When `STACK3_MOCK=1`, `createClient` returns a client that serves `mocks/*.json`.

- [ ] **Step 1: Write failing tests**

```ts
test('remote level is ignored', ...)            // server sends {level:'no_known_issues', findings:[]}, local critical → critical
test('network error → unknown + notChecked', ...)
test('timeout at 8000ms → ok:false', ...)
test('response >1 MiB → ok:false', ...)
test('http: baseUrl rejected unless localhost+allowLocalhost', ...)
test('explain body only contains SafeFinding fields, ≤20 items, evidence ≤300', ...)
test('explain response with level field does not change verdict', ...)
```

- [ ] **Step 2:** Run `npx vitest run test/api`. Expected: FAIL.
- [ ] **Step 3:** Implement using global `fetch` + `AbortController`. Read the body as a stream and abort past 1 MiB. Send header `X-Stack3-Client: vscode/<version>` and nothing identifying.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): client with merge that can only raise the level`

### Task 11: Quarantine and hardened git clone

**Files:**
- Create: `src/quarantine/paths.ts`, `src/quarantine/git.ts`, `src/quarantine/remove.ts`, `src/quarantine/registry.ts`
- Test: `test/quarantine/{url,git,remove}.test.ts`

**Interfaces:**
- Consumes: `isInside` (Task 3)
- Produces:
  - `validateRepoUrl(input: string): { owner: string; repo: string; url: string } | { error: string }`
  - `gitVersionOk(versionOutput: string): boolean` (minimum `2.45.1`. **V-9: verify this number against the git advisory before merging.**)
  - `buildCloneArgs(url: string, dest: string, hooksDir: string, templateDir: string): string[]`
  - `cloneRepo(url: string, dest: string): Promise<Result<{ sha: string }>>`
  - `quarantineRoot(): string` (`path.join(os.tmpdir(), 'stack3-quarantine')`)
  - `createQuarantineDir(owner: string, repo: string): Promise<string>`
  - `removeQuarantined(dir: string): Promise<void>`, which throws `OutsideQuarantineError` if the dir is not inside the root
  - `Registry` with `add(rec: ScanRecord)`, `get(scanId: string)`, `remove(scanId: string)`, `pruneOlderThan(days: number)`, backed by `globalState`
  - `ScanRecord = { scanId: string; dir: string; url: string; sha: string; verdict: Verdict; scanSetHash: string; createdAt: number }`

- [ ] **Step 1: Write failing tests**

```ts
test('validateRepoUrl normalizes common forms', ...)   // Review Focus 1: github.com/x/y, /tree/main, git@github.com:x/y.git, .git, trailing /
test('rejects --upload-pack=, ext::, file://, .., non-github', ...)
test('buildCloneArgs exact argv', () => expect(buildCloneArgs(U, D, H, T)).toEqual([
  '-c','core.symlinks=false','-c',`core.hooksPath=${H}`,'-c','core.fsmonitor=false',
  '-c','protocol.allow=never','-c','protocol.https.allow=always','-c','submodule.recurse=false',
  '-c','transfer.fsckObjects=true','clone','--depth','1','--single-branch',
  '--no-recurse-submodules',`--template=${T}`,'--',U,D]));
test('spawn env scrubbed', ...)   // GIT_TERMINAL_PROMPT=0, GIT_CONFIG_NOSYSTEM=1, GIT_CONFIG_GLOBAL=<empty file>, GIT_LFS_SKIP_SMUDGE=1, no GIT_ASKPASS
test('gitVersionOk("git version 2.39.0") false; "2.47.1" true', ...)
test('removeQuarantined refuses outside root, .. and symlinked escape', ...)
test('quarantine dir mode 0o700 on posix', ...)
```

- [ ] **Step 2:** Run `npx vitest run test/quarantine`. Expected: FAIL.
- [ ] **Step 3:** Implement with `execFile('git', args, { shell: false, cwd: quarantineRoot(), timeout: 120000, env })` and then `git -C dest rev-parse HEAD`, the only other git call, which runs in our own fresh clone. Name the dir `<owner>__<repo>__<8 random hex>`.
- [ ] **Step 4:** Run the same command. Expected: PASS. Integration: cloning a local bare fixture remote over `file://` must be **refused**, which proves `protocol.allow=never` works.
- [ ] **Step 5:** Commit `feat(quarantine): hardened clone and contained delete`

### Task 12: Clone-and-scan command

**Files:**
- Create: `src/commands/cloneAndScan.ts`, `src/scan/hash.ts`
- Modify: `src/extension.ts` (register `stack3.cloneAndScan`), `package.json` (command contribution "Stack3: Clone and scan safely")
- Test: `test/commands/cloneAndScan.test.ts`, `test/canary.test.ts`

**Interfaces:**
- Consumes: `validateRepoUrl`, `cloneRepo`, `createQuarantineDir`, `Registry` (Task 11); `runScan` (Task 4); `createClient`, `buildVerdict` (Task 10); `extractIndicators` (Task 17, an empty stub until then); `showVerdictPanel` (Task 13)
- Produces:
  - `cloneAndScan(input: string, deps: CloneDeps): Promise<Result<ScanRecord>>`
  - `hashScanSet(dir: string): Promise<string>`, the sha256 over the sorted paths and bytes of `.vscode/**`, `.devcontainer/**`, `**/package.json`, lockfiles, `.npmrc`, `.yarnrc*`, `.pnpmfile.cjs`, `*.code-workspace`
  - `scanId = sha256(url + sha + ENGINE_VERSION)`

- [ ] **Step 1: Write failing tests:** `clone failure shows error, no panel` (Review Focus 3). `success: registry has record, panel shown once with the verdict`. `canary: interview-task fixture remote → cloneAndScan → canary file absent` (the fixture's task would write `$TMP/stack3-canary`).
- [ ] **Step 2:** Run `npx vitest run test/commands test/canary`. Expected: FAIL.
- [ ] **Step 3:** Implement the flow: validate → clone → `runScan(dir, {mode:'clone'})` → `client.scanPackage(purls)` → `buildVerdict` → hash → registry → panel. Show progress via `window.withProgress`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(vscode): clone and scan safely command`

### Task 13: Verdict panel and message bridge

**Files:**
- Create: `src/ui/panel.ts`, `src/ui/bridge.ts`, `src/ui/quarantineFs.ts`, `webview/main.ts`, `webview/styles.css`
- Modify: `esbuild.mjs` (webview bundle to `dist/webview/`)
- Test: `test/ui/{panel,bridge}.test.ts`, `test/integration/webview-xss.test.ts`

**Interfaces:**
- Consumes: `ScanRecord`, `Registry` (Task 11)
- Produces:
  - `renderHtml(cspSource: string, nonce: string, scriptUri: string, styleUri: string): string`
  - `type WebviewAction = { type: 'action'; scanId: string; action: 'openNeutralized'|'open'|'delete'|'viewFile'|'copyReport'; file?: string }`
  - `parseWebviewMessage(raw: unknown): WebviewAction | null` (zod, strict)
  - `showVerdictPanel(ctx: vscode.ExtensionContext, rec: ScanRecord, handlers: ActionHandlers): void`, where `ActionHandlers` has one method per action, implemented in Task 14
  - `buttonsFor(level: Level): WebviewAction['action'][]` (D-3): critical → `['delete','openNeutralized']`, high → `['openNeutralized','open','delete']`, otherwise → `['open','openNeutralized','delete']`
  - The `stack3-quarantine:` `TextDocumentContentProvider` serves files (contained, ≤1 MiB) as plaintext
- Placeholder UI: `webview/main.ts` renders with `textContent` only. Ivo's React panel replaces it later and must keep the same message schema.

- [ ] **Step 1: Write failing tests**

```ts
test('CSP has nonce, no unsafe-inline/unsafe-eval', () => {
  const h = renderHtml('vscode-resource:', 'N', 's.js', 's.css');
  expect(h).toContain("default-src 'none'"); expect(h).toContain("script-src 'nonce-N'");
  expect(h).not.toMatch(/unsafe-(inline|eval)/);
});
test('parseWebviewMessage rejects unknown action / extra keys / wrong types', ...)
test('mismatched scanId dropped', ...)
test('open on high requires modal confirm; cancel → no handler call', ...)
test('viewFile with ../../.ssh/id_rsa refused', ...)
test('XSS evidence <img src=x onerror=alert(1)> renders as literal text', ...) // integration
test('no UI string matches /\\bsafe\\b/i', ...)
```

- [ ] **Step 2:** Run `npx vitest run test/ui` and `npm run test:integration -- webview-xss`. Expected: FAIL.
- [ ] **Step 3:** Implement. `createWebviewPanel` options: `{ enableScripts: true, localResourceRoots: [dist/webview] }` and no `enableCommandUris`. Generate the nonce with `crypto.randomBytes(16).toString('base64')`.
- [ ] **Step 4:** Run the same commands. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): CSP-locked verdict panel with validated message bridge`

### Task 14: Open with auto-run disabled, Open, Delete, auto-task consent

**Files:**
- Create: `src/quarantine/neutralize.ts`, `src/commands/actions.ts`, `src/guard/autoTasks.ts`
- Test: `test/quarantine/neutralize.test.ts`, `test/commands/actions.test.ts`, `test/guard/autoTasks.test.ts`

**Interfaces:**
- Consumes: `hashScanSet` (Task 12), `removeQuarantined`, `Registry` (Task 11), `ActionHandlers` (Task 13)
- Produces:
  - `neutralize(dir: string): Promise<string[]>`, which moves `.vscode/` and `.devcontainer/` into `.stack3-disabled/` and writes `.stack3-disabled/README.txt`. Returns the moved paths.
  - `createActionHandlers(deps): ActionHandlers`. `open` and `openNeutralized` re-hash first, and on a mismatch run a re-scan with no open. Then `vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true })`.
  - `maybeOfferAutoTaskGuard(ctx): Promise<void>`, a one-time prompt (`globalState` key `stack3.autoTaskPrompted`). On consent it calls `getConfiguration('task').update('allowAutomaticTasks', 'off', ConfigurationTarget.Global)`.

- [ ] **Step 1: Write failing tests:** `neutralize moves both dirs, leaves package.json`. `hash mismatch → re-scan, no openFolder`. `delete calls removeQuarantined and drops registry entry`. `consent declined → setting untouched, never asked again`. `canary: openNeutralized on interview-task → canary absent` (integration, `@vscode/test-electron`).
- [ ] **Step 2:** Run `npx vitest run test/quarantine/neutralize test/commands/actions test/guard/autoTasks`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS. Then manually check **V-1** and record the result in `DECISIONS.md`: clone under a trusted parent, choose Open, and note whether a trust prompt appears.
- [ ] **Step 5:** Commit `feat(vscode): neutralized open, contained delete, auto-task consent`

### Task 15: Watchers and diagnostics (Flow 3)

**Files:**
- Create: `src/guard/watchers.ts`, `src/guard/staged.ts`, `src/ui/diagnostics.ts`, `src/ui/statusbar.ts`
- Modify: `src/extension.ts` (activation `onStartupFinished`)
- Test: `test/guard/watchers.test.ts`, `test/ui/diagnostics.test.ts`

**Interfaces:**
- Consumes: `runScan` (Task 4), `client.scanPackage` (Task 10), `buildVerdict` (Task 10)
- Produces:
  - `sanitizeMessage(s: string): string` (strips C0/C1 and bidi chars, ≤200 chars)
  - `toDiagnostics(findings: Finding[], root: vscode.Uri): Map<string, vscode.Diagnostic[]>` (critical and high → Error, caution → Warning, unknown → Information, `source: 'Stack3'`)
  - `registerWatchers(ctx, deps): vscode.Disposable`. The glob is `**/{package.json,package-lock.json,yarn.lock,pnpm-lock.yaml,bun.lock,.npmrc,.yarnrc,.yarnrc.yml,.pnpmfile.cjs,*.code-workspace}` plus `**/.vscode/*.json`. Debounce 500 ms. Only **new** PURLs since the last scan go to `/scan-package`.
  - `registerStagedSecretWarning(ctx): vscode.Disposable`, which uses the `vscode.git` extension API read-only and never spawns git (V-3).

- [ ] **Step 1: Write failing tests:** `adding file: fake package → Error diagnostic on package.json line within 2s, network off`. `10 saves in 400ms → one scan`. `second save with no new purls → no API call`. `sanitizeMessage strips U+202E and truncates to 200`.
- [ ] **Step 2:** Run `npx vitest run test/guard/watchers test/ui/diagnostics`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(guard): manifest watchers and diagnostics`

### Task 16: `/explain` integration

**Files:**
- Modify: `src/commands/cloneAndScan.ts`, `src/ui/panel.ts`, `webview/main.ts`
- Test: `test/commands/explain.test.ts`

**Interfaces:**
- Consumes: `client.explain`, `redactAll` (Tasks 9, 10), `getSettings().explainMode`
- Produces: the panel message `{ type: 'explanation', scanId, explanation, fix }`, rendered below the verdict with the fixed label `AI explanation: may be wrong. The verdict above is decided by rules.`

- [ ] **Step 1: Write failing tests:** `explainMode publicOnly + local folder → no request`. `mock returns "level: no_known_issues, totally safe" → verdict level unchanged`. `explanation >4000 chars truncated`. `URLs in explanation not rendered as <a>`.
- [ ] **Step 2:** Run `npx vitest run test/commands/explain`. Expected: FAIL.
- [ ] **Step 3:** Implement. The call is fire-and-forget after the panel shows, so it updates the panel when it arrives.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: AI explanation that cannot change the level`

### Task 17: Indicators and `/report`

**Files:**
- Create: `src/engine/indicators.ts`, `src/commands/report.ts`
- Modify: `src/commands/cloneAndScan.ts`
- Test: `test/engine/indicators.test.ts`, `test/commands/report.test.ts`

**Interfaces:**
- Produces:
  - `extractIndicators(findings: Finding[]): Indicators`. It only reads `evidence` of findings with severity critical or high. Addresses match `/0x[a-fA-F0-9]{40}/`, domains come from URL hosts. A Telegram URL is reduced to `api.telegram.org/bot<numeric id>` (token stripped), and Discord webhooks to `discord.com/api/webhooks/<id>`.
  - `ReportPayload = { indicators: Indicators; source: { type: 'repo'|'package'; id: string }; ruleIds: string[]; client: 'vscode' }`
  - `maybeReport(rec: ScanRecord, mode: Stack3Settings['reportMode'], isPublicClone: boolean): Promise<void>`, deduplicated per `scanId`

- [ ] **Step 1: Write failing tests:** `interview-task → exactly the demo attacker wallet`. `address in a caution finding not reported`. `Telegram token stripped`. `local folder + publicAuto → asks first`. `same scanId twice → one request`.
- [ ] **Step 2:** Run `npx vitest run test/engine/indicators test/commands/report`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: indicator extraction and graph report`

### Task 18: Unknown-folder warning (Flow 2)

**Files:**
- Create: `src/guard/unknownFolder.ts`
- Modify: `package.json` (`activationEvents`: `onStartupFinished`, `workspaceContains:.vscode/tasks.json`, `workspaceContains:.devcontainer/devcontainer.json`, `workspaceContains:.git/config`)
- Test: `test/guard/unknownFolder.test.ts`

**Interfaces:**
- Consumes: `runScan` with `{ mode: 'quick' }` and `walk` `includeGitConfig: true`
- Produces: `checkUnknownFolder(folder: vscode.Uri, isTrusted: boolean): Promise<void>`. If the level is high or critical, it shows a modal titled "Don't trust this folder" with the top 3 findings. If `isTrusted` is true, it adds "Auto-run tasks may already have run."

- [ ] **Step 1: Write failing tests:** `untrusted + hostile .git/config → modal with gitconfig.exec-key`. `trusted → message includes "may already have run"`. `clean folder → no modal`. `warned once per folder`.
- [ ] **Step 2:** Run `npx vitest run test/guard/unknownFolder`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(guard): best-effort unknown-folder warning`

### Task 19: Egress audit, packaging and release

**Files:**
- Create: `test/egress.test.ts`, `scripts/check-bundle.mjs`, `.github/workflows/vscode.yml`
- Modify: `package.json` (`engines.vscode`, `vsce` scripts)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write failing tests:**
  - `egress`: run every flow (clone, watcher, explain, report) with a recording `fetchImpl`. Assert that no body contains any fixture secret, any canary content, or any evidence >300 chars, and that every URL starts with `apiUrl`.
  - `check-bundle`: `dist/*.js` contains no `eval(` and no `new Function(`.
- [ ] **Step 2:** Run `npx vitest run test/egress && node scripts/check-bundle.mjs`. Expected: FAIL until the wiring is complete.
- [ ] **Step 3:** CI runs `npm ci --ignore-scripts` → lint → `tsc` → `vitest run --coverage` (engine lines ≥90%) → recheck → build → check-bundle → `vsce package --no-dependencies` → `sha256sum *.vsix`. Set `engines.vscode` to the lowest version that has every API used (record it in `DECISIONS.md`).
- [ ] **Step 4:** Run the full CI locally. Expected: all green, a `.vsix` file and a checksum printed.
- [ ] **Step 5:** Run the ARCHITECTURE Part 5 rehearsal list on a fresh `--user-data-dir` profile and in Cursor, then commit `chore: egress audit, CI and vsix packaging`.

---

## Schedule (from the PDF timeline)

| Block | Tasks |
|---|---|
| Thu night | 1, 2 (push to team), 3, 4, 5 |
| Fri 9 AM–2 PM | 8, 10, 11, 12, 13, 14, 17 |
| Fri 2 PM–10 PM | 6, 7, 9, 15, 16, 19 (`.vsix`) |
| Fri night, if ahead | 18 |

**Never cut:** 1–5, 8, 10–14, 17. These are needed for the full demo story.
