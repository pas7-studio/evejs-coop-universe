# COOP-031 — Native NPC refinery, source-grounded V1

**Status:** proposed implementation, disabled by default; runtime not deployed or gameplay-verified. Pinned EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Why this is real and not a virtual NPC factory

A tagged native station ore stack (`coop-warehouse:v1:cargo:<cargoID>`) created by PR #34 is the **only** accepted input. The refinery reads this stack from the authoritative EveJS `itemStore`, looks up its real NPC corporation and SDE-backed station and calls upstream `reprocessingRuntime.buildReprocessingQuoteForItem` directly. Quote uses actual native ore type materials, portions, efficiency and tax, with a zero-skill/zero-standing, non-impersonated internal NPC context. No second ore/mineral ledger grants inventory.

An internal-only L1 itemStore method atomically updates the input ore stack and creates separately tagged mineral items with real native item IDs in **one `items` table write** and synchronously calls `GameStore.flushTableSync('items')`. Mineral quantities come exclusively from the validated upstream quote's `recoverables[].client`; input consumed `quantityToProcess` plus remaining ore `leftOvers` is exactly the original native input quantity. Unknown material IDs, negative/oversized yields, randomized-only recipes, duplicate mineral types, missing or disputed warehouse source, stale/unauthorized corp or disabled station are hard blocked.

The operation key is `coop-refine:v1:<oreItemID>:<sourceQuantity>`. Its receipt is fsynced before mutation. Mineral stacks have exact `customInfo` `coop-refine:v1:<oreItemID>:<sourceQuantity>:mineral:<materialTypeID>` and are deliberately not merged with other owners' or NPC's stock. The receipt is `PREPARED` until a synchronous SQLite flush and independent native item verification, then `COMMITTED`. After a crash with unknown flush, **never blindly retry the mutation**: operator `reconcile(..., {authorize:true})` checks native source remainder and all tagged mineral stacks and may complete the journal only when all native evidence matches. If evidence is partial or missing it remains blocked for reconciliation. In-process double-run is blocked; an already-completed durable operation can be queried by its operationID.

## Owner, permissions and ISK constraints

`coopNpcRefineryRuntime.cjs` is an **internal server adapter only**, not a client RPC or fake character session. It resolves actual corporation records from `corporationState`, verifies `isNpcCorporationID`, looks up a real station through `worldData`, validates native reprocessing facility service 8192 and never constructs a logged-in character. Requires `EVEJS_COOP_NPC_REFINERY=1` and an absolute `EVEJS_COOP_NPC_REFINERY_DIR`. The feature has **no periodic tick or auto-processing**: a trusted, future NPC production director must explicitly call it.

Upstream charges **player wallet ISK** for `totalISKCost > 0` and handles some structure taxes. NPC corporation escrow/payment atomicity is not yet implemented. Therefore V1 **only allows real native quotes with exactly 0 ISK cost**; all positive-cost jobs hard-block with `NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED`. Do NOT zero the native tax, fake wallet balance, or call public `reprocessItems` with a forged player session. Real corporate debit, tax recipient, journal and recovery must be implemented before enabling paid refining. For station fee/tax >0 and zero rounded native charge, underlying quote still determines yield; no operator override is applied.

### Dependency on physical delivery

PR #40 physical station arrival remains a separate, disabled-by-default source-gated route until actual operator acceptance. This refinery cannot transform virtual depot totals, mined-yet-undelivered cargo or an untagged player item. It does not automatically run when PR #40 settles a delivery.

### Remaining risks and gates

- Not yet exercised against a running EveJS SQLite/GameStore, real station refinery, full NPC-owned corp capital or two EVE clients; source-level pinned patch compatibility and disposable test fixtures alone are not proof of live success.
- The GameStore `items` table write is single-table atomic only; the external receipt is a separate durability domain, reconciled fail-closed. Full power-loss and SQLite journal replay on an isolated production-shaped volume still required.
- A prepared receipt whose mutation was not durably recorded requires operator investigation. No blind repeated grants.
- This PR does NOT schedule autonomous refinery jobs, manufacture ammunition, change market inventory or balance NPC wallets.
- Full production chain follows COOP-032 (native BPO, production job) and COOP-033 (warehouse -> market), with native receipts and validated positive-cost ISK settlement first.

## Repeatable local tests

Run `node --test tests/coop-npc-refinery.test.mjs`, then the pinned overlay check and actual module-source tests. Test scenarios: one 100-unit tagged native ore stack quoted as 90 used +10 leftovers -> exact typed native minerals; double call; restart; corrupted receipt; missing station/corp; fee; write and SQLite flush fault; unknown output; no unintended player items; no opening client endpoint.

Deployment/operation remains **OFF** until PR #40, native warehouse, isolated-volume fault injection and actual client purchase proof are accepted. Never reset `evejs-data` or seed missing inventory as a workaround.