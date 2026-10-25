# Chat 24: native player mining resource conservation

Source revision: pinned gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f.
Status: CODE_READY / LIVE_UNVERIFIED. No automatic rollout or default-ON flags.

## Native paths audited

- Player lasers and harvesters: `services/mining/miningRuntime.js::executeMiningCycle`. This path already validates module family, charge, range, target lock, skill/dogma/command burst modifiers, specialized hold and available volume. It grants actual native itemStore inventory before calling `applyMiningDelta`, which permits unbacked cargo if the later depletion fails.
- Player mining drones: `services/drone/droneRuntime.js::tickDroneMining` independently grants itemStore cargo before native rock depletion, with the same conservation failure.
- Native `miningMath` critical bonus is added to transfer quantity but the stock `applyMiningDelta` debits only normal yield + waste. A critical roll near depletion can therefore credit more resources than leave the physical target.
- `miningRuntimeState` already owns resource depletion and persistence; the existing ALIFE-06 state writer patch requires a success acknowledgment when passed `requireNativeMiningPersistence:true`. Do not create a separate asteroid store.
- Existing mining Dogma and command-burst modifiers, resource sites, cargo holds, ship bonus computations and drone ownership remain the authoritative native implementations. NPC mining and the NPC atomic cycle belong to Chat 16 and must remain untouched.

## Repair, default OFF

`integration/coopPlayerMiningCustody.cjs` implements the source-first player cycle with verified connected session, unique ship/owner, module or drone ID, actual physical target, original ore/ice/gas resource classification, permitted hold and volume, exact source snapshot, original `applyMiningDelta` with strict state persistence, post-debit native state readback, then original itemStore native grant. The result must show the exact net inventory delta (including stack merging) for the correct owner, hold, location and type before a cycle is marked COMMITTED. Native HUD notifications occur only after a committed credit. Mining lasers retain upstream crystal and mining-ledger handling; drones retain upstream FX and cycle behavior.

A journal in the operator-provided private directory has PREPARED, DEBITED, UNCERTAIN and COMMITTED receipts. It uses exclusive writer lock, fsync of the journal, atomic rename and directory fsync (where available) to block duplicate or ambiguous grants. The operation key includes system, physical resource, ship, mining module/drone and cycle timestamp: two distinct modules on the same ship can operate on one resource; exact replay cannot. Any unresolved rock or ship fence stops other miners rather than issuing unbacked ore. No synthetic ore or wallet mutation is introduced.

This implementation deliberately chooses debit-first. It **does not offer distributed ACID or guarantee zero resource loss after a crash**: native miningRuntimeState and native itemStore are distinct GameStore writes; source may be durably debited while credit fails or is ambiguous. The journal preserves the uncertainty for operator repair. In-memory/cache source acknowledgment is not proof of actual worker fsync. Windows directory fsync has additional limitations. Never claim production durability without a real forced-process-kill/restart test.

`scripts/coop-player-mining-custody-patch.cjs` exports reversible `patch` (laser) and `patchDrone` functions with pinned unique source anchors. It is intentionally **not registered in the shared central patch script**, owned by Chat 01. Apply it after the currently registered ALIFE-06 and ALIFE-07 patches and remove it before them. The strict mining-state writer must be present and accept `requireNativeMiningPersistence:true` before activation. Chat 01 must decide and test central integration; no upstream or Docker tree was modified here.

## Flags and safety

- `EVEJS_COOP_PLAYER_MINING_CUSTODY=1` enables the new player-only source-first branch; OFF retains the pinned default path unchanged. Do not turn it on for the preserved world.
- `EVEJS_COOP_PLAYER_MINING_JOURNAL_DIR`: **pre-existing, absolute, private, non-symlink** directory outside the preserved GameStore data volume. Missing or unsafe paths fail closed before resource debit. Journal and writer lock must survive crash/restart; never auto-delete uncertain files. Never reuse a testing journal across data resets.
- Do not confuse this flag with NPC-only `EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION` or `EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC`; these have separate writers and scope.

## Evidence and blocked acceptance

Local Node v22.16.0: `node --test tests/coop-player-mining-custody.test.mjs`: 15/15 PASS including two players on one physical resource, critical depletion, ore/ice/gas holds, cargo capacity, failed debit, lost cargo ACK, journal replay, stale session, drone controller ownership, same-ship independent modules and reversible patches (LF+CRLF). This uses an isolated source/cargo simulation and is not actual EveJS GameStore/SQLite persistence or a real client.

Minimum real acceptance on a disposable pinned EVE server with two **authenticated** clients: rock/ice/gas harvesting and two-person same-site depletion; two ships with laser+drone simultaneous cycles; vessel-specific holds and fleet/boost effects; genuine itemStore itemIDs/ownerIDs and capacity; same native source before/after plus persistence worker flush; shutdown immediately after PREPARED, source debit, native grant and COMMITTED; reconnect and forced restart with same characters, cargo, site and residual resource. Inspect unresolved fences with real native DB IDs, never repair by synthetic credits. Do not mark LIVE_PASS without these tests.