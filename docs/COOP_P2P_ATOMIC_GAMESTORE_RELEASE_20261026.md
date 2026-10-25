# P0 — Native GameStore atomic player SELL + Rust post-settlement order release

**Status:** SOURCE_WIRED / DEFAULT_OFF / LIVE_UNVERIFIED. Upstream pin: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## What changed

1. **Original GameStore is the only item/wallet writer.** New SQLite-native table `playerMarketFills` is registered with `server/src/gameStore/index.js` and added to the existing `coopGameStoreAtomic` allowlist; no JSON or duplicate market database. The single existing `coopAtomicNativeRows.transact` does a synchronous SQLite `BEGIN IMMEDIATE` with durability and native cache/index invalidators.
2. `coopPlayerMarketAtomicSettlement.cjs` implements the first supported original player P2P SELL path in one transaction over **characters, items, marketEscrow, identityState, playerMarketFills**: buyer original cash debit; seller original gross credit and market-rules tax debit; original physical stack moves to buyer under the **same itemID**; original escrow deleted on final fill or reduced in-place on partial fill; both native wallet journals/market transactions and a durable receipt committed together. A persisted `p2p:<order_id>:<cycle>` receipt makes repeats read-only or fail closed. There is no independent item allocator, no shadow balances, and no synthetic mint.
3. The first atomic path explicitly requires **one original SELL order represented by exactly one physical escrow stack (partial fill splits only that stack)** and independently verified native order/escrow/custody proof. Reject multi-stack source escrows, SELL-order-to-BUY-order crossings and prepaid player BUY orders. A partial fill uses the original native identityState nextItemID allocator under the same SQLite transaction to create a fresh buyer-owned stack while leaving the original escrow stack with the remaining quantity. The prior native market path remains unchanged with atomic flag OFF.
4. `coopPlayerMarketAtomicRuntime.cjs` coordinates *durable native journal PREPARED → verified Rust claim → GameStore atomic COMMIT → Rust finalize (still locked) → native journal RUST_ACK/SETTLED → reread actual GameStore receipt → Rust release*. No automatic replay on ambiguous crash outcomes.
5. Rust `coop_p2p_market_claim.rs`: `FinalizePlayerFill` retains `market_orders.state='settling'` while decrementing remaining volume and persisting its exact ACK. New idempotent `ReleasePlayerFill` performs the final `settling → open|filled` CAS **only after native receipt is presented**; repeat release checks the saved receipt key and returns the exact stored claim ACK. `GetPlayerFillClaim` exposes the released receipt key for controlled reconciliation.
6. Central reversible installer composes the native SELL atomic hook and table registry after the existing P2P market source patches; Rust RPC is updated by the separate pinned Rust source overlay, not the JS installer. After successful post-release settlement, the native path sends buyer item, wallet and order notifications. No notifications or credits are issued before durable commit/release.

## Flags, disabled by default

All five MUST be `1` before matching any player order:
- `EVEJS_COOP_PLAYER_MARKET_FILL_GUARD`
- `EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE`
- `EVEJS_COOP_RUST_P2P_CLAIM`
- `EVEJS_COOP_NATIVE_ATOMIC_ROWS`
- `EVEJS_COOP_PLAYER_MARKET_ATOMIC`

Also requires a persistent absolute `EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_JOURNAL_FILE` (on Windows, precreated). Incomplete flag combinations fail closed before order matching. No Docker or world configuration modified.

## Important limitations / non-claims

- **Not distributed ACID:** Rust SQLite and GameStore SQLite still have distinct commits. After GameStore COMMIT but before Rust finalization/release, the order remains locked and the durable GameStore receipt and native journal require verified reconciliation. No silent abort or refund, no automatic second ISK transfer. The Rust RPC release key is checked by the trusted local server; it is **not a cryptographically verified cross-database commit certificate**. Daemon RPC exposure must be access-controlled before any production enablement.
- Single physical escrow-stack only: multi-stack, prepaid BUY orders and linked SELL→BUY orders are deliberately disabled in strict mode until independent reserve proof, partial-stack allocator and paired-Rust-order escrow are atomic.
- Original `RecordTrade` history RPC is not yet idempotently included in the atomic commit; chart/history parity and market notifications require isolated gameplay verification. Client notifications happen after release and cannot establish transaction durability.
- All **source-level** regression tests and pinned JS source transforms are distinct from true Rust compile, SQLite crash-injection and two-client tests. These have **NOT RUN** in this session; do not enable on live `evejs-data`.

Next P0: independently funded BUY escrow receipt; multi-stack SELL fulfillment with strict physical custody; Rust idempotent history event and protected, operator-approved crash recovery across both durable receipt stores. User requested detailed test-agent runbook later.

No live ISK, item, market.sqlite, Docker, `evejs-data`, client binaries, or real-world game sessions have been touched.

## P0 extension: original player partial SELL, 26 October 2026

This follow-up extends the **existing** single-stack SELL settlement to an exact `volumeBefore → filledQuantity + volumeAfter` split. It uses the same native GameStore `BEGIN IMMEDIATE` transaction and the same Rust `ClaimPlayerFill → FinalizePlayerFill (locked) → ReleasePlayerFill` protocol; no parallel trading system.

- **Partial:** the seller retains their *original* itemID at its original market escrow location with `quantity=stacksize=volumeAfter`. The buyer receives one new physical item, allocated via the existing `identityState.nextItemID` in the same transaction after a strict scan of all persisted item IDs; `marketEscrow.remainingQuantity` is reduced to `volumeAfter`. Wallets, ledger entries, unique allocation, original cargo, buyer item, escrow and durable receipt commit as one unit.
- **Final:** if `volumeAfter=0`, the original remaining stack moves directly into the buyer's native hangar, keeping the old itemID; escrow is deleted. No second itemID is allocated.
- **Replay:** native `playerMarketFills` receipt binds `sourceItemID`, `itemID` (buyer delivery), `volumeBefore`, `volumeAfter`, `quantity`, both actors and exact cents. Repeating the same fill is read-only and never replenishes the buyer's goods or wallet. Distinct paid Rust cycles have distinct receipts.
- **Admission:** only one original escrow stack whose total quantity equals the original market order remaining volume is accepted. Multi-stack offers, prepaid BUY, linked crossing and uncertain/invalid `nextItemID` refuse without attempting synthetic fallbacks. Rust journal and native receipt remain authoritative after crash.
- **Verification so far:** source-executed JS assertions for complete `7→3→4` and terminal `4→4→0`, no double debit on replay, all-or-nothing rollback on unavailable/unsafe native allocator, leftover item identity/owner and order volume; pinned full market patch composition and reversible LF/CRLF transformations. **Rust compilation, real node:sqlite/better-sqlite3, game two-client and crash tests remain NOT EXECUTED.** Do not enable on `evejs-data`.
