# EveJS Stage J — Autonomous Native Salvage Economy

**Source implementation:** one consolidated PR replaces pending #146; Stage J earlier #139 (warehouse) and #142 (pending market) already merged in `main`.

**Acceptance status:** SOURCE-GATE PASS in isolated V8 test environment; full independent Node 22, real Rust compilation, real native SQLite and actual two-client EVE gameplay **NOT_RUN**. This document and PR do not claim a deployed or gameplay-verified economy. All new functionality remains **OFF by default**. Persistent `evejs-data` and running market untouched.

## The complete gameplay design — source path

1. Original native hauler cargo is lost, proven by an immutable `salvage-provenance` manifest and real native wreck receipt. A-Life NPC has legal loot rights; it physically approaches wreck and atomically transfers original `npcWreckItems` to its own real `npcCargo`. Existing player RESCUE escrow wins any race over NPC theft; two paid players can recover the original native cargo.
2. Existing NPC salvage station-delivery phase physically brings the same NPC to a valid station and **atomically debits its original NPC cargo** into one native `items` corporation-owned warehouse row. The original durable rival journal tracks the original wreck/cargo/owner/itemID. No duplicate stack.
3. The new `coopAlifeSalvageMarket` is invoked from **the existing 30-second A-Life tick** through `coopAlifeSalvageMarketRuntime`; it does not spawn another worker. It permits at most **one source action** per tick, requiring a visited system, native station, native NPC corporation, original source-delivered journal, and exact native warehouse item.
4. If **any unfinished market operation** exists, reconcile its original Rust operation and GameStore receipts before accepting a new sale. Otherwise request **real Rust `GetOrders`** for the exact native station, product and region. Reject seed/virtual price references, buyer self-dealing, malformed prices, mismatched stations and unsupported stock. Use the best authentic bid or a capped 1% improvement on an authentic native ask. If no original credible quote exists, the NPC **holds** its warehouse stock; no arbitrary seed income.
5. Use the existing `coopSalvageNpcPendingMarket` source authority: atomic one-shot `PREPARED` journal, idempotent Rust `ReserveNpcSellOrder` pending order, native `items` transfer to one `marketEscrow` in a SQLite transaction, Rust `ActivateNpcSellOrder` and independent `GetNpcSellOrder` readback. Require `source=coop-npc`, native escrow, original quantity and exact identity. A stock `PlaceOrder` is forbidden. This is now called automatically through A-Life *only when flags are explicitly enabled on a disposable test world*.
6. Real authenticated and docked buyer uses existing `coopNpcCorporateBuyRuntime` / `coopNpcCorporateSettlement`. Rust `ClaimNpcSellOrder` locks the full stack. One native atomic GameStore settlement debits the buyer, credits the real NPC corporate wallet (division 1000), moves the **same native item** to buyer, deletes original `marketEscrow`, writes unique `npcMarketFills`, and records `NATIVE_SALE_COMMITTED`. Original salvage marker, manifest IDs, native receipt, wallet, order, and duplicate source protection are checked inside the same native transaction. **No synthetic ISK or inventory.**
7. Rust `FinalizeNpcSellOrder` and `GetNpcSellClaim` independently attest the exact original buyer and `fillID`; only then mark `SOLD` with a durable journal. One sale has one real buyer debit, one corporate ISK credit and one native item transfer. Repeated claims after restart are idempotent.

## Recovery cases (automatic, fail closed)

| Durable GameStore phase | Native Rust proof | Action |
| --- | --- | --- |
| `PREPARED` | `pending` order with exact native source | Move original warehouse stock and create the one matching native market escrow atomically, then activate same pending Rust order |
| `PREPARED` | Rust RPC timeout, no reliable canonical proof | Hold and report `RECONCILIATION_REQUIRED`; **never** blindly Reserve again |
| `ESCROWED` | exact escrow item and Rust pending | Idempotently activate original order; read back before sealing `LISTED` |
| `ESCROWED` | exact escrow item and Rust open | Seal existing `LISTED` without another escrow debit or new order |
| `LISTED` | Rust open | Read-only valid listing; do not charge wallets |
| `LISTED` | Rust settling | Await native buyer's atomic settlement, do not pretend `SOLD` |
| `NATIVE_SALE_COMMITTED` | original native `npcMarketFills`, actual buyer-owned item, NPC wallet entry and Rust filled | Seal `SOLD` without a second payment |
| `NATIVE_SALE_COMMITTED` | original native receipt/payment verified, Rust still settling | Complete the same `FinalizeNpcSellOrder` with its **recorded** fillID, read back, seal `SOLD`; never repeat wallet settlement |
| `SOLD` | durable closed entry | Do not re-list or mint another item |

All unverified mismatches block additional market activity and expose observable failure state instead of bootstrapping new stock. Not every legacy/ambiguous Rust state can be automatically repaired safely: if Rust offers no trustworthy source record, the original is quarantined for operator reconciliation.

## Explicit opt-in (disposable test world only)

Both the existing economic and new Stage J gates must be set consistently:

```text
EVEJS_COOP_ALIFE=1
EVEJS_COOP_ALIFE_SALVAGE_RIVALS=1
EVEJS_COOP_ALIFE_SALVAGE_MARKET=1
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_SALVAGE_NATIVE_DEATH=1
EVEJS_COOP_SALVAGE_PROVENANCE=1
EVEJS_COOP_NATIVE_NPC_MARKET_PENDING=1
EVEJS_COOP_SALVAGE_NATIVE_MARKET=1
EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT=1
EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF=1
EVEJS_COOP_RUST_NPC_MARKET_PENDING=1
EVEJS_COOP_RUST_NPC_BUY_SETTLEMENT=1
EVEJS_COOP_RUST_NPC_SALVAGE_MARKET=1
```

Other existing native A-Life arbitration and market services must already be configured, reachable, and healthy. Never enable these flags on production before the acceptance gates below.

## Test evidence and acceptance

Source-backed isolated V8 execution (mock Rust RPC, single in-memory transactional store) passed **64/64** across six suites after consolidating #146 and previous Stage J tests: original native pending, recovery, real-price A-Life scheduler, simulated whole-chain, salvage wallet and pre-existing manufacturing wallet regressions. Further code improvements to strict Rust source verification were covered by another 64/64 replay. The full-chain simulated tests include **real quote → source-backed pending sale → escrow → native buyer/corp wallet → SOLD**, replay after settled ACK, lost ACK after finalized Rust and crash before Rust finalize. **These are simulation results, not real gameplay proof.**

New source files:
- `integration/coopAlifeSalvageMarket.cjs`: bounded A-Life decisions from native Rust book, recovery-before-sale
- `integration/coopAlifeSalvageMarketRuntime.cjs`: native GameStore, itemStore, corporation, station, Rust and immutable source-witness bindings
- `integration/coopSalvageNpcPendingMarket.cjs`: Rust/escrow source guard, provenance, durable recovery to SOLD
- `integration/coopNpcCorporateSettlement.cjs`, `rust/coop_npc_market_pending.rs`: original salvage-safe full-stack real wallet accounting, independently gated Rust namespace (consolidated from #146)
- `integration/coopVirtualWorldRuntime.cjs` and `scripts/patch-evejs-coop.cjs`: existing 30-second runtime and reversible pinned overlay registry
- `tests/coop-stage-j-full-economy-source-e2e.test.mjs`: whole-chain mock Rust+GameStore acceptance, replay and crash simulation

On isolated local checkout, run:

```powershell
node --test tests/coop-salvage-npc-native-pending-market.test.mjs tests/coop-salvage-native-market-recovery.test.mjs tests/coop-alife-salvage-native-market.test.mjs tests/coop-stage-j-full-economy-source-e2e.test.mjs tests/coop-salvage-native-corporate-market-settlement.test.mjs tests/coop-npc-corporate-settlement.test.mjs tests/coop-stage-j-auto-market-wiring.test.mjs
node scripts/coop-test-baseline.cjs
node scripts/patch-evejs-coop.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code --dry-run
```

Then manually dry-run and compile the separately pinned Rust market patches `scripts/coop-rust-npc-pending-patch.cjs` and `scripts/coop-rust-npc-settlement-patch.cjs`. Verify real `GetOrders`, `ReserveNpcSellOrder`, `ActivateNpcSellOrder`, `ClaimNpcSellOrder`, `FinalizeNpcSellOrder`, and `GetNpcSellClaim` on an isolated native Rust server. Test real SQLite/GameStore restart and two authenticated clients, and inspect actual balances and native inventory before/after. See `tests/scenarios/coop-stage-j-full-autonomous-economy.json` — scenarios **NOT_RUN**.

**No GitHub Actions** for Stage J; manual host-only acceptance. No host/world was modified during cloud-only work.

## Remaining proof boundary, not a new feature backlog

All three requested source-level slices (sale settlement, A-Life autonomy, crash/ACK reconciliation) are in this one PR. Stage J gameplay should only be declared ACCEPTED after real native Rust/SQLite and two-client E2E runs are signed off. Full-stack-only market purchases remain intentional (partial item splitting is not part of this P0). Existing NPC seller tax pricing policy is separate; corporate gross income is recorded, **taxes/broker fees are not modeled** by the existing whole-stack settlement and should not be described as net profit. Price strategy is bounded by actual Rust market orders rather than a fictitious market.

## Rollback

Disable Stage J flags, preserve persistent `evejs-data`, capture relevant Rust pending/fill and GameStore item/wallet receipts, then use the pinned reversible overlay/market patch tools on an authorized disposable deployment. Never reset native GameStore or silently clear an unresolved market operation.
