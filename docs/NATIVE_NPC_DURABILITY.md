# Persistent named NPCs — real EveJS restart safety (P0)

**Status:** implemented in the feature branch and isolated-tested against
the pinned EveJS contracts. **NOT proven by a real server restart or two
real clients.** No unattended deployments, GitHub CI, market reset or
volume deletion are authorized.

## Actual root cause

Previously the LivingCoop native NPC materializer always passed
`transient:true` to `npcRuntime.spawnBatchInSystem`. Pinned EveJS
`nativeNpcStore` passes this option into `gameStore.write`; the game
store explicitly excludes transient paths from on-disk snapshots.
The separate `coop-npc-links.json` identity file could therefore
persist an NPC ID whose native entity, controller, modules and cargo
would vanish after a server restart. An identity file alone is NOT a
persistent ship.

Pinned upstream:
`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## New opt-in real native persistence

- `EVEJS_COOP_DURABLE_NPC_SHIPS=1` enables `transient:false`
  **only for named NPC ships created by the co-op materializer**.
  Stock upstream mining fleets and extra faction patrol fleets retain
  their own existing transient lifecycle. The flag is written by
  `Deploy-Coop-RuntimeProbe.ps1 -LivingCoop` during a deliberate,
  owner-approved deployment; it is not silently turned on in an
  already-running Docker server.
- The pinned `nativeNpcStore.allocateID` overlay now coordinates
  the high-water mark shared between transient and durable allocations,
  preventing a durable NPC from receiving an ID already assigned to a
  transient miner, module or cargo row in the same process. The source
  patch is reversible, idempotent and restricted to the pinned SHA.
- The co-op registry explicitly records `durable: true` when a
  new durable native ship is linked; older registry records are left
  unchanged and **not silently converted**.
- `coopNativeRestore.restoreNamedShips` runs when the real headless
  scene comes up, **before** `bridge.reconcile` can call
  `identityRegistry.prune`. It requires an actual native EveJS
  entity and controller persisted under the **same ID and system**,
  uses `nativeNpcService.materializeStoredNativeController`, then
  verifies the physical `kind="ship", nativeNpc=true` in the scene.
  If already physically present it does NOT spawn again.
- An incomplete durable record, foreign ship occupying the ID, saved
  system mismatch or failed native materialization returns
  `NEEDS_OPERATOR_REPAIR`. The runtime emits
  `living-native-durable-recovery` with the precise failures and
  refuses unsafe pruning/spawn. **Do not delete the identity file to
  make a failing test pass.**
- An intentionally destroyed NPC may legitimately have no saved
  native entity. That is accepted ONLY when the independent
  `coop-npc-life.json` contains a real native-wreck loss matching
  the exact pilot, ship ID and solar system with a positive
  `wreckID` and `lostAt >= linkedAt`. Ordinary clone recovery
  timing then controls any later replacement. An old/stale wreck
  cannot justify erasing a new durable NPC.
- Old `transient:true` co-op links and already-running transient
  NPCs are not migrated behind the player's back. They may naturally
  require a new physical ship on a later restart. Do not describe
  that one-time legacy transition as preserved ship identity.

## Required manual QA (on an approved disposable/local server)

Only after the owner approves updating the current overlay, with
`evejs-data` and local test fixtures preserved:

1. Start the server normally and run the read-only
   `Local-Two-Client-Test.ps1 -Action DiagnoseWorld`, followed by
   `-Action World -WorldSystemID 30000144`.
2. Verify `EVEJS_COOP_DURABLE_NPC_SHIPS=1` in the effective
   **running** configuration; check
   `living-native-durable-recovery` is `OK`.
3. Observe a newly materialized, named **non-mining** NPC with
   `durable:true` in `coop-npc-links.json`, plus its matching
   native entity and controller in the EveJS store. Record **only**
   pilot ID, system ID, entity ID, timestamp and role for QA.
4. After the game store has completed its normal persistence flush,
   perform a **controlled stop/restart only with the owner's
   permission**. Do not reset/replace `evejs-data`, re-run init,
   clear the market, regenerate test fixtures, use `down -v` or
   rebuild the pinned upstream as part of this restart test.
5. Verify that `living-native-durable-recovery` reports
   `recovered >= 1` or `alreadyPhysical >= 1` for the exact
   same entity ID. In the actual server scene confirm a single
   physical ship and its correct co-op name. Run the read-only
   `World` check again; do not claim a client PASS from it.
6. Only then have an authorized client enter space and visually
   confirm the named NPC and its behavior; repeat with two players
   when possible. Check no duplicate NPC or ghost ship appears.
7. After a **naturally occurring** verified native NPC kill, confirm
   its real wreck, the independent life ledger, and that legitimate
   clone recovery doesn't trigger
   `DURABLE_NATIVE_RECORD_MISSING`. Do not create synthetic
   death or force a player combat encounter to manufacture proof.

**Out of scope for this change:** continuous checkpointing of native
position/health/cargo during autonomous movement, guaranteed
instantaneous flush durability on sudden power loss, and verified
cross-system durable NPC gate travel. This slice establishes the
persistent native ship/controller record, original ID reuse and
fail-closed restoration; finer runtime-state continuity needs
separate evidence and testing.

## Regression

`tests/coop-native-durable-restart.test.mjs`,
`tests/coop-native-durable-id-allocator.test.mjs`, and
`tests/coop-identity-registry.test.mjs` are registered in the
manual-only verifier. They cover restoration, idempotency, corrupted
records, legacy transient exclusion, same-pilot real loss proof,
stale wreck protection and mixed transient/durable ID collisions.

No GitHub Actions. No merge. No public ports. Do not claim full
gameplay until a compatible authorized client demonstrates it.
