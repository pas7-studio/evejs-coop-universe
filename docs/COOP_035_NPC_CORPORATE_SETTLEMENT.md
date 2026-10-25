# COOP-035 — native NPC corporate market settlement

**State: Draft integration, default-OFF. Not approved for live ISK, Rust market, Docker or evejs-data.** Base is COOP-034 (pending Rust escrow), which in turn depends on COOP-033 (factory director) and COOP-032D/E/F (real GameStore manufacturing). Preserve all main and pinned upstream changes.

## What this actually builds

### Core GameStore atomic native settlement

integration/coopNpcCorporateSettlement.cjs implements one GameStore transaction across these specific native SQLite JSON tables:

- characters (buyer's native wallet and market journal)
- corporationRuntime (NPC corporation division 1000 wallet and journal)
- items (the **same physical industry-manufactured itemID**, owner moves from seller NPC corp to buying player, location from escrow to original station)
- marketEscrow (exact remaining quantity/escrow/source item record removed after full sale)
- npcMarketFills (durable one-per-order authoritative receipt with order, buyer, item, price, before/after balances)

A trusted canonical Rust claim supplies exact NPC order ID, buyer ID, operation ID, original manufactured item ID, type, station, **unit price in cents**, quantity and unique fill ID. The client supplies an authenticated buyer identity and a maximum unit price bound; it cannot forge the corporation owner or seller price.

All five GameStore table updates commit together. No split/clone/mint, no free ISK, no partial sales in this first proof. Price and balance calculations use integer cents; source item quantity and stacksize must exactly match the Rust claim and native escrow. Replay with identical unique fill ID reads npcMarketFills and returns without debiting again. A changed fill ID/buyer/item/amount fails. If any validation, wallet check, missing item, escrow conflict or injected error occurs, outer SQLite transaction rolls back all five tables.

### Rust order ownership and crash protocol

rust/coop_npc_market_settlement.rs extends COOP-034 on a pinned disposable Rust checkout with:

1. ClaimNpcSellOrder: exclusive Rust SQLite claim by order + NPC operation + **real buyer ID**. Persists buyer and unique fill receipt and moves OPEN → SETTLING (not visible in order book). Replays only same buyer/claim.
2. GetNpcSellClaim: inspect authoritative claim and status for forensic recovery.
3. FinalizeNpcSellOrder: idempotent SETTLING → FILLED, vol_remaining=0 and fill receipt state=filled in the **same Rust SQLite transaction**. A repeated valid finalization is a no-op.
4. Stock Rust FillOrder, ModifyOrder and CancelOrder refuse source=coop-npc, blocking direct bypass of physical custody/ISK settlement.

The JS orchestration order is claim Rust → atomic native gameStore commit → finalize Rust → verify Rust done. If finalize loses ACK **after** durable native commit, repeating the same purchase only reuses the native receipt and retries Rust finalization; it cannot debit twice. If claim succeeds but native commit never occurs, the order stays SETTLING and invisible until a safe operator reconciliation. There is **no force release** or automatic rollback mint.

**Cross-database transactions are not globally ACID**. Safety comes from exclusive Rust claim, hidden SETTLING, durable native idempotency receipt and explicit fail-closed reconciliation, not from pretending two independent SQLite databases share one COMMIT.

### Native client bridge and caches

integration/coopNpcCorporateBuyRuntime.cjs takes the actual authenticated session supplied by marketProxyService; checks buyer's native character record, exact docked station, stock native market order, matching escrow and canonical NPC corporation isNPC flag. Uses the real marketDaemonClient for the above Rust RPCs. The existing COOP-034 stock buyer skip is conditionally replaced with a whole-stack buyer branch (scripts/coop-npc-corporate-buy-patch.cjs). The stock player-seller logic is NEVER used for NPC corporation proceeds.

The COOP-032D GameStore bridge is extended to reject any account-table transaction lacking production cache invalidation. After COMMIT it clears characterState.characterRecordCache and resets corporationRuntimeState runtime caches through separately reversible pinned patch hooks; if that fails, the server **fail-stops** rather than serving stale balances. Existing itemStore index invalidation remains intact. The ordinary overlay knows how to copy the two new runtime modules but does not start a scheduler by itself.

### Activation gates

All flags default OFF, and code MUST NOT be activated prior to compiled Rust + client E2E and crash testing:

- EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
- EVEJS_COOP_NATIVE_NPC_MARKET_PENDING=1 (COOP-034 seller/listing)
- EVEJS_COOP_RUST_NPC_MARKET_PENDING=1
- EVEJS_COOP_RUST_NPC_BUY_SETTLEMENT=1 (Rust activation/claim/finalize gate)
- EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF=1 (GameStore buy core)
- EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT=1 (real client buyer branch)

The buyer branch **does not** activate on any single flag alone. The new module reports supportsLiveSettlement:false until the full production gate is verified. The scheduler remains off and is not registered for automatic production tick.

## Tests performed and not performed

**Verified source-level tests in the available environment:**

- 12/12 exact native settlement core tests against disposable transaction mock with physical item/corp/buyer wallet rows: exact conservation, idempotent replay, no funds, rollback after last table write, invalid owner/price, lost final ACK, different buyer, default OFF.
- 14/14 buyer + Rust reversible patch contract tests against the exact committed modules (including native Rust stock FillOrder/ModifyOrder/CancelOrder bypass guards).
- Exact pinned upstream Rust state.rs/rpc.rs patch→remove **4/4 PASS** on LF and CRLF (after applying COOP-034).
- Exact pinned native characterState/corporationRuntimeState reversible patch→remove **2/2 PASS** and static syntax check for all modified JS modules.

**Not executed:** cargo check/test (Rust toolchain unavailable), real market-server, native better-sqlite3/worker cache coherence after restart, actual EVE client buy, or any live server mutation. The updated inherited GameStore tests and new full server gate still must be run in complete checkout. Do not report fully working player purchases yet.

## Next acceptance sequence on isolated pinned EveJS

1. Apply COOP-034 Rust patch, then COOP-035 Rust patch **on a disposable exact pinned Code tree**. Run cargo check --locked and cargo test --locked; fix compile errors.
2. Start an isolated Rust market DB; assert pending invisibility, idempotent source reservation, unique buyer claim, no second buyer claim, blocked old Fill/Modify/Cancel, and idempotent finalize.
3. Start a disposable full GameStore with better-sqlite3 and persistence worker; prove all five native tables commit/rollback, postcommit character/corp/item cache read accuracy, lost COMMIT ACK, and restart.
4. With one NPC-owned manufactured stack and one funded human character, dock the player, query orderbook, buy exactly the full quantity, verify buyer hangar itemID and wallet debit, NPC corporation wallet credit, escrow removal, Rust filled status, unique receipt, and real client cache/notification behavior. Check replay and crash after each irreversible step.
5. Add partial-stack fills only with audited native itemID split allocation and ledger proofs, then remove supportsLiveSettlement:false and enable in an isolated game. Later re-enable the NPC economy scheduler only after the entire mine → haul → refine → industry → market cycle passes.

The code is not a substitute for these gates; no changes to main, running Docker, real market DB or evejs-data are authorized by this Draft.

## Post-review acceptance update (2026-10-25)

Three runtime blockers were fixed in the COOP-034/035 dependency chain:

1. SQLite registration: npcMarketFills was missing from the pinned GameStore SQLITE_TABLES list despite being in the atomic transaction allowlist. scripts/coop-npc-market-fills-table-patch.cjs now registers it through the reversible normal Node overlay. Never enable the corporate buyer while the durable receipt table is unregistered.
2. Rust final order proof: COOP-034 coop_npc_row now selects and returns native vol_remaining, which COOP-035 requires to be exactly zero before reporting a completed purchase. Both dependent branches carry the correction.
3. Buyer double debit: the optional marketProxy NPC branch now skips chargeBuyerWallet=false cases, where funds can have been previously reserved by native buy-order matching. Only direct whole-stack purchases are supported until a separate reserved-fund settlement is audited.

Current rebased branch verification: 19/19 isolated core+registry source contract tests, 21/21 client/Rust/account patch tests, 4/4 exact pinned upstream Rust apply/unapply (LF and CRLF), and 18/18 existing local COOP-032D SQLite baseline tests.

New tests/coop-npc-corporate-real-sqlite.test.mjs adds six scenarios using actual node:sqlite: whole-stack five-table commit, process-style SQLite connection restart, wallet rollback, lost Rust final ACK after COMMIT, wrong item custody and missing receipt table. This six-case file has NOT yet been executed against a full checkout here. The updated original GameStore regression suite, native better-sqlite3 worker, Rust cargo check and real market daemon/client purchase also remain unverified. Do not report a successful playable NPC market or enable any default-OFF flags until those gates pass.

PR #79 was rebased onto latest main and PR #88 was rebased onto the new #79. Both remain Draft; main, Docker, market data and evejs-data remain unchanged.
