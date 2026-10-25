# COOP-054 — Controlled NPC buyer crash recovery

**Status: Draft, default OFF.** Stacked on PR #130 → #127 → #120. No changes to `main`, no live-server mutation and no access to the protected `evejs-data` volume.

## Critical defect fixed

Before this change the ordinary, periodically invoked `coopNpcBuyerCoordinator.tick()` would automatically call `buyer.purchaseOnce()` when it found a `PREPARED` claim left behind by a crash. This could replay the purchase without an operator having reconciled Rust, GameStore and the journal.

**After COOP-054:** normal A-Life tick *never* retries a PREPARED claim. Instead it returns `NPC_BUY_PENDING_OPERATOR_RECOVERY` without any market or GameStore write. The pending claim's exact original `claimKey` remains on disk.

## Strict recovery API

`coopNpcBuyerNativeBindings.cjs` exports `recoverApproved({actorID,approval})`. It does **not** register a player-facing RPC or invoke recovery automatically from A-Life. It only works when:

- `EVEJS_COOP_NPC_BUY_RECOVERY_OPERATOR=1`, `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`, and `EVEJS_COOP_NPC_BUY_PLAYER_ASK=1`.
- A **trusted server-admin caller** injects `authorizeRecoveryOperator` into the native bindings at construction. In the installed A-Life runtime no such authenticator is supplied, so operator recovery remains unavailable until an authorized server control surface is implemented.
- An explicit approval specifies the exact original `claimKey`, one expected recovery action, a nontrivial reason and a unique operator approval identifier. The trusted authenticator must validate operator privileges itself, not trust these fields as authority.
- The same cross-process journal `.lock` is exclusively acquired via `wx`. **Preexisting/stale locks are never deleted** by this implementation.
- Only a single PREPARED journal entry with matching corporation/order is eligible. Actor authority, NPC ownership, physical station, combat and warp state are revalidated.

The controller re-reads `auditNativeNpcBuyerRecovery()` under the owned lock and refuses any disagreement between the approved action, Rust claim/history, GameStore receipt/tax and fsynced journal.

| Approved action | Required independent evidence | Writes |
|---|---|---|
| `RETRY_SAME_CLAIM` | PREPARED; Rust explicitly absent; no GameStore receipt; fresh OPEN order | Existing idempotent buyer using **same** claimKey |
| `RESUME_GAMESTORE_SAME_CLAIM` | PREPARED; Rust SETTLING; no GameStore receipt | Existing five-table native atomic buyer using same claimKey |
| `FINALIZE_RUST_SAME_CLAIM` | PREPARED; Rust SETTLING; matching paid GameStore receipt | Existing Rust finalize, no second native buyer debit |
| `ACK_JOURNAL_SAME_CLAIM` | PREPARED; Rust FILLED + price-history witness; matching paid GameStore receipt | **Journal only** — no wallet, escrow or market RPC |

For all paths, a **second cross-DB audit after native work** must prove `ACK_JOURNAL_SAME_CLAIM` with the same `fillID` and original `itemID`. Only then does the controller fsync `SETTLED`. If a step fails, the journal remains PREPARED and a new operator audit is required. No new claim key is minted during recovery.

A previously completed SETTLED entry cannot be recovered again. Any ambiguous double receipt, unverified operator, player-controlled ship, wrong tax, modified price or concurrent writer results in `BLOCKED` without a payment.

## Tests and local gate

- `tests/coop-npc-buyer-controlled-recovery.test.mjs`: 15 strict tests for all actions, stale lock, approval and authorization gates, owner/combat changes, tax conflict, failure and replay.
- Existing `tests/coop-npc-buyer-native-bindings.test.mjs`: native GameStore/Rust/finalize lost-ACK integration now exercises explicit operator ACK rather than automatic A-Life replay.
- Existing `tests/coop-npc-buyer-coordinator.test.mjs`: verifies the normal tick remains blocked on PREPARED.
- Existing `tests/coop-npc-buyer-recovery-audit.test.mjs`: 15 read-only cross-DB corruption matrices.
- CI: `pwsh -File scripts/Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests`. Rust market remains built/tested against the pinned upstream in disposable GitHub Actions.

## Remaining

A trusted operator UI/route with authentication, one-time approvals, auditing and operator-facing lock recovery procedure has **not** been deployed. The API is intentionally uncallable from normal A-Life runtime without injected authorization. Protected volume is unchanged. Two-client market/gameplay E2E, market notifications and a full crash/restart with separate Rust/GameStore processes remain NOT_RUN; keep all live trade flags OFF.
