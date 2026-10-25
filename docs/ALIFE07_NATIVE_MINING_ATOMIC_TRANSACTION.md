# ALIFE-07 — Atomic native asteroid → NPC cargo

**Status: DRAFT / SOURCE_IMPLEMENTED / LIVE_E2E_NOT_RUN.** Depends on #121, #119, #110, #114. Tracks #122.

## Native authority

- Pinned EveJS already stores miningRuntimeState and npcCargo in the same SQLite gamestore.sqlite.
- Mining state uses a wrapper row: systems<SEP>systemID with entities[asteroidID].
- npcCargo uses the original flat row cargo containing keyed cargo[cargoID].
- Existing coopGameStoreAtomic bridge supports BEGIN IMMEDIATE, exact transaction rollback, pre-commit cache flush, and post-commit cache reconciliation.
- ALIFE-07 extends its allowlist to miningRuntimeState and requires PRAGMA synchronous=FULL before the atomic transaction.

## Changes

1. Reserve an ID only through original nativeNpcStore.allocateCargoID (persistent mode). Native counter changes flush before source/cargo commit; skipped IDs on failed attempts are harmless.
2. Derive operation ID from original system, asteroid, miner, module and cycle timestamp. Store hash, fingerprint, and COMMITTED receipt in SQLite.
3. In ONE SQLite transaction, compare original asteroid source and original NPC cargo ID, owner, type, quantity, then update miningRuntimeState and npcCargo plus the receipt.
   - Conservation: asteroid depletion includes the full transferred ore quantity (including critical bonus) plus waste. A critical hit cannot create free cargo.
4. Allow exact replay without second credit or source debit; refuse conflicts, moved custody and unknown outcomes.
5. After SQLite COMMIT, use original applyMiningDelta for visuals/in-memory scene only, with an explicit already-persisted marker. No second source write.
6. Reconcile original native cargo store readback into hull-local cargo. Quarantine failed/unknown postcommit reconciliation.
7. Player mining is unchanged. Feature flags OFF preserve ALIFE-06/vanilla semantics. Both native mining files have reversible LF/CRLF patches.

## Activation (DISPOSABLE TEST WORLD ONLY)

    EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY=1
    EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION=1
    EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
    EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC=1

CRITICAL: Stock NPC mining fleets currently spawn with transient:true. The new atomic path FAILS CLOSED on those ships until stable native miner/hauler identity and fleet-slot restart restoration are verified. This is intentional: the normal game mining mode is not yet production-ready under the atomic flag.

GameStore also refuses transactions when either participating table has active transient paths. Do not force these checks off. Multiple independent GameStore owner processes and stale cache writes remain outside proven safety scope.

## Local verification

    pwsh -File scripts/Run-Alife07-Native-Mining-Atomic-Tests.ps1 -UpstreamCodeRoot 'C:\Games\EveCoop\upstream-evejs\Code'

Read-only disposable SQLite receipt audit:

    node scripts/audit-alife07-native-mining.cjs C:\path\to\disposable\gamestore.sqlite

Ten physical scenarios remain NOT_RUN in tests/scenarios/native-mining-atomic-e2e.json, including forced SQLite abort, restart, actual persistent miners, cross-miner source CAS, original cargo ownership, miner-to-hauler-to-warehouse custody and two real clients.

Do not merge as verified or enable on the preserved evejs-data volume until all restart, actor restoration and native physical E2E tests pass. PRAGMA FULL improves durability but does not replace real kill-at-commit testing.
