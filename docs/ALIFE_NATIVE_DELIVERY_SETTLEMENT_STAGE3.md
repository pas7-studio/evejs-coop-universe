# ALIFE-03 — Native warehouse delivery recovery + fact-only A-Life SETTLE

**Status: source changes IMPLEMENTED_UNVERIFIED; real EveJS/2-client gameplay NOT RUN.**
Standalone PR based on main, independently mergeable from pending COOP-043/#98 and ALIFE-02/#107. Existing warehouse owner remains fully authoritative.

## Why no second ore writer

The native path already exists:

1. Stock EveJS mining fleet accumulates actual cargo rows, which coopNativeHaulCargo transfers by the **same cargoID** into an actual hauler.
2. coopNativeStationArrival applies real station identity, physical surface distance, no warp, and dwell checks.
3. With EVEJS_COOP_NATIVE_HAUL_MANIFEST=1, coopNativeHaulManifest prepares and fsyncs an immutable full trip before warp.
4. coopNativeWarehouse.deposits physical cargo with PREPARED → SOURCE_DEBIT_PROVEN → TARGET_CREDIT_PROVEN → COMMITTED, and a unique tagged native itemStore destination. Interrupted transactions require operator proof; the native warehouse may not give cargo a second time.
5. coopNativeHaulManifest.verify requires **every** committed warehouse receipt, source absence and matching native itemStore tags.

The new A-Life integration observes **only step 5**; it never settles, credits, mints, despawns, issues a warp, changes ISK, or manually retries uncertain cargo custody.

## Fixed empty-hauler completion bug

Prior station-arrival tick checked `!stackCount && !trip.completedStackCount` BEFORE calling full manifest verifier. This incorrectly returned `EMPTY_DELIVERY_NOT_PROVEN` after the last warehouse cargo stack had already been COMMITTED but the current tick lost the terminal in-memory completion count. A subsequent tick saw empty native cargo and could never reach the existing fully authoritative manifest proof.

Under manifest-enabled mode ONLY, that early guard now permits **verification**, not optimistic completion. The precise native manifest proof must be `FULL_NATIVE_CARGO_DELIVERY_VERIFIED` and must validate the exact system, fleet, trip ID, station, haulers, cargo IDs, count, and no fabricated payout. Missing/incomplete/forged evidence still blocks and preserves the pending route. The result's stacks/quantity are the complete authoritative manifest totals, not the number of stacks discovered on the final tick. Non-manifest legacy behavior is unchanged.

This is **same-process / retained-trip tick recovery**. It does NOT claim durable restoration of the entire in-memory native fleet route after a full server-process restart. That is a separate P0 gate.

## A-Life SETTLE evidence and player-visible news

After native cargo has already been COMMITTED and full source/target manifest verified, the existing station arrival flow emits a read-only:

- `event: alife-native-delivery-settled`
- `status: NATIVE_FULL_MANIFEST_WITNESSED`
- `eventID: alife-native-delivery:<systemID>-<fleetID>-<startedAt>` (stable dedupe identity)
- `manifestID`, `systemID`, `fleetID`, `stationID`, `corporationID`, exact `cargoIDs` / `haulerIDs`, `stacks`, `quantity`
- `proof: WAREHOUSE_COMMITTED_AND_NATIVE_ITEMSTORE_VERIFIED`
- `nativeMutation:false`, `iskCredited:false`, `paidReward:false`

If optional EVEJS_COOP_ALIFE_NEWS=1 is enabled, existing Local digest can report the physical warehouse confirmation. Incomplete or 0-quantity events are filtered. A read-only `scripts/audit-alife-native-deliveries.cjs` checks log event shape, same-trip duplicates, conflicting quantities and cargoIDs claimed by two trips. **The log auditor never calls a ledger read a PASS**; actual storage proof still comes from the warehouse journal and original GameStore item IDs.

Commands (copied telemetry file, no production mutation):

    pwsh -File scripts/Run-Alife-Native-Delivery-Tests.ps1
    node scripts/audit-alife-native-deliveries.cjs /path/to/copied-coop-events.jsonl

## Regression and local gameplay verification

Automated isolated source execution performed in the development tool: station-arrival 10/10, new native delivery helper/log audit 11/11, wiring checks 3/3, A-Life Local digest 8/8: **32 focused tests PASS in isolated JS harness**. This is NOT full native Node test runner or gameplay.

The provided PowerShell runner includes 10 source/unit test files, including the full existing native warehouse, manifest, itemStore patch and crash safety tests; the complete runner is **NOT RUN** in this remote GitHub workflow.

Eight independent local E2E cases in `tests/scenarios/alife-native-delivery-e2e.json` are **NOT_RUN**. Includes physical mining target + cargo growth, exact miner→hauler transfer, manifest before warp, physical dock/dwell + real warehouse COMMITTED, lost terminal tick after completed debit, crash after debit before item credit, cross-fleet cargo identity replay and two authorized clients.

## Dependencies and merge handoff

- This PR is based directly on main and does NOT require #98 or #107 to compile. It touches `scripts/patch-evejs-coop.cjs` for the required read-only overlay module, which also has independent additions in #107. On merge/rebase combine the two names; never drop either one.
- Native stock mining fleet haulers may be **unnamed**. Do not fabricate a personal `coop-pilot-NNN` actor or pretend this is an A-Life economic planner dispatch. This stage is confirmed **RECORD/SETTLE evidence** for an independently running native delivery actor.
- Full A-Life DECIDE→ACT for mining/warehouse/industry needs verified NPC identity and explicit native command dispatch, as specified by #107 and COOP-045/#108. Do not create a second transaction authority.
- The main world and preserved `evejs-data` were not touched. All advanced feature flags remain OFF until the owner runs local 2-client crash/conservation tests.
