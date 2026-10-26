# Chat 24 + 31 — Stage E2B4: Original Corporate Rust Finalize / Release after Durable GameStore Settlement

**Status: source implemented in Draft PR #287; flags default OFF; no live corporate market trades, no original Rust compilation or real SQLite E2E.** Pinned original EveJS: \`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f\`.

## Why the native Rust lifecycle needs two post-commit phases

E2B3 introduced original Rust \`ClaimCorpFill\` with an exclusive \`open → settling\` lock and a native GameStore atomic COMMIT for:
- character buyer ISK debit;
- genuine corporation Wallet Division 1000 gross credit plus native fee/tax debit;
- physical same-item provenance for the sold quantity (partial fill keeps the source itemID in escrow and gives buyer a newly allocated genuine native itemID);
- immutable GameStore \`coopPlayerMiningCorpFill\u001forderID:cycle\` receipt.

A Rust order must **not** be reduced/released solely because a Node client says a COMMIT succeeded. Losing the GameStore ACK may be ambiguous; the original authority remains the committed SQLite source. Conversely, GameStore must never replay a paid fill after Rust already finalized it.

## E2B4 changes

### Native GameStore durable witness (Node)

\`integration/coopPlayerMiningCorporateFillSettlement.cjs\` now includes \`buyerJournalID\`, \`sellerJournalID\` and \`feeJournalID\` in the immutable, replay-checked original \`GAMESTORE_COMMITTED\` receipt. These IDs refer to exact original character and corporate wallet journal/transaction entries, not a guessed current balance.

### Original Rust read-only receipt audit

\`rust/coop_corp_mining_sell.rs\` now reads the original GameStore **read-only SQLite connection** and checks all of:
- exact Rust order, original corporation, buyer character, cargo ID, source item ID, cycle and volume before/after;
- the original \`coopPlayerMiningCorpFill\u001forderID:cycle\` receipt, gross/net/fee cents, durable timestamp and journal IDs;
- original \`characters[buyerID]\` buyer walletJournal debit and amount/balance witness;
- original \`corporationRuntime.corporations\u001fCorpID\` corporate Wallet Division 1000 revenue and tax/fee entries in **journal and transactions**, with exact source receipt references;
- original \`marketEscrow[orderID]\`, \`coopPlayerMiningCorpSell\u001fcargoID\` remaining quantity and settled cycle;
- actual \`items[deliveredItemID]\` title, station, quantity and source IDs;
- on partial fill, original source \`itemID\` still in the corporation's native escrow with the exact remaining amount and untouched cargo provenance marker; on full fill, original itemID owned by the buyer.

No source row, journal, amount, quantity or provenance may be substituted by client-supplied success flags. This is a **read-only source witness**; it cannot mint ISK or items.

### \`FinalizeCorpFill\`

- Requires original Rust authenticated server-only token + the separate Rust claim flag; exact claimed \`orderID+cycle\`.
- Validates Rust order still exclusively \`settling\` and original claim volume/price unchanged.
- Independently audits the original GameStore transaction above.
- In **one Rust SQLite transaction**, reduces \`market_orders.vol_remaining\` through a compare-and-swap on the original locked volume and stores a \`phase='finalized'\` original \`ack_json\`, receipt key and the immutable original claim proof. **Does not reopen the order.**
- Repeated finalize reads stored Rust ACK without another volume debit. Unknown ACK remains operator-recoverable from the private Rust claims table.

### \`ReleaseCorpFill\`

- Requires existing \`phase='finalized'\` and matching persisted Rust ACK/key.
- **Re-runs the full original GameStore physical item, buyer debit, seller corp credit and native-fee audit**, not merely receipt existence.
- In one Rust transaction, opens \`market_orders.state='open'\` only if original \`volume_after > 0\`; otherwise marks \`filled\`, then marks the claim \`released\` with durable ACK. Repeated release is idempotent.
- The original Rust MarketRuntime invalidates affected scope caches and refreshes region summaries after finalize/release, mirroring the existing native P2P cache handling.

### \`GetCorpFillClaim\` restart recovery

Read-only private RPC now reports \`claimed\`, \`finalized\`, and \`released\` states. The latter two must include the original stored ACK/receipt key and source order/cycle, making recovery checks possible after loss of a Rust RPC reply without repeating the buyer debit.

### Trusted Node lifecycle

\`integration/coopPlayerMiningCorporateFillLifecycle.cjs\` orchestrates:

\`\`\`text
read original server-attested match (not client parameters)
    -> ClaimCorpFill
    -> GetCorpFillClaim (verify same original source claims)
    -> original atomic GameStore characters+corporationRuntime+items+marketEscrow+identityState COMMIT
    -> FinalizeCorpFill (Rust independently audits actual original SQLite)
    -> ReleaseCorpFill (Rust independently re-audits, then publishes remaining volume internally)
\`\`\`

The lifecycle is disabled by default behind \`EVEJS_COOP_PLAYER_NPC_MINING_CORP_FILL_LIFECYCLE\`. It has **no public route, no game client action and no standalone market timer**. If any RPC ACK or original COMMIT is uncertain, automatic retries stop. A recovery operator must compare original Rust claim phase and GameStore receipts; do not silently issue another SELL/ISK movement.

**This does not enable corporate market trading:** \`PublishCorpSell\` remains deliberately fail-closed with \`CORP_SELL_NATIVE_FILL_SETTLEMENT_NOT_IMPLEMENTED\` until the full original buyer execution / trusted matching / corporate fee source and restart tests exist. Accordingly, this source-only lifecycle is testable with isolated witnesses, but is not reachable through the current in-game corporate market.

## Proof gates executed

| Check | Evidence |
| --- | --- |
| Rust E2B2/E2B3/E2B4 source/patch regression tests | 20/20 isolated JS source-level PASS |
| Original native GameStore partial/full settlement and journal receipt tests | 14/14 isolated JS PASS |
| End-to-end *orchestration* using isolated Rust and GameStore interface mocks | 11/11 isolated JS PASS |
| E2B1 original corporate escrow regressions | 20/20 isolated JS PASS |
| E2B2 original Rust prepare / escrow bridge regressions | 9/9 isolated JS PASS |
| E2A original corporate cash-cost audit regressions | 15/15 isolated JS PASS |
| Pinned original Rust state.rs/rpc.rs patch | Idempotent, byte-exact reverse, CRLF roundtrip PASS |
| Pinned original sqliteStore.js corporate fill row group | \`explodeToRows / assembleFromRows\` roundtrip + reverse patch PASS |

**Total 89/89 isolated tests PASS.** These are **NOT** compiled Cargo tests, native SQLite transaction/restart tests, or two real EveJS client E2E. Rust toolchain and external pinned server are not installed in the current execution runtime. No remote CI or deployment was triggered.

## Remaining blockers before playable corporate SELL and profit

1. Add a genuine original orderbook **buyer match authority**; the lifecycle currently requires an externally injected, verified source match and trusted native tax/broker fee quote. No client may dictate volume, price or ownership.
2. Complete guarded \`PublishCorpSell\` with the necessary enabled and tested original Rust claim/settlement lifecycle, original GameStore escrow COMMIT and full market cache consistency; keep release of live fills protected from unmatched stock market paths.
3. Add original order cancellation/expiry and **partial unsold** corporate office return using verified remaining stock and last settled cycle, with no shadow ore split or tax leakage.
4. Run native \`cargo test\` + pinned Node/SQLite, restart and lost-ACK E2E (claim, GameStore COMMIT, finalize, release); prove no double-spend/cargo creation and no half-open executable order.
5. Two real authenticated clients, an actual original native sell and buyer fill, corporate wallet/fee reconciliation, and realized P&L minus real payroll and ore purchase costs.
6. Resolve PR #287 conflicts with the current fast-moving \`main\`, rerun all tests and complete the explicit project release gates before merging.

**Do not activate any original corporate-market economy flags on a preserved world.**
