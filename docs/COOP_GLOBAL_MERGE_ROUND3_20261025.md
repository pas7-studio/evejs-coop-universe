# EveJS Co-op — global merge round 3 (2026-10-25)

## Included

- PR #35: native MarketGroups now reads the **canonical published SDE itemTypes rows** via `readStaticRows` and accepts keyed/item ID data shapes; adds safe Manifest station-specific readiness inspection. Supersedes the old incorrect `readStaticTable` raw catalog contract.
- PR #34: native NPC warehouse primitive with **unique receipt-tagged itemStore stacks** and durable source-debit/target-credit fencing. There is **no trusted automatic station docking witness**, so this primitive is deliberately not called from the timer-driven hauler loop. It does not produce free player ore.
- PR #36: native NPC order arbitration and physically verified NPC controller/ship assignment. Original native raid eligibility remains authoritative. `EVEJS_COOP_NPC_ORDER_ARBITER=1` is explicit and default OFF.

## Conflict reconciliation

PR #36 adds 11 runtime hunks; all eleven matched uniquely in the post-round2 runtime, preserving existing NPC raid hunting, native hauler custody and World evidence. The installer now copies 72 unique overlay modules, uses 22 distinct pinned upstream source specs, and retains the existing native market, exploration, trade/custody, and warehouse hooks.

## Verified (source only)

- The **composed** upstream `server/src/services/inventory/itemStore.js` transform parses, is idempotent and round-trips byte-for-byte on pinned `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` including native trade and warehouse hooks.
- Integration tree contains all 72 named modules and 118 registered `tests/*.test.mjs` files. The local verifier automatically discovers new tests and still prohibits remote CI.
- Native MarketGroups adapter references `readStaticRows`, which is present in the pinned upstream service helper.

No local PowerShell, Node test execution, Docker container restart, native SQLite import, itemStore mutation or two-client gameplay was performed during this Git merge.

## Next acceptance

Run local manual regression and installer --check against a disposable pinned checkout. Market import must stay OFFLINE with explicit authorization and a backup; warehouse must await real native station arrival and owner/cargo proofs; NPC order arbiter needs actual physical controller collision/restart evidence before flag enablement.
