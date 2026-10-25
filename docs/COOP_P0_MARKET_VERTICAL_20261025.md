# P0 market vertical integration — native catalog + real Manifest stock

**Scope:** the two currently separate market streams are integrated for review on the latest `main`:
- PR #27: native GetMarketGroups catalog fix, backed by actual persisted SDE itemTypes, default-OFF via `EVEJS_COOP_MARKET_CATALOG=1`.
- PR #25: safe additive offline starter-stock **candidate** and importer into the existing native market SQLite. Absolutely no automatic re-seed or market.sqlite replacement.
- **New in this integration:** exact-station read-only stock readiness, identifying whether the player's current station (not just another system/station) has positive *real native*, published, browsable seeded stock or authentic open player sell orders. This is evidence to plan a client purchase, not a claim of successful purchase.

The last owner-published client log showed an undock at **Manifest V — AIR Laboratories Trade Center**, solar system **30100032**. The stock default geography in pinned upstream market seed is Jita+New Caldari; that is why a healthy market daemon can still show no purchasable Manifest items.

## Verified current-main reconciliation

This branch starts from recent main `0ef58c302dad7ef635aea770a28af59067edc7e2`, not outdated PR copies of the deployment or patch scripts. It merges independent source/docs/tests from #25 and #27; it **only adds** the `coopMarketCatalog` integration module and native `server/src/services/market/marketProxyService.js` hook to the existing transactional patcher and adds a separate opt-in `-EnableMarketCatalog` PowerShell parameter. **Existing NPC Local chatter, agent-dialogue hooks, current native World, and VPN/friend-PC setup remain intact.**

**Keyed-SDE compatibility fix:** the native market catalog hook now uses EveJS's canonical `readStaticRows("itemTypes")` instead of raw `readStaticTable`, and the adapter also accepts dictionary-form `types` keyed by native type IDs (`_key` fallback). Without this, a populated, keyed native SDE could still produce an empty MarketGroups listing. Regression coverage includes both keyed and normalized SDE row formats, with no invented marketGroupIDs.

## Read-only operator workflow

These commands run inspections only, do not rebuild/restart Docker or change any player/world/market state.

```powershell
# First determine where genuine station stock exists:
.\scripts\Inspect-Coop-Market.ps1 -SolarSystems '30100032,30000142,30000144'

# Enumerate all native stations in the Manifest system with local seeded sell units and real player sell orders:
.\scripts\Inspect-Coop-MarketStation.ps1 -SystemID 30100032

# Choose the exact positive native stationID from the listing; NEVER assume the other station's stock belongs here.
.\scripts\Inspect-Coop-MarketStation.ps1 -SystemID 30100032 -StationID <EXACT_NATIVE_STATION_ID>
```

The exact-station reader opens `/var/lib/evejs/market/market.sqlite` via `better-sqlite3` with `readonly:true,fileMustExist:true` and `PRAGMA query_only=ON` from the existing server container, and restricts queries to `stations`, `market_types`, `seed_stock`, `market_orders`. It excludes unpublished/unbrowsable market types (`t.published=1`, `t.market_group_id>0`) and refuses wrong station/system combinations. For positive stock it returns up to eight **real**, sorted source-tagged examples but status remains `STATION_NATIVE_STOCK_EVIDENCED_NOT_CLIENT_PROVEN`.

Status interpretation:
- `STATION_SELECTION_REQUIRED`: system contains known stations, operator must choose exact one.
- `NO_BUYABLE_STOCK_AT_SELECTED_STATION`: stock at another station does not help this client; no invented market order or fake hangar delivery.
- `STATION_NATIVE_STOCK_EVIDENCED_NOT_CLIENT_PROVEN`: real source rows exist at the exact station. **Need actual EVE client buy+ISK+item+reconnect proof**.
- `MARKET_SCHEMA_INCOMPLETE`, `STATION_NOT_IN_SYSTEM`, `MARKET_EXAMPLES_NOT_EVIDENCED`, `MISSING_NATIVE_MARKET_DB`: BLOCKED, investigate; never run rebuild automatically.

## Optional source catalog enablement

The reversible opt-in native market catalog hook can be enabled only on a separately approved `-LivingCoop -EnableMarketCatalog` deployment using the established transactional installer. The hook is default-OFF and does not create stock, SKUs, sell orders, or currency.

## If Manifest is genuinely empty

PR #25 includes a **strictly offline and manually confirmed** additive importer using a **separate** pinned native `market-seed` candidate, retaining an SQLite-consistent backup before a single transaction. This importer refuses an overlapping live Exordium region, existing player orders/summaries and any incompatible SDE. Never run it on the active market daemon, never replace market.sqlite, and never call `market-tools rebuild` on an existing world. The owner must authorize the offline operation, verify plan/backup, pass the exclusive filesystem lock, and validate the pinned native market-server `doctor` before restart. See `docs/MANIFEST_MARKET_ADDITIVE_SEED.md`. This chat **did not apply** a candidate or touch `evejs-data`.

## Evidence & next gates

1. The **actual pinned EveJS** `marketProxyService.js` was fetched from upstream SHA `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. The integrated full `patch-evejs-coop.cjs.transform()` parsed successfully, applied a single opt-in GetMarketGroups patch, was idempotent and **reverted byte-for-byte**.
2. Native `coopMarketCatalog` tests: **4/4 PASS** in isolated JS harness. New `coop-market-station-readiness` tests: **9/9 PASS** in isolated JS harness, covering real/published group IDs, exact station, other-station false positives, real player orders, missing schema, invalid IDs, and no mutation SQL.
3. Original upstream-agent market importer/candidate and catalog suites are present but were **not** rerun in a full Windows Node `--test` runner during this chat. No real SQLite donor merge, Docker upgrade, in-game category rendering, native ISK debit or actual native hangar receipt was tested.
4. Owner-local review should run:
   ```powershell
   node --test tests/coop-market-*.test.mjs
   node scripts/patch-evejs-coop.cjs --check --code-path C:\Games\EveCoop\upstream-evejs\Code
   ```
5. After an approved controlled release, the genuine client should browse the Market at a verified stocked **exact station**, purchase a low-cost seeded native item, verify market stock decreases, player ISK debits, matching native inventory ID appears in that station hangar, repeat login, and inspect both native records. A screenshot of the market category alone is **not** completion proof.

### Conflict coordination

PR #21 (co-op P0), PR #23/#28 (native atomic trade), and PR #15 (exploration) also modify/derive the same native overlay/deployment scripts. **Never merge an old full-file replacement that overwrites another new hook.** Rebase the final owner-accepted installer from latest main and compose only the native opt-in transforms. This branch is a review candidate that supersedes market #25 and #27 as a single integration; do not merge both individual market branches again.

**No CI, main merge, Docker restart, PostgreSQL/SQLite mutations, market rebuilding or user-save changes occurred.**
