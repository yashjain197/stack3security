# VS Code Extension: Decision Log

This file is kept separate from [`ARCHITECTURE.md`](./ARCHITECTURE.md). Each entry has a Status, the Decision, Why, Evidence, and what it does Not cover. When a build step deviates from the blueprint, add a dated status note to that step in the blueprint too.

## Summary

| ID | Decision | Status | Owner |
|---|---|---|---|
| D-1 | Monorepo layout (`packages/engine`, `apps/vscode`) | Proposed | Imran + team |
| D-2 | Quarantine in `os.tmpdir()/stack3-quarantine` | Proposed | Imran |
| D-3 | Button set per verdict level | Proposed | Imran + Ivo |
| D-4 | Neutralize by moving `.vscode/` and `.devcontainer/` | Proposed | Imran |
| D-5 | `/explain` snippets: public clones on, local opt-in | Proposed | Imran |
| D-6 | Graph poisoning policy for client reports | Proposed | Yash |
| D-7 | `task.allowAutomaticTasks: off` with consent | Proposed | Imran |
| D-8 | Auto-report indicators only for public clones | Proposed | Imran + Yash |
| D-9 | Hardened `git clone` over a tarball download | Proposed | Imran |

## Entries

### D-1: Repo layout
- **Status:** Proposed, 2026-10-29
- **Decision:** Follow the PDF's monorepo (`packages/engine`, `packages/ui`, `apps/vscode`). Move the current `vs-extension/` placeholder into it.
- **Why:** The CLI and the API reuse the engine. A flat folder would force copying rules into each one.
- **Evidence:** PDF, "Monorepo layout". The repo currently has `vs-extension/test.txt` only.
- **Not covered:** The workspace tooling choice (pnpm is assumed).

### D-2: Quarantine location
- **Status:** Proposed
- **Decision:** Use `os.tmpdir()/stack3-quarantine/<owner>__<repo>__<rand>`, mode 0700.
- **Why:** Users often trust `~` or their projects folder as a parent, and a clone there would open trusted (V-1).
- **Evidence:** Blueprint §0.2 and V-1 (unverified).
- **Not covered:** Users who trust `/tmp`. Neutralization (D-4) covers that case.

### D-3: Buttons per level
- **Status:** Proposed
- **Decision:**
  - critical: Delete (primary), Open with auto-run disabled (confirm).
  - high: Open with auto-run disabled (primary), Open (modal).
  - caution and below: Open.
- **Why:** The PDF's "Open in Restricted Mode" cannot be forced (V-1).
- **Evidence:** PDF Flow 1 step 4.
- **Not covered:** Final copy (Ivo).

### D-4: Neutralize before opening
- **Status:** Proposed
- **Decision:** Move `.vscode/` and `.devcontainer/` to `.stack3-disabled/` inside the quarantine clone, and add a README.
- **Why:** It works whatever the trust state is.
- **Evidence:** Blueprint S10.
- **Not covered:** Install scripts (they only run on install) and other extensions reading other config files.

### D-5: `/explain` snippet consent
- **Status:** Proposed
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
- **Status:** Proposed
- **Decision:** A one-time consent prompt, then set `task.allowAutomaticTasks` to `"off"` at user scope.
- **Why:** Defence in depth against `folderOpen` tasks.
- **Evidence:** PDF Flow 3. V-4 is unverified.
- **Not covered:** Workspaces that legitimately need automatic tasks.

### D-8: Indicator reporting
- **Status:** Proposed
- **Decision:** Automatic for public-URL clones. Ask first for local folders.
- **Why:** A local folder can contain private internal domains.
- **Evidence:** Blueprint §2.4.
- **Not covered:** n/a

### D-9: Fetch method
- **Status:** Proposed
- **Decision:** Hardened `git clone` (blueprint §2.6) instead of a GitHub tarball.
- **Why:** It keeps the commit SHA for verdict binding and avoids archive-extraction bugs.
- **Evidence:** CVE-2024-32002 class (V-9).
- **Not covered:** Private repos. Use local scan or the CLI for those.

## Open questions (not yet ratified)

- V-1 to V-10 in the blueprint §0.5 must be verified, or accepted as risks here.
- Who owns server-side retention and logging of `/explain` and `/report` payloads?
- What is the minimum `engines.vscode` version? It depends on which APIs ship (V-2, V-3).
