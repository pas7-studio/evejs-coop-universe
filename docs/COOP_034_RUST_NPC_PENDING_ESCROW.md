# COOP-034 — Native NPC pending Rust sell order and physical escrow

**Status:** manual code/protocol proof only; default OFF. The real player-to-NPC corporation market purchase path is not yet implemented. Do not deploy or enable on live game data.

## Why

Pinned EveJS creates a Rust sell order with PlaceOrder, which is immediately OPEN, and only afterward moves native items to the stock market escrow location. These are different SQLite databases without a shared transaction. A crash can expose unbacked orders. Stock marketProxyService.js handles every non-seeded seller as a character and cannot credit an NPC corporate seller.

## Implemented

The Rust extension at rust/coop_npc_market_pending.rs adds three guarded RPCs: ReserveNpcSellOrder, GetNpcSellOrder and ActivateNpcSellOrder. Reserve creates a PENDING order invisible to stock book/match queries and an idempotent reservation table with unique operation ID, source item ID and order ID. Any modified replay is rejected. Get inspects durable source identity. Activate checks order+item+operation identity and transitions pending to open, then invalidates market caches. The stock PlaceOrder path is separately patched to reject any coop-npc source so nobody can bypass pending reservation.

The patch is explicit and reversible: scripts/coop-rust-npc-pending-patch.cjs, pinned to upstream c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f, supports --dry-run, --check, --remove and LF/CRLF. It is **not** registered with ordinary EveJS Node startup.

The JS adapter at integration/coopNpcPendingMarketEscrow.cjs first obtains a Rust PENDING reservation, then atomically moves the exact existing manufactured native item into market escrow at location 9200000000 + orderID and writes a matching marketEscrow row in the **same GameStore SQLite transaction**. It checks native itemStore and escrow row again before invoking Rust Activate. A lost RPC acknowledgement is not retried; parent COOP-033 journal retains LIST_UNKNOWN. No synthetic market stock, no created items, no free ISK. The GameStore atomic allowlist gained marketEscrow.

## Flags and safety

All default OFF. Manual escrow requires EVEJS_COOP_NATIVE_ATOMIC_ROWS=1 and EVEJS_COOP_NATIVE_NPC_MARKET_PENDING=1. Rust reservation also requires EVEJS_COOP_RUST_NPC_MARKET_PENDING=1. **Rust activation additionally requires EVEJS_COOP_RUST_NPC_BUY_SETTLEMENT=1, which must remain OFF** until the game client market buyer path supports a genuine NPC corporation seller with wallet settlement. Enabling activation now is unsupported.

## Evidence

- 8/8 isolated JS source-level regression scenarios PASS (exact committed adapter): escrow-before-activation, feature OFF, foreign/unbacked stock, bad pending response, transactional rollback, and lost activation ACK without double-listing.
- 9/9 Rust overlay patch-function tests PASS against fixtures: reversible LF/CRLF, source guard, settlement gate, unique reservation key, double-apply and drift fail-closed.
- 3/3 GameStore item+escrow scope tests PASS.
- Exact pinned Rust state.rs and rpc.rs reversible patch/remove verified **4/4**, both LF and CRLF.

Rust compilation, real Rust market daemon tests, real pinned better-sqlite3 worker, client purchase, corporate wallet credit and item delivery have **NOT** been executed. Rust toolchain is absent in this execution environment.

## Isolated manual verification commands

Only on a disposable pinned EveJS checkout:

~~~sh
node scripts/coop-rust-npc-pending-patch.cjs --code-path /isolated/EveJS/Code --dry-run
node scripts/coop-rust-npc-pending-patch.cjs --code-path /isolated/EveJS/Code
cd /isolated/EveJS/Code/externalservices/market-server
cargo check --locked
cargo test --locked
~~~

Revert after test using --remove on the same script and Code path. These commands have **not** run in this session.

## Next mandatory P0

Implement an independently fenced **NPC corporate-seller path in marketProxyService**, not the stock character-seller branch. It must reconcile buyer ISK debit, exact physical item delivery to buyer hangar, Rust FillOrder, native NPC corporation wallet credit, escrow remaining quantity, and unique durable receipts per fill. Prove crash behavior before and after each external commit, and prove via an actual client buy and server restart. Only then release the Rust activation and scheduler gates.

No changes to main, live Docker, Rust database, market seed or evejs-data in this PR.


## Mandatory client-path fail-closed guard added

The actual pinned marketProxyService.js buyer loop would treat source coop-npc as a normal player sell order. To avoid paying an NPC corporation ID through a character wallet or removing escrow stock through the wrong path, scripts/coop-npc-market-buy-safety-patch.cjs now inserts a narrow unconditional skip for coop-npc sellers **before** any character debit, escrow move or Rust fill. This reversible guard is registered into the normal Node overlay for marketProxyService.js, but does not create or activate any NPC sell order. It must be replaced by a separately tested **corporate-seller settlement** before the feature can become playable. The patch refuses unknown source anchors and preserves pristine source, LF and CRLF.

5/5 focused buyer-guard tests pass. Total source-level regression coverage for COOP-034 is **25/25 PASS** (8 escrow, 9 Rust patch contracts, 3 GameStore allowlist, 5 buyer safety). There is no claim of Rust compilation or a real purchase.
