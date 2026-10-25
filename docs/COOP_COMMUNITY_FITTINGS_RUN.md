# COOP-043 — Community Fittings: executable local runbook

**Implementation status (local session 2026-10-25):** source, tests, live public-API harvest, real-Dogma validation, stopped-world staging apply/rollback and native-payload verification were performed locally against the pinned upstream and the real `evejs-data` gamestore. **Client (in-game window) acceptance is still owned by the human tester** — the catalog was not written into the live world in this session, and no gameplay claim is made from server-side evidence.

Known live-source and runner defects fixed in this session (each one previously made a real run impossible):

| Defect | Symptom | Fix |
| --- | --- | --- |
| Whole-file SDE read with a 50 MB guard | `SDE_FILE_TOO_LARGE` on the pinned `types.jsonl` (143 MB) | streaming JSONL reader with row/byte caps |
| camelCase-only EVE Workbench schema | `WORKBENCH_LIST_SCHEMA_CHANGED` on the live API | accept the real `Fits`/`NumberOfPages`/`Id`/`ShipId`/`Eft` keys |
| Positional EFT section counting | 87% of public fits rejected with `EFT_MODULE_QUANTITY_NOT_ONE` | classify every line by the item's own dogma effect/category when real dogma data exists |
| `--approve-sha256` argument regex | `UNKNOWN_ARGUMENT --approve-sha256`, Apply impossible | argument names may contain digits |
| No Dogma validation at all | any structurally plausible fit looked "valid" | slot kind, slot count, rig size, calibration, hardpoints, drone bay, group limit and CPU/PG/skill checks |
| First N fits per hull | duplicates and near-identical setups | round-robin over derived `(role, tier)` buckets |

## Safety and baseline

- Pinned upstream: `gameboys84/EveJS` commit `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
- No changes to proprietary EVE client, no GitHub Actions, no new dependencies in source tree. This only seeds native `savedFittings` in the SQLite database of a **stopped** server.
- Backups are mandatory before apply; do not reset `evejs-data`, modify player wallets/inventory, delete player-owned fittings, or fabricate modules.
- The existing native community fitting browser uses owner `1000282` and may not render >600 records correctly. The initial smoke test must remain within 600; larger catalog is **experimental** until a real client verifies search, scroll, open/save and restart at >=2,000 records. The native `GetCommunityFittings` call returns one dict for the whole owner and the client has no paging parameter, so **server-side pagination is not possible without modifying the game client** (forbidden). A large catalog is therefore bounded, measured and left switched off until a human verifies it in the client.
- `SdePath` is the directory with `types.jsonl`, `groups.jsonl`, `typeDogma.jsonl`, `dogmaAttributes.jsonl` and `dogmaEffects.jsonl` that matches the PINNED server snapshot; do not substitute a current 2026 SDE. The scripts validate slot flag shapes, slot kind vs module dogma effects, hull slot counts, rig size, calibration, turret/launcher hardpoints, drone bay volume, single-module group limits and CPU/Powergrid against the hull's own dogma attributes.
- CPU/Powergrid acceptance model (documented, not guessed): a fit is accepted when it fits at base capacity, or inside the all-V fitting envelope `CPU/PG capacity x1.25` (CPU Management V / Power Grid Upgrades V) `x1.05` (best-case fitting implant), with `-25% CPU` / `-10% PG` applied to turret and launcher modules (Weapon Upgrades V / Advanced Weapon Upgrades V). Anything above that is rejected as `CPU_IMPOSSIBLE` / `PG_IMPOSSIBLE`. Drone *bandwidth* limits launched drones only, so it is reported but never used to reject a bay.
- Source data is fetched locally only and must not be committed: the public EVE Workbench API returns published fits, and zKillboard/ESI returns public combat-loss builds. Keep attribution and provider terms; label killmail builds `[FIELD]` (unreviewed). Don't copy private/corp EVE University fittings.

## Tests

From `pas7-studio/evejs-coop-universe` branch containing COOP-043:

```powershell
node --test .\tests\coop-community-fittings.test.mjs .\tests\coop-community-fitting-pipeline.test.mjs .\tests\coop-community-fit-dogma.test.mjs
```

`22/22` isolated tests PASS locally (13 original + 9 Dogma/streaming/diversity). The suite covers slot-kind mismatch, rig size, calibration, hardpoints, drone bay, group limit, CPU/PG envelopes, role profiling, diverse selection, a >50 MB SDE file and an uncovered-hull reason report. A passing unit test is not client proof.

## 1. Locate the actual environment (read-only)

On Windows, locate the existing `C:\Games\EveCoop\upstream-evejs\Code` and the pinned SDE files and confirm `git -C ... rev-parse HEAD`. Confirm where the existing running container mounts `evejs-data` and where `gamestore.sqlite` actually lives. Use `docker inspect`, read-only; avoid guesses. Use external large-data/cache folders such as `O:\tmp\coop043` if that drive exists, otherwise a suitably sized external temp path.

## 2. Collect just the smoke sample, no game mutation

```powershell
.\scripts\Run-CommunityFittings.ps1 -Action Collect -SdePath '<VERIFIED-SDE-DIR>' -OutputRoot '<EXTERNAL-TEMP-DIR>\coop043' -Ships 'Venture,Heron,Merlin,Rifter,Caracal,Vexor,Osprey,Drake' -WorkbenchPages 120 -FieldPages 3 -PerHull 5
```

Check `catalog.json` and `coverage-report.json`. Verify provenance URLs, records per hull, no unknown/unpublished IDs, low/mid/high/rig flags, duplicate hashes and actual distinct roles. Published Workbench fits get `[EWB]`; combat-loss fits `[FIELD]`; explicitly authorized local EFT get the original source name. A shortfall in `coverage-report.json` must remain visible.

If Workbench API is unavailable, the wrapper reports a warning and falls back to zKillboard/ESI. If both APIs fail, fail honestly, don't generate fake fits. Both are rate-limited, cached and may need more source pages.

Full-library pass (all fittable hulls of the pinned SDE, no killmail fallback):

```powershell
.\scripts\Run-CommunityFittings.ps1 -Action Collect -SdePath '<VERIFIED-SDE-DIR>' -OutputRoot '<EXTERNAL-TEMP-DIR>\coop043-full' -WorkbenchPages 387 -FieldPages 0 -PerHull 5 -MaxFits 7000
```

`-FieldPages 0` disables the zKillboard/ESI fallback (it is very slow: 1 request/second plus one ESI call per killmail). Run it as a second pass with `-FieldPages 2..6` when `coverage-report.json` still lists hulls below target, and use `-FieldTarget 5` to top up hulls that already have 3-4 fits.

Known ceiling: the public pool is finite. Hulls such as rare special editions have no public fittings at all, and a deeper zKillboard pass returned the same records with zero new API failures. Never copy a donor fit from another hull to fill a gap.

### `coverage-report.json`

Required fields, all measured: `shipsTotal`, `shipsWithAtLeastOneFit`, `shipsWithoutFit`, `fittingsTotal`, `atLeastThree`, `atLeastFive`, `fewerThanThree`, `bySource`, `byRole`, `rejectedTotal`, `rejectedReasons`, `dogmaValidated`, `dogmaCheckedRecords`, `nativeClientValidated` and `missing[]` with `shipTypeID`, `shipName`, `variants`, `available`, `reason` and the chosen `roles`. A hull stays visibly uncovered with an explicit reason (`NO_PUBLIC_FIT_FOUND`, `TARGET_NOT_MET_ONLY_N_VALID`, or the first real rejection code such as `CPU_IMPOSSIBLE`) instead of being filled with an invented fit.

Roles and tiers are derived from the fitted modules' own SDE groups and meta levels (`mining`, `combat`, `ewar`, `logistics`, `exploration`, `hauling` x `budget`, `improved`, `specialized`). No PvE/PvP label is fabricated: the client only ever sees an observable property.

## 3. Optional author-approved EFT packs

Create `manifest.json` in a local directory alongside `.eft` files; entries need `file`, `sourceURL`, `author`, `permission`. Then repeat Collect with `-Manifest '<FOLDER>\manifest.json'`. Only public/permissioned content belongs in this local private server. The importer does not scrape restricted third-party datasets.

## 4. Plan and test disposable world before any live install

Use a **real stopped disposable EveJS server** and a copy of `gamestore.sqlite` with the pinned `.git` source checkout and the existing `better-sqlite3` dependency in `Code\server\node_modules`. The optional seeder cannot be operated from a disconnected cloud session. Check it with a plan:

```powershell
.\scripts\Run-CommunityFittings.ps1 -Action Plan -SdePath '<VERIFIED-SDE-DIR>' -OutputRoot '<EXTERNAL-TEMP-DIR>\coop043' -CodePath 'C:\Games\EveCoop\upstream-evejs\Code' -DbPath '<VERIFIED-STOPPED-TEST-DB-PATH>'
```

Note `catalogSha256`, `afterCommunity`, and `changes`. For sample <=600, **do not pass `-ExperimentalLargeCatalog`**.

After an explicit approval, test apply on stopped staging container with verified DB attachment:

```powershell
.\scripts\Run-CommunityFittings.ps1 -Action Apply -SdePath '<VERIFIED-SDE-DIR>' -OutputRoot '<EXTERNAL-TEMP-DIR>\coop043' -CodePath 'C:\Games\EveCoop\upstream-evejs\Code' -DbPath '<VERIFIED-STOPPED-TEST-DB-PATH>' -Container '<TEST-CONTAINER>' -CatalogSha256 '<SHA256-FROM-PLAN>' -BackupDir '<BACKUPS-OUTSIDE-EVEJS-DATA>' -ConfirmApply
```

The script checks a stopped container **before it opens the DB**, creates a verified SQLite backup, checks the persistence outbox, and writes only community owner + fitting next ID. It does not automatically restart the server. Reapply on the same catalog must produce zero creations and no duplicates; a managed record that is no longer in the catalog is removed (`removed`), while unmanaged community rows are never deleted.

### Whole-volume install (live world) wrapper

`Install-CommunityFittings-ToVolume.ps1` performs the approved stopped-world sequence on a Docker volume: stop check → volume attachment check → copy `gamestore.sqlite` (+ WAL/SHM) out → Plan → Apply with an out-of-volume backup → WAL checkpoint → copy the single file back → `chown 1000:1000` → native payload verification → evidence JSON. It never starts, restarts or resets anything.

```powershell
.\scripts\Install-CommunityFittings-ToVolume.ps1 -Volume evejs-data -Container evejs-server-1 `
  -Catalog '<EXTERNAL-TEMP-DIR>\catalog.json' -SdePath '<VERIFIED-SDE-DIR>' `
  -CodePath 'C:\Games\EveCoop\upstream-evejs\Code' -WorkRoot '<EXTERNAL-TEMP-DIR>\live' `
  -BackupDir '<EXTERNAL-TEMP-DIR>\live-backups' -AllowOver600 -ConfirmInstall
```

### Native payload probe (no client required)

`scripts/Verify-CommunityFittings-Native.cjs` loads the **real upstream** `_secondary/fitting/fittingStore` (not a reimplementation) against a `gamestore.sqlite`, reads `getCommunityFittingsResponse()` exactly like the in-game window, marshals it with the server's own encoder and reports count, per-hull distribution, duplicate names/signatures, `util.KeyVal` field health and marshalled bytes:

```powershell
$env:EVEJS_GAMESTORE_DATA_DIR='<DB-PARENT>\gameStore\data'
node .\scripts\Verify-CommunityFittings-Native.cjs
```

`verdict=NATIVE_PAYLOAD_OK` only means the server can serve a well-formed community payload. It is not client proof.

### Staging evidence actually recorded on 2026-10-25

- pinned upstream `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, container `evejs-server-1` (image `evejs-local`), volume `evejs-data` mounted at `/var/lib/evejs`, live `gamestore.sqlite` 16.4 MB;
- consistent read-only snapshot taken with the native SQLite backup API (`quick_check ok`, `savedFittings` = 5 rows, community owner `1000282` = 0 fittings, `nextFittingID` = 1, `_persistence_outbox` empty);
- Plan on the staging copy: `catalogSha256` recorded, `changes.created` = records, `afterCommunity` = same;
- Apply on the staging copy with a dedicated **stopped** container (`coop043-staging`) and an out-of-volume backup: `applied=true`, backup `quick_check ok`;
- re-Apply: `created=0, updated=0, unchanged=N` (idempotent, no duplicates, `nextFittingID` unchanged);
- native store read of the staged DB: correct owners, correct `util.KeyVal` fields, unique names/signatures;
- rollback: restoring the pre-Apply snapshot returned the community owner to 0 fittings and `nextFittingID` to 1 with `quick_check ok`;
- player owners were never touched (no wallet, inventory, ship or unrelated fitting rows written).

## 5. Real game-client acceptance (mandatory)

1. Restart staged EveJS. A real compatible/authorized client should see `Community Fittings` and smoke hull templates (not just a DB row).
2. Open/save-as with **two separate authenticated pilots**; source is read-only. Restart server and verify persistence.
3. Fit a real test ship with owned modules and sufficient skills. Confirm no free modules, ISK transfers or duplicate inventory.
4. Try missing modules/skills and ensure clear rejection. Do not treat native API saved-fit success as physical fit success.
5. Test >600/1,000/2,000 catalog rows **only on a disposable world** with `-ExperimentalLargeCatalog`, then verify full client scrolling/search, performance and no truncation. The stock client has no paging argument for `GetCommunityFittings`, so a bigger catalog cannot be split server-side without client changes (forbidden). Record the observed limit and keep the installed catalog inside it.
6. Full coverage run without `-Ships`, and a report for each fittable hull with <3 fits; increase source pages or add actually compatible, distinct EFTs. Do not clone random donor fits across hulls or disguise unvalidated loss fits as PvE recommendations.
7. With owner approval, repeat Plan and Apply to the **stopped real** world using a verified backup, and record exact DB/container/volume identifiers, backup hash, fit count, and client screenshots privately.

**Never claim DONE before observed two-client browse and fitting on the actual server.**

## 6. Rollback

Keep the exact SQLite snapshot created by the seeder outside of `evejs-data`. With the target stopped, verify backup integrity and replace the target DB with the tested backup through the native backup/restore process appropriate for its Docker mount/WAL layout. Reopen the server and verify pre-install fit counts and player state. Never reset/recreate a named game volume.