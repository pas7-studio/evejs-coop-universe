# Stage J P0 — NPC Salvage / Player RESCUE atomic arbitration

**Status:** source implementation; full local Node + native SQLite/GameStore + two real clients **NOT_RUN**.
**Revision:** relative to main, pinned upstream EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
**Runtime:** flags OFF; no live world writes, no GitHub Actions.

## Race found

The `coopSalvageNativeRewards.reserve()` quote validated the original wreck *before* the native escrow transaction. Meanwhile the A-Life `coopSalvageNpcRivals.tick()` checked that no escrow existed *before* its pickup transaction. If these operations interleaved, both could consider the same wreck inventory available: a player contract could be funded after an NPC took the cargo or an NPC could steal the last cargo after players funded the contract.

## Native conservation rules

1. The player's `reserve` transaction now includes `npcWreckItems` plus `corporationRuntime` and `characters`. Before debiting any NPC corporate wallet it checks each **original** `wreckItemID`, `sourceCargoID`, `typeID`, `quantity`, exact wreck identity and `sourceKind=cargo`. It checks for already-recorded player or rival moves and duplicate original rows.
2. NPC rival pickup re-checks `coopSalvageEscrows` inside the exact native transaction that moves the original item from `npcWreckItems` to `npcCargo`. ANY contract state, even terminal, excludes rival pickup; a corrupt escrow ledger fails closed.
3. Both operations use the existing `coopAtomicNativeRows` GameStore bridge; the serializing SQLite writer chooses **one** winner. No timer, second wallet, virtual reward, or new scheduler.
4. If NPC wins first: player reservation does not debit funds. If player funding wins first: NPC leaves the original wreck untouched. Already signed consents are **not** invented escrow. Lost ACK must be reconciled by reading original native rows, escrow and exact receipt before retry.

## Verification / reproduction

- `tests/coop-salvage-native-corporation-escrow.test.mjs` — now 14 cases; three interleaving/forged-original regressions; existing 11 escrow/payout/history tests retained.
- `tests/coop-salvage-rival-escrow-arbitration.test.mjs` — 6 new real-source tests covering unfunded rival pickup, stale preflight after player-funded reservation, terminal escrow exclusion, corrupt ledger, stale preflight sourceKind swap, default-OFF flag.
- Isolated V8 execution using the actual current GitHub source and an in-memory atomic adapter: **20/20 PASS**. This is **not** a real native SQLite test, Docker deployment or two-client gameplay acceptance.
- Local on pinned standalone checkout, run `node --test tests/coop-salvage-native-corporation-escrow.test.mjs tests/coop-salvage-rival-escrow-arbitration.test.mjs` then `node scripts/coop-test-baseline.cjs`. Keep test failures explicit.
- On a **disposable** world copy, intentionally interleave two independent authenticated pilots accepting a genuinely funded corporation RESCUE with a real rival NPC approaching a physical wreck. Record actual original-item row, both wallet deltas, NPC cargo, `coopSalvageEscrows`, `coopSalvageMoves`, `coopSalvageRivalMoves` and player inventory across restart. Capture only redacted evidence; never commit personal data, credentials or native databases.
- Full acceptance matrix: `tests/scenarios/coop-stage-j-salvage-escrow-race.json`. Do not claim GO without native GameStore and real two-client evidence.

## Rollback

Revert this PR; the new checks do not migrate persistent schemas. Flags remain default OFF and no running overlay, NPC wallet or `evejs-data` is modified by source changes.
