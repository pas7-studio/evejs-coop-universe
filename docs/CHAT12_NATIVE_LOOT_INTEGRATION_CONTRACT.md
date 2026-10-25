# Chat 12 native loot/salvage custody audit and Chat 01 integration contract

Review basis: `pas7-studio/evejs-coop-universe@bb3ff00dcf3605c5b6ff7bdf5bd01e4b47be1adb` and pinned `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Local code tests only, no Docker, two authenticated clients, or live item database. This contract is NOT permission to deploy or enable feature flags.

## Source defects and limits found

1. `Code/server/src/space/npc/nativeNpcWreckService.js::transferNativeWreckItemToCharacterLocation`: calls `grantItemToCharacterLocation` before `removeNativeWreckItem` / `upsertNativeWreckItem`. A successful item grant followed by a failed source write duplicates value. The existing `coopNativeLootPickupEvidence.note` is post-commit telemetry; `coopNativeLootQuarantine.check` is preflight but only blocks a previously quarantined item. Neither makes this transaction atomic. The existing module's physical-wreck refresh broadcaster was repaired separately and does not solve custody.
2. `Code/server/src/space/modules/salvagerRuntime.js::executeSalvagerCycle`: grants salvage materials before `completeSuccessfulSalvage` commits the wreck consumption. A failed or interrupted completion leaves materials plus a salvageable wreck. `transferNativeWreckLootToContainer` similarly grants to the container before deleting source wreck rows. The same risk exists for NPC salvaging and two-player salvage contention.
3. `Code/server/src/services/ship/cargoContainerRuntime.js::scoopCargoContainerToCargo`: removes the physical entity *before* `updateInventoryItem`; if the inventory write fails, an item can become unreachable. `transferContainedItemsToOwner` logs individual child update failures and continues, so a scoop can return success with mixed child ownership.
4. `Code/server/src/services/ship/jettisonRuntime.js::jettisonItemsForSession`: creates and presents a jetcan before moving the first item. When every move fails, returns MOVE_FAILED but leaves a durable empty can and its ball. Also validate repeated item IDs before moving, and make sure two-client jetcan loot obeys native permissions.
5. Player ship destruction (`Code/server/src/space/shipDestruction.js`) creates a wreck, resolves cargo death outcomes, removes hull, then spawns physical wreck. Partial failures can leave a durable wreck without a physical entity or stale hull visibility. NPC destruction delegates to `nativeNpcWreckService` and uses a distinct durable store. Both require source-ID-based reconciliation and two-client sighting.
6. `Code/server/src/space/modules/tractorBeamRuntime.js` appears to use native movement and not change item custody. Require tests for disappearance/reacquire on wreck destruction and reconnect; do not create a separate tractor ownership ledger.
7. Salvage-to-industry must use the same native item IDs, type IDs and quantities through station reprocessing/industry, not a separate invented resources counter. This link is LIVE_UNVERIFIED.

## Isolated code already prepared (not installed)

- `integration/coopNativeLootQuarantine.cjs`: durable interprocess writer lock, exclusive write, fsync of new file and parent directory, stale lock/temp detection, fail-closed corruption/restart behavior. **The lock serializes quarantine journal writes; it does NOT serialize native loot transfers.**
- `integration/coopNativeLootPickupEvidence.cjs`: validates source quantity consistency and actual net inventory changes, rejects misleading stack updates, incorrect owner, stale/reused ship, duplicate ready sessions, and unverified non-ship destinations. This is a read-only observer, not a replacement transfer.
- Focused local tests: 24/24 PASS under Node 22.16.0 (only isolated module tests). Existing upstream regression suite, overlay roundtrip, client and DB tests remain outstanding.

## Mandatory Chat 01 integration ownership

Central files are owned by Chat 01: `scripts/patch-evejs-coop.cjs`, `scripts/Deploy-Coop-RuntimeProbe.ps1`, `integration/coopVirtualWorldRuntime.cjs`, feature flag/deployment manifest, and native hooks. No Chat 12 changes to these files.

Request opt-in `EVEJS_COOP_NATIVE_LOOT_ATOMIC_CUSTODY=1` (default OFF). At pinned native source entry points, use one-call hooks into an isolated Chat 12 native custody adapter. Proposed hook/API:

```
coopNativeLootCustody.transferWreckItem({
  session, wreckID, wreckItemID, destinationLocationID, destinationFlagID,
  quantity, nativeNpcStore, itemStore, scene, operationKey
})
coopNativeLootCustody.completeSalvage({
  session, wreckID, sourceKind, nativeNpcStore, itemStore, scene,
  rewardEntries, operationKey
})
coopNativeLootCustody.scoopContainer({
  session, containerID, itemStore, spaceRuntime, operationKey
})
```

The adapter must not wrap the existing unsafe grant-first function and call it after preflight: that still duplicates on crash. Implementation must provide durable pre-mutation PREPARED state, a **native source-debit confirmation** with exact item/owner/type/quantity, durable debit confirmation, one destination credit with idempotent destination identity, and SETTLED; unknown outcomes fail closed and require operator reconciliation. Use a server-derived deterministic operationKey tied to exact native source IDs and operation generation, never an arbitrary client-supplied nonce. Cross-table transaction is preferred when native GameStore can provide real atomicity. Lock must be per item/custody key and interprocess, not only an in-memory `Set`. Reconnect/replayed RPC must look up native durable transaction before any new grant, and must never silently credit after uncertain debit. Native legitimate loot rights and capacity checks remain authoritative. All opt-in code defaults OFF until source-level roundtrip and actual local/native tests pass.

For salvage, the reward write and wreck consumption must be one durable operation or a source-first reconciled journal; do not pay salvage first then attempt to delete the wreck. For scoop, persist native container location/contents ownership before removing the physical ball; reconcile ball state from the item store on failed despawn and check nested child transfer result atomically. For jetcan, create/move/spawn must have an idempotent durable operation ID and remove an empty can on complete move failure after checking no concurrent items; avoid deleting a can with real contents.

### Tests required for the integration owner

- Source patch `--dry-run`, idempotent apply/remove with pinned SHA, exact file rollback and `OVERLAY_OK` after permitted deployment.
- Two concurrent clients attempt to loot the **same** native NPC wreck item; exactly one source debit/credit, or a legitimate authorized partial-stack split with conserved quantities.
- Crash after PREPARED, after source debit but before ACK, after ACK before destination credit, and after credit before final ACK. No replay duplicates any inventory row.
- PvP wreck with surviving fitted modules/cargo, actual owner provenance and Crimewatch/loot rights. Unauthorized looter must not be falsely treated as lawful.
- Salvage success and failure, multiple simultaneous salvagers, salvage reward exactly once, source wreck removed or converted into one authentic loot can, tractor movement and despawn synchronized on both clients.
- Container scoop by one pilot while the other moves items, including nested containers, wrong owner/capacity/range/reconnect. No partial owner rewrite or vanished physical ball.
- Jetcan fully failed move, duplicate item IDs, mixed successful/failed moves and restart. Confirm no ghost ball, lost item or extra stack.
- Bring actually salvaged item(s) into native station hangar, reprocess or manufacture with native inventory debit and persisted outputs; assert type/quantity conservation through reconnect/restart.

No GitHub Actions, no reset of `evejs-data`, no direct edits to upstream or proprietary clients. Report `CODE_READY / LIVE_UNVERIFIED` until two authenticated client pilots observe matching native scene and inventory records.
