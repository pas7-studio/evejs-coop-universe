# COOP-030 — Native NPC warehouse, first implementation (2026-10-25)

**Status: implemented behind no runtime caller; unit tests only; NOT LIVE.**
Pinned upstream EveJS: `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Player benefit and authoritative chain

A physical NPC hauler with **durably persisted** mined ore should deliver the ore to a **real** station warehouse owned by an **existing NPC corporation**. An actual itemStore `items` record (native itemID, typeID, quantity, ownerID, locationID, HANGAR flag) is the result. It is not virtual `coopNativeDepot.totals` or invented `coopVirtualEconomy.goods`.

The first code slice adds `integration/coopNativeWarehouse.cjs` (native custody coordinator), a reversible hook inside pinned `inventory/itemStore.js` (`scripts/coop-native-warehouse-item-patch.cjs`) and deterministic fault tests.

**Do not wire `deposit()` to the existing `miningNpcOperations` hauler-return timer.** The current co-op `coopNativeHaulCargo.unloadCargo()` is invoked by a **timer** at `haulereturn`, without a verified native docking/arrival event, valid station ID, corporation ID or durable cargo classification. Turning that timer into station stock would teleport ore. `verifyArrival` must derive true exclusively from a trusted *server-side* native station-arrival witness that checks the exact ship/entity + fleet, docking range, system, station and timestamp; client-supplied arguments alone are insufficient. `verifyDurableCargo` must confirm the source is NOT transient and will survive a process restart. Both are mandatory and no default `true` implementation is registered.

## Runtime contract

```js
const {createWarehouse}=require('./coopNativeWarehouse');
const warehouse=createWarehouse({
  root:'/var/lib/evejs/coop-native-warehouse',
  store:require('./npc/nativeNpcStore'),
  items:require('../services/inventory/itemStore'),
  flush: table => require('../gameStore').flushTableSync(table),
  getStation:stationID=>require('./worldData').getStationByID(stationID),
  getCorporation:corpID=>require('../services/corporation/corporationState').getCorporationRecord(corpID),
  isNpcCorporation:corpID=>require('../services/corporation/corporationState').isNpcCorporationID(corpID),
  verifyArrival:verifiedNativeDockingEvidenceFunction, // MUST NOT accept timer-only
  verifyDurableCargo:verifiedNativePersistenceFunction  // MUST reject transient records
});
```

The example is **illustrative and not a deployable adapter**: until the two verifier functions are implemented and proven against a real native docked NPC ship, the warehouse remains OFF.

`deposit({cargoID,haulerID,fleetID,systemID,stationID,corporationID})` validates the native corporation+station and the exact native cargo record. It requires the original miner reference + fleet custody tag. State machine:

- `PREPARED`: fsynced atomic journal of source and target before any source mutation.
- Native `removeNativeCargo(cargoID)` and synchronous GameStore `flushTableSync('npcCargo')` then source absence.
- `SOURCE_DEBIT_PROVEN`: journal persisted with a proven physical debit. Only this stage can authorize the output item.
- Native `grantUniqueNpcDepotItem` writes **one unique, tagged, non-merged stack** to the genuine `items` table. Stock grants are not suitable: `applyStackableGrant` merges with older stacks and would lose the receipt marker. Item tag is `coop-warehouse:v1:cargo:<cargoID>`.
- `flushTableSync('items')`, reread tagged owner/quantity/location, persist `TARGET_CREDIT_PROVEN`, then `COMMITTED`. Duplicate deposit returns `ALREADY_COMMITTED` only when native receipt and item agree.

On restart, `audit()` is read-only and exposes unresolved operations. `resume(cargoID,{authorize:true})` allows operator-reviewed reconciliation of a **provably persisted SOURCE_DEBIT_PROVEN** record using the unique target marker; PREPARED with missing cargo remains `PREPARED_SOURCE_UNKNOWN` and NEVER mints replacement ore. A failed items flush, JSON corruption, wrong owner or duplicate tag blocks automatic credit. Journal `fsync`+rename is a separate persistence domain; no cross-table atomic transaction is claimed. Enforce a **single live EveJS writer** to this warehouse directory and to GameStore.

**Important limitation:** committed output markers currently identify the initial warehouse stack. Future reprocessing and player trading will legitimately consume or move it; before enabling those systems, extend provenance ledger with `RESERVED_FOR_REFINERY`, `MATERIAL_CONSUMED`, `OUTPUT_SETTLED` states. A missing original receipt item after a verified consumption cannot be treated as a loss forever.

## Required integration gates

1. Add a native docking witness on the pinned fleet return path: physical ship at the correct station in the correct solar system, station/owner verified, not a timer extrapolation. Persist station arrival before unloading.
2. Verify `npcCargo` cargo and hauler persistence: `transient:true` must never be deposited; restart/recover physical native entity first.
3. Use a disposable copy of both `npcCargo` and `items` SQLite/native tables. Inject crash after PREPARED, source remove, source flush, source debit journal, target grant, target flush and final commit. Audit real persisted records after reopen.
4. Test two concurrent fleets carrying the same ore type, the same cargoID replay, wrong corporation, destroyed hauler, station mismatch, cargo-id collision, non-stackable types, oversized stacks, source mutation after prepare and an invalid tag.
5. Verify no player or other NPC can move or sell the warehouse stack without actual ownership/capability policy; real corp wallet/access must be set up before refinery/manufacturing.
6. **Only then** enable actual NPC warehouse deposit hook under an explicit `EVEJS_COOP_NPC_WAREHOUSE` toggle, and verify real ore appears in a native station inventory. Never use this incomplete stage to grant goods to a player or create market supply.

## Local tests

`node --test tests/coop-native-warehouse.test.mjs tests/coop-native-warehouse-patch.test.mjs`.
No CI/Actions, no market rebuild, Docker restart or `evejs-data` volume reset is authorized by this source change.