# COOP-030B — Physical NPC hauler return to station and warehouse custody

**State:** opt-in source integration; not deployed or proved with real Docker / clients. Depends on PR #34's `coopNativeWarehouse.cjs` and tagged native itemStore hook, now present in `main` following global merge PR #38. This branch was ported onto that merged `main` and does not override its newer market, fleet, industry or deployment changes.

## Previously broken behavior (source-verified)

- Pinned `miningNpcOperations.js` seeded transient miners **and haulers**; the ore entries used native `npcCargo` transient paths that vanish on restart.
- Once miners loaded the hauler, vanilla returned to an off-grid `originAnchor` by warp, NOT a station; `haulereturn` and `unloadCargo()` ran on a timer. That deleted real cargo and credited a virtual depot, not native station stock.
- A timer-fired `haulereturn` is NOT evidence that physical ore reached a station. Do not connect it to item grants.

## Implemented behind `EVEJS_COOP_NPC_STATION_DELIVERY=1` (default OFF)

1. **Durable NPC hauler at spawn:** Only hauler wing has `transient:false`; miner and response fleet behavior remains original. Native NPC identity still needs on-host restart validation.
2. **Cargo reparent with persistence:** `coopNativeHaulCargo.transferCargo` moves the very same native `cargoID` from transient miner to persisted hauler, clears that exact `npcCargo /cargo/<cargoID>` transient marker and synchronously flushes the native cargo table. On flush error, no success is reported; no invented stack or additional cargo ID.
3. **Actual route:** During existing `loaded` phase, select a real same-system NPC-owned station backed by both `worldData.getStationsForSystem()` and an authentic `scene.staticEntities` `kind:'station'` entity. Verify owner via pinned real corporation state and issue stock `npcService.runtime.warpToPoint()` to its physical coordinates. Record in-memory arrival intent; never claim delivered on warp acknowledgement.
4. **Station physical presence:** In `haulereturn`, require the same physical ship ID, durable source entity and matching solar system, completed warp (`mode !== WARP`, no pending warp), distance within 2500 m surface-to-surface of that very station, and >= 2 seconds of stable proximity. The next mining cycle does not start until delivery is settled; timeout/lost ship/corruption blocks instead of teleporting ore.
5. **Native stock transfer:** The trusted `coopNativeStationArrival` director exclusively calls PR #34 `warehouse.deposit`, whose second ownership/station and real cargo verification plus persisted source debit / unique tagged itemStore grant enforce exactly-once custody. If warehouse is `PENDING_RECONCILIATION`, fleet holds. No old `unloadCargo()` path is used under the flag; the legacy path is untouched with the flag OFF.
6. **Human approval:** Deployment adds explicit `-EnableNpcStationDelivery` (requires `-LivingCoop`); the new flag and warehouse receipt folder have no effects until an approved overlay deployment. No pre-existing virtual receipt is reinterpreted as real inventory.

## Technical limitations / blockers

- This is **arrival within station interaction range, not stock client docking service**. NPC remains a physical ship near the station, with cargo handed to native station storage after the verified approach. Client visible docking/undocking NPC animations are out of scope.
- The fleet route is held in memory. If the process crashes *after* warp but before completed delivery, there is no persistent native mining fleet return route to resume automatically. Native warehouse receipt recovery is explicitly fail-closed; do not auto-credit orphan persistent cargo. Implement idempotent owner-authorized reattachment/recovery and inspect existing durable NPC hulls before marking this entire P0 DONE.
- `coopVirtualEconomy` goods and NPC seed-market stock are *not* credited from station deposits. Refinery (`COOP-031`), BPO work (`COOP-032`), real sale (`COOP-033`) remain separate workstreams.
- `getStation`, `getCorporation`, native entity/scene, cargo and itemStore are hard-validated. If the current world has no actual station matching a persisted NPC corporation in the system, the fleet blocks safely, with cargo aboard.
- A failed warp command may leave a subset of multi-hauler ships moving with no active route; replay requires operator intervention. Fail closed, never force arrival by timer.
- Native GameStore has multiple dirty caches; all persisted writes must be checked on isolated real SQLite under actual abrupt process termination, including `npcEntities`, `npcCargo`, `items` and `coop-native-warehouse/receipts`.

## Local verification

`node --test tests/coop-native-station-arrival.test.mjs tests/coop-native-station-arrival-patch.test.mjs`

Tests: exact matching SDE station and corp, valid native ship identity, transient vs durable, actual distance, WARP/pendingWarp, dwell, timed failure, destroyed ship, wrong station, inventory failure, reverse native source patch LF/CRLF. Native source transform also must be tested with *the full project installer* against pinned `c3ea396b` and existing native haul patches, not only the sample fixture.

## Live operator gate (not yet executed)

1. Merge reviewed PR #34 and this stacked PR; run the entire `Verify-Local-Coop.ps1` suite on an isolated checkout. Inspect `patch-evejs-coop.cjs --check` and all native source drift witnesses.
2. On a copied disposable `evejs-data` only, enable `-LivingCoop -EnableNpcStationDelivery`, start Perimeter with real SDE station and durable hauler. Do **not** apply on the production volume until backup and owner authorization.
3. Observe `living-npc-station-warp-requested` and *native position snapshots* (not just return timer). Confirm signed native `npcCargo` record moved to hauler, then removed, with one uniquely tagged `items` row at the right NPC corporation/station.
4. Abort ship warp, destroy ship during return, disconnect test client, crash between native debit and item grant, restart process. Check exact item count and no replay-dup; no auto-credit when any provenance is unknown.
5. After safe delivery, link subsequent NPC refinery, T1 ammo production, real market wallet/hangar acceptance to these native assets. Never claim the virtual depot receipt already closes that loop.

**Safety:** This PR never rebuilds/restarts Docker, touches `evejs-data`, seeds market inventory or credits ISK. It modifies only repo source/tests/docs with an explicit default-OFF runtime feature flag.
## Legacy stage-2 settlement overlap

`integration/coopNativeStationOreSettlement.cjs` is an independent, manually invoked path that can grant a station stock item **from a committed virtual depot receipt**. The new physical-arrival path does not call `coopNativeDepot.commit()`, so it does not create those receipts. Never manually invoke the old stage-2 settlement for any cargoID already handled by `coopNativeWarehouse`: those represent alternative credit pathways and could otherwise double-produce station items. A future unified item provenance index should reject cross-workflow reuse before permitting automation.
