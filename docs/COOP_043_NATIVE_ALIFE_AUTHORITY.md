# COOP-043 — A-Life native station economy authority

**Status: implemented source-reader integration, default OFF.** This is the native data trust-boundary and PERCEIVE extension to merged COOP-042. It does not issue jobs, purchase items, place/cancel Rust orders, mint cargo, refund wallets, or start another scheduler. Do NOT claim player-facing full loop acceptance without isolated engine evidence.

## Runtime activation: observe-only

COOP-042 A-Life requirements:
- `EVEJS_COOP_VIRTUAL_WORLD=1`
- `EVEJS_COOP_ALIFE=1`
- `EVEJS_COOP_ALIFE_ECONOMY=1`

COOP-043 reader additional opt-in:
- `EVEJS_COOP_ALIFE_ECONOMY_AUTHORITY=1`
- `EVEJS_COOP_ALIFE_ECONOMY_PRODUCTS=[{"typeID":215,"targetStock":100}]` — an operator-configured **bounded target policy**, not a mint or an authoritative demand receipt. The type ID is an example, not evidence of local BPO/facility availability. At most eight type IDs and 50,000 units per product.

Run exclusively on a disposable local server until the pinned native Rust, GameStore and client tests are finished. Restart the process after changing product/authority configuration; observer factory instances are intentionally not hot-reloaded.

## Exact source-of-truth chain

`coopAlifeStationAuthorityRuntime.cjs` connects these pre-existing authoritative EveJS APIs:

| Evidence | Read source |
|---|---|
| NPC corporation identity, `isNPC` | `corporationState.getCorporationRecord` |
| Corporate wallet division 1000, exact ISK | `corporationRuntimeState.getCorporationRuntime` |
| Station ID, solar system and market region | `worldData.getStationByID` |
| Real facility and manufacturing activity | `industryStaticData.getFacilityPayloadByID` |
| Owned native minerals, ore, blueprint and manufactured item IDs | `itemStore.listOwnedItems` |
| Owner-scoped active and ready jobs | `gameStore.read("industryJobs", "/jobs")` |
| Corporate escrow rows | `gameStore.read("marketEscrow", "/")` |
| Physical escrowed output item | `itemStore.findItemById` |
| Original BPO custody and ME | `industryRuntimeState.getBlueprintState` |
| Manufacturing material quantities | `industryStaticData.getBlueprintDefinitionByProductTypeID` + `industryParityHelpers.buildIndustryActivityMaterials` |
| Actual public native market asks | Rust `marketDaemonClient.call("GetOrders", {region_id,type_id})` |
| Inventory mutation concurrency fence | `itemStore.getItemMutationVersion` |

For one authenticated native trader ship, the observer reads the **actual ownerID** from the native NPC entity store. Corporate wallet and stock values are attached to that **single pilot**, not to a shared station-level snapshot that another NPC could reuse. The A-Life decision gate verifies matching `ownerID`, `stationID`, `systemID` and valid positive corporation wallet before deriving a manufacturing intent.

Any missing, duplicated, negative, mismatched or stale ledger entry returns an explicit `NATIVE_...` blocker. Rust asks with `source=coop-npc` must match a corporate escrow record **and** the exact physical item ID, owner, type, quantity and order-specific escrow location. An invisible pending Rust order or orphaned escrow **cannot be counted** as sellable stock. During async Rust reads, the authority rechecks inventory mutation version, wallet balance, active jobs and escrow; a changed snapshot is rejected.

Material shortage is calculated from the genuine SDE quote against owned mineral items. Product shortage uses a capped configuration target minus verified hangar stock, verified own open Rust escrow asks and in-progress native manufacturing output. This is a **restocking planning signal**, not proof that a buyer or NPC consumed stock; certified consumption receipts and independent policy caps are the next stage.

## A-Life semantics and safety

- One existing A-Life 30-second tick; maximum four visited systems and eight distinct station/corporation read sets **globally** per tick. Shared station evidence is cached within the tick only. No new timer for economic scheduling.
- Rust read RPC uses a bounded 5-second timeout; failure leaves a named blocker rather than stale profit/stock claims. Read-only RPC completion cannot create duplicate items/ISK.
- Native survival, warp and accepted ship orders still preempt all economic intents.
- Manufacturing/listing/refining remain pure **intents**. A real ACT/SETTLE authority for those intents must use the existing durable COOP-032/033/034/035 mechanisms, not another NPC economic wallet or local market.
- Empty or missing corporate cash blocks manufacture; read-only projection never mints money or supplies.
- `supportsNativeMutation:false` stays unchanged, and all COOP-034/035 production mutation flags remain independent and gated.

## Test gate and scenarios

On a disposable local checkout:

```powershell
pwsh -File scripts/Run-Alife-Economy-Tests.ps1
```

The runner includes the previous COOP-042 unit suites plus:
`tests/coop-alife-station-authority.test.mjs`,
`tests/coop-alife-station-runtime.test.mjs`,
`tests/coop-alife-station-owner-isolation.test.mjs`,
`tests/coop-alife-station-wiring.test.mjs`.

The `tests/scenarios/alife-native-economy-e2e.json` pack has **28** independent, explicitly `NOT_RUN` local gameplay/engine scenarios. The original 22 cover mine → physical haul → refine → BPO industry job → native Rust escrow → human buy → consumption → finite reorder, concurrent buyers, restart/lost ACK and balance conservation. Six more cover foreign corporation ownership at the same station, orphan Rust order, orphan escrow, concurrent native inventory/ISK mutation during market reads, Rust timeout and invalid BPO/SDE quote.

Mandatory outstanding real acceptance: exact pinned Rust `cargo check --locked`/`cargo test --locked`, a fresh native `better-sqlite3` persistence worker, actual runtime read+write restart cases, two live clients, strict before/after owned-item and native corporate-wallet ledgers. These were **not run on the user's local server** in this turn.

## Next development

COOP-044 can add real demand receipt aggregation (native market fills and weapon ammo debits) plus an idempotent A-Life-to-native ACT dispatcher with a single durable operation/lease, recovering ambiguous outcomes rather than reissuing jobs/orders. Partial stack buys also require a separate native splitter with atomic ISK and escrow conservation.

No live `main`, Docker container, source market SQLite or `evejs-data` is modified by this branch.
