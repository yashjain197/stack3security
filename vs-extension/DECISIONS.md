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

## Verification results

### V-4: `task.allowAutomaticTasks` (verified 2026-10-30)
- **Result:** Confirmed in a real VS Code 1.142.0 (`npm run test:integration`, suite `open-canary`). With the user-level setting `"on"`, a folder whose `.vscode/tasks.json` has a `folderOpen` task ran it on open (control). With the user-level setting `"off"`, the same folder did not. The value is honoured at user scope, which is where D-7 writes it.
- **Also shown:** a clone opened through Stack3's "Open with auto-run disabled" (D-4) did not run its task even with the setting `"on"`.
- **Not covered:** the value `"auto"` (the default, which prompts), and workspace-level overrides.

### V-1: Workspace Trust and trusted parent folders (NOT yet verified, needs a person)
- **Why not:** it is a question about what VS Code's trust prompt shows, and the test runs VS Code with trust disabled. The result cannot be observed unattended.
- **How to check (2 minutes):** in VS Code, trust a parent folder such as `/tmp` (Manage Workspace Trust > Trusted Folders > Add). Run "Stack3: Clone and scan safely" on any repo, press Open (not "with auto-run disabled") and note whether a trust prompt appears for the clone.
- **Why it matters little:** D-4 does not depend on the answer. A neutralized open removes the auto-run files, so it is safe whether or not VS Code trusts the folder. It only decides how much the plain Open button can be trusted to show a prompt.

## Open questions (not yet ratified)

- V-1 to V-10 in the blueprint §0.5 must be verified, or accepted as risks here. V-4 is verified (above). V-1 needs a person.
- Who owns server-side retention and logging of `/explain` and `/report` payloads?

## Release checks (Task 19, 2026-10-30)

Run on this machine with `npm run ci` (lint, `tsc`, 1179 tests, engine line coverage 99.5% against a floor of 90%, ReDoS check, build, bundle check), then `npm run package`.

| Check | Result |
|---|---|
| Egress audit (`test/egress.test.ts`) | Clone, watcher, explain (API and local model) and report run against a repo with planted keys, a seed phrase and a canary. No planted value, local path or snippet over 300 characters appears in any request, and every request goes to the configured origin (or loopback for Ollama). Mutation check: with the redactor disabled the audit fails. |
| Bundle check | No `eval(`, `new Function(`, string `setTimeout` or `innerHTML =` in `dist/*.js`. |
| `.vsix` contents | 9 files, 240 KB: `dist/extension.js`, `dist/worker.js`, `dist/webview/*`, `package.json`, README, LICENSE. No sources, tests or server bundle. |
| Install on a fresh profile | VS Code 1.142.0 and Cursor 3.18.9: installed and listed as `stack3.stack3-vscode@0.1.0`. This shows the package is accepted, not that every command was exercised in Cursor. |
| Rehearsal 5 (canary, neutralized open) and 7 (XSS evidence as text) | Pass in a real VS Code 1.142.0 (`npm run test:integration`: 18/18 and 7/7). |
| Rehearsal 1, 2, 3, 4, 6, 8 | Not run by hand. 1, 2, 4 and 8 have automated tests in the suite that pass but were not re-checked against this list; 3 (ten clean repos) and 6 (V-1) need a person. |
