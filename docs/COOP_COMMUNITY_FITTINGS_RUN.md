# COOP-043 — Community Fittings: executable local runbook

**Implementation status:** source and isolated tests complete; live API harvest and game-client acceptance **NOT performed in this cloud session**. No gameplay claims on test-only evidence. Ship coverage is measured rather than invented.

## Safety and baseline

- Pinned upstream: `gameboys84/EveJS` commit `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
- No changes to proprietary EVE client, no GitHub Actions, no new dependencies in source tree. This only seeds native `savedFittings` in the SQLite database of a **stopped** server.
- Backups are mandatory before apply; do not reset `evejs-data`, modify player wallets/inventory, delete player-owned fittings, or fabricate modules.
- The existing native community fitting browser uses owner `1000282` and may not render >600 records correctly. The initial smoke test must remain within 600; larger catalog is **experimental** until a real client verifies search, scroll, open/save and restart at >=2,000 records.
- `SdePath` is the directory with `types.jsonl` and `groups.jsonl` that matches the PINNED server snapshot; do not substitute current 2026 SDE blindly. The scripts validate item IDs and slot flag SHAPES; they do not currently simulate full Dogma CPU, PG, rigs, skills or launcher limitations.
- Source data is fetched locally only and must not be committed: the public EVE Workbench API returns published fits, and zKillboard/ESI returns public combat-loss builds. Keep attribution and provider terms; label killmail builds `[FIELD]` (unreviewed). Don't copy private/corp EVE University fittings.

## Tests

From `pas7-studio/evejs-coop-universe` branch containing COOP-043:

```powershell
node --test .\tests\coop-community-fittings.test.mjs .\tests\coop-community-fitting-pipeline.test.mjs
```

`13/13` isolated source tests PASS in the development workspace. **PowerShell CLI and actual live better-sqlite3 DB apply have not been executed on a Windows game host**; these are next validation gates. Local agent should also run normal regression baseline and check Docker/world health, not invent a pass.

## 1. Locate the actual environment (read-only)

On Windows, locate the existing `C:\Games\EveCoop\upstream-evejs\Code` and the pinned SDE files and confirm `git -C ... rev-parse HEAD`. Confirm where the existing running container mounts `evejs-data` and where `gamestore.sqlite` actually lives. Use `docker inspect`, read-only; avoid guesses. Use external large-data/cache folders such as `O:\tmp\coop043` if that drive exists, otherwise a suitably sized external temp path.

## 2. Collect just the smoke sample, no game mutation

```powershell
.\scripts\Run-CommunityFittings.ps1 -Action Collect -SdePath '<VERIFIED-SDE-DIR>' -OutputRoot '<EXTERNAL-TEMP-DIR>\coop043' -Ships 'Venture,Heron,Merlin,Rifter,Caracal,Vexor,Osprey,Drake' -WorkbenchPages 120 -FieldPages 3 -PerHull 5
```

Check `catalog.json` and `coverage-report.json`. Verify provenance URLs, records per hull, no unknown/unpublished IDs, low/mid/high/rig flags, duplicate hashes and actual distinct roles. Published Workbench fits get `[EWB]`; combat-loss fits `[FIELD]`; explicitly authorized local EFT get the original source name. A shortfall in `coverage-report.json` must remain visible.

If Workbench API is unavailable, the wrapper reports a warning and falls back to zKillboard/ESI. If both APIs fail, fail honestly, don't generate fake fits. Both are rate-limited, cached and may need more source pages.

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

The script checks a stopped container **before it opens the DB**, creates a verified SQLite backup, checks the persistence outbox, and writes only community owner + fitting next ID. It does not automatically restart the server. Reapply on the same catalog must produce zero creations and no duplicates.

## 5. Real game-client acceptance (mandatory)

1. Restart staged EveJS. A real compatible/authorized client should see `Community Fittings` and smoke hull templates (not just a DB row).
2. Open/save-as with **two separate authenticated pilots**; source is read-only. Restart server and verify persistence.
3. Fit a real test ship with owned modules and sufficient skills. Confirm no free modules, ISK transfers or duplicate inventory.
4. Try missing modules/skills and ensure clear rejection. Do not treat native API saved-fit success as physical fit success.
5. Test >600/1,000/2,000 catalog rows **only on a disposable world** with `-ExperimentalLargeCatalog`, then verify full client scrolling/search, performance and no truncation. If the client hard-limits the list, implement a server-side per-hull/page view rather than forcing thousands of records into a broken UI.
6. Full coverage run without `-Ships`, and a report for each fittable hull with <3 fits; increase source pages or add actually compatible, distinct EFTs. Do not clone random donor fits across hulls or disguise unvalidated loss fits as PvE recommendations.
7. With owner approval, repeat Plan and Apply to the **stopped real** world using a verified backup, and record exact DB/container/volume identifiers, backup hash, fit count, and client screenshots privately.

**Never claim DONE before observed two-client browse and fitting on the actual server.**

## 6. Rollback

Keep the exact SQLite snapshot created by the seeder outside of `evejs-data`. With the target stopped, verify backup integrity and replace the target DB with the tested backup through the native backup/restore process appropriate for its Docker mount/WAL layout. Reopen the server and verify pre-install fit counts and player state. Never reset/recreate a named game volume.