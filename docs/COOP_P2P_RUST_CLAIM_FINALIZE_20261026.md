# P0 — Idempotent Rust claim / finalize for native player market fills

**Status:** Source-integrated, opt-in OFF, no Rust binary build or real market SQLite execution performed. Pinned upstream `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Exactly one original Rust order writer

`rust/coop_p2p_market_claim.rs` extends the existing Rust `MarketRuntime` **without creating a replacement market**:

- `ClaimPlayerFill`: in a Rust SQLite transaction, validate the real original `market_orders` row (open, source=player, owner/side, price cents, remaining quantity and min_volume); lock that order as `settling` and persist an exclusive `(order_id, cycle)` claim with both participants and the exact proposed fill. One active claim per order. Same claim+payload is idempotent; replay with different parameters is denied.
- `FinalizePlayerFill`: requires the original exclusive claim and that same `settling` native order; decrements `vol_remaining` with an atomic conditional UPDATE, records a durable exact `FillOrderResponse` JSON receipt and switches the order to `open` or `filled`. Repeating the same finalize returns the **saved original receipt**, not a second decrement.
- `GetPlayerFillClaim`: read-only reconciliation of pending/finalized Rust claims. There is **no automatic refund, release, rollback or replay** of ambiguous multi-database settlements.
- While `EVEJS_COOP_RUST_P2P_CLAIM=1`, original stock Rust `FillOrder` **refuses player orders**; seed/NPC authority is not changed by this guard. This prevents accidentally bypassing the new claim protocol.

The reversible manual Rust overlay `scripts/coop-rust-p2p-claim-patch.cjs` adds the exact RPC models/dispatch and extension include to pinned `rpc.rs` and `state.rs`, plus native stock fill guard. It checks SHA and only operates with an explicitly named disposable `--code-path`; it is **separate from the JS central installer**, just as existing COOP-034/035/047/048 Rust extensions are. The original Rust source and binary are unchanged until someone explicitly applies/builds the overlay.

## Native integration

`integration/coopPlayerMarketRustClaim.cjs` binds the existing durable P2P journal's exact original order/ticket cycle and the physical transaction proof to Rust:

1. `PREPARED` journal reservation in the existing native fence.
2. Exclusive `ClaimPlayerFill` RPC before original wallet debit or item transfer; a claim mismatch fails closed.
3. Original native item/wallet path. `FinalizePlayerFill` is invoked instead of stock `FillOrder` for a protected P2P match.
4. Existing Rust ACK verification and the previous strict native wallet/item/escrow receipts must still pass before its journal is `SETTLED`.

The central JS installer copies `coopPlayerMarketRustClaim.cjs` into `server/src/space` and composes one reversible market native patch after the prior P2P settlement patch. It requires **all three flags**: `EVEJS_COOP_PLAYER_MARKET_FILL_GUARD=1`, `EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE=1`, and `EVEJS_COOP_RUST_P2P_CLAIM=1`, plus the earlier persistent native journal path. Flags are all OFF by default.

## Limits / remaining next PR

**This is not native GameStore + Rust cross-DB atomic commit.** After Rust finalize, the order can return to `open` while the native seller credit, tax and escrow reconciliation are still pending. The same protected native P2P path blocks replay using its persistent journal, but a distributed atomic-release protocol and GameStore `transact(["characters","items","marketEscrow"],...)` settlement are still required. Rust claim receipts alone cannot prove a seller was paid, nor can they safely authorize an automatic repair.

**Evidence now:** 15/15 isolated JS source/contract tests; 5/5 native Rust-wiring source test callbacks; pinned Rust source patch repeated and byte-reversed; composition after COOP-034/035/047/048 checked for `state.rs` and `rpc.rs`; full pinned native JS market installer parse, repeated install and rollback LF/CRLF pass. Actual Rust compiler, cargo tests, SQLite daemon restart, Windows game server, GameStore wallet/item transfer and two game clients **NOT EXECUTED**.

No live `evejs-data`, market database, player wallets, orders, items, Docker or binary changed. Detailed QA-agent instructions intentionally deferred.
