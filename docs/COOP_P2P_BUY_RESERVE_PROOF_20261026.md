# P0 — Native BUY ISK reserve and original Rust order custody proof

**Status:** Source-integrated, default OFF, not a live BUY-order settlement feature. Upstream `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Problem repaired

Original `executeBuyRequest` charged market reserve, broker fee and SCC surcharge as **separate native wallet writes**, called Rust `PlaceOrder`, then persisted a BUY escrow row. An ambiguous Rust ACK could leave real money charged with no reliable proof of order placement; ordinary `syncOpenBuyEscrowRecords` also reconstructed BUY escrow from an open Rust order alone, without an independently verified wallet debit.

## Source-level implementation

- `integration/coopPlayerMarketBuyReserve.cjs` uses original GameStore `coopAtomicNativeRows.transact` with existing native `characters`, `identityState`, `playerMarketFills`, and `marketEscrow` tables. One synchronous SQLite transaction validates the character wallet, exact two-decimal original price and fee quote, available cash, and reserves `price * quantity + broker fee + SCC surcharge`. It persists the original wallet journal entries (native event IDs `42/46/149`), sequential journal IDs and an immutable-identity `P2P_BUY_RESERVE / RESERVED` receipt keyed by a random UUID. **No Rust order or escrow is invented at this stage.**
- A single `RESERVED` operation per buyer may be unresolved at a time. After a lost or uncertain `PlaceOrder` response, no auto-refund, no blind retry, and no second cash reservation for the same buyer until that operation is reconciled.
- `integration/coopPlayerMarketBuyReserveRuntime.cjs`: only after the durable reserve exists, call the **original** Rust `PlaceOrder` and independently read its persisted `GetOrder`. Verify the precise original `order_id`, source player, buyer identity, side BUY, owner, region-independent station/type, exact price cents, quantity, min-volume, duration and order range.
- Then and only then, a second GameStore transaction binds the original Rust ID to the existing reserve receipt and atomically writes the native BUY escrow with `coopReserveOperationID` and `coopReserveReceiptKey`. A second bind with the same ID is idempotent and does not charge the wallet again. A changed identity, outstanding old escrow or duplicate order link fails closed.
- Native source patch wires guarded `executeBuyRequest` (duration greater than zero) into that path, without issuing an immediate matching buy on the same call. Existing instant buys (duration zero) use their normal existing safe SELL matching path. Structure-owned market locations are rejected in this first slice because structure broker fee owner credit needs a separate atomic corporation-wallet boundary.
- To prevent minting a fake BUY escrow, the former `syncOpenBuyEscrowRecords` does **not** reconstruct escrow from Rust rows in reserve mode. Before any new BUY placement the server also checks every already-open character BUY order against a real bound GameStore receipt. Legacy/unfunded BUY orders or unknown native order states block new reservations.
- Under the strict reserve flag, old BUY cancel, expiry, structure-market cancellation and price modification financial paths refuse and require operator-audited settlement instead of blindly crediting wallet or moving escrow. Stock player BUY-match seller payout remains blocked by existing P2P atomic gate.

## Safety / feature controls

This slice **must not be enabled yet as a playable marketplace feature**: a BUY order now has durable, independently verifiable funds but the seller payout, item transfer, partial reserve decrement, price improvement refund and cancellation/expiry refund logic are **not yet implemented atomically with that receipt**. Existing strict mode deliberately stops those operations. It is a staged integration source change; production enabling would strand otherwise legitimate BUY funds until a controlled resolution.

The additional `EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE=1` flag and **all five** existing P2P financial flags must explicitly be `1`: `EVEJS_COOP_PLAYER_MARKET_FILL_GUARD`, `EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE`, `EVEJS_COOP_RUST_P2P_CLAIM`, `EVEJS_COOP_NATIVE_ATOMIC_ROWS`, `EVEJS_COOP_PLAYER_MARKET_ATOMIC`. Every flag remains **OFF by default** and no deployment config was touched.

This is not distributed ACID between Rust and GameStore; `RESERVED` can survive a crash after debit but before Rust `PlaceOrder` or before order binding. The operator must inspect the original Rust order and the durable GameStore receipt before any approved repair. No automatic compensation is safe. Multiple outstanding bound orders are allowed if the buyer has sufficient cash, but a new reserve is denied while a previous one is still `RESERVED`.

## Evidence and gaps

9/9 GameStore reserve and legacy migration source-executed JS tests, 5/5 original Rust PlaceOrder/GetOrder coordinator tests, 4/4 source patch reversibility/guards checks: **18/18 isolated checks PASS**. The **full pinned native** `marketProxyService.js`, after all NPC/catalog/custody/P2P/atomic hooks, parses and applies idempotently, and rolls back byte-for-byte with LF and CRLF.

No true Node/SQLite test runner, Rust cargo build, live daemon, real Windows/EveJS GameStore, two-client gameplay, restart injection or production accounting integration was run here. `evejs-data`, player ISK, original Rust market.sqlite, Docker and game processes unchanged. Detailed QA-agent runbook deferred as requested.

**Next P0:** original seller offer physical item custody → payout from `BOUND` BUY reserve with partial fills, durable per-cycle decrement, exact tax/price improvement, GameStore + Rust receipt-gated release, audit-safe cancellation/expiry and eventual history event parity.
