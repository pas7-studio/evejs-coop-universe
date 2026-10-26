# Chat 24 + 31 — Stage E1: Original Physical HAUL / RETREAT Completion

**Status: SOURCE IMPLEMENTED, LIVE_UNVERIFIED, DEFAULT OFF.** Draft PR #287. This completion check does not mine ore, warp ships, insert stock, pay ISK or create a scheduler.

## Why a native command ACK was insufficient

Stock pinned `miningNpcOperations.startHaulCycle()` returns true when the haul sequence is requested, while `completeHaulCycle()` can set `lastHauledAtMs` without a final NPC station warehouse deposit. Stock `retreatFleetToOrigin()` reports attempted warps, not each original hull's physical landing. Neither ACK justifies clearing `NATIVE_REQUESTED`. An unsafe retry can double-haul or teleport cargo.

## E1 strict reconciliation

### At first HAUL dispatch, before calling stock warp

- Capture all original native `cargoID`, `typeID`, `quantity` and source miner IDs from actual `nativeNpcStore.listNativeCargoForEntity()`, rejecting duplicate cargo IDs, transient/non-original rows, mutated owner, missing IDs, unreadable source, empty cargo and more than 256 stacks.
- Persist the **same snapshot** with the `ISSUING` fence into the existing original GameStore `coopPlayerMiningShift\u001f<operationID>` record. The change is atomic **before** native warp or haul.
- If the snapshot is absent, return `MINING_SHIFT_SOURCE_CARGO_NOT_ATTESTED` and do not call the original native operation. No fake original cargo can be invented by the client.

### To complete HAUL

A read-only source oracle requires **all** of these simultaneously:

1. The same `FUNDED` contract and original startup NPC fleet, immutable ship and employer corporation identity.
2. A `NATIVE_REQUESTED` HAUL with an original captured pre-haul cargo manifest.
3. The original stock `fleetRecord.lastHauledAtMs` after the command's durable `issuedAt`, and original fleet state returned to `mining` after `haulereturn`.
4. Every recorded original cargo ID absent from **every original miner and hauler**.
5. For each cargo ID, a **real fsynced native warehouse receipt** in `COMMITTED` phase, at or after issue, matching exact original system, fleet, NPC employer, original hauler, type and quantity.
6. Exactly the same physical native `itemID`, `typeID`, quantity, tagged `customInfo`, NPC owner and station in `itemStore.findWarehouseItem()`. An old, forged, consumed, missing or player-transferred item does **not** count as an unproven delivered title.

Only then does the preexisting native atomic writer change the shift's command state from `NATIVE_REQUESTED` to `NATIVE_COMPLETED`, storing a durable `ORIGINAL_WAREHOUSE_DELIVERY` witness. A subsequent tick is read-only and cannot double-sell ore or replay the original warp. An already-sold ore stack remains **blocked** until an independent downstream title/consumption proof exists; never fake a deposit after ownership moved.

### At first RETREAT dispatch, before calling stock warp

- Capture the exact original native fleet's origin `{x,y,z}` **and the IDs of at least one original NPC hull physically outside the origin's allowed arrival radius**, before warp starts.
- If all hulls are already at origin, a real departure cannot be attested: do **not** start/complete a fabricated retreat.
- Store original origin and departure hull IDs alongside the existing `ISSUING` write, ahead of stock `retreatFleetToOrigin`.

### To complete RETREAT

Require identical original origin and fleet IDs, real stock `retreating`/recovery phase, the same original live NPC hulls, no active `pendingWarp`/`warpState`/`sessionlessWarpIngress`, and every hull actually within the bounded 2,500-meter arrival region. The durable `ORIGINAL_FLEET_WARP_ARRIVED` proof is then stored in the original GameStore transaction. **Elapsed time alone never proves physical arrival.**

### What remains permanently fenced

- `ISSUING` and `DISPATCH_UNKNOWN` do not reconcile automatically even if ships appear safe; explicit operator crash recovery is still required.
- Stale source cargo, missing warehouse receipt, wrong stock ItemStore owner or physically unlanded warp remain `NATIVE_REQUESTED`.
- Native store poison/failed transactional commit means no completed status is claimed.
- Only after `NATIVE_COMPLETED` may the same real corporation industry manager choose `MINE` in the D3 in-game stock Agent selector, and the original native scene/order authority is checked again.
- A different player, corporation, agent or hull may not reuse this receipt.

## Source and flags

- `integration/coopPlayerMiningPhysicalCompletion.cjs`: physically authenticated cargo and hull oracle (read-only).
- `integration/coopPlayerMiningShiftOrders.cjs`: captures HAUL cargo / RETREAT departure at the pre-native `ISSUING` fence and atomically saves **one** `NATIVE_COMPLETED` proof after strict verification.
- `integration/coopPlayerMiningFleetTick.cjs`: existing stock mining tick calls the original store oracle, never creates another timer.
- `integration/coopNativeStationArrival.cjs`: read-only original runtime warehouse `getOriginalWarehouseReceipt()`; no new warehouse or dock simulation.
- `integration/coopPlayerMiningAgentOrders.cjs`: shows post-proof MINE/resume only when actual native state also permits.
- `scripts/overlay-spec.cjs` registers the new module in the same reversible pinned source overlay.

All flags default OFF. On an **approved disposable deployment** the following gates must be coordinated:

```ini
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_PLAYER_NPC_MINING_COMPANY=1
EVEJS_COOP_PLAYER_NPC_MINING_AGENT=1
EVEJS_COOP_PLAYER_NPC_MINING_ORDERS_UI=1
EVEJS_COOP_PLAYER_NPC_MINING_COMPLETION=1
EVEJS_COOP_NPC_STATION_DELIVERY=1
```

## Test evidence and acceptance

- **18/18** isolated exact-source cargo and original NPC warp source verifier tests.
- **14/14** isolated original GameStore intent/physical completion CAS tests.
- **22/22** original Stage B command-safety tests.
- **26/26** D3 Agent order selector tests, **8/8** in-game Agent integration and **17/17** prior single-fleet Agent tests.
- Source syntax check passed for updated original mining, warehouse, Agent, overlay files.

These are **isolated V8 and in-memory Store tests, not live Node/SQLite/Rust/gameplay**. In the real pinned checkout run `node --test tests/coop-player-mining-*.test.mjs` and the reversible overlay checker, then prove physically in a disposable server:

1. One actual original NPC miner cargoID is loaded on a real hauler, its original warp reaches the real station, the original warehouse produces `COMMITTED`, and the same itemID exists at the station.
2. The matching paid HAUL command reaches `NATIVE_COMPLETED` **only after** that state; a restart before/after COMMIT never produces a second cargo or pays a second wallet entry.
3. Original RETREAT starts outside the origin, one NPC hull remains physically in warp while another lands, and `NATIVE_COMPLETED` remains false until all ships land; restart prevents a duplicate warp.
4. Two real EVE clients confirm role and menu gating. Native stock market settlement and actual realized corporation profit remain a later stage.

**Do not enable Stage E1 on preserved worlds until the exact SQLite/writer, native HAUL bridge and two-client E2E gates are verified.**
