# Chat 24 + 31 — Stage E2B5: Locked corporate SELL cancellation and unsold ore return

**Status: source implemented, guarded, LIVE_UNVERIFIED.** Draft PR #287. Original market SELL publication remains **disabled**. No actual EVE client / Rust compiled trade has taken place.

## Critical original stock bypass closed

Pinned Rust \`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f\` has general \`FillOrder\`, \`ModifyOrder\` and \`CancelOrder\` SQL methods. These methods DO NOT apply the corporate wallet/item receipt protocol. The reversible \`scripts/coop-rust-corp-mining-sell-patch.cjs\` now adds server-side admission guards to **all three stock methods** for orders with \`source='coop-corporation'\` — rejecting even a direct RPC attempt before mutation. Guards apply independently of the private corporate feature flags.

These source guards are required before any original corporate open SELL is allowed. The current \`PublishCorpSell\` remains intentionally fail-closed; no live corporate stock is exposed to native automatic matching. The normal Node marketProxyService buy matching is still character/seed-oriented and cannot be considered corporate atomic settlement. **Real orderbook buyer matching remains a future requirement.**

## Rust native exclusive cancellation (E2B5)

Extended the same original market server \`rust/coop_corp_mining_sell.rs\` with:

- \`LockCorpSellCancel\`: private server-token RPC, default-OFF \`EVEJS_COOP_RUST_CORP_CANCEL\`. Allows only original prepared or published corporation SELL order, with positive unsold units and no active/unfinished Rust claims. Verifies that prior fills are all \`released\`, and cycles form a contiguous sequence. Locks \`market_orders.state='cancelling'\` with SQLite compare-and-swap and saves an immutable \`coop_corp_sell_cancel_intents\` record (original itemID, cargoID, corporation, remaining quantity, prior fill count).
- \`GetCorpSellCancel\`: read-only inspection of this durable original Rust lock, for lost-ACK operator reconciliation.
- \`FinalizeCorpSellCancel\`: reads the **real original GameStore SQLite** read-only and checks the exact original source \`coopPlayerMiningCorpSell\u001fcargoID\` row, same original physical \`itemID\` in the original corporate office with only unsold remainder, unchanged corporation owner, type, provenance, location and division; also verifies \`marketEscrow[orderID]\` tombstone with exactly zero remaining stock and matching original source itemID. Only then atomically moves the original Rust order to \`cancelled\` and records a terminal ACK. Repeated finalization reuses that source ACK.

Important: the exclusive market lock and cancel-intent live in original Rust SQLite. The original \`coop_corp_sell_prepared\` CHECK schema is **unchanged**, avoiding a migration of existing prepared orders. Only the terminal \`phase='cancelled'\` (already permitted in that source schema) is written at finalize.

## Native GameStore physical unsold remainder return

\`integration/coopPlayerMiningCorporateUnsoldReturn.cjs\` uses the same original native \`coopAtomicNativeRows\` writer over \`items+marketEscrow+corporationRuntime\`:

- Requires an independently read Rust \`CANCEL_LOCKED\` proof (not client input), authentic original corporation officer session, Industry + Wallet + office TAKE rights.
- Verifies the same original itemID, unmodified corporate owner, original office folder and division, escrow volume, all previously completed original partial-fill cycles, no cargo marker duplicate and no unknown pending GameStore COMMIT.
- Returns **only remaining physical units** of the original source itemID to the exact prior corporate office. It changes no buyer inventory, wallet or prior realized earnings. Example: after 3 of 8 ore units sold and already settled, **five units return**; the buyer keeps three.
- One original GameStore COMMIT records \`RETURNED_UNSOLD\` in original source sale receipt, terminal marketEscrow tombstone and same physical item in original corporate office with matching \`returnedQuantity\`. Unknown COMMIT fences automatic retries.

\`integration/coopPlayerMiningCorporateCancelLifecycle.cjs\` orchestrates trusted \`LockCorpSellCancel → GetCorpSellCancel → returnRemaining → FinalizeCorpSellCancel\`. Every RPC, original qty, source item, corporation and prior fill sequence is checked. A lost ACK at any boundary moves to operator reconciliation; it never resends the refund or returns ore twice. No public/client RPC entrypoint or independent scheduler is installed.

## Source verification

- **12/12** isolated native original partial/zero-fill cargo return tests PASS.
- **8/8** isolated private Rust-to-GameStore cancellation lifecycle tests PASS.
- **25/25** isolated Rust source/patch tests PASS, including original stock Fill/Modify/Cancel bypass guards and strict Rust cancellation/source witness.
- Original pinned Rust \`state.rs\` / \`rpc.rs\` patched/undone byte-for-byte, idempotent, including CRLF.
- Previous E2B1/E2B2 tests and E2B4 source oracles should be rerun with complete native checkout before deployment.

**These are isolated tests against original-interface mocks/source text; not compiled \`cargo test\`, not real SQLite crash/restart and not two EVE clients.** No actual stock wallet, item or Rust order was mutated in a live world. No CI/deployment was started.

## Critical remaining gates

1. Real corporate **buyer matching** from original market orderbook with server-authenticated buyer and quote; never allow the ordinary stock \`FillOrder\` to bypass atomic corporate settlement. Add safe original Rust \`PublishCorpSell\` only after full matching, fee authority and exact GameStore escrow proof.
2. Run pinned original Rust \`cargo test\` and actual Node/SQLite, then interrupt/restart at each edge of \`Lock → Return → Finalize\`, including partial sells and source drift. Verify physical item conservation and original corporation/character wallets.
3. Ensure native published corporate orders are excluded from any unsafe stock buy matching until a fully wired original client/Rust atomic corporate match path is proven. Cache invalidation and expiry must use private source authority.
4. In-game corporate SELL from appropriate NPC/Market UI, actual buyer vs seller testing, realized P&L across original wallet, wages, purchased ore, verified station/market fees.
5. Reconcile PR #287 branch divergence with current \`main\`, rerun entire original Node/Rust/SQLite plus two-client E2E before merging and toggling any financial flag.

**Do not enable any new financial or cancellation flag on preserved worlds.**
