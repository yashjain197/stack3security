# Stack3 threat graph (TigerGraph)

Made by Yash Jain with passion.

`schema.gsql` creates the `stack3` graph with graph-local types (a schema-change job), so it never touches other
graphs in the workspace, such as the `Transaction_Fraud` sample. Apply it with:

```bash
python -m scripts.tg_gsql -f graph/schema.gsql
```

The file has no comments because the GSQL parser in Savanna rejects some of them. Two TigerGraph 4.2 limits shaped it:
`Package` is a reserved word (hence `SoftwarePackage`), and graph-local schema jobs reject multi-source edges
(`FROM a, TO b | FROM c, TO d`), so each edge has one source and one target type.

## Vertex IDs (normalised by the API before writing)

| Vertex | Primary ID | Example |
|---|---|---|
| Wallet | `<chainId>:<0x address, lowercase>` | `1:0x00000000000000000000000000000000deadbeef` |
| Domain | registrable domain, lowercase | `metamask-verify.io` |
| SoftwarePackage | purl | `pkg:npm/@ledgerhq/connect-kit@1.1.7` |
| Repo | `github:<owner>/<name>` | `github:acme/wallet-sdk` |
| Endpoint | scheme + host + path, no query | `https://evil.example/collect` |

Report history (who reported what, when) lives in Postgres; graph nodes carry `report_count`, `first_seen`, `last_seen`.

## Edges (each has a reverse edge for walking backwards)

| Edge | From → To | Reverse | Meaning |
|---|---|---|---|
| `PACKAGE_DRAINS_TO` | SoftwarePackage → Wallet | `WALLET_DRAINED_BY_PACKAGE` | Malicious package sends stolen funds here |
| `DOMAIN_DRAINS_TO` | Domain → Wallet | `WALLET_DRAINED_BY_DOMAIN` | Phishing site's drainer pays out here |
| `PACKAGE_SENDS_TO` | SoftwarePackage → Endpoint | `ENDPOINT_FED_BY_PACKAGE` | Package exfiltrates keys or seed phrases here |
| `DOMAIN_SENDS_TO` | Domain → Endpoint | `ENDPOINT_FED_BY_DOMAIN` | Phishing form posts data here |
| `LOADS_SCRIPT` | Domain → SoftwarePackage | `SCRIPT_LOADED_BY` | Page loads this (compromised) script |
| `DEPENDS_ON` | Repo → SoftwarePackage | `DEPENDED_ON_BY` | Repository depends on this package |
| `FUNDED` | Wallet → Wallet | `FUNDED_BY` | On-chain money flow (laundering hops) |

## API

| Method | Path | Who |
|---|---|---|
| `POST /v1/report` | logged-in user (website or extension) | Report nodes and edges. Body: `reason`, `nodes`, `edges` |
| `POST /v1/internal/report` | Imran's backend, header `X-Service-Key` | Same body plus `source` (`vscode` or `cli`) and `reporter` |
| `GET /v1/graph/{type}/{id}` | logged-in user | The node and its direct neighbours. `type` is `wallet`, `domain`, `package`, `repo` or `endpoint` |

Ids in those calls use the formats above (`1:0xabc…`, `pkg:npm/name@1.2.3`, …). Postgres stores every report first. A background
loop copies unsynced reports into TigerGraph and retries after a failure. `synced: false` in the response means the retry
has not happened yet; the neighbourhood read still works from Postgres.

## Access

- Schema and setup: in-database user (`TIGERGRAPH_USERNAME` / `TIGERGRAPH_PASSWORD`) over `/gsql/v1/statements`.
- Runtime reads and writes: `TIGERGRAPH_SECRET` → `POST /gsql/v1/tokens` → Bearer token on `/restpp/...`.
  (`/restpp/requesttoken` from older docs returns 400 on Savanna 4.x.)
