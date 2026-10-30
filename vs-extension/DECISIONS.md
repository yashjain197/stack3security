# VS Code Extension: Decision Log

This file is kept separate from [`ARCHITECTURE.md`](./ARCHITECTURE.md). Each entry has a Status, the Decision, Why, Evidence, and what it does Not cover. When a build step deviates from the blueprint, add a dated status note to that step in the blueprint too.

## Summary

| ID | Decision | Status | Owner |
|---|---|---|---|
| D-1 | Monorepo layout (`packages/engine`, `apps/vscode`) | Proposed | Imran + team |
| D-2 | Quarantine in `os.tmpdir()/stack3-quarantine` | Accepted | Imran |
| D-3 | Button set per verdict level | Accepted | Imran + Ivo |
| D-4 | Neutralize by moving `.vscode/` and `.devcontainer/` | Accepted | Imran |
| D-5 | `/explain` snippets: public clones on, local opt-in | Accepted | Imran |
| D-6 | Graph poisoning policy for client reports | Proposed | Yash |
| D-7 | `task.allowAutomaticTasks: off` with consent | Accepted | Imran |
| D-8 | Auto-report indicators only for public clones | Accepted | Imran + Yash |
| D-9 | Hardened `git clone` over a tarball download | Accepted | Imran |
| D-10 | Minimum git version is a per-series patch level | Accepted | Imran |
| D-11 | Lockfiles get a 16 MiB read cap | Accepted | Imran |

## Entries

### D-1: Repo layout
- **Status:** Proposed, 2026-10-29
- **Decision:** Follow the PDF's monorepo (`packages/engine`, `packages/ui`, `apps/vscode`). Move the current `vs-extension/` placeholder into it.
- **Why:** The CLI and the API reuse the engine. A flat folder would force copying rules into each one.
- **Evidence:** PDF, "Monorepo layout". The repo currently has `vs-extension/test.txt` only.
- **Not covered:** The workspace tooling choice (pnpm is assumed).

### D-2: Quarantine location
- **Status:** Accepted, 2026-10-30 (the user took the recommended default)
- **Decision:** Use `os.tmpdir()/stack3-quarantine/<owner>__<repo>__<rand>`, mode 0700.
- **Why:** Users often trust `~` or their projects folder as a parent, and a clone there would open trusted (V-1).
- **Evidence:** Blueprint §0.2 and V-1 (unverified).
- **Not covered:** Users who trust `/tmp`. Neutralization (D-4) covers that case.

### D-3: Buttons per level
- **Status:** Accepted, 2026-10-30 (the user took the recommended default)
- **Decision:**
  - critical: Delete (primary), Open with auto-run disabled (confirm).
  - high: Open with auto-run disabled (primary), Open (modal).
  - caution and below: Open.
- **Why:** The PDF's "Open in Restricted Mode" cannot be forced (V-1).
- **Evidence:** PDF Flow 1 step 4.
- **Not covered:** Final copy (Ivo).

### D-4: Neutralize before opening
- **Status:** Accepted, 2026-10-30 (the user took the recommended default)
- **Decision:** Move `.vscode/` and `.devcontainer/` to `.stack3-disabled/` inside the quarantine clone, and add a README.
- **Why:** It works whatever the trust state is.
- **Evidence:** Blueprint S10.
- **Not covered:** Install scripts (they only run on install) and other extensions reading other config files.

### D-5: `/explain` snippet consent
- **Status:** Accepted, 2026-10-30 (the user took the recommended default)
- **Decision:** `stack3.explain.sendSnippets = "publicOnly"` by default.
- **Why:** Local folders may be private code.
- **Evidence:** PDF privacy rule.
- **Not covered:** Server-side retention of snippets (to be decided by the API owner).

### D-6: Graph poisoning
- **Status:** Proposed, **needs Yash**
- **Decision:** Reports from clients are *unconfirmed*. `tx_risk` returns critical only for confirmed indicators or ≥2 independent sources, with an allow-list of well-known contracts.
- **Why:** A repo can plant a legitimate DEX router address to get real users blocked.
- **Evidence:** Blueprint S13.
- **Not covered:** How the confirmation workflow works.

### D-7: Automatic tasks off
- **Status:** Accepted, 2026-10-30 (the user took the recommended default)
- **Decision:** A one-time consent prompt, then set `task.allowAutomaticTasks` to `"off"` at user scope.
- **Why:** Defence in depth against `folderOpen` tasks.
- **Evidence:** PDF Flow 3. V-4 is unverified.
- **Not covered:** Workspaces that legitimately need automatic tasks.

### D-8: Indicator reporting
- **Status:** Accepted, 2026-10-30 (the user took the recommended default)
- **Decision:** Automatic for public-URL clones. Ask first for local folders.
- **Why:** A local folder can contain private internal domains.
- **Evidence:** Blueprint §2.4.
- **Not covered:** n/a

### D-9: Fetch method
- **Status:** Accepted, 2026-10-30 (the user took the recommended default)
- **Decision:** Hardened `git clone` (blueprint §2.6) instead of a GitHub tarball.
- **Why:** It keeps the commit SHA for verdict binding and avoids archive-extraction bugs.
- **Evidence:** CVE-2024-32002 class (V-9).
- **Not covered:** Private repos. Use local scan or the CLI for those.

### D-10: Minimum git version
- **Status:** Accepted, 2026-10-30
- **Decision:** Refuse to clone unless `git --version` is at or above the first patched release of its series: 2.39.4, 2.40.2, 2.41.1, 2.42.2, 2.43.4, 2.44.1, 2.45.1, or any 2.46 or later. Older gets a clear message, not a weaker clone.
- **Why:** The fix for CVE-2024-32002 (and CVE-2024-32004, -32020, -32021, -32465) shipped in those releases. A flat "2.45.1 or newer" would wrongly reject patched 2.39 to 2.44 builds.
- **Evidence:** Upstream release notes for v2.45.1 and v2.43.4 list these versions. Resolves V-9.
- **Not covered:** Distribution builds that backport the fix but still report an older number (for example Ubuntu 24.04 `2.43.0-1ubuntu7.3`, whose changelog includes the CVE-2024-32002 patch). `git --version` cannot tell them apart, so they are refused; upgrade git (for example from the git-core PPA) to clone.

### D-11: Lockfile size cap
- **Status:** Accepted, 2026-10-30
- **Decision:** The walker reads lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`) up to 16 MiB each. Every other file keeps `maxFileBytes` (1 MiB). Lockfile bytes still count toward `maxTotalBytes`.
- **Why:** Real lockfiles are often several MiB. A truncated JSON or YAML lockfile cannot be parsed, so the whole dependency check would be reported as not done.
- **Evidence:** Task 8 parsers; test `lockfiles get a higher per-file cap`.
- **Not covered:** A lockfile over 16 MiB is still truncated and reported as not fully checked.

### D-12: Minimum VS Code version
- **Status:** Accepted, 2026-10-30
- **Decision:** `engines.vscode` stays `^1.90.0`.
- **Why:** The code compiles against `@types/vscode` 1.90.0 with `tsc --noEmit` clean, so every API it uses exists in 1.90. `vsce` also refuses an `engines.vscode` newer than the types. The `vscode.git` extension API used for the staged-secret warning is read through our own narrow types and guarded, so its absence only turns that warning off.
- **Evidence:** the `.vsix` installs in VS Code 1.142.0 and Cursor 3.18.9 on a fresh `--user-data-dir`/`--extensions-dir`; the integration suite runs in 1.142.0. It has not been run on 1.90 itself.
- **Not covered:** behaviour on VS Code 1.90 to 1.141, which is assumed from the API levels and not tested.

### D-13: Licence is MIT, and publishing is enabled
- **Status:** Accepted, 2026-10-30 (the owner chose MIT)
- **Decision:** `LICENSE` is the MIT licence, copyright "The Stack3 Security team", and `package.json` says `"license": "MIT"`. `"private": true` is removed so `vsce publish` works. Publishing steps, scripts and the tag-driven workflow are in `PUBLISHING.md`.
- **Why:** An open licence is needed for a public Marketplace listing, and MIT keeps the terms simple. The server-side scan notice ("known patterns only, not a guarantee") stays in the README.
- **Still open:** the copyright holder's legal name; the Marketplace publisher ID `stack3` must be created by a person.

### D-14: ReDoS check and what it changed
- **Status:** Accepted, 2026-10-30
- **Decision:** `npm run check:regexes` runs `recheck` over every regex literal and constant `new RegExp` in `src/`, found with the TypeScript parser. It fails the build on `vulnerable` or `unknown`. One pattern is allowed by name with its reason (`regexes.ts` base64 decode: a hard 200-character gap defeats the automaton checker). Three patterns built from templates at run time are listed, not checked.
- **Found and fixed:** `/x+$/` trims (4 sites plus one in `indicators.ts`), the `.env` line parser, the `node -e` signal (cubic), the `SPAWN_OK` path pattern and the JSON web token redaction pattern. All were polynomial; the worst (`.npmrc` registry value) was quadratic over a line that could be 1 MiB. Each is now a loop or a linear pattern with a test in `test/engine/rules/redos.test.ts` and `test/verdict/redact.test.ts`.
- **Behaviour change:** a JSON web token written directly after `-` or `_` (for example `x-eyJ...`) is no longer matched by the redactor, because the pattern now starts at the beginning of a token run.
- **Not covered:** patterns built at run time (`src/ai/explain.ts`, the `rawIpUrl` copy in `source.ts`), which run on text capped at 4096 characters.

### D-15: Socket package scan in the repo-scan service
- **Status:** Accepted, 2026-10-30
- **Decision:** `src/server/socket.ts` calls Socket's batch purl route with `alerts=true&purlErrors=true`. It uses `POST /v0/orgs/{org_slug}/purl` when `SOCKET_ORG_SLUG` is set and the deprecated `POST /v0/purl` otherwise. Only critical and high alerts in the `supplyChainRisk` category become findings (the blueprint's "malware, typosquats, install scripts, env exfiltration").
- **Why:** The OpenAPI spec (api.socket.dev/v0/openapi) marks `/v0/purl` deprecated since 2026-01-05 and lists the org route as its replacement. Both need the `packages:list` scope. "Middle" alerts (network access, eval, shell use) fire on ordinary packages and would put most repositories at caution. Known-CVE (`vulnerability`) alerts are dropped: the first live scan of `lodash/lodash` (602 packages) came back critical with 101 findings, all old-CVE alerts on dev dependencies, which is not what this product warns about. A package without a verdict must never read as clean, so it is counted in `notChecked`.
- **Evidence:** `test/server/socket.test.ts` (request shape, NDJSON parsing, severity filter, unresolved packages, failures, size and time caps), with a mutation check on the severity filter.
- **Not covered:** a live call. The response shape comes from the spec, not from a real key. The backend's own Socket call (`app/modules/protection/scripts.py`) uses `GET /v0/purl?purl=`, which is not in the spec and may not work; that is the backend's to check.
- **Cost:** up to 4 requests (400 quota units) per uncached scan of a repository with 1500+ packages; usually 1 (100 units). Results are cached for `CACHE_TTL_MS`.

### D-16: Rule changes found by rehearsal 3 (ten clean repositories)
- **Status:** Accepted, 2026-10-30
- **Decision:** Running the engine over ten well-known clean Node and Web3 repositories (`scripts/rehearsal-clean-repos.mjs`) gave `high` for vite, ethers, wagmi and hardhat. Every one was a false alarm, fixed with a regression test (which fails on the old code):
  1. `text.long-line`: a line over 2000 characters in a **source file** (`.js`, `.ts`, ...) is `high` only when the line itself contains a code sink (`eval(`, `new Function(`, `child_process`, a base64 decode). Plain long data (word lists, embedded bytecode, test vectors) is `caution`. Shell, yaml, config and `.vscode` files, and the "hidden behind 200+ spaces" case, stay `high`.
  2. `source.multiple-signals`: `caution` instead of `high` when the signals are only code-running ones (`eval`, `new Function`, `child_process`) with no secret read, decode or raw IP, and when the file is a test, spec, playground, e2e or fixture file. A **decode-and-run** (`base64-exec`) is never softened, wherever the file is.
  3. Comment lines (`//`, `*`, `/*`) are not scanned for source signals, because documentation that names `.env` or `child_process` is not behaviour. A line that closes a comment (`*/`) is still scanned, since code can follow it.
  4. `secret-path-read` ignores a line that is only a quoted name in a list (`'.env',`): a dev server's deny list is data. The same name inside a call (`readFileSync('.env')`) still counts.
  5. `secret.evm-key`: the word `private` alone is no longer key context (it is the visibility keyword in `bytes32 private constant TYPEHASH = 0x...`). `private key`, `privateKey`, `private_key`, `secret`, `signer` and the others still are.
  6. pnpm lockfile parser: newer pnpm writes several YAML documents (`---`) in one `pnpm-lock.yaml`. These used to fail as "Could not read pnpm-lock.yaml", which forced `unknown` on vite and hardhat. All documents are now read (at most 4).
  7. A locked package downloaded from `codeload.github.com` is a GitHub (git) dependency: `deps.unverified-source` (caution), not `deps.foreign-registry` (high). This only appeared once item 6 let hardhat's lockfile be read. Look-alike hosts (`codeload.github.com.evil.example`, `...@evil.example`) are still a foreign registry.
- **What this costs (accepted evasions):** a hostile file can now stay at `caution` if it (a) puts a long line of non-code data-like text in a source file, (b) pairs `child_process` with `eval` or `new Function` and nothing else, (c) hides a stealer in a file under `test/`, `playground/` or similar **without** a decode-and-run, (d) names `.env` on its own line and reads it through a variable, or (e) puts the `.env` in a comment line. These cases still show as `caution`, not as nothing. Install-script, auto-run task and decode-and-run detection are unchanged.
- **Evidence:** regression tests in `test/engine/rules/{textTricks,source,secrets}.test.ts` and `test/engine/lockfiles.test.ts`; the result table under "Release checks".

### D-17: `stack3.scan.exclude`, a per-folder exclusion that only the user can set
- **Status:** Accepted, 2026-10-30
- **Decision:** A user-level (application scope) setting maps one exact folder path to a list of relative paths that the guard scans (Problems panel, unknown-folder check) skip. Matching is by plain path prefix: no wildcards, no regular expressions. Anything skipped adds "Some paths are excluded by your stack3.scan.exclude setting" to `notChecked`, so the level is at least `unknown` and never "no known issues".
- **Why:** Opening this repo showed 6 critical findings in the Problems panel. All were the deliberate attack fixtures and payload strings the tests and demo rely on, so they cannot be deleted. A file inside the repo that says "ignore this" would let a hostile repo hide its own payload, so the list lives only in the user's settings, as `apiUrl` does (I-10).
- **Safety properties:** never applied to a clone scan (`scanJob` forces an empty list for `mode: 'clone'`; test `a clone scan ignores any exclusion`, with a mutation check); applies only to the exact folder named, not a parent, subfolder or lookalike; a path cannot contain `..`, a leading `/` or wildcards; at most 50 folders and 50 paths each.
- **Not covered:** a hostile folder the user has themselves listed. The setting is theirs to choose, and the verdict still says it skipped paths.

## Verification results

### V-4: `task.allowAutomaticTasks` (verified 2026-10-30)
- **Result:** Confirmed in a real VS Code 1.142.0 (`npm run test:integration`, suite `open-canary`). With the user-level setting `"on"`, a folder whose `.vscode/tasks.json` has a `folderOpen` task ran it on open (control). With the user-level setting `"off"`, the same folder did not. The value is honoured at user scope, which is where D-7 writes it.
- **Also shown:** a clone opened through Stack3's "Open with auto-run disabled" (D-4) did not run its task even with the setting `"on"`.
- **Not covered:** the value `"auto"` (the default, which prompts), and workspace-level overrides.

### V-1 and V-5: Workspace Trust and trusted parent folders (NOT yet verified, needs a person)
- **Why not:** it is a question about what VS Code's trust prompt shows, and the integration run starts VS Code with Workspace Trust disabled. The result cannot be observed unattended.
- **Where clones go:** `os.tmpdir()/stack3-quarantine/<owner>__<repo>__<random>`, so on Linux `/tmp/stack3-quarantine/...`. Trusting `/tmp` therefore trusts every clone.
- **How to check (about 2 minutes):**
  1. Make a bait folder: `mkdir -p /tmp/s3-v1/.vscode`, and put this in `/tmp/s3-v1/.vscode/tasks.json`:
     `{"version":"2.0.0","tasks":[{"label":"canary","type":"shell","command":"touch /tmp/s3-v1/ran.txt","runOptions":{"runOn":"folderOpen"}}]}`
  2. **A, not trusted (V-5).** Check Manage Workspace Trust > Trusted Folders has no `/tmp`. Run `code -n /tmp/s3-v1`. Note: did a trust prompt appear? Choose "No, I don't trust the authors" (Restricted Mode). Does `/tmp/s3-v1/ran.txt` exist? (`ls /tmp/s3-v1`)
  3. **B, trusted parent (V-1).** Add `/tmp` under Trusted Folders. Close that window, `rm -f /tmp/s3-v1/ran.txt`, run `code -n /tmp/s3-v1`. Note: did a trust prompt appear? Was there an "allow automatic tasks" prompt? Does `ran.txt` exist now?
  4. **C, the extension.** With `/tmp` still trusted, run "Stack3: Clone and scan safely" on any public repo and press plain **Open** (not "with auto-run disabled"). Note whether a trust prompt appears for the clone.
  5. Afterwards remove `/tmp` from Trusted Folders and `rm -rf /tmp/s3-v1`.
- **Why it matters little:** D-4 does not depend on the answer. A neutralized open removes the auto-run files, so it is safe whether or not VS Code trusts the folder. It only decides how much the plain Open button can be trusted to show a prompt.
- **Result (to be filled in with what you saw; nothing has been recorded yet):**
  - A, `/tmp` not trusted: trust prompt? ___ ; `ran.txt` after choosing Restricted Mode? ___
  - B, `/tmp` trusted: trust prompt? ___ ; automatic-tasks prompt? ___ ; `ran.txt`? ___
  - C, Stack3 plain Open of a clone: trust prompt? ___

## Platform assumptions V-1 to V-10: status (blueprint §0.5)

Checked 2026-10-30 against VS Code 1.144.0 (the copy installed on this machine) and the repository's tests. "Verified" means observed, not assumed.

| ID | Assumption | Status | Evidence | Gap |
|---|---|---|---|---|
| V-1 | Nothing forces Restricted Mode; a folder under a trusted parent opens trusted | **Not verified** | none (needs a person; steps below) | Whether a trust prompt appears for a clone under a trusted parent |
| V-2 | The terminal shell-execution event fires after a command starts and cannot cancel it | **Verified (typings)** | `vscode.d.ts` 1.144.0: `onDidStartTerminalShellExecution` "will be fired when a terminal command is started", only with shell integration; it is an `Event`, with no way to veto. It is absent from the 1.90 typings the extension builds against, and Stack3 does not use it. | None for the design: no pre-install blocking is promised |
| V-3 | The git extension API has no pre-commit veto | **Verified (bundle)**, not read from `git.d.ts` | The built-in git extension of 1.144.0 (`extensions/git/dist/main.js`) registers `registerPostCommitCommandsProvider`, `registerBranchProtectionProvider`, `registerPushErrorHandler`, and has no pre-commit registration. `src/guard/staged.ts` only reads the staged list. | `git.d.ts` was not on this machine; the check is by absence in the shipped bundle |
| V-4 | `task.allowAutomaticTasks` `"on"`/`"off"` is honoured at user scope | **Verified** | see "V-4" below; real VS Code 1.142.0, `npm run test:integration` | `"auto"` and workspace-level override |
| V-5 | `folderOpen` tasks do not run in Restricted Mode | **Not verified** | The integration run disables Workspace Trust (`--disable-workspace-trust`), so it cannot observe this | Needs a person together with V-1 |
| V-6 | `scope: "application"` settings ignore workspace values | **Verified** | `test/settings.test.ts` (unit); `test/integration/suite.cjs` step 3 in a real VS Code: a hostile workspace `settings.json` cannot set `stack3.apiUrl` | None |
| V-7 | Webview `enableCommandUris` defaults to false | **Verified** | `vscode.d.ts` 1.144.0: "Defaults to `false`"; `src/ui/panel.ts:70` also sets it to `false` explicitly; the XSS integration test passes (7/7) | None |
| V-8 | A clone copies no hooks and no remote repo config | **Verified (local fixture)** | `test/quarantine/git.test.ts`, "real git" block: a fixture remote with a `.githooks/post-checkout`; after the hardened clone no hook is installed, symlinks arrive as plain files, `core.hooksPath` is not set from the repo | Real GitHub remotes were exercised only by the ten-repo run, which reads results, not hook state |
| V-9 | Minimum git version for CVE-2024-32002 | **Verified (documented)** | D-10 and `test/quarantine/git.test.ts` for the version gate; the version list comes from upstream release notes cited there; this machine's git is 2.56.0 and clones succeed | The release notes were not re-fetched today |
| V-10 | Shape of the Socket batch PURL API | **Partly verified** | D-15: request and response shape taken from Socket's OpenAPI spec, covered by `test/server/socket.test.ts` | No live call with a real key has been made |

## Open questions (not yet ratified)

- V-1 and V-5 need a person (see the table above and the V-1 steps).
- Who owns server-side retention and logging of `/explain` and `/report` payloads? A draft is in `RETENTION.md`; no owner is named there on purpose.
- The copyright holder's legal name for `LICENSE`.

## Release checks (Task 19, 2026-10-30)

Run on this machine with `npm run ci` (lint, `tsc`, 1179 tests, engine line coverage 99.5% against a floor of 90%, ReDoS check, build, bundle check), then `npm run package`.

| Check | Result |
|---|---|
| Egress audit (`test/egress.test.ts`) | Clone, watcher, explain (API and local model) and report run against a repo with planted keys, a seed phrase and a canary. No planted value, local path or snippet over 300 characters appears in any request, and every request goes to the configured origin (or loopback for Ollama). Mutation check: with the redactor disabled the audit fails. |
| Bundle check | No `eval(`, `new Function(`, string `setTimeout` or `innerHTML =` in `dist/*.js`. |
| `.vsix` contents | 9 files, 240 KB: `dist/extension.js`, `dist/worker.js`, `dist/webview/*`, `package.json`, README, LICENSE. No sources, tests or server bundle. |
| Install on a fresh profile | VS Code 1.142.0 and Cursor 3.18.9: installed and listed as `stack3.stack3-vscode@0.1.0`. This shows the package is accepted, not that every command was exercised in Cursor. |
| Rehearsal 5 (canary, neutralized open) and 7 (XSS evidence as text) | Pass in a real VS Code 1.142.0 (`npm run test:integration`: 18/18 and 7/7). |
| Rehearsal 1, 2, 3, 4, 6, 8 | Rows 1, 2, 4 and 8 and the findings for 3 are in "Rehearsal results" below; 6 (V-1) still needs a person. |

## Rehearsal results (2026-10-30)

Run on this machine against VS Code 1.142.0 / 1.144.0, git 2.56.0, Node 24. "Automated" means a test asserts the exact claim of the rehearsal line (ARCHITECTURE.md Part 5). `test/rehearsal.test.ts` was added for the ones that had no single test.

| # | Rehearsal | Result | Test that checks it | What it asserts |
|---|---|---|---|---|
| 1 | The demo interview repo says "do not run", with `tasks.json:14`, the install script reading `.env`, and the attacker wallet sent to `/report` | **Pass (automated)** | `test/rehearsal.test.ts` "rehearsal 1"; `test/report/demo.test.ts` builds and validates the `/report` payload; `test/engine/rules/vscodeFiles.test.ts` | level `critical`, action "Do not open this folder in VS Code"; `tasks.folder-open` at `.vscode/tasks.json:14`; `scripts.lifecycle` at `package.json:7`; `source.decode-exec-secret` at `scripts/.cache/setup.js` with `secret-path-read`; indicators = exactly the demo wallet, token stripped |
| 2 | Adding the fake `file:` package warns before `npm install`, with the network off | **Pass (automated)** | `test/guard/watchers.test.ts` "end to end with the real scanner (network off)"; `test/engine/rules/deps.test.ts` "fake file: package is flagged with no network and no lockfile" | the real walker, worker-less scan and watcher; the API client answers "Network error"; an Error on the fake package's `package.json` and a Warning on the dependency line within 2 s; level `critical` |
| 3 | Ten popular clean repos give no critical or high | **9 of 10 pass; 1 high kept on purpose.** See the table below | `scripts/rehearsal-clean-repos.mjs` (manual, needs network) | see below |
| 4 | Pulling the network gives `unknown` with no crash | **Pass (automated)**, with a note | `test/rehearsal.test.ts` "rehearsal 4"; `test/commands/cloneAndScan.test.ts` "the API being down gives unknown"; `test/api/merge.test.ts` | a real scan of a repo with a lockfile, a real client whose `fetch` throws: nothing thrown, "Package scan unavailable" in `notChecked`, never `no_known_issues`. With no local finding the level is exactly `unknown`. **Note:** a local `caution` outranks `unknown` (order critical > high > caution > unknown), so a repo that already has a caution finding reads `caution`, with the unavailable lookup listed. |
| 5 | Open with auto-run disabled leaves the canary absent | Pass (real VS Code 1.142.0, `npm run test:integration`) | `test/integration/open-canary.cjs` | recorded earlier |
| 6 | A clone under a trusted parent folder | **Not run: needs a person** | none | steps and a result template are under V-1 above |
| 7 | The XSS fixture renders as text | Pass (real VS Code, 7/7) | `test/integration/webview-xss.cjs` | recorded earlier |
| 8 | The huge-repo fixture stays bounded | **Pass (automated)**, new test | `test/rehearsal.test.ts` "rehearsal 8"; `test/scan/walker.test.ts`; `test/scan/scheduler.test.ts` (timeout and worker crash) | 21 000 real files (limit 20 000) plus a 3 MiB file scanned with the default limits: finishes inside the 30 s limit, "Stopped at the file limit" in `notChecked`, level `unknown`; a tree deeper than 32 flags the depth limit. The worker's 256 MiB heap limit and the timeout are covered by the scheduler tests, not by this one. |
| 9 | Fresh-profile install works in VS Code and Cursor | Pass for install and listing (see the table above) | manual | not every command was exercised in Cursor |

### Rehearsal 3 in detail

`node scripts/rehearsal-clean-repos.mjs` clones each repository with the extension's own hardened clone and runs the same engine and limits as the server (mode `clone`). It is the **local engine only**: no Socket or Stack3 API lookup was made, so a repo with packages would read lower than "unknown" only because that lookup is not part of this script. The scans below come from three runs on one day (GitHub was slow, so a single run timed out on several clones), all with the rules as they are after D-16:

| Repo | Commit | Level | Findings | Packages in lockfile | Not checked |
|---|---|---|---|---|---|
| expressjs/express | 1c6f1b0 | caution | 1 | 0 | Exact package versions unresolved (no lockfile) |
| fastify/fastify | 5df959f | unknown | 0 | 0 | Exact package versions unresolved (no lockfile) |
| vitejs/vite | 4f340fd | caution | 86 | 1226 | |
| ethers-io/ethers.js | 3ea4c22 | caution | 64 | 162 | |
| wevm/wagmi | d755448 | caution | 24 | 1995 | |
| NomicFoundation/hardhat | 03cf2dd | caution | 98 | 1332 | |
| OpenZeppelin/openzeppelin-contracts | 5b76c00 | caution | 5 | 541 | |
| Uniswap/v3-core | 5ea68a7 | caution | 1 | 1191 | |
| safe-global/safe-smart-account | 247b8ce | caution | 2 | 735 | |
| scaffold-eth/scaffold-eth-2 | 87557d9 | **high** | 8 | 1951 | |

`wevm/viem` was planned but dropped: its clone stalled even with plain `git clone --depth 1` on this network (20 MB after 4 min 40 s), so it says nothing about the scanner. It was replaced by scaffold-eth-2.

**None of the ten is `no_known_issues`.** Every result, classified:

| Result | Verdict | Why |
|---|---|---|
| **Before the fixes: high on vite, ethers, wagmi, hardhat** | **False alarms, fixed** (D-16, each with a regression test) | long lines of data (word lists, bytecode); tool code that spawns a process; `.env` named in a comment or a deny list; a pnpm lockfile with several documents that could not be read; a GitHub tarball called a foreign registry; the Solidity keyword `private` read as "private key" |
| scaffold-eth-2: `high` `yarn.repo-binary` (`.yarnrc.yml` `yarnPath: .yarn/releases/yarn-4.18.1.cjs`) | **Real finding, kept** | `yarn` will run that committed file on any command. A committed Yarn release is the normal Yarn Berry layout, so it is benign here, but it is also exactly how a repo gets code run through your package manager. The rule cannot tell the two apart from the path alone. Decision for the team: keep it `high` (current), or lower it to `caution` when the file is named `.yarn/releases/yarn-<version>.cjs` and say plainly that this lets a swapped-in file through at `caution`. |
| express, fastify: `unknown` / "Exact package versions unresolved" | **Accurate** | neither commits a lockfile, so package versions cannot be looked up. Correct and intended |
| `caution` `scripts.lifecycle` (husky, simple-git-hooks, `only-allow`, `nuxt prepare`) | **Accurate, benign** | an install script exists and will run on `npm install`. This is the signal the product exists to show |
| `caution` `source.child-process`, `source.eval`, `source.new-function`, `source.raw-ip-url`, `source.secret-path-read` (about 130 across hardhat, vite, ethers and others) | **Accurate, benign in context** | single signals in tool, test and keystore code (`keystore` is a word in ethers and hardhat-keystore). Caution is the designed level for one signal |
| `caution` `source.multiple-signals` (5, all in test or playground files, or exec-only) | **Accurate, benign in context** | down from `high` after D-16 |
| `caution` `text.long-line` (52, mostly word lists, bytecode and test vectors) | **Benign** | down from `high` after D-16; still listed because a 2000+ character line can hide code |
| `caution` `secret.evm-key` (10) and `secret.mnemonic` (11) | **Accurate, benign** | keys and phrases in test code and configs that look like development values (scaffold-eth's `0xac…f80` is Hardhat's well-known account #0); I did not check each one. The value is really in the repo, and in a clone it is `caution` by design ("someone else's leak") |
| `caution` `deps.unverified-source` (62) and `deps.no-integrity` (5) | **Accurate** | `github:`/git dependencies (`forge-std`, `permit2`) and lockfile entries with no integrity |
| `caution` `walker.committed-node-modules` (2), `secret.dotenv` (2), `extensions.recommendations` (1), `text.bidi` (1, in an Illustrator `.ai` file) | **Accurate, benign** | test fixtures and an editor recommendation list. The `.ai` file is a data file; a bidi character there is harmless, though the rule cannot know |

**Rehearsal 3 as written ("no critical or high"): nine of ten pass. scaffold-eth-2 fails on one `high` that is a real behaviour, not a wrong rule; whether to soften it is the team's call (see its row).**
