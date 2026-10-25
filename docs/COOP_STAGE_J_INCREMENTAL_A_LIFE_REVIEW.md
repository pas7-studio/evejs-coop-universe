# Stage J — incremental native death / NPC salvage review (2026-10-25)

This extends the existing Stage J Draft #116, stacked on Draft #100.

## Verified source facts

The branch ALREADY contains a native pinned death patch at scripts/coop-salvage-death-native-patch.cjs and integration/coopSalvageDeathAtomic.cjs. Its feature gate EVEJS_COOP_SALVAGE_NATIVE_DEATH=1 uses coopAtomicNativeRows to transfer original npcCargo source IDs into npcWreckItems and preserves sourceCargoID. This is not newly invented by this update. It uses an existing single SQLite native row transaction and guards against duplicated original cargo after crash. Its pinned EveJS counterpart is nativeNpcWreckService.destroyNativeNpcEntityWithWreck. The stock wreck transferNativeWreckItemToCharacterLocation grants destination first and then removes source, so it is NOT a suitable atomic salvage warehouse operation.

## Additional code this update

- coopSalvageProvenance.verify now rechecks absence of original cargo in both the native source and corporation warehouse *even after* the immutable source-to-wreck witness was fsynced. This protects a restart/replay against reconstructed duplicate stock.
- coopSalvageNpcDispatch creates server-owned physical NPC salvage movements only with an independent live source witness and exact wreck/ship/controller identifiers: real native warp at long range, orbit when close; no teleport, no free inventory or payout. NPCs with active combat target or manual attack order are not diverted. Cooldown guards repeated orders. It does not autonomously choose missions until wired into the A-Life runtime.
- Added 6 authored tests in tests/coop-salvage-npc-native-dispatch.test.mjs, with source checks and negative cases.
- Reversible installer now includes the new NPC adapter. The flag EVEJS_COOP_SALVAGE_NPC_DISPATCH=1 remains default OFF.

## Required remaining work — no fabricated GO

1. Wire coopSalvageNpcDispatch into the real A-Life scheduler/physical NPC assignment source, with bounded autonomous opportunity selection and conflict-safe owner arbitration.
2. Implement an actual atomic warehouse transfer across native npcWreckItems and itemStore items (not just the strict coopSalvageAtomicCustody verifier), including an idempotent source/target transaction ID and validated warehouse item schema. The stock wreck pickup grant-then-remove is disallowed for source-proven escrow.
3. Persist rescue opportunity and native corporation-funded escrow through full lifecycle: offer, 2-player acceptance, physical delivery, actual native wallet payout OR proven refund, and update reputation only from the terminal credit.
4. Run all Node 22 tests on the full checkout and 2 authentic EVE clients in a disposable test world; then reconcile #96 crash recovery, #100 P1/P2, #116 Stage J to current main with overlay drift checks.

Do not enable these features on production world yet. No real-client E2E, no native provider claim, no production merge, no modification of evejs-data.
