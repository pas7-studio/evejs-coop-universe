# P1 — Native ore custody to durable receipts (stage 1; full station economy incomplete)

## Identified P1 data-loss gap

`coopNativeHaulCargo.unloadCargo()` removed the *real EveJS native NPC cargo row* before `coopNativeDepot.record()` persisted the depot receipt. If the process crashed or receipt persistence failed between these operations, ore vanished with no confirmed accounting. The old depot was a **virtual supply counter**, not station stock, refinery inventory, industry input, or market escrow.

## Implemented stage 1 — fail-closed custody journal

- `prepare` persists `PENDING`/`PREPARED` in the existing version-1 native depot document before any native cargo removal. The journal uses exact cargo ID, type, quantity, native hauler, system, fleet. An incomplete intent is NOT credited to totals.
- Confirm native remove success and source absence. Only then `commit` transitions to `COMMITTED`, increments aggregate virtual receipts once; all steps are re-openable after restart.
- If prepare fails, no native cargo is removed. If remove fails, retain pending intent and retry after verifying the same exact cargo still exists. If native removal succeeded but receipt commit failed, retain an unresolved pending entry; never auto-credit from a missing cargo row, never mint replacement cargo. Require operator investigation.
- Reused cargo IDs, quantity mismatches, and different fleet ownership fail closed. Read-only audit derives committed totals by system and native ore `typeID`; mismatches produce `NEEDS_OPERATOR_REPAIR` and block virtual economy credit.
- The old `depot.record()` path that accepted unverifiable deliveries is disabled (`UNVERIFIED_DIRECT_CREDIT_DISABLED`). The corresponding legacy tests now use the real prepare/commit protocol.

## Required stage 2 — true station economy (NOT IMPLEMENTED)

To connect native ore to actual station refining, blueprint manufacturing and player-compatible orders, we must select one authoritative NPC station-warehouse owner and implement **cross-domain transaction/recovery** across `nativeNpcStore` cargo, `itemStore` warehouse items, refinery inventory and the native market/escrow service. The market's `AdjustSeedStock` command is NOT proof of a physical station cargo inventory: it adjusts seed quantities and may introduce fictional material if used without a matching native debit. Do not call it just to inflate economic supply.

Acceptance: physical miner ore → durable physical hauler → station warehouse inventory with exact type/quantity and immutable origin IDs → native refinery conversion using EVE recipe (debit ore / credit output) → native industry reservation and delivery → real market order fulfillment, wallet/escrow movements with unique transaction receipts → replay-safe restart and conservation equation (initial + mined − consumed − destroyed − shipped = final). No opaque virtual goods or synthetic market seed stocks count as PASS.

## Tests / safety

Fault tests cover prepare failures, remove failures, crash between remove and commit, mismatched IDs, exactly-once receipts across restart. Do not restart live Docker, clear `evejs-data`, credit player items, or turn on native market settlement until stage 2 is independently reviewed and tested in a disposable test volume.
**Important:** no new items are credited to EveJS station warehouses in this PR; physical refining, industry reservations and exchange settlement remain explicitly blocked. Existing committed receipt history is preserved. Review unresolved PREPARED receipts before any stage-2 settlement or replay.
