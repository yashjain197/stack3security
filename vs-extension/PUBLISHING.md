# Publishing Stack3 Security

The extension is MIT licensed (`LICENSE`). Publishing needs two things only a person with the accounts can do: a
Marketplace **publisher** and a **Personal Access Token (PAT)**. Never commit or paste a PAT; if one leaks, revoke it.

## One-time setup

1. **Azure DevOps organization.** Sign in at dev.azure.com with a Microsoft account and create an organization (any name).
2. **PAT.** User settings > Personal access tokens > New Token. Organization: **All accessible organizations**. Scopes:
   Custom defined > Show all scopes > **Marketplace > Manage**. Copy it once.
3. **Publisher.** At marketplace.visualstudio.com/manage create a publisher with ID **`stack3`** (it must equal `publisher`
   in `package.json`; the ID cannot be changed later). If `stack3` is taken, pick another and change `package.json`.
4. *(Optional, for Cursor and VSCodium)* Create an account at open-vsx.org, create a namespace `stack3`, and make an access token.

## Publish from your machine

```bash
cd vs-extension
npm ci --ignore-scripts
npm run ci                      # lint, tsc, tests, ReDoS check, build, bundle check
npx vsce login stack3           # paste the PAT when asked
npm run publish:marketplace     # builds, checks the bundle, then `vsce publish`
npx ovsx create-namespace stack3 -p <OVSX_PAT>   # first time only
npm run publish:openvsx -- -p <OVSX_PAT>         # optional
```

No PAT yet? `npm run package` builds `stack3-vscode-<version>.vsix`; upload it by hand on the manage page.

## Publish from GitHub Actions

1. Repository settings > Secrets and variables > Actions: add **`VSCE_PAT`** (and optionally **`OVSX_PAT`**).
2. Bump `version` in `package.json` (the Marketplace rejects a version it already has) and commit.
3. Tag and push: `git tag vscode-v0.1.0 && git push origin vscode-v0.1.0`. The workflow
   (`.github/workflows/vscode-publish.yml`) checks the tag equals the version, runs `npm run ci`, then publishes.
   It can also be started by hand from the Actions tab.

## After publishing

New extensions are scanned automatically and can take a few minutes to appear. Check the page at
`https://marketplace.visualstudio.com/items?itemName=stack3.stack3-vscode` and install it on a fresh profile
(`code --user-data-dir /tmp/s3 --install-extension stack3.stack3-vscode`).
