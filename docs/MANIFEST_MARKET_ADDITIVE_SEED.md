# Manifest starter market: non-destructive native seed import

**Status:** code ready for operator-reviewed OFFLINE testing only. Not deployed, not applied, and no live client purchase has been verified.

## Why this needs an additive importer

The last authorized client started at **Manifest V — AIR Laboratories Trade Center**, solar system **30100032** (region Exordium). EveJS's default v1 seed uses only **Jita 30000142** and **New Caldari 30000145**. It does not seed Manifest. The Rust `AdjustSeedStock` RPC fails if the target `(station_id,type_id)` has no existing `seed_stock` row, so it cannot add new station supply. The old `market-tools rebuild` **replaces** the entire market SQLite database including player orders/history; never use it to repair an established world.

## What the new code does

`coop-market-additive-seed.cjs` takes TWO independent, schema-compatible **market-server** SQLite databases: the real existing `market.sqlite` and a separately seeded **candidate** containing ONLY Manifest 30100032. It plans a scoped import and fails closed if the target region already has seed stock, player market orders or summary rows. It refuses cross-schema/static-SDE mismatches, wrong candidate system, empty native sell stock, symlink alias of the live database, overlapping buy orders/summary rows, and conflicting market item-type metadata. The default is **dry-run**.

On a deliberately authorized `-Apply` in an OFFLINE environment with an exclusive `flock`, it first retains a SQLite-consistent backup in `/var/lib/evejs/market/backups`, then inserts ONLY missing native station/region/system references, market type metadata, stock/supply and precomputed region/system summaries in a **single SQLite transaction**. All native prices/quantities come verbatim from the pinned EveJS market-seed candidate. It **never** truncates/updates the original `market_orders`, escrow, history or manifest, does not erase the existing Jita market, and cannot duplicate existing Manifest rows on re-run. It also never creates player items, modifies wallets or changes NPC ore receipts.

## Operator runbook — do not execute unattended

1. Obtain explicit owner approval and a planned service interruption. Save client logs, character / wallet state and project/image SHA.
2. Run the separate **read-only** `Inspect-Coop-Market.ps1` first. Verify Manifest is unseeded. If it already has market activity, the importer MUST refuse; investigate instead.
3. Stop server and market intentionally, **without removing volumes**: `docker compose -f <CodePath>/compose.yaml stop server market`. Verify both stopped.
4. Build a **separate candidate**, never run `market-tools rebuild` or replace the live market DB. After the services are stopped, use the new reversible project helper, which accepts only the pinned v1 seed config, an initially absent output path and the Manifest system:

   ```powershell
   .\scripts\Prepare-Coop-ManifestSeed.ps1
   # Inspect the preview, then explicitly create only coop-manifest.candidate.sqlite:
   .\scripts\Prepare-Coop-ManifestSeed.ps1 -BuildCandidate
   ```

   Its implementation invokes the pinned native `market-seed` with a temporary config whose **only** modified setting is `[output].database_path` pointing to `/var/lib/evejs/market/coop-manifest.candidate.sqlite`, plus `build --force --solar-system-id 30100032`. The candidate must not exist beforehand, and the helper holds the same exclusive offline `flock` as the running market service. The native candidate SQLite is checked for the exact system and positive station sell stock. **The live market.sqlite is never replaced by this preparation step.**
5. From updated project checkout, while market remains OFFLINE:

   ```powershell
   .\scripts\Bootstrap-Coop-Market.ps1 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
   ```

   This runs the importer via Docker `market-tools` with nonblocking **exclusive flock**; by default it prints a dry-run plan and makes no changes. If lock fails, stop and investigate; never force it.
6. Only if the plan shows `ADDITIVE_IMPORT_ELIGIBLE` and backup location is verified, an authorized operator may explicitly execute:

   ```powershell
   .\scripts\Bootstrap-Coop-Market.ps1 -Apply -ConfirmMarketMutation
   ```

7. **Before restarting** run pinned `market-server --config /app/docker/market-server.toml doctor` offline and compare Jita/Manifest stock; confirm the backup is retained. If any issue arises, keep services stopped and use the existing retained-backup restore mechanism under operator control. Start `market` then `server` only after validation.
8. Test the real client at the exact Manifest V AIR station: browse Market, buy one low-value seeded item, confirm native ISK debit + hangar ownership + seed stock decrement, then reconnect and verify persistence. Without these, do not mark market PLAYABLE.

## Safety constraints

- No code in this PR calls Docker, writes to `evejs-data`, or alters any database in this chat. The operator CLI is explicitly gated and defaults to dry-run.
- Do not mix target/candidate from unrelated SDE builds or unknown market schemas. Do not import from another player's server or assume remote market order ID ownership.
- Importer intentionally rejects overlapping Exordium liquidity rather than merging/pricing partial regions; no silent overwrite of player orders.
- Source-level SQL and mocked importer are tested locally, but the **real better-sqlite3 database merge and pinned Rust doctor are not yet tested on a disposable Docker volume**. Keep this PR draft until that proof exists. Do not attempt APPLY on irreplaceable saves before fault/crash recovery validation.

## Source-level integration proof (disposable only)

In addition to Node tests, the importer table-copy SQL was executed against disposable native-shaped SQLite databases. It inserted a Manifest system/station/market-type/seed-stock/buy-stock/summaries set, returned SQLite `quick_check=ok`, and preserved a preexisting Jita player market order exactly. This is not a live market-server integration test and does not replace validating the Rust doctor on a disposable **full native** market DB before applying to `evejs-data`.