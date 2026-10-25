# COOP-043 — Community Fittings: local run evidence (2026-10-25)

Task: `COOP-043`. Branch `feat/coop-043-community-fittings-runner` (PR #71), worktree
`O:\tmp\wt-coop043` off `origin/feat/coop-043-community-fittings-runner`.

Everything below was executed on this machine, not inferred. Anything not executed is marked
**NOT RUN**. No GitHub CI was added or used.

## 1. Actual environment (read-only inspection)

| Item | Measured value |
| --- | --- |
| Upstream checkout | `C:\Games\EveCoop\upstream-evejs`, `git rev-parse HEAD` = `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` (matches the documented pin) |
| Server container | `evejs-server-1`, image `evejs-local`, compose project `evejs`, `Code\compose.yaml` + `compose.coop-probe.yaml` |
| Volume | `evejs-data` mounted at `/var/lib/evejs`; also `evejs-images` at `/app/server/src/_secondary/image/generated` |
| Live gamestore | `/var/lib/evejs/gameStore/gamestore.sqlite` (16.4 MB), `EVEJS_GAMESTORE_DATA_DIR=/var/lib/evejs/gameStore/data` |
| SDE in use | `/var/lib/evejs/sde/eve-online-static-data-3396210-jsonl` (510 MB; copied to `O:\tmp\coop043\sde` for the scripts) |
| Native community owner | `COMMUNITY_FITTING_CORP = 1000282`, `OWNER_SCOPE.COMMUNITY`, read-only for players |
| Native write limit | `MAX_CORP_FITTINGS = 600` is enforced only on player `saveFitting`/`saveManyFittings`, not on read |

## 2. Defects found while actually running the pipeline (all fixed)

| Defect | Observed failure | Fix |
| --- | --- | --- |
| Whole-file SDE read with a 50 MB guard | `SDE_FILE_TOO_LARGE` on the pinned `types.jsonl` (143.7 MB) | streaming JSONL reader (`readJsonl`) with byte/row caps |
| camelCase-only Workbench schema | `WORKBENCH_LIST_SCHEMA_CHANGED` against the live API | accept `Fits`/`NumberOfPages`/`Id`/`ShipId`/`Eft` |
| Positional EFT section counting | 254 of 291 sampled public fits rejected with `EFT_MODULE_QUANTITY_NOT_ONE` (empty sections collapse) | classify each line by the item's own dogma effect/category; stack size on a module line fits one and keeps the rest as cargo |
| `--approve-sha256` argument regex | `UNKNOWN_ARGUMENT --approve-sha256`, Apply impossible | argument names may contain digits |
| stderr treated as fatal in the runner | a single `API_WARN` killed a finished Collect run | merge streams, exit code decides |
| No dogma validation at all | any structurally plausible fit looked valid | full pinned-SDE dogma validation (below) |
| First N fits per hull | near-identical duplicates | round-robin over derived `(role, tier)` buckets |
| 50-char name truncation | 30 different fits rendered with identical names | deterministic signature suffix, verified 0 duplicates |
| Hulls without slots counted as failures | shuttles/capsules/freighters polluted coverage | `fittable=false`, reason `NO_FITTING_SLOTS` |

Tests: `node --test tests/coop-community-fittings.test.mjs tests/coop-community-fitting-pipeline.test.mjs tests/coop-community-fit-dogma.test.mjs` → **26/26 PASS**.

## 3. Dogma acceptance model (pinned SDE, not guessed)

Hard rejections: slot kind vs module dogma effects (`loPower`/`medPower`/`hiPower`/`rigSlot`/`subSystem`/`serviceSlot`), slot index vs the hull's own slot counts, rig size vs hull `rigSize`, sum of `upgradeCost` vs `upgradeCapacity`, turret/launcher count vs hardpoints, drone bay volume vs `droneCapacity`, `maxGroupFitted=1` duplicates, cargo volume, required-skill existence/level, and a module with no dogma row (`NO_DOGMA_DATA`).

CPU/Powergrid envelope (documented, tested): accepted at base capacity, or inside
`capacity x 1.25` (CPU Management V / Power Grid Upgrades V) `x 1.05` (best-case fitting implant),
with `-25% CPU` / `-10% PG` applied to turret and launcher modules (Weapon Upgrades V /
Advanced Weapon Upgrades V). Above that: `CPU_IMPOSSIBLE` / `PG_IMPOSSIBLE`.
Drone **bandwidth** limits launched drones only, so it is reported but never rejects a bay.

## 4. Collected library (public sources only)

Command: `Run-CommunityFittings.ps1 -Action Collect -WorkbenchPages 387 -FieldPages 2 -PerHull 5 -MaxFits 10000 -Concurrency 3 -Spacing 150`
(sources: published EVE Workbench fits with author + URL; public zKillboard/ESI losses for hulls below 3; no private/corp fits).

| Metric | Value |
| --- | --- |
| Hulls in the pinned SDE | 423 (410 fittable, 13 without any module slot) |
| Fittings installed | **1616** |
| Hulls with at least one fit | 364 |
| Hulls with >= 3 fittings | **320** |
| Hulls with 5 fittings | **293** |
| Fittable hulls still below 3 | 90 |
| Fittable hulls with none | 46 |
| Duplicate names / signatures | 0 / 0 |
| By role | ewar 560, combat 503, exploration 280, logistics 100, mining 70 (workbench pass) |
| Source candidates rejected | 5104 (dogma/slot/CPU/PG/hardpoint/data, plus 186 ambiguous item names) |

`coverage-report.json` lists every hull below target with `variants`, `available`, `reason`
(`NO_PUBLIC_FIT_FOUND`, `TARGET_NOT_MET_ONLY_N_VALID`, `NO_FITTING_SLOTS`, or the first dogma
rejection code). Shortfalls are visible, never filled with invented fits.

A deeper follow-up run (`-FieldPages 6`) produced the **same records with zero new API failures** for hulls below three: those hulls have no further distinct public losses, and inventing fittings is forbidden. A second top-up run with `-FieldTarget 5` (`-FieldPages 4`) added 16 more fits for hulls that already had 3-4, taking the library to 1616 and hulls-with-five to 293. Breakdown of the 90 hulls still below three: 46 have no public fit at all, 28 have exactly one, 16 have two. The 13 hulls without any module slot (shuttles, capsules, freighters) are excluded from the denominator.

## 5. Staging on a copy of the real world (before touching live)

- Consistent source snapshot through the native SQLite backup API inside the container: `quick_check ok`, `savedFittings` 5 rows, community owner 0 fittings, `nextFittingID` 1, `_persistence_outbox` empty.
- Plan on the copy: `catalogSha256` recorded, `created` = record count.
- Apply on the copy with a dedicated **stopped** container: `applied=true`, backup `quick_check ok`.
- Re-Apply: `created=0, updated=0, unchanged=N` — idempotent, no duplicates, `nextFittingID` stable.
- Rollback: restoring the pre-Apply backup returned the community owner to 0 fittings and `nextFittingID` to 1, `quick_check ok`.
- Player owners were never touched (no wallet, inventory, ship or unrelated fitting rows).

## 6. Disposable rehearsal world (full volume copy) and the >600 measurement

`evejs-data-coop043-rehearsal` = byte copy of `evejs-data`, container `coop043-rehearsal` (stopped).

Install of the final catalog through the real upstream `fittingStore`:

```
communityFittings 1616 | distinctHulls 364 | >=3 320 | =5 293
duplicateNames 0 | duplicateSignatures 0 | problemCount 0 | verdict NATIVE_PAYLOAD_OK
marshalledBytes 711266
```

**Large-catalog finding:** the stock client calls `corpFittingMgr.GetCommunityFittings` with no
paging argument and the server returns one dict for the whole community owner, so a server-side
page/subset split is impossible without modifying the game client (forbidden by the project
boundaries). The 600 number is a *player write* limit, not a read limit. What can be measured
without touching the client: 1616 fittings marshal to ~695 KB before the cached-method-call
wrapper compresses them. Whether the client UI scrolls/search that volume is a client question
and is recorded below.

## 7. Live install into the real stopped world (owner-approved)

`Run-CommunityFittings.ps1 -Action ...` via `Install-CommunityFittings-ToVolume.ps1`:

| Step | Evidence |
| --- | --- |
| Container stopped before any DB write | `docker inspect evejs-server-1` → `Running=false` |
| Volume check | container mounts `evejs-data` (+`evejs-images`); refused otherwise |
| Source DB copy | `O:\tmp\coop043\live\gamestore.sqlite`, SHA-256 `95EC0E22...E64C5E1A9` |
| Plan + first Apply | `afterCommunity=1600`, `created=1600`, `catalogSha256=5996d211adb2fa8ab6204fda797cbe4dd15e5f951e9e0b044f7c49801f7fc7ce` |
| Apply | `applied=true`, `dogmaValidated=true`, WAL checkpointed |
| External backup | `O:\tmp\coop043\live-backups\coop043-1792949698034-50416.sqlite` (17,195,008 B), SHA-256 `58DDA0CE...E6E8D0328F` (outside the volume) |
| Installed DB | SHA-256 `D8621D0459C4699C0F27F514B974D417C10F9D5DDA4C7F57610A0704AEB1C23D`, ownership restored to `1000:1000` |
| Native read from the volume | 1600 fittings, 364 hulls, 0 duplicate names/signatures, `NATIVE_PAYLOAD_OK` |
| Server start | `evejs-server-1` `healthy`, no fitting/error lines in the log tail, NPC telemetry resumed (`living-native-activity`) |
| Restart persistence | after `docker restart`: 1600 fittings, same hull distribution, 0 duplicates, `NATIVE_PAYLOAD_OK` |
| Top-up install (`-FieldTarget 5`) | catalog `cfdf3db8...c6610`, `created=19`, `unchanged=1597`, total 1616, backup `coop043-1792953467507-10356.sqlite` SHA-256 `183D3AF8...27D23E3`; live store then reads 1616 fittings / 320 hulls with >=3 / 293 with 5 |

Player data was not modified: the seeder writes only `owners\u001f1000282` (community scope) and
`_meta.nextFittingID`; no ISK, inventory, ship, wallet or character fitting rows were touched.

## 8. Client (in-game) status

Client `W:\EVE Online - 3396210` was launched locally; character `Sasunok1488` (140000005) logged
in to the live server after the install. Owner-observed in the real client:

- the **Community Fittings window opens** and lists the installed fittings;
- **scrolling and search work** across the full catalog (1600 records at the time of the test; 1616 after the top-up) (no freeze, no truncation
  reported at this size, i.e. the 690 KB marshalled payload is handled and the 600 number is not a
  read limit);
- not yet observed by the tester: copy-to-my-fittings, then fitting a real ship with owned
  modules, then a second independent pilot. Those are the remaining client gates and are **NOT
  CLAIMED**.

The client login was broken immediately after the install restart ("transport has not yet been
connected, or authentication was not successful"); an EVE client relaunch (new one-time login
ticket) resolved it. This is a normal consequence of restarting the server, not a catalog defect.

No client binary was modified; no claim is made from server-side data.

## 9. Rollback procedure actually rehearsed

1. Keep `O:\tmp\coop043\live-backups\coop043-*.sqlite` (verified by `quick_check` before restore).
2. Stop the world, copy the backup back into `evejs-data:/var/lib/evejs/gameStore/gamestore.sqlite`,
   delete stale `-wal`/`-shm`, restore `1000:1000` ownership.
3. Start the world, verify community owner count returns to 0 and `nextFittingID` to 1.
4. Never reset or recreate the volume.

## 10. Verdict

- Server side: **PASS** — pinned-SDE dogma validation, 1616 real fits, staging apply/rollback,
  live install with a verified external backup, restart persistence, no duplicates, native
  payload `NATIVE_PAYLOAD_OK`.
- Client side: **PARTIAL PASS** — the Community Fittings window opens, shows the catalog and
  scroll/search works at 1600 records (owner-observed). Copy-to-my-fittings and actually fitting
  a real ship with owned modules, plus a second independent pilot, remain **NOT VERIFIED**.
- No gameplay PvP/PvE, wallet, market or inventory behaviour was changed by this task.
