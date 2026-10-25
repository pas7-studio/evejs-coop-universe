# COOP-053 — Safe read-only cross-DB NPC buyer crash audit

**Status:** Draft; no automatic recovery and no writable action. Builds on COOP-052 Rust exactly-once history witness and COOP-051 native seller tax. The existing A-Life economy and corporate buyer feature flags remain OFF.

## Motivation

An NPC corporate purchase spans three independent durable authorities:
1. **Journal**: the A-Life coordinator fsyncs PREPARED with a stable claimKey before calling Rust, then writes SETTLED only after success.
2. **Rust SQLite**: actual player market order OPEN → SETTLING → FILLED, original claimed price/quantity, trade-history receipt (COOP-052).
3. **GameStore SQLite**: corporation gross ISK debit, seller gross credit + native transaction tax debit, original item ownership transfer, escrow removal, immutable npcMarketFills receipt.

A process may crash at any boundary. Neither deleting `.lock` nor creating a fresh claimKey is a safe general recovery strategy.

## Implemented

`integration/coopNpcBuyerRecoveryAudit.cjs` classifies **read-only** evidence (does not mutate filesystem, market, GameStore or ISK):

| Journal | Rust claim | GameStore receipt | Audit recommendation |
|---|---|---|---|
| PREPARED | explicitly missing | absent | RETRY_SAME_CLAIM |
| PREPARED | SETTLING | absent | RESUME_GAMESTORE_SAME_CLAIM |
| PREPARED | SETTLING | committed | FINALIZE_RUST_SAME_CLAIM |
| PREPARED | FILLED + history | committed | ACK_JOURNAL_SAME_CLAIM |
| SETTLED | FILLED + history | committed | CONSISTENT |
| Any | unverified owner/price/tax/fill | any | HOLD_MANUAL |
| Any | FILLED without GameStore receipt | absent | HOLD_MANUAL |
| Any | receipt without Rust claim | committed | HOLD_MANUAL |
| Any | transport error or duplicate receipts | ambiguous | HOLD_MANUAL |

All valid recommendations retain the **same durable claimKey**. Only `CONSISTENT` is fully complete. Even a recommended retry has `requiresOperator:true`; no action or lock removal happens automatically.

`coopNpcBuyerNativeBindings.cjs` exposes `audit()` using real persisted `coordinator.inspect()`, read-only GameStore `npcMarketFills` scan, Rust `GetNpcCorpPlayerClaim` inspection and `file + '.lock'` presence. Rust not-found is only accepted when the error explicitly matches the pinned Rust error text; a network outage is never mistaken for an absent claim.

15 isolated state-matrix regression tests cover nominal and corrupted evidence; 2 additional integration tests cover the bound native GameStore/Rust coordinator and ACK-loss classification. The tests are registered in `Run-Alife-Economy-Tests.ps1` and pinned overlay.

## Crucial limits

- This is **diagnosis, not automatic repair**, and does not unlock a protected live runtime or delete a stale lock file.
- The code does not provide a fully distributed atomic transaction across GameStore and Rust. A valid operator action must recheck physical NPC owner, available material escrow and confirmed DB receipts before invoking an existing idempotent writer.
- A previous settled entry is never rewritten or recharged; mismatched history, fill ID, tax or owner is quarantined.
- The real two-player co-op E2E, UI notification parity and production deployment are still NOT_RUN.
- Do not apply or test against the protected persistent `evejs-data` volume.
