# Stack3 Security for VS Code

Check a repository **before** you open it. Fake-interview and "clone this task" attacks hide a command in
`.vscode/tasks.json` that runs the moment a trusted folder opens. Stack3 clones the repo into a quarantine folder, reads
it as data, and shows a verdict before anything can run.

## Use it

1. Run **Stack3: Clone and scan safely** from the Command Palette and paste a GitHub URL.
2. Read the verdict. The buttons depend on the level:
   - **critical**: Delete (main button), or Open with auto-run disabled.
   - **high**: Open with auto-run disabled (main button), Open, Delete.
   - lower levels: Open, Open with auto-run disabled, Delete.
3. *Open with auto-run disabled* moves `.vscode/` and `.devcontainer/` out of the way into `.stack3-disabled/` first, so
   nothing in them can start.

While you work, Stack3 re-scans when `package.json`, a lockfile or a `.vscode` file changes, puts findings on the line
in the editor and in the Problems panel, and warns before you commit a private key or seed phrase.

## What it checks

| Check | Where it runs |
|---|---|
| Auto-run tasks, shell and interpreter overrides, dev containers | on your machine |
| Install scripts (`preinstall`, `postinstall`, …), package-manager config, git config, hidden text | on your machine |
| `eval`, base64-then-execute, `child_process`, raw-IP requests, reads of `.env` and key files | on your machine |
| Private keys, seed phrases, API keys committed in the repo | on your machine |
| Packages in the lockfile (malware, typosquats, install scripts) | Stack3 API, package URLs only |

Nothing in the repository is ever run, imported or opened as a workspace by the scan.

## Verdict levels

`critical`, `high`, `caution`, `unknown`, `no_known_issues`. The extension never says "safe": rules find known
patterns, not intent. `unknown` means something could not be checked (API offline, limit reached, a file that would not
parse). The overall level is the highest finding, and the server's opinion can only raise it.

## What leaves your computer

- **Package URLs** (`pkg:npm/name@version`) of the lockfile go to the Stack3 API, so packages can be checked.
- **Flagged snippets**, at most 20 per request and 300 characters each, with secrets masked, go to an explanation
  service **only if** you pick the `api` explanation provider. The default runs a model on your own computer through
  [Ollama](https://ollama.com), and nothing leaves.
- **Attacker wallets and domains** found in a public repo are reported to the threat graph (`stack3.report.mode`).
- Source files, paths on your disk, `.env` values and the text of your repo are never sent. `test/egress.test.ts` checks
  this on every build.

## Settings

All settings are user-level: a repository cannot change them, and they are disabled in an untrusted workspace.

| Setting | Meaning |
|---|---|
| `stack3.apiUrl` | HTTPS origin of the Stack3 API. Empty means package checks report "not checked". |
| `stack3.explain.provider` | `ollama` (default, local) or `api`. |
| `stack3.explain.ollamaModel` | Model for the local explanation (default `qwen2.5-coder:7b`). |
| `stack3.explain.sendSnippets` | `publicOnly` (default), `always` or `never`. |
| `stack3.report.mode` | `publicAuto` (default), `ask` or `never`. |
| `stack3.scan.limits` | Bounds on files, bytes, depth and time. Hitting one gives `unknown`. |

## Limits, stated plainly

- Only public GitHub repositories can be cloned this way. For a private repo, scan the folder instead.
- git must be a release that contains the 2024 clone fixes (2.39.4, 2.40.2, 2.41.1, 2.42.2, 2.43.4, 2.44.1, 2.45.1 or
  newer). An older git is refused with a message.
- The warning for a folder opened directly is best effort: VS Code may show its own trust prompt first.
- Solana and non-EVM chains are not covered. Packages bundled into a repo's own files cannot be mapped to a package.

## Install from a file

`code --install-extension stack3-vscode-0.1.0.vsix` (Cursor: `cursor --install-extension …`). Check the file against
the published SHA-256 first.

## Licence

MIT, see `LICENSE`. A scan reports known patterns only; it is not a guarantee that code is safe to run.
