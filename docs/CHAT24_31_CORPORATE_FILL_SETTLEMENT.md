# Chat 24 + 31 — Stage E2B3: Original Corporate Rust Claim and Native Atomic Full/Partial ISK Settlement

**October 26, 2026 — SOURCE IMPLEMENTED, LIVE_UNVERIFIED, NOT ENABLED.** This is not a playable market SELL. The original Rust corporate order publication remains **blocked**, and no Rust claim finalize/release has yet been implemented.

## Scope and reuse

This is the continuation of [E2B1](CHAT24_31_CORPORATE_SELL_ESCROW.md) and [E2B2](CHAT24_31_RUST_CORPORATE_SELL_PREPARE.md).

The existing EveJS personal market settlement is explicitly character-only (\`is_corp=false\`); copying it directly would mis-credit seller funds and corrupt corporate office custody. E2B3 uses the **same original native GameStore atomic row writer and Rust market database**, but with a separate corporation-specific claim/receipt namespace and no additional market scheduler.

### Original Rust claim

Extended \`rust/coop_corp_mining_sell.rs\` with a \`coop_corp_sell_fills\` SQLite claim table and private \`ClaimCorpFill\` / \`GetCorpFillClaim\` RPCs. The server-only secret token and the additional \`EVEJS_COOP_RUST_CORP_FILL_CLAIM\` gate are mandatory.

- Requires source \`coop-corporation\`, original **corporation-owned SELL**, original order state **open**, original preparation phase **published**, matching owner/price/station/type/volume, authenticated buyer and positive quantity bounded by remaining stock.
- Unique \`orderID+cycle\`; exactly one \`phase='claimed'\` claim per order, and cycles must advance consecutively.
- One native Rust SQLite transaction moves the order into exclusive \`state='settling'\`, inserts a source-bound claim and returns exact \`orderID,cycle,buyerCharacterID,sellerCorpID,cargoID,sourceItemID,priceCents,volumeBefore,quantity,volumeAfter,escrowLocationID\`.
- Retrying the **same** lost Rust claim returns the identical source claim; different buyer, quantity or price is rejected.
- **No Rust finalize/release yet.** Claims remain locked until a subsequent phase revalidates the committed GameStore receipt. Do not bypass this by calling regular stock \`FillOrder\`.

### Original GameStore atomic settlement

Added \`integration/coopPlayerMiningCorporateFillSettlement.cjs\`, default OFF behind \`EVEJS_COOP_PLAYER_NPC_MINING_CORP_FILL\`. Its \`readNativeClaim\` callback must come from the authorized Rust daemon, **never from client JSON**. The \`quoteNativeFees\` callback must return an independently trusted actual tax/fee breakdown; otherwise the module blocks.

One native atomic transaction spanning \`characters\`, \`corporationRuntime\`, \`items\`, \`marketEscrow\` and \`identityState\`:

1. Verify original \`ESCROW_BOUND_UNSETTLED\` / \`ACTIVE_SELL\` corporation-owned escrow, source \`cargoID\`, exact \`itemID\`, type, station, quantity, native order-specific escrow location, unchanged physical provenance, and a continuous original \`settledCycles\` / \`remainingQuantity\` chain.
2. Verify actual buyer character balance and original corporation seller Wallet Division 1000 and their native journals, plus actual fee quote.
3. Debit the **real buyer character balance** by \`quantity × unitPrice\`. Credit the original **seller corporation wallet** by \`gross - nativeTransactionTax - nativeBrokerFee\` with durable reciprocal wallet/transaction entries. Fee amounts cannot exceed gross; no estimated market price or fake ISK credit.
4. **Full sale:** transfer the same original itemID to the buyer's genuine station inventory, preserving \`sourceCargoID\` and \`sourceItemID\` provenance.
5. **Partial sale:** the same original itemID and cargo provenance remain in the original corporate escrow with reduced physical quantity; allocate a **new original native itemID** through \`identityState.nextItemID\` for the purchased portion, preserving source provenance. Never duplicate the \`coop-warehouse:v1:cargo:<ID>\` marker.
6. Persist source-linked \`coopPlayerMiningCorpFill\u001forderID:cycle\` \`GAMESTORE_COMMITTED\` receipt and update original escrow/source order quantities in the *same* transaction; verify/reuse the exact receipt when a fill is replayed. Unknown COMMIT result fences the order for operator reconciliation, never auto-retries.

Native \`coopPlayerMiningCorpFill\` receipts are registered in the reversible pinned \`sqliteStore.ROW_GROUPS.corporationRuntime\` mapping. There is no second wallet, item system or orderbook.

## Proof limits and remaining blockers

- **14/14** isolated in-memory native settlement tests PASS: one partial and subsequent full sale, same original itemID, conservation of ISK/ore, fees, duplicate Rust claim, tampered native receipt, out-of-sequence cycle, insufficient funds, unknown COMMIT and disabled flags.
- **14/14** patched Rust source/installer regression tests passed after one original publish-test scope correction; pinned Rust installer remains source-reversible and composes with existing NPC pending Rust patch.
- Original pinned SQLite row-group install/uninstall and \`explodeToRows/assembleFromRows\` source simulation PASS.
- **Actual Rust compiler/Cargo test, real SQLite fsync/crash/restart, physical original EveJS client and live Rust market settlement: NOT_RUN.**
- \`PublishCorpSell\` intentionally still refuses. This means actual Rust claims and corporate wallet writes **cannot be triggered from ordinary gameplay**. The Node settlement is a guarded implementation primitive, not an active market feature.

### E2B4 next — must happen before enabling SELL

1. Implement verified Rust \`FinalizeCorpFill\` and \`ReleaseCorpFill\` that **independently read the matching durable GameStore committed receipt** before decreasing original Rust volume and returning order to \`open\` (if unsold) / \`filled\` (if complete), with idempotent lost-ACK recovery.
2. Add a safe publication gate: Rust \`PublishCorpSell\` must require a matching, independently verified durable native escrow and an enabled, tested full settlement and claim/release pipeline. It must invalidate native order caches; do not set \`open\` solely because the escrow exists.
3. Define source-verified native taxes/broker fees, then wire server-authenticated market order commands, cancellation and partial return to the original real corporation office; finish a validated corporate P&L based on **actual completed fills only**.
4. On a disposable pinned checkout, run full Node/SQLite/Rust manual tests and two authenticated EveJS clients, kill/restart every claimed/committed/finalized edge, audit original itemID/quantity plus wallet conservation and complete source overlay \`--check\`.
5. Reconcile PR #287 with current main and repeat all tests. **No GitHub CI or automatic deployment.**

**Do not enable the corporate market economy on an existing world.**
