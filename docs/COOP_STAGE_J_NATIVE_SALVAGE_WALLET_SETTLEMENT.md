# Stage J P0 — original NPC salvage native fill, corporate wallet and Rust finalization

**Implementation:** dependent on Stage J native salvage market PR #142 and original warehouse custody PR #139. **Status:** source patch; isolated source-backed test evidence only, full local Node / Rust compilation / actual SQLite / Docker / two-client game acceptance **NOT_RUN**. Native feature flags stay OFF.

## Reused native infrastructure

There is already a real full-stack `coop-npc` corporate buy protocol, independent of the NPC seed-market side ledger:

1. Rust `ClaimNpcSellOrder` durably locks exactly one buyer and one whole-stack order (state `settling`).
2. EveJS GameStore `coopNpcCorporateSettlement.atomicSettle` debits the real character wallet, credits `corporationRuntime/corporations\u001f<corpID>/wallet/divisions/1000`, transfers the same native `items` item into buyer ownership, deletes `marketEscrow`, and writes `npcMarketFills/order\u001f<orderID>` in **one** `coopAtomicNativeRows` transaction.
3. Rust `FinalizeNpcSellOrder` marks the order `filled`. `GetNpcSellClaim` must independently confirm the buyer and original `fillID` before success is reported.

The existing code accepted only manufactured `npc-manufacture:*` operations and `coop-industry:v1` items. Stage J extends this **same** authority; there is no alternate wallet, substitute money, phantom item or duplicate buyer handler.

## Source-specific authorization

- The pinned `rust/coop_npc_market_pending.rs` now accepts **only** `npc-manufacture:<32 lowercase hex>` or `npc-salvage:<32 lowercase hex>`. Salvage additionally requires `EVEJS_COOP_RUST_NPC_SALVAGE_MARKET=1`; original industry remains unchanged. Rust `Claim/Finalize` already calls the shared operation validator, so the Rust salvage gate applies across all three stages.
- `coopNpcCorporateSettlement` admits a salvage operation only with `EVEJS_COOP_SALVAGE_NATIVE_MARKET=1` and the pre-existing `EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF=1` and `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`.
- Before even claiming the Rust order, disabled salvage is rejected. A disabled feature must **not** leave the market order locked in Rust.
- Inside the native **payment** transaction, an original salvage item must match exact `marketEscrow.coopSource=NATIVE_SALVAGE`, `coopSalvageMarketOps` LISTED original source entry, `coopSalvageRivalMoves` original `NPC_STOCK_DELIVERED` provenance, actual source wreck/cargo IDs, native itemID/owner/station/type/quantity, `coop-salvage-rival:v1:` item marker, and a freshly recomputed SHA-256 operation ID. Another native item carrying the same original marker blocks the purchase.
- Paid buyer, credited corporation, original item transfer, deleted native sell escrow, durable idempotent `npcMarketFills`, and `coopSalvageMarketOps` `NATIVE_SALE_COMMITTED` all commit atomically, or none do.
- Only after Rust finalize + independent Rust claim verification is `coopSalvageMarketOps` advanced to `SOLD` in a separate idempotent, readback-validated transaction. An ambiguous post-commit outcome is **not** a new debit. On retry, the original `npcMarketFills` receipt protects both wallets and the native item even if Rust ACK was lost.
- The whole-stack purchase path is intentionally unchanged (no partial splits). **No taxes, broker fee accounting or partial fills are implemented/assumed**: the existing full-stack corporate path credits gross proceeds. A separately authorized native fee rule is needed before any claim of fee-aware production economics.

## Test evidence and manual gates

- New `tests/coop-salvage-native-corporate-market-settlement.test.mjs`: 13 source-backed scenarios covering real wallet arithmetic, replay, funds shortage, original receipt/marker/escrow tampering, missing physical item, tampered order, duplicate original, late transaction rollback, lost Rust finalize ACK, independent feature OFF and unauthenticated buyer.
- All 12 pre-existing `tests/coop-npc-corporate-settlement.test.mjs` industry settlement cases retained. **25/25 combined isolated V8 actual-source/in-memory GameStore checks PASS.** This is not real Node SQLite/Rust execution.
- `tests/coop-stage-j-native-rust-salvage-settlement-wiring.test.mjs`: Rust explicit namespace/gate and pinned module uniqueness contracts. Rust source compilation not run here.
- Run locally on pinned disposable copy: `node --test tests/coop-npc-corporate-settlement.test.mjs tests/coop-salvage-native-corporate-market-settlement.test.mjs tests/coop-stage-j-native-rust-salvage-settlement-wiring.test.mjs`, and `node scripts/coop-test-baseline.cjs`.
- Run reversible/manual Rust `scripts/coop-rust-npc-pending-patch.cjs` then `scripts/coop-rust-npc-settlement-patch.cjs` dry-runs on the *authorized* pinned upstream checkout, compile Rust offline, validate Rust option gates, and verify EveJS pinned overlay `--dry-run`. **No GitHub Actions.**
- Full physical and financial acceptance cases are staged as `tests/scenarios/coop-stage-j-native-salvage-wallet-settlement.json`. At least one actual authorized buyer session, original item on corp warehouse, native Rust buy order, actual GameStore character/corporation wallet before/after, native `npcMarketFills` and Rust `GetNpcSellClaim` must agree. Reconnect and repeat after forced lost ACK and SQLite crash; never use production `evejs-data`.

## Follow-up

After this source patch passes the real two-client and native financial gates, integrate **selection of eligible unsold original NPC salvage** into the existing A-Life tick. Do not automatically activate native market from this PR. Require independently verified regional price/fees/buyers and a capped batch; do not reinterpret a mere LISTED order as ISK revenue.

## Rollback

No native persisted schema migration. Restore only via pinned reversible overlay and manual Rust patch removal; preserve `evejs-data` and read-only snapshot of original market, wallets and claim receipts. Source flags remain default OFF.
