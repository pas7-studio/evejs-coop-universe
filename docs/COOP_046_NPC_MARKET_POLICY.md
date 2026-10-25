# COOP-046 — source-backed NPC market policy

**Draft / intent-only.** Stacked on COOP-045 PR #108. This module never writes GameStore, wallets, Rust orders, escrow or NPC inventory. No new timer or A-Life subsystem.

## Implemented pure policies

`integration/coopNpcMarketPolicy.cjs` exports:

- `planNpcNativePurchase`: exact NPC corporation and station, verified Rust asks and wallet, outstanding incoming/reserved stock, maximum spend and reserve. Selects an affordable **whole-stack** source-backed order and refuses self-trade, duplicate ask IDs, missing provenance, wallet underflow or purchases above target. Explicitly returns `NPC_BUY_PARTIAL_STACK_REQUIRES_ATOMIC_SPLITTER` for oversized stacks. It **does not** execute purchases.
- `suggestNativeAskPrice`: weighted median of genuine recent native fill receipts, real stock scarcity, bounded 24-hour response and floor above verified cost and fees. Refuses stale/missing, duplicate, unverified or unprofitable trade evidence. It **does not** change native orders.
- `decideNpcSolvency`: existing manufactured output and READY job settlement before new cash spending; wait for native Rust buyer if already listed; no grants, synthetic loans, free minerals, or wallet minting.
- `chooseNativeRegionalProduct`: uses region, station, owner, original BPO and facility proof plus genuine buyer volume and material, industry and freight costs to select the highest verified positive margin. No magic regional stock or synthetic demand.

## Native authority boundaries and prerequisites

**Important:** the existing COOP-035 Rust corporate sale only accepts a whole-stack player purchase. It does **not** provide general NPC-corporation buying from a player, nor an atomic partial stack splitter. The above functions are **policies, not functional NPC corporate market buys**. They must not be advertised to players until a proper native corporate buyer writer/settlement/receipt is created and accepted with real Rust + GameStore.

Local enabling of these policies alone **cannot** put new goods or ISK in a world. Keep live mutations default OFF. The only allowed ACT/SETTLE implementation must:
1. Verify native corporation wallet/cash reserve and a canonical Rust ask with an unmodified seller item/escrow.
2. Claim a unique idempotent fill in Rust; commit buyer debit, seller credit, item transfer and fill receipt atomically in GameStore; finalize Rust idempotently.
3. If partial stack is needed, split native item IDs and quantities inside the **same** atomic transaction and reconcile remaining Rust quantity/escrow.
4. Recover ambiguous Rust or GameStore outcomes without a second debit or item creation.
5. Reobserve native demand and available stock before starting another purchase, while A-Life retains the single tick and native order arbiter.

## Verification

**17/17 PASS** pure V8 policy regressions against exact current branch file.
`tests/coop-npc-market-policy.test.mjs` is included in
`scripts/Run-Alife-Economy-Tests.ps1`.
Six independent native acceptance scenarios in
`tests/scenarios/coop-046-market-policy-acceptance.json` remain **NOT_RUN** until real wallet, Rust market and two-client evidence is obtained.

Run on isolated pinned checkout:
```powershell
pwsh -File scripts/Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests
```

No Docker, `main`, game server startup or `evejs-data` modifications.
