# Stack3 repo-scan service

A small HTTP service that scans a public GitHub repository and answers in the shared verdict JSON. It is built from
`vs-extension/Dockerfile` (the default target). It holds the service key; the VS Code extension never does.

## Run it

```
docker build -t stack3-repo-scan vs-extension
docker run --rm -p 8080:8080 \
  -e SERVICE_KEY=<the key Yash sends> \
  -e STACK3_API_URL=http://<stack3-api-host>:8000 \
  --read-only --tmpfs /tmp:rw,mode=1777 --cap-drop ALL --security-opt no-new-privileges:true \
  stack3-repo-scan
```

The service needs outbound HTTPS to github.com (to clone), to `STACK3_API_URL` (to report) and, when a Socket key is set, to api.socket.dev. It needs a writable `/tmp`
(clones live there for the length of one scan and are deleted straight after). It runs as the unprivileged `node` user.

| Variable | Default | Meaning |
|---|---|---|
| `SERVICE_KEY` | required, 16+ chars | Shared secret. Checked on incoming calls, sent as `X-Service-Key` on outgoing ones. The service refuses to start without it. |
| `STACK3_API_URL` | `http://localhost:8000` | Base URL of the Stack3 API. Reports go to `POST {STACK3_API_URL}/v1/internal/report`. |
| `PORT` | `8080` | Listen port. |
| `MAX_CONCURRENT_SCANS` | `2` | Clones/scans at once (1 to 8). |
| `MAX_QUEUED_SCANS` | `8` | Waiting scans; beyond this the answer is `429 busy`. |
| `SCAN_TIMEOUT_MS` | `90000` | Wall-clock limit for one request. |
| `CACHE_TTL_MS` | `300000` | A finished scan of the same repo is reused for this long. |
| `SOCKET_API_KEY` | none | Socket.dev token with the `packages:list` scope. Without it, repositories with packages come back as `unknown`. |
| `SOCKET_ORG_SLUG` | none | Your Socket organisation slug. Set it to use the current `POST /v0/orgs/{slug}/purl` route; without it the deprecated `POST /v0/purl` is used. |

## Routes

`GET /healthz` returns `{"status":"ok"}`. No key.

`POST /v1/internal/scan-repo` with header `X-Service-Key` and body `{"repoUrl": "https://github.com/owner/name", "ref": "optional-commit"}`
returns the verdict JSON: `level`, `target`, `findings`, `indicators`, `notChecked`, `actions`, `explanation` (always `null`).
`level` is the worst finding, one of `critical`, `high`, `caution`, `unknown`, `no_known_issues`, never "safe".
Wallets in `indicators.addresses` are `chainId:address` (chain `1`, since a repository names no chain).

Errors are `{"error": {"code", "message"}}`:

| Status | code | When |
|---|---|---|
| 400 | `invalid_request` / `invalid_repo_url` / `invalid_ref` | bad body, a URL that is not `https://github.com/owner/name` (or a pasted form of it), or a `ref` that is not 7 to 40 hex characters |
| 401 | `invalid_service_key` | header missing or wrong |
| 413 | `payload_too_large` | body over 4 KiB |
| 415 | `unsupported_media_type` | not `application/json` |
| 429 | `busy` | queue full; `Retry-After: 5` |
| 502 | `clone_failed` | not found, private, too large, timed out, or git too old |
| 504 | `scan_timeout` | over `SCAN_TIMEOUT_MS` |

`ref` can only name the commit that was scanned: the clone is shallow, so the default branch tip is what is scanned. If `ref`
is not that commit the answer still comes back, with a `notChecked` entry saying which commit was scanned, so the level is at
least `unknown`.

## What it reports to the graph

After a scan with a **critical** finding that decodes hidden text, runs it and reads secrets, the service posts to
`/v1/internal/report`: the package (`pkg:npm/name@version`, from the nearest `package.json` of the flagged file), the wallet
addresses named in that file (`1:0x...`, lowercase, well-known contracts excluded), and the endpoints it sends to, linked with
`package_drains_to` and `package_sends_to`. A critical install script with no wallet reports just the package. A
vendored package also gets a `repo` node and a `depends_on` edge. At most 5 wallets and 5 endpoints per finding. A Telegram bot
or Discord webhook is reported by id only; the token is stripped. A report the API would refuse is never sent, and a failed
report never fails the scan.

## Security properties

- The service key is compared in constant time, checked before the body is read, and never appears in a response or a log line.
- Only `https://github.com/owner/name` is ever cloned. The clone is the hardened one: no hooks, no submodules, no symlinks, no
  LFS, no credentials, `protocol.allow=never`, a scrubbed environment, a 2 minute timeout and a size cap. Git older than the
  first patched release of its series is refused. Nothing from the repository is executed.
- Every string in a response passes through the secret redactor.
- Each clone is deleted after its scan, and again by an hourly sweep.

## Package scan (Socket.dev)

With `SOCKET_API_KEY` set, the package URLs found in the lockfiles (`pkg:npm/name@version`, nothing else) are sent to Socket in
batches of 500, at most 4 batches per scan (2000 packages; each request costs 100 quota units). Socket's critical and high
alerts in the `supplyChainRisk` category (malware, typosquats, install scripts, exfiltration) become findings with source
`socket`; the level is still computed here. Middle and low alerts are ignored because they fire on ordinary packages, and so are
known-CVE (`vulnerability`) alerts, licence, quality and maintenance alerts: an old dev dependency in a popular repo is not an
attack, and would make it "critical".

A package Socket has no verdict for (`pendingScan`, `notFound`, a `purlError`, a failed batch, or past the 2000 cap) is counted
in a `notChecked` line ("Package scan incomplete: N of M packages were not checked by Socket."), so the level is at least
`unknown`. If every batch fails (bad key, missing scope, quota, outage) the line is "Package scan unavailable". The log has an
`event: socket` line per scan with the counts and, on failure, the HTTP status; never the key.

## Not done yet

Nothing is left open in the service itself. The Socket call has been tested against recorded response shapes only, not a live key.
