# P1 — native convoy outcome evidence: actual station stock or real hauler loss

**Stacked after PR #48** (genuine native pirate raid and two-player applied-damage evidence). This adds durable **economic aftermath observations**, not a new NPC economy, fictional escort reward or auto-rescued convoy.

## Scope and precise truth claims

The combat incident identified by `systemID:pirateID:targetID` exists ONLY after a genuinely accepted native pirate `attack` on the same real `hauler`. `coopConvoyOutcomeProof` reads the parent PR's persisted incident journal independently. If no exact attacked hauler exists, or two different pirate incidents point at the same hull, it **refuses attribution**.

Two independent native truth sources, observed exclusively after success in the current modules:

1. **Physical native warehouse delivery:** `coopNativeWarehouse.createWarehouse().commitCredit()` has already removed the exact `cargoID` from the original native hauler and flushed the `npcCargo` table, verified the exact owner/corporation, native station, type, quantity, itemID and `coop-warehouse:v1:cargo:<cargoID>` tag in itemStore, flushed native items, and durably fsynced its `COMMITTED` warehouse receipt. Only then `noteWarehouse(record,target,!findCargo(record))` can append `WAREHOUSE_STOCK_VERIFIED`. This proves **one exact station warehouse cargo stack**, never a whole convoy's successful delivery.
2. **Physical stock-fleet hauler destruction:** the existing `coopVirtualWorldRuntime.confirmedNativeNpcWreck()` path verifies the real stock fleet member through `verifyStockFleetWreck`: live native mining-fleet membership, real persistent native wreck, actual physical wreck entity and matching ship launch/source ID. Only `PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED` with `victimRole=hauler` can be recorded as `HAULER_WRECK_VERIFIED`. An NPC memory record, timer expiry or standalone loss counter is not evidence.

No new L1 patch, no NPC order/damage change, no new cargo grant, no additional stock sale, no ISK/LP/standing payment. The existing native warehouse and stock wreck logic own every actual asset mutation.

## Ledger & statuses

Separate persistent append-only journal:
`/var/lib/evejs/coop-convoy-native-outcomes.jsonl`, optionally overridden by the absolute test-volume path `EVEJS_COOP_CONVOY_OUTCOMES_FILE`.

- `NATIVE_STATION_STOCK_PARTIALLY_VERIFIED`: at least one actual warehouse item stack. **Not** evidence that all cargo was delivered, pirate suppressed, or two pilots qualified.
- `HAULER_NATIVE_LOSS_VERIFIED`: a real wreck of the exact victim hauler.
- `PARTIAL_STOCK_DELIVERED_THEN_HAULER_LOST`: some physical cargo reached a station *before* the ship was destroyed, without rewriting earlier delivery as loss.
- No record/unknown: `NO_NATIVE_CARGO_OUTCOME`, **not** a successful escort.
- Every snapshot sets `convoySaved:false` and `paidReward:false` intentionally, since full hauler cargo manifests/trip completion and real wallet settlement are **not** proven.

A persistent `wx` exclusive writer lock stops concurrent settlement observations. An ambiguous write, read, lock or fsync leaves a durable stop/repair state rather than retrying indefinitely; an operator must reconcile the physical ledger and native inventory before clearing any stale lock. Events are bounded and append+fsync only. Native game actions always remain successful even if optional observation fails. No removal, compaction, auto-retry or empty cargo generation.

## Operator verification

Both stages default-OFF under ordinary LivingCoop. The new observer inherits PR #48's explicit `-LivingCoop -EnableConvoyOperations` opt-in; if disabled, no convoy outcome journal is modified.

Run locally against the code repo (without touching production save):

```powershell
node --test tests/coop-native-convoy-operations.test.mjs tests/coop-native-convoy-operations-wiring.test.mjs tests/coop-native-convoy-operations-overlay.test.mjs
node --test tests/coop-convoy-native-outcomes.test.mjs tests/coop-convoy-native-outcomes-overlay.test.mjs
node --test tests/coop-installer-module-coverage.test.mjs
node scripts/patch-evejs-coop.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code --dry-run
```

After a separately approved deployment on a cloned saved world, inspect **both** read-only ledgers:

```powershell
.\scripts\Inspect-Coop-ConvoyOperations.ps1
.\scripts\Inspect-Coop-ConvoyOutcomes.ps1
```

Do NOT use the status string as proof the EVE client received an item. EVE-client acceptance requires two independently authenticated pilots, exact native fleet, real pirate attacking a real ore-bearing native hauler, independently witnessed native player damage, physical native station arrival, native warehouse item ID/quantity in the correct corporation station, persisted after restart, and expected market cargo changes. Test the alternate failure path with a **real stock fleet hauler wreck** and verify zero after-the-fact warehouse deliveries for that now-lost hull.

## Evidence in this PR

- 12/12 direct outcome-source regression scenarios PASS in isolated JS/V8 with a controlled filesystem API: one warehouse stack, repetition across restart, mismatched owner/item/quantity/marker, real stock fleet wreck, miner/foreign wreck rejection, partial stock then loss, attack/hauler requirement, multiple raids ambiguity, journal corruption/lock, and no native asset mutation.
- Added `tests/coop-convoy-native-outcomes-overlay.test.mjs` for current native warehouse + stock fleet wreck call points, parser source and operator read-only tool. **Official Node runner, actual SQLite/GameStore crash tests and two real clients are not yet verified.**
- Existing PR #48 direct 12/12 + wiring 4/4 + overlay 5/5 isolated checks remain separate.
- Current main `coopNpcChatter` packaging and native station arrival hooks must remain unmodified; this is a six-module-file delta stacked atop the latest #48 branch, not a replacement of the existing installer or independent duplicate economy.

## Important next requirement

To confidently issue a **SAVED_WITH_DURABLE_CARGO** operation result, we still need the actual hauler's **full original cargo manifest** and `coopNativeStationArrival.checkReturn()` terminal `DELIVERED` proof (PR #40), plus reconciliation of **all** exact cargo IDs. A single warehouse stack is insufficient. A subsequent explicit escort payout must debit a pre-funded real wallet through native contract escrow, be once-only by stable incident ID, and have crash/reconnect ledger proof. This PR intentionally does neither.

**Review only. No GitHub Actions, main merge, Docker restart, original `evejs-data` modification, or client gameplay PASS.**
