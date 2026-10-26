# P0 — original native P2P BUY escrow cancel/expiry refund

**Status: SOURCE-INTEGRATED; DEFAULT OFF.** Original pinned EveJS: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Native protocol

This stage completes the first **refund** flow for a previously funded original player BUY order. It reuses native GameStore `characters`, `marketEscrow`, `playerMarketFills`, and `identityState` and the original Rust market order state. No parallel wallet, item store or market.

1. **User cancellation**: original in-game `Handle_CancelCharOrder` first verifies that the original Rust BUY order is still open and that GameStore contains a `BOUND` original reserve/escrow. Original Rust `CancelOrder` must return exactly `state=cancelled`, `invalidated=true`, and the same original order ID. Independent `GetOrder` then proves terminal state and matching original buyer/price/volume/station/type. An ACK timeout or mismatch produces **NO automatic refund**.
2. **Expiration**: original Rust `GetOrderEvents(event_type=expired)` is the discovery source. Every expiry event is independently checked with original `GetOrder`: exact original order identity, player side, owner, type, price, remaining volume, station and `expired` state. The event cursor is advanced only after original GameStore settlement succeeds.
3. **Native GameStore durable COMMIT**: the only ISK writer uses the existing `coopAtomicNativeRows.transact(["characters","marketEscrow","playerMarketFills","identityState"])` bridge with full durability. Validate the original `BOUND` reserve receipt and exact native BUY escrow against Rust `vol_remaining`. Refund **only** `priceCents * vol_remaining` to the keyed buyer wallet and append the native `MARKET_ESCROW=42` wallet journal entry. In the same SQLite COMMIT delete the original BUY escrow, mark the original reserve `REFUNDED` preserving `spentCents`, set `refundedCents`/zero remaining reserve, increment native journal sequence and write `buy-refund:<order_id>` durable receipt.
4. **Replay**: a repeated terminal event finds the existing durable receipt, verifies original order, reason, price, quantity, cash delta, original reserve identity and conservation `spentCents + refundedCents = reservedCents`; it never credits the wallet twice. Different reason/owner/amount/order fails closed.
5. Existing native sell-custody and BUY-reserve source guards remain. In refund mode, existing *stock* BUY refund branches are bypassed by early handlers after durable settlement; without the refund flag old strict guards **still refuse** unsafe BUY cancellation or expiry. Structure-service bulk order cancellation remains blocked rather than using a different unverified refund path.

## Exact safety controls

All of the following must equal `1`:
`EVEJS_COOP_PLAYER_MARKET_BUY_REFUND`, `EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE`, `EVEJS_COOP_PLAYER_MARKET_ATOMIC`, `EVEJS_COOP_NATIVE_ATOMIC_ROWS`, `EVEJS_COOP_RUST_P2P_CLAIM`, `EVEJS_COOP_PLAYER_MARKET_FILL_GUARD`, `EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE`. All default **OFF**. The existing persistent market settlement journal is still required for fills.

**No distributed ACID:** Rust SQLite and original GameStore SQLite are separate. A crash after original Rust cancel before native refund leaves a cancelled order with refundable original reserve; it requires operator-reviewed replay/reconciliation. A lost Rust ACK is never interpreted as proof of success. Existing BUY price-modify, structure service cancellation, source SELL crossing and unmatched/legacy reserve paths remain blocked. Original broker fee and SCC paid on placement are **not refunded**, only unused purchase reserve. No retroactive automatic refunds of historical/unfunded Rust BUY orders.

## Source verification

- Native receipt, partial (7 units, 3 spent, 4 refunded), unfilled 7-unit expiry, failure/replay, false escrow, ID, cents and rollback: **8/8** JS isolated tests PASS.
- Original Rust CancelOrder/independent GetOrder, expiry terminal-state readback, lost RPC ACK, unknown native commit: **7/7** isolated tests PASS.
- Reversible native cancel/expiry source hooks: **3/3** isolated tests PASS.
- Pinned full original market source with all prior NPC and player market patches: V8 parse, repeated exact application and byte-identical rollback on LF/CRLF PASS.

**NOT RUN:** real full Node runner, Rust cargo, live two-database SQLite, crash/restart and two-client local game. Do not enable flags in production; no Docker, `evejs-data` or live wallets touched. Test-agent runbook deferred per user direction.

Next gaps: item splitting in funded BUY fills, linked source SELL→BUY matching, original Rust `RecordTrade` exactly-once history, and audited cross-DB crash recovery/repair.
