# COOP-033 — NPC native economy cycle, supply demand and conservation

**Implementation:** `integration/coopNpcNativeEconomyDirector.cjs` (manual synchronous coordinator). **No live server registration**, background tick, market mutation, automatic money mint or deployed factory. Feature flag `EVEJS_COOP_NATIVE_NPC_ECONOMY=1` defaults OFF; the export explicitly reports `supportsLiveRuntime:false`.

## One economy lifecycle

The director is a *compositor*, not a new wallet/inventory backend:

1. Read authoritative NPC corporation, native station, stock in its native hangar, native escrow orders, unfinished native manufacturing jobs, and certified native demand receipts. Reject snapshots that don't prove origin/ownership.
2. Use existing COOP-032A native-SDE manufacturing planner and bounded target inventories (including verified native ammo consumption over the previous 24 h, max 3x base and maxStock hard cap). Do not start when physical stock + owned escrow + unfinished native jobs covers target.
3. Persist a unique `npc-manufacture:<uuid-without-hyphens>` journal entry before any assets change. Require a canonical independent native manufacturing quote. Persist `INSTALL_UNKNOWN` *before* calling COOP-032E GameStore atomic installer; after confirmed job, verify native corporation's actual industry debit receipt.
4. Allow only genuine elapsed `INSTALLED → READY` with the original clock and required BPO custody (COOP-032F dependency). Then persist `DELIVERY_UNKNOWN` *before* native COOP-032C settlement. Verify actual job-owned native item, its itemID, owner, station and industry receipt; never issue an output stack directly.
5. Persist `LIST_UNKNOWN` before native market listing. An external native market adapter is required to durably escrow **that exact generated item** and return a real client-visible sell order with a source itemID and verified escrow. Reject synthetic seed orders or phantom market stock. The director does not create or alter market orders itself.
6. Observe real native order fills (including partial fills). Only declare sale complete if the original quantity equals remaining native escrow plus **unique native trade receipts**, and every revenue entry has a matching native corporation-wallet credit with exact money amount. Never credit a wallet from this module.
7. After actual sold-out inventory and the reorder cooldown, an NPC may plan the next run if verified current native stock still falls below its bounded target. Consumption receipts from native weapons/purchases raise target only within the cap; duplicate receiptIDs are rejected.

State flow: `PREPARED → INSTALL_UNKNOWN → INSTALLED → READY → DELIVERY_UNKNOWN → DELIVERED → LIST_UNKNOWN → LISTED → SOLD`. Unknown outcomes stay durable and block automatic retries after crash, ambiguous RPC response or failed native receipt verification. A human repair/reconciliation workflow must resolve these states; the module has **no force-retry or manual ISK/item creation API**. Stale lock files also fail closed.

## Boundaries and required production adapters

This PR implements and tests the orchestration and conservation decisions; the following concrete bindings remain **unimplemented and mandatory before activation**:

- The actual pinned `better-sqlite3` + GameStore worker/outbox gate from PR #54, then actual COOP-032E installer, COOP-032F readiness and COOP-032C delivery, using canonical SDE quotes and true NPC owner/facility validation.
- The **native player-visible market order and physical escrow adapter**. Current `coopNativeNpcMarket.cjs` supports buying/selling against **existing seeded Rust-market orders for physical NPC ship cargo**, not listing freshly manufactured station-hangar items in a new NPC order. It is not valid to substitute that mechanism for `market.listOnce` without explicit native stock custody.
- Native wallet debit and sale-credit receipts, transaction ID uniqueness, true character purchase acceptance, NPC ship ammo consumption integration (related open PRs #52, #55, #58, #62), and same-item stock visibility after a restart.
- A deliberate runtime scheduler with actual physical systems, station coverage, catch-up bounds, operator controls, and an environment-specific durable journal path. The existing coordinator is only a manually invoked `tick` and intentionally not deployed.

`native.getIndustryDebit` and `market.getWalletEntry` must read actual source-of-truth transactions, not emit `verifiedNative:true` based on a caller assertion. Tests use fake adapters **only in disposable temporary directories**.

## Test evidence

`node --test tests/coop-npc-native-economy-director.test.mjs`: **16/16 PASS** in local Node 22 isolated fixtures. Tests include first manufacturing cycle, native timer, physical output, partial and complete fills, finite ISK, repeated stock, consumption-driven demand, invalid/duplicate demand, duplicate sale transaction, invalid quote, missing debit/credit proof, wrong owner/station, restart after unknown-install/delivery, and corrupted journal.

Those tests do NOT execute the actual pinned EveJS driver, Rust daemon or EVE client. No Docker container, `evejs-data`, client database, seed market orders, live wallets, or `main` are mutated by this PR. No unsupported live claim.

## Next gates / acceptance

1. Real disposable GameStore `better-sqlite3` + worker restart test, fix until PASS; promote native job/quote/owner/item verifiers to actual production authorities.
2. Native Rust sell-order creation/custody integration with exact escrowed produced item and client-initiated purchase including both corporate ISK transfer and character inventory receipt. Add lost-RPC acknowledgement tests and restart recovery.
3. Integrate ship AI ammo depletion, buying against native real stock and material shortage feeds, register bounded scheduler and production stops on false inventory, lost job, price manipulation, zero/negative cash, duplicate receipts.
4. **Acceptance test:** mine native ore → native warehouse → native refinery → native mineral debit + corp ISK debit → BPO job → READY → exactly-one native output item → Rust market sell order → client buys → item in player hangar → NPC replenishes when native stock depletes. Check all native ledger balances before/after and restart.

Current scope is the first integrated control-plane slice, not a completed playable economy.
