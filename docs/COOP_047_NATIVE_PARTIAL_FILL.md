# COOP-047 — native NPC partial market claim + atomic six-table split

**Status:** Draft implementation / native source contract, not yet built, deployed or enabled. Stacked on COOP-046 PR #109, COOP-045 PR #108 and COOP-044 PR #101. Pinned EveJS `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Keep all flags OFF and `evejs-data` untouched.

## Why the existing whole-stack protocol was not sufficient

COOP-035 Rust `coop_npc_sell_fills.order_id UNIQUE` and the GameStore `order\u001f...` idempotency receipt support **one full-stack buyer**, not a series of partial fills. A stock `quantity < vol_remaining` request must never be sent through it.

COOP-047 introduces **separate** `ClaimNpcPartialSell`, `GetNpcPartialClaim` and `FinalizeNpcPartialSell` RPCs. The original full-stack protocol, GameStore writer and player branch remain unchanged. Rust only exposes this extension after the explicit pinned reversible overlay. It uses `coop_npc_partial_claims`, with unique durable `claim_key` and per-fill ID in a separate 910T namespace.

## Implemented native transaction

`integration/coopNpcPartialFillAtomic.cjs` requires an exact Rust `SETTLING` claim with matching operation ID, fill ID, order ID, buyer ID, NPC owner, station, item, type, quantity and price. **Native GameStore** updates all six tables within the existing single `BEGIN IMMEDIATE` connection:

| Table | Change |
|---|---|
| `items` | Keeps source itemID in Rust order-specific escrow with reduced stack quantity. Creates new buyer itemID for strict partial fills, using the persisted native item allocator and high-watermark proof. For a terminal fill transfers the existing residual itemID, leaving no zero-quantity stack. |
| `identityState` | Advances `nextItemID` only for a new split item. |
| `marketEscrow` | Reduces remaining quantity; removes escrow only for final fill. |
| `characters` | Debits authenticated, docked buyer cash and appends a market transaction and wallet entry. |
| `corporationRuntime` | Credits original NPC seller corporate wallet division 1000 and appends a native receipt. |
| `npcMarketFills` | Records immutable `fill\u001f<fillID>` idempotency evidence, including before/after quantities, item IDs and ISK balances. |

GameStore rollback on any failed assertion prevents partial credits, item minting, or unique ID leaks. A lost Rust finalize ACK is handled by reusing the same durable claim key; GameStore recognizes the already-committed receipt and will not debit again. Rust partial finalize atomically reduces `market_orders.vol_remaining` and reopens the order if stock remains or marks it filled if stock reaches zero.

Unknown outcomes after a Rust claim remain `SETTLING` and invisible to other buyers until reconciliation; the system does **not** generate an alternate claim key automatically to bypass one.

### Important missing final bindings

- **No live RPC patch applied.** `scripts/coop-rust-npc-partial-patch.cjs` is manual, reversible and pinned. Apply COOP-034 and COOP-035 Rust overlays first on a disposable checkout, then dry-run/patch COOP-047.
- **No client runtime hook enabled.** The existing authenticated marketProxy still restricts COOP-035 to whole-stack buys. It deliberately does not pass a partial `claimKey` because its currently exposed request has no persisted per-attempt identity. A source-backed durable request journal and authenticated client-to-native handoff are needed before activation; never derive a claim ID from an untrusted client parameter alone.
- **No independent NPC-corporation BUY from player orders.** COOP-047 currently models **player buying partial stock from a verified NPC corporation**. `coopNpcMarketPolicy.cjs` remains a safe pure planner for *NPC purchasing* pending a separate native buyer wallet/escrow authority.
- **Do not infer cross-DB atomicity.** SQLite GameStore and Rust market each transact locally; the protocol uses durable claim/receipt/finalize and explicit reconciliation, not an impossible shared DB transaction.
- **Rust compilation and worker-native proofs still pending.** The JS and Rust code are not a verified live protocol until the source patch compiles in the pinned Rust daemon and the RPC responds correctly.

## Tests

- `tests/coop-npc-partial-fill-atomic.test.mjs`: **16/16 PASS** isolated exact-source JS with deterministic transaction rollback, lost ACK, final residual stack, replay and item allocator faults.
- `tests/coop-rust-npc-partial-patch.test.mjs`: **5/5 PASS** isolated reversible LF/CRLF Rust overlay checks.
- `tests/coop-npc-partial-real-sqlite.test.mjs`: **6 test cases added, not yet executed in this environment**; use Node with `node:sqlite` on the disposable checkout to test the actual six-table SQLite transaction.
- `tests/scenarios/coop-047-native-partial-market-e2e.json`: **7 gameplay/E2E acceptance scenarios, all NOT_RUN**; require real Rust daemon, native GameStore, authenticated buyers and before/after item/ISK ledger snapshots.

Run the full local unit gate:
```powershell
pwsh -File scripts/Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests
```

On a disposable pinned checkout with COOP-034/035 overlays installed, inspect the patch first:
```powershell
node scripts/coop-rust-npc-partial-patch.cjs --code-path C:\\Games\\EveCoop\\test-upstream\\Code --dry-run
```

The example `test-upstream` is intentionally a **disposable copy**, not an instruction to change the user's protected original EveJS Code tree. Recheck the exact pinned upstream SHA before any patch.

## Safety gate before enabling

1. Compile the actual pinned Rust market daemon, run cargo tests on a disposable market DB, verify RPC serde string-i64 contracts and `fillID` uniqueness.
2. Prove the original whole-stack COOP-035 and stock market orders are unaffected by COOP-047.
3. Run Node SQLite test and complete each E2E scenario including two concurrent buyers, lost ACK and restart across the Rust/GameStore boundary.
4. Implement trusted persisted claimKey lifecycle at the native authenticated player market entrypoint, then wire the guarded client branch as a separately reviewed patch. Keep new flag OFF until this passes.
5. Confirm strict physical and corporate wallet conservation over 100+ mixed partial/terminal fills before any main merge or Docker enablement.
