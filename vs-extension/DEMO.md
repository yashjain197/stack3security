# Demo running order (3 minutes)

Stack3 reads a repo as data before you open it. The demo: scan one repo that has a real finding, scan one with none, and
show that you stay in control of the clone.

## Before you go on stage

- Install the extension: `npm run package`, then `code --install-extension stack3-vscode-0.1.1.vsix`.
- Explanation: run **Stack3: Set Claude API key** once (the key is stored in the OS keychain). Claude Haiku then writes the
  plain-English explanation under the verdict in a few seconds. `node --env-file=.env test/integration/claude.mjs` passed
  6/6 on 2026-10-30 (3.3 s). Without a key the verdict still shows; only the explanation is missing. It never changes the verdict.
- `npm run warm-up` wakes the deployed hosts and fills the live counters. It needs `SERVICE_KEY` in `.env`.
- Do one dry run of both repos below so the clones are cached and the network is known to work.

### Be honest about package checks

**Package checks in the extension need your own Socket key.** Run **Stack3: Set Socket API key** once (OS keychain; the key is
never in the package; it needs the `packages:list` scope). The extension then sends only package URLs to `api.socket.dev`; it
does not use Yash's API. Verified against Socket on 2026-10-30 with the extension's own client: `lodash` and `express` read
checked-and-clean, `viem@2.51.0` returns a high finding. So:

- No key saved: package checks are reported as **not checked** ("Package scan unavailable"). A repo with packages cannot read
  `no_known_issues`, and a local finding still shows at its own level.
- `STACK3_MOCK=1` (the F5 config already sets it): package checks return **canned mock data**. Every repo with packages gets the
  same fake "Known malware" finding. Never present that as a real registry check.
- **Socket quota:** every batch request costs 100 units and a free key has little. Right after repeated scans Socket answers
  429 ("Insufficient quota", retry in about 5 minutes); the extension retries once, then shows "not checked". Do not rehearse
  package scans in a loop right before the demo.
- **Key scope:** the key must have `packages:list`. Without it Socket answers 403 "Insufficient permissions".
- Real package results exist only through the repo-scan service (`POST /v1/internal/scan-repo`). Its package check calls the
  Chrome API's `POST /v1/internal/scan-packages` (leave `SOCKET_API_KEY` unset, so it never talks to Socket directly). Both
  deployed services work with `SERVICE_KEY` from `.env` (checked 2026-10-30): `scan-repo` and `stats` on `vs-ext-backend`, and
  `scan-packages` on `chrome-ext-backend`, all 200. The extension calls it only with the key you saved yourself.
- Socket is running behind the API now. A scan of the risky repo below returns a Socket finding (`high`, "Socket.dev flagged
  viem@2.51.0: httpDependency") next to the local rule's finding, and no "Package scan incomplete" line.
- The deployed scan service matched the local rules on every repo I compared on 2026-10-30 (express caution, the risky repo
  high, the clean repo no known issues). The earlier report of "high where local says caution" did not reproduce.
- `npm run warm-up` ran clean against both deployed hosts: 3 of 3 scans, counters filled.

The two repos below were picked so that the demo does not depend on package checks.

## Running order

### 0:00 to 0:20. The problem

"Fake job interviews hand you a repo to run. A hidden `.vscode/tasks.json` task can run the moment you trust the folder.
Stack3 scans the repo before you open it."

Open VS Code on an empty window. Open the Command Palette.

### 0:20 to 1:20. A repo with a real finding

Run **Stack3: Clone and scan safely** and paste:

`https://github.com/mdimran29/cross-chain-rebase-token`

Expected (local rules, checked 2026-10-30 at commit `cdbd901`): **High risk**, "Open only with auto-run disabled.", one
finding `deps.foreign-registry` in `frontend/package-lock.json` (a dependency installed from `pkg.pr.new`, not the npm
registry).

Say: "This is an ordinary project, not an attack. It still has something worth a look: a package that does not come from the
npm registry. At high, the main button is *Open with auto-run disabled*. It moves `.vscode/` and `.devcontainer/` into
`.stack3-disabled/` before the folder opens."

Point at: the level, the finding with its file, the main button **Open with auto-run disabled**, and the "Not checked" line
if the API is not configured.

Do not click *Open anyway*.

> **The critical story, with no network.** The "interview task" attack exists as the test fixture
> `test/fixtures/repos/interview-task`: a `folderOpen` task (`.vscode/tasks.json:14`, `curl ... | sh` to `127.0.0.1:9`, which
> goes nowhere), an install script that reads secrets, and a fake attacker wallet. No public repo of it exists, and *Clone and scan
> safely* only takes public GitHub URLs, so show it as a folder instead:
>
> 1. `cp -r test/fixtures/repos/interview-task ~/stack3-demo` (outside this repo).
> 2. In VS Code: File > Open Folder > `~/stack3-demo`, and stay in **Restricted Mode** (do not click Trust).
> 3. Stack3 scans it as data and a modal lists the critical findings, with a **Close** button. This check is best effort and
>    says so itself. It is not the clone flow, so there is no *Open with auto-run disabled* button here.
>
> To get the full critical verdict screen with the buttons through a real URL, someone has to publish the fixture as a public
> repo first, then add its URL here.

### 1:20 to 2:00. A repo with no known issues

Run **Stack3: Clone and scan safely** again and paste:

`https://github.com/mdimran29/web3-security-portfolio`

Expected (checked 2026-10-30 at commit `1ce8237`): **No known issues found**, headline "No known issues found. This is not a
guarantee."

Say: "It never says safe. It says nothing known was found, and it tells you that is not a promise."

Point at: the buttons are now *Open*, *Open with auto-run disabled*, *Delete clone*.

Avoid `expressjs/express` here: its tests contain an `eval`, so it reads **caution**, not clean.

### 2:00 to 2:30. You stay in control

Press **Delete clone** on the verdict. The quarantine folder is removed.

Say: "Nothing was opened and nothing ran. If you do not like the result, one click and the clone is gone."

### 2:30 to 3:00. Questions

Keep each answer to one line.

- **What if it misses something?** It finds known patterns, not intent, so it never says "safe": the best result is "No known
  issues found. This is not a guarantee."
- **What leaves my computer?** Package URLs (`pkg:npm/name@version`) for the lockfile, and masked snippets (secrets removed)
  only if you add your own Claude key (they go to Anthropic) or choose the `api` provider (they go to the Stack3 server); the
  verdict itself is decided on your machine, and `stack3.explain.sendSnippets` set to `never` sends no snippets at all.
- **Why only EVM wallets?** Item 11: wallet detection covers EVM chains only, with no Solana or other chains yet.

## Handing the extension to judges

There is no Marketplace listing yet (`stack3.stack3-vscode` is not found there), so nobody else can install it from the
Marketplace. Give them the file:

- `vs-extension/stack3-vscode-0.1.1.vsix` (rebuild with `npm run package`), and the SHA-256 in
  `stack3-vscode-0.1.1.vsix.sha256` next to it.
- They install it with `code --install-extension stack3-vscode-0.1.1.vsix` (Cursor: `cursor --install-extension ...`).
- Publishing to the Marketplace needs the publisher account and PAT in `PUBLISHING.md`.

## Rehearse this order twice

Clone the risky repo, read the verdict, point at *Open with auto-run disabled*, then clone the clean repo, then *Delete clone*.
Rehearse once with the network on and once with it off (use the folder fallback above).

## If something goes wrong

- Clone fails or hangs: the repo must be public and the machine needs `github.com`. Switch to the other repo.
- A verdict differs from the one above: the repos change. Re-run `scripts/rehearsal-clean-repos.mjs owner/name` to see what the
  local rules say today.
- No explanation under the verdict: no Claude API key is set (run *Stack3: Set Claude API key*) or the Claude API was unreachable. The verdict is unaffected.
