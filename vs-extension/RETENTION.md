# Proposal: retention and logging of what Stack3 receives

**Status:** draft for the team to decide. **Owner of the decision:** not yet named; the team needs to name one. Nothing
below is in force until someone with that authority accepts it.

## What reaches Stack3, and where it is today

| Data | Sent when | What it contains | Kept today |
|---|---|---|---|
| Package URLs (`pkg:npm/name@version`) to `/scan-package` | every scan of a repo with a lockfile | package names and versions only | not decided (Stack3 API) |
| Snippets to `/explain` | only if the user picks the `api` explanation provider (default is a local model: nothing leaves) | at most 20 snippets of 300 characters, secrets masked | not decided (Stack3 API) |
| Reports to `/report` | a public repo with attacker indicators, `stack3.report.mode` = `publicAuto` or the user agrees | attacker wallet and endpoint, package name and version, the repo as `github:owner/name`, a fixed `reporter` label (`scan-repo` in the code today, not a user id) | not decided (Stack3 API) |
| Repo-scan service (`src/server`) | each scan the Stack3 API asks for | repo URL during the scan; the clone is deleted afterwards | result cache 5 min in memory; counters in memory (reset on restart); request log lines hold method, path, status, time and level, never the key, a body or a path on disk |
| Socket.dev (third party) | the service looks up the lockfile packages | package URLs | governed by Socket's own terms, not by us |

Never sent by the extension: source files, paths on the user's disk, `.env` values. `test/egress.test.ts` checks this on every build.

## Proposal

1. **Do not keep `/explain` snippets after the answer is returned.** Process in memory, return, discard. No request-body
   logging for this route. Reason: snippets are the most sensitive thing we receive, and the feature does not need them later.
2. **`/scan-package`: keep nothing per request.** Cache verdicts by package URL (a public fact), not by user. Log counts and
   timings only.
3. **`/report`: keep the graph, not the person.** The wallet, endpoint, package and repo are the product's threat data and
   are kept as graph nodes and edges. The `reporter` field stays a fixed label; do not add a user id, IP address or token
   to it or to the edge. Keep a report only for public repositories (already the rule for `publicAuto`).
4. **Logs:** structured lines with route, status, duration, verdict level and counts. Never a request or response body, a
   snippet, a URL query, a service key or a user token. Keep 30 days, then delete.
5. **Repo-scan service:** keep as built (clone deleted after the scan, 5-minute cache, in-memory counters). If the
   website needs counters that survive a restart, store only the five level counts and a date, not repository names.
6. **Deletion:** a user can ask for the removal of a report they sent; the graph keeps indicators that were confirmed
   from other sources.
7. **Review:** the owner re-reads this table whenever a new field is sent to the API or the log format changes.

## Open points for the team (not decided here)

- Who owns the Stack3 API's storage and logs, and who may change this table.
- Whether 30 days of logs, and "no user identity on the graph", are acceptable for the legal and privacy basis you operate under.
- Whether the Marketplace listing and README need to say this in one sentence (the README already lists what leaves the machine).
