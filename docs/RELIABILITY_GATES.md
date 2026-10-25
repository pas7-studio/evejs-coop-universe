# COOP-020 — read-only reliability acceptance

This gate complements (does not replace) `docs/GAMEPLAY_TESTING.md`,
`Local-Two-Client-Test.ps1 -Action DiagnoseWorld/World/Party`, and the
existing source-contract tests. It never runs GitHub CI, deploys or
rebuilds the overlay, restarts containers, changes network listeners,
regenerates markets, or mutates `evejs-data`.

## Run against the existing Windows 11 / Docker world

```powershell
cd C:\Games\EveCoopProject
# First unresolved gate: headless event writer. READ ONLY.
.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
# Read-only validation on the running image and latest genuine telemetry.
.\scripts\Verify-Coop-Reliability.ps1 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
# Local tests only; no GitHub Actions or dependency installs.
node --test tests/coop-reliability-gates.test.mjs
```

The script records the exact checked-out **project SHA**, the pinned
**upstream SHA**, the running **Docker image ID and container start time**,
and verifies the **actual running server** mounts named `evejs-data` at `/var/lib/evejs`. These
identifiers are evidence labels, NOT proof that the running overlay was
built from that project commit: confirm the installed overlay revision
before cross-revision certification. Raw event logs stay in memory;
`test-results/coop-reliability-*.json` contains only redacted summary
statuses and counts. Any non-PASS gate exits 2. Missing telemetry is
`BLOCKED_TELEMETRY`; run `DiagnoseWorld` and do not rebuild just to make
telemetry appear. A 10k-line tail limit could otherwise lose the original headless boot
marker on a busy server. The read-only runner therefore retrieves the latest
**actual event-file** boot record separately, followed by the activity tail. A boot marker is
allowed to be older than the 30-minute activity window but MUST be after
the actual Docker process start; if the marker is still absent, the gate remains BLOCKED
until native evidence from the correct boot is obtained. No made-up marker.
The report also rejects stale events from previous container processes,
replayed shared scenes and duplicate native ship IDs.

## Five independent gates

| Gate | PASS evidence | Must remain BLOCKED/FAIL when |
| --- | --- | --- |
| World | Native headless boot; topology; physical miner+hauler; named NPC; sampled native motion AND ore/target | Missing, malformed or stale JSONL, empty native static data, stock/NPC inactivity |
| Party | Two current distinct native pilots in the same fresh reciprocal-visibility scene | Raw TCP sockets, stale/disconnected pilots, scene without both ships |
| Persistence | Two native authoritative snapshots of **at least two** characters, same `evejs-data` volume/image, independently evidenced restart between capture timestamps, identical ship/ISK/items | No native exporter, unsanctioned restart, duplicated item/ship ID, lost/crafted ISK or cargo |
| Economy | Native authoritative entry export with unique entry IDs and reward keys, exact integer double-entry transfer sums, explicit positive mint/negative burn | No ledger, repeated reward, repeated entry, unbalanced transfer, invalid money values |
| Client | Operator-confirmed **lawful** two-client login, undock, NPC interaction, mutual visibility, accepted fleet invitation/warp, shared combat/loot, actual item/ship gifts, shared quest credit, reconnect with the same ship and unaffected second pilot on the exact tested SHA/image | Missing legal client, real gameplay not observed, wrong client identities, stale/reused attestation |

No QA implementation pretends to observe a proprietary client. `PASS_SERVER`,
`PASS_SNAPSHOT`, `PASS_LEDGER` and `PASS_OPERATOR_ATTESTED` retain distinct
meanings. The overall result `PASS_WITH_OPERATOR_ATTESTATION` is possible
only when all five independently pass; it is not an automated screen test.

## Optional evidence inputs (no fabricated fixtures)

Running with no auxiliary files is expected to leave persistence,
economy and client `BLOCKED`. These are **opt-in operator-generated
native-authoritative exports**, never manually created claims of production
success. Keep raw exports in ignored `test-results/` or outside the repo,
never commit player, database, personal or authentication data.

```powershell
.\scripts\Verify-Coop-Reliability.ps1 -Before .\test-results\before.json -After .\test-results\after.json -Ledger .\test-results\ledger.json -Client .\test-results\client-observation.json
```

`before.json` / `after.json` contract:

```json
{
  "source": "native-authoritative-export",
  "projectSha": "<40-char-actual-project-commit>",
  "upstreamSha": "<40-char-actual-upstream-commit>",
  "capturedAt": "2026-10-25T10:00:00Z",
  "runtime": {
    "volumeName": "evejs-data",
    "imageId": "sha256:<running-image-digest>",
    "containerId": "<docker-container-id>",
    "containerStartedAt": "2026-10-25T09:00:00Z"
  },
  "characters": [{
    "id": 101, "shipId": 3001, "systemId": 30000142, "isk": "100000",
    "items": [{"id":1001,"typeId":34,"quantity":500,"locationId":3001}]
  }]
}
```

The actual export must contain **two or more real characters**. For the
after snapshot, actual `containerStartedAt` must be after the before
snapshot capture. Compare only a planned idle restart with no gameplay
or transactions in between. The read-only native snapshot exporter below supplies the database evidence;
an operator-approved restart and proof of the preserved named volume at both
snapshots remain separate prerequisites; this
gate does **not** perform or authorize them.

`ledger.json`: `{source, projectSha, upstreamSha, entries}` with one
row per native entry: `{entryId, txId, account, delta, kind}`; `delta`
is a signed base-10 integer **string**, kind `transfer`, `mint`, or
`burn`. Every `mint` additionally carries an immutable `rewardKey`.
A `transfer` must sum to zero with at least two entries; `mint` must
sum positive, `burn` negative. This audits a supplied **complete scoped
transaction window**; it cannot detect unexported transactions or prove
that an exported ledger is complete. Validate external source provenance.

`client-observation.json`: exact `{projectSha,upstreamSha,imageId,
authorizedClient:true,recordedAt,characterIds:[idA,idB],observations}`.
`observations` must contain actual operator-verified `true` for:
`loginA`, `loginB`, `undockA`, `undockB`, `npcVisible`,
`mutualVisibility`, `fleetInviteAccepted`, `fleetWarp`, `sharedCombat`,
`sharedLoot`, `itemGift`, `shipGift`, `sharedQuestCredit`,
`reconnectRetainsShip`, `secondPilotSurvivesDisconnect`.
The two identities must differ; the attestation must be at most 30
minutes old and match the tested SHA/image. The generated report never
prints player identifiers. Do not mark an unavailable capability PASS.

## Current limitations / remaining owner-only evidence

1. Until `DiagnoseWorld` resolves `/var/lib/evejs/coop-events.jsonl`, native world and party status remain **BLOCKED**. No synthetic events may substitute.
2. The character/items exporter is now implemented against upstream `gamestore.sqlite` and tested with deterministic native-shaped rows, but not yet validated on the actual deployed DB. Until its first real capture, persistence remains **BLOCKED**. A complete native double-entry wallet/mission-reward journal exporter is still absent, so economy remains **BLOCKED** independently. A hand-written JSON file is not valid evidence.
3. Compatible EVE client permission, actual login/visual observation and a disruption-approved server restart require the local operator. TCP connections and Docker health never suffice.
4. Some exact gameplay functions may still be unimplemented in adjacent work. Never change its source to force the gate green. Fix the functionality and retest.

No CI, no merge, no deploy or persistent-volume modification is part of this QA patch.

## QA review follow-up (2026-10-25)

- The initial prototype incorrectly required a headless startup event in the
  *last 30 minutes*. The corrected gate accepts an older boot record from
  the **same** running container process and checks fresh activity separately.
- The runner now reads `.State.StartedAt` and the actual `.Mounts` array using
  read-only Docker inspect. Both are requirements, not simulated flags.
- `Party` rejects two character IDs sharing one ship, a scene from a prior
  native boot, prior-container events, and a mismatch between scene pilots and
  an operator's claimed client/snapshot identities.
- Ledger checks reject zero-value entries and purported transfers between
  only one account. **They do not prove the native DB export is complete.**
- Live host and GUI checks remain pending: the test runner cannot SSH to the
  user's Windows machine and cannot safely claim a Docker/world/client PASS.

## Native SQLite evidence capture — implemented, NOT live-certified

Upstream `Code/server/src/gameStore/README.md` confirms runtime SQLite at
`/var/lib/evejs/gameStore/gamestore.sqlite` inside the persistent volume,
with `characters` and `items` keyed rows containing JSON records. Its
`services/account/walletState.js` rounds wallet balances to two decimals.
The exporter consequently emits `characters[].isk` as **integer ISK cents**
(`100025` means **1,000.25 ISK**), never a rounded whole-ISK amount.
The standalone test suite verifies 16 exporter/QA integration cases.

Once the *existing running world* is diagnosed, use two actual native
character IDs belonging to the private co-op test pilots. These are examples
only; replace them with the two observed IDs:

```powershell
# Read-only: no DB copy, game restart, source patch, or Docker file write.
.\scripts\Capture-Coop-NativeSnapshot.ps1 -CharacterIds 101,102 -OutputPath .\test-results\before.json
# Only AFTER separately approved normal idle server restart, capture again:
.\scripts\Capture-Coop-NativeSnapshot.ps1 -CharacterIds 101,102 -OutputPath .\test-results\after.json
# Re-run the native gates. Never claim client or economy PASS without their evidence.
.\scripts\Verify-Coop-Reliability.ps1 -Before .\test-results\before.json -After .\test-results\after.json
```

The capture script streams `coop-native-snapshot.cjs` into the running
container's `node -` process via stdin. It opens the *existing* SQLite
with `readonly:true,fileMustExist:true`, sets `query_only`, and executes
SELECT queries in a read transaction, then ROLLBACK. Nothing is installed
or modified inside the container. Its only output is a **private ignored
local snapshot**. It requires actual Docker `.Mounts`, `.Image`,
`.State.StartedAt`, both real characters, ownership of each active ship
and every owned item. Missing/inconsistent rows are explicit failures.
A simulated fixture cannot count as a real capture; test this against the
actual pinned database before treating persistence as complete.

The native exporter intentionally does **not** export account usernames,
passwords, credentials, chat, wallet journals or whole databases. This
privacy boundary means it cannot by itself certify idempotent mission
payouts or full market ledger conservation. A later audited native
transaction adapter is required for `economy = PASS_LEDGER`.