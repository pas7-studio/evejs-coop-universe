# EveJS Co-op — Native NPC Industrial Economy V1

**Status:** implementation-ready RFC; **NOT implemented / NOT deployed**. Authored against pinned EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` (2026-10-25).
**First real success:** an NPC-mined ore stack becomes manufactured **native ammunition**, is sold at a real station, bought by a real capsuleer, appears in that character's real hangar, and survives restart, without duplicate items or ISK.

## 1. Player experience first

- **Manifest:** starter industrial hub; finite stocked ammunition, starter fittings, repair/replacement modules; player sales can replenish factories.
- **Perimeter:** asteroid mining, physical haulers, refinery, basic minerals, ore scarcity, pirate risk, player escort jobs.
- **Jita:** competitive trade hub and reference prices; it is NOT magically populated with cargo from Perimeter until actual safe native station-to-station logistics are implemented.
- Players see **stockouts and recovery**: when NPC freighters die, upstream goods run out; a new haul, player sale or factory completion changes real inventory and market liquidity. Orders, price, output and costs are inspectable.
- NPC pilots have a real economic intent: miner earns from verifiable output, manufacturer pays materials/job fees, trader pays for goods, hauler carries real cargo, pirate may capture or destroy cargo. Narration/chat reads settled events only.

## 2. Source audit — what exists vs missing

| Native authority (pinned upstream) | Reuse | What is missing |
| --- | --- | --- |
| `space/npc/nativeNpcStore.js` | Real ore cargo item IDs on physical miners/haulers | Transfer into native **station itemStore**, not virtual depot totals |
| `inventory/itemStore.js` | Real owner/location/flag/quantity, `grantItemsToOwnerLocation`, `takeItemTypeFromOwnerLocation` | Custody settlement and receipt-aware idempotency spanning NPC cargo and items table |
| `services/reprocessing/reprocessingRuntime.js` | `buildReprocessingQuoteForItem`, `reprocessItems`, actual SDE yields and tax | The public operation derives station, character and wallet from an authenticated session; extract/reuse shared trusted core for NPC corp owner, not fake a player session |
| `services/industry/industryStaticData.js` | Actual blueprint definitions; native facility activities; `getBlueprintDefinitionByProductTypeID` | Valid real NPC-owned BPO/BPC and authorized facility owner |
| `services/industry/industryParityHelpers.js` | `buildIndustryActivityMaterials`, material efficiency, facility/time modifiers | Safe NPC quote input using native definitions, no duplicate formula implementation |
| `services/industry/industryRuntimeState.js` | `quoteIndustryJob`, `installIndustryJob`, `deliverIndustryJob`, existing native job status and real output | Both public operations use **character session permissions**; installation separately consumes materials, charges wallet, creates job, locks/moves blueprint; delivery grants output then marks DELIVERED. These are separate writes and NOT crash-atomic |
| `services/market/marketProxyService.js` + Rust daemon | Real `GetOrders`, player wallets, escrow, seed stock, hangar delivery and pricing | Independent NPC owner-wallet/escrow settlement, and safe inventory-to-seed market stock bridge |
| `integration/coopVirtualEconomy.cjs` | Non-authoritative strategy/demand hints only | Its initial goods and timer-generated ore are NEVER physical inventory or item production |

**Dependent workstreams, presently Draft at design time:** PR #20 (safe hauler custody), #25 (non-destructive Manifest starter stock), #27 (MarketGroups). They are **not** proof that live native industry or market acceptance passed. Recheck merges before coding.

## 3. One authoritative production chain

```text
physical asteroid --actual mining yield--> native miner cargo (cargoID)
    --same cargoID transfer--> real hauler cargo (cargoID)
    --verified unload receipt--> NPC corporation station warehouse (native itemStore itemID)
    --reprocessing quote, reserve and debit--> native mineral stacks (typeID + itemID)
    --native blueprint + facility + real costs--> native industry jobID
    --job READY + durable output settlement--> native product itemID at warehouse
    --escrow / market stock debit-once--> actual Rust sell order/seed row
    --real player Buy--> player wallet debited, native hangar credited
```

The virtual economy may **observe** committed native changes; it must never authorize a `grant*` call. A receipt in `coopNativeDepot.json` proves unloading history, not possession of native station inventory.

## 4. Industrial actors and ownership

- Define a named **real persisted NPC corporation/industrial owner ID** from existing native corporation records. Validate ID, active facility, wallet account and native warehouse location. Do not mint an arbitrary owner ID or impersonate a logged-in player.
- Bind `npcPilotID -> corporationID -> homeStationID -> real facilityIDs -> actual blueprintItemIDs`. Pilot name is identity/decision-making; corporation owns assets, job reservations and revenue.
- Workers: refinery operator, manufacturer, logistics dispatcher, warehouse manager, retailer. One corporation can employ several named physical pilots. No second in-memory NPC inventory source of truth.
- Blueprint originals/copies must be **real owned item instances** registered through native blueprint state; initial BPO acquisition/seed is a one-time, explicit, auditable starting asset, not recurrent generation.
- Dedicated **internal server principal** (validated type, owner, facility and specific operation capability) must authorize NPC-only manufacturing/refining. DO NOT construct a fake `session.characterID`, call user handlers with elevated debug roles or bypass player-access controls. Extract shared native quote/consume/produce primitives behind strict internal entrypoints and test the normal player path remains unchanged.
- All NPC job charges use a **real backed corporate budget** with tracked initial capital injection and sinks, not `credits=100` from `coopVirtualEconomy`. A job cannot start with insufficient material, blueprint, wallet, slots or facility access.

## 5. Native warehouse and refinery (dependency COOP-030 / COOP-031)

1. Dedicated storage at the **actual station ID**, `ownerID=validatedCorpID`, native `ITEM_FLAGS.HANGAR`; exact itemIDs/typeIDs/quantities in stock EveJS `items`.
2. Before removing NPC hauler cargo, journal the concrete `cargoID,typeID,qty,haulerID,stationID,corporationID,operationID` and target ownership. The current PR #20's two-phase virtual receipt is **not yet** the final station warehouse transfer.
3. Execute a custody state machine: `PREPARED -> SOURCE_DEBIT_PROVEN -> TARGET_CREDIT_PROVEN -> COMMITTED`; `UNKNOWN` blocks reuse. On crash, compare **native source cargo** and native destination item evidence by immutable operation ID / item metadata; never grant a second stack just because journal commit is missing.
4. For reprocessing, call the SAME pinned native yield/tax/pricing logic. Reserve exact existing ore itemIDs, output only configured real mineral typeIDs; calculate non-recoverable waste and charges. At every restart reconcile ore debit, mineral grants and fee before moving state.
5. Inventory invariant per batch: `inputOreQty = processedOreQty + returnedRemainderQty`; each mineral `createdQty = nativeQuotedYield` for its recipe; do not compare kilograms of minerals with integer ore units as if they were the same commodity. Ledger is **per typeID + provenance**, not one aggregate `goods` counter.
6. No market supply is increased by a PREPARED or unresolved warehouse/reprocessing event.

## 6. Manufacturing executor and job recovery (COOP-032)

A read-only director chooses jobs; a trusted executor alone mutates native state.

**Read-only director inputs:**
- authoritative corporation station inventory `ownerID/stationID/typeID/availableQty` less confirmed reservations;
- real BPO/BPC itemID and state; native production quote including material requirements, product outputs, native facility, system cost index, taxes and time;
- confirmed native industry jobs in READY/INSTALLED state and real unfilled sell inventory;
- demand measured from native market trades, open buy interest and actual ship/module destruction, never from virtual tick counters;
- solvent corporate wallet, concurrency cap, per-station budgets, freight risk.

**Director algorithm (deterministic):**
1. Calculate `targetStock` from a bounded demand window + minimum starter safety stock; subtract `availableForSale + verifiedWorkInProgress + reservedOutput`. Ignore unverified hauler arrivals.
2. Rank production by actual shortage, verified input availability, profit after job taxes and material opportunity costs, and strategic starter essentials. Stable tie-breaking by system/station/product/blueprint.
3. Choose **at most 2 jobs per station per planning interval**, respect real manufacturing slots, blueprint runs, cooldown, available wallet, station reserves and exact native recipe quantities. Reserve resources *between* selected jobs so two NPCs cannot spend the same mineral stack.
4. Revalidate native state immediately before execution (optimistic version/CAS or per-owner lock). The pure plan is NOT an authorization to mint.
5. A paused factory causes `NEEDS_MINERALS`, `NEEDS_WALLET`, `BLUEPRINT_BUSY` or `FACILITY_UNAVAILABLE` — not a replacement with free goods. Planner can request a real hauling job or publish player procurement opportunity.

**Executor lifecycle:**
`PROPOSED -> RESERVED -> INSTALL_REQUESTED -> NATIVE_JOB_CONFIRMED -> READY -> OUTPUT_DELIVERY_REQUESTED -> DELIVERED -> AVAILABLE_FOR_SALE`.
For every boundary store immutable `operationID,ownerID,blueprintItemID,materialItemIDs/nativeQuantities,jobID,facilityID,sourceVersions,outputItemIDs`. An uncertain native call becomes `UNKNOWN_REQUIRES_RECONCILIATION` and is never automatically repeated. Do not call `grantItemsToOwnerLocation` twice when stock already contains an output item; native job status must be cross-checked with actual item IDs. On server restart, rehydrate existing native jobs before scheduling new ones.

**Do not** lift client-side job install logic into an unaudited NPC script: native install currently debits materials before wallet charge, job persistence and blueprint lock; native delivery grants outputs before setting DELIVERED. Patch/adapter must explicitly eliminate or recover these intermediate failure states. Existing player manufacturing must retain its exact native API, constraints and output semantics.

## 7. What NPCs manufacture first

Read recipes from *actual* `industryBlueprints` and require `getBlueprintDefinitionByProductTypeID` success. No guessed recipe/type IDs.

| Priority | Product family | Player benefit | Prerequisite |
| --- | --- | --- | --- |
| V1-A | Basic T1 small ammo/charges (one real recipe) | Players can **buy ammo** locally; pirate fights consume it | Real mineral delivery and a valid native blueprint |
| V1-B | Low-tier fitting essentials (e.g. basic defense/propulsion) | Replace lost fittings without Jita travel | At least one additional verified native recipe |
| V1-C | One starter T1 frigate | Replacement after losing a ship | Full hull material bill, genuine BPO, cost and timer |
| V1-D | One T1 hauler | Logistics and industry fleet growth | Hull manufacturing + safe native item/cargo ownership |
| V2 | Diverse modules, drones, ships, advanced supply chains | Industrial specializations | Native material and financial audits first |

**Acceptance for first vertical slice:** a named NPC hauler actually unloads ore; a native station inventory stack is credited once; quoted refinery yields are stored as native mineral itemIDs; an NPC-owned real blueprint consumes those minerals and pays real job cost; its native job becomes READY; exactly one ammo output appears, is listed in a genuine order/seed bridge, purchased by a capsuleer with ISK debit, hangar grant, reduced sale stock and correct state after restart.

## 8. Market settlement: stock is NOT the same as inventory (COOP-033)

- The existing **seed market** is the first compatible retail bridge, not independent NPC-owned orders. PR #25 can add initial Manifest retail seed rows only after operator-approved offline backup and safe migration. Rust `AdjustSeedStock` cannot create a missing station/type row.
- Sellable NPC factory output is first **real native item inventory**, not `coopVirtualEconomy.goods`. Before increasing a seed sell quantity, reserve/debit the corresponding warehouse item quantity with an immutable `marketSupplyOperationID`.
- The Rust stock adjustment RPC is not idempotent by operation ID and is in a different persistence domain. Persist a transaction journal and reconcile actual market stock **and** original native items on timeout/restart; uncertain RPC -> BLOCKED, no blind repeat. Consider extending the Rust daemon with a transaction ID / escrow-backed NPC-owned order as the final preferred solution.
- Likewise NPC retail revenue must use the **actual recipient wallet/escrow**. A seeded market sell order may debit the player's wallet without crediting our NPC corporate wallet. Until revenue is implemented, don't pretend an NPC firm earned that ISK. Track such seed-market movements as temporary operator-backed market supply, separately from true NPC P&L.
- Do not replace or rebuild `market.sqlite`, clear player orders, pre-populate every recipe, or simulate a free purchase. Player sale/buy authority stays upstream native.
- Keep explicit baseline starter stock, real NPC production stock, imported stock, player-supplied stock and order escrow in separate **provenance classes**.

## 9. Supply, demand, and inter-system roles (COOP-034)

Actual system identities:
- **Manifest 30100032:** starter consumption + basic manufacturing + starter demand. Limited audited initial liquidity, then physical factory stock.
- **Perimeter 30000144:** native asteroid belts and miner/hauler output, minerals and industrial inputs; native station inventory required.
- **Jita 30000142:** existing mature seeded market, high volume, reference quotes.

No inter-system goods until physical cargo transition, native stargate travel, station deposit and cross-system custody are proven together. Virtual transfer only creates *intent*, never arrivals.

At station/type grain track:
`startNativeQty + actualAcquired + nativeCraftOutput + realImports - realSales - nativeCraftInputs - exported - destroyed = endNativeQty`;
reconciling by `ownerID,locationID,typeID,itemID,operationID`.
Use 1h/6h/day order activity plus confirmed player purchases and combat losses to estimate demand. **Do not adjust prices on every NPC AI tick.** Set bounded changes (proposed <= 5% price drift per in-game day, minimum valid sell/buy spread 15%, no price below audited costs absent funded subsidy); tune by client playtests. Scarcity may lead to procurement contracts and security missions instead of instant restock. Risk premiums are only real if safe-harbor/loss costs can be accounted for.

Loop examples:
- Actual pirate kills real ore hauler -> ore never reaches refinery -> ammo output decreases -> buy orders rise -> NPC trader/players get **escort/procurement** opportunity.
- Player mines/sells ore -> verified native station supply increases -> NPC factory schedules a job -> real shop receives ammo after job completion.
- Players destroy NPC ships -> ship replacement demand consumes real minerals/ISK; factories may prioritize modules/hulls over ammo, based on stock.
- Pirate escorts/patrols change measured loss rates; NPC decision planner can prefer safer routes, not spawn bonus resources.

## 10. Recovery, performance and security

- All NPC economic writes are server-internal, tenant/owner verified, default OFF behind `EVEJS_COOP_NPC_INDUSTRY=0`; never grant an ordinary client control of the privileged NPC owner. Keep existing `EVEJS_COOP_NATIVE_NPC_MARKET` OFF until native sale/buy evidence.
- Single writer or durable optimistic locks per `stationID/ownerID/typeID`; no `setInterval` per NPC. Process small fixed batch every ~60 s after existing world tick (planning only); native jobs follow **actual** wall-clock timestamps.
- Restart/offline catch-up **does not produce output by simulating elapsed ticks**. Only a saved real job reaching READY can yield product through exactly-once controlled delivery.
- Journal all `PREPARED/COMMITTED/UNKNOWN` transitions; never auto-clear a corrupt receipt, unknown market RPC or missing inventory. Read-only operator audit and a separate explicit repair workflow.
- Keep world/volume untouched during tests. Use disposable DB snapshots for interruptions at *every* step, including power loss after item debit, wallet debit, job insert, output grant, market adjustment, player sale and across two-client reconnect.
- Unit tests are not gameplay evidence. Live acceptance includes Rust order book, actual stock, native itemStore and wallet balances, two clients and at least one controlled restart, **without data loss**.

## 11. Agent execution graph / dependency order

| Task | Scope / committed acceptance gate | Prerequisite | Status |
| --- | --- | --- | --- |
| **COOP-030** | Native corporation warehouse: cargoID -> exactly-once real itemStore station item; immutable custody ledger, crash replay & read-only audit. Verify no duplicate on 4 interruption points | PR #20 source and real NPC cargo | TODO |
| **COOP-031** | NPC refinery: shared pinned native yield/tax, owner authorization, reserve/debit real ore, grant real mineral items once; no forged session | COOP-030 | BLOCKED |
| **COOP-032** | NPC manufacturing: real BPO/facility/budget/blueprint native quote, material debits, native jobID, READY/delivery, crash-safe journal; initially 1 ammo recipe | COOP-031 | BLOCKED |
| **COOP-033** | Factory-to-player market: audited warehouse -> reserved stock -> legitimate seed or NPC escrow sale, real wallet/market/hangar settlement | COOP-032 + PR #25 + PR #27 | BLOCKED |
| **COOP-034** | Demand planner and physical cross-system logistics: shortfall/sales/loss signals, safe NPC decisions, procurement/escort contracts, freight receipts, no virtual transfers | COOP-030/033 + native gate proofs | BLOCKED |
| **COOP-035** | Real player acceptance: shop, ammo, 2 clients, ISK balances, order consumption, NPC losses, 2 controlled restarts and full quantity provenance | COOP-030..034 | BLOCKED |

**Parallelism:** COOP-030 native custody and COOP-032 *pure read-only* blueprint/production planning can be developed concurrently; COOP-033 retail ledger model can be prototyped on disposable SQLite concurrently. **No native settlement or deployment** before its upstream dependencies pass.

## 12. Required repeatable tests (no GitHub Actions)

- Native authority: correct corp owner; wrong/synthetic owner rejected; BPO not silently created; facility permissions checked; no client spoofing.
- Material conservation: 1/2 ore stacks, partial batch, leftovers, refining waste, ME/TE, same mineral reserved by 2 concurrent NPCs, nonnegative real stock.
- State machine: fail after source debit, destination credit, fee, native job insert, blueprint lock, output grant, market stock change; detect `UNKNOWN` and never retry unsafe calls blindly.
- Economy: exhausted stock -> no output, market unseeded -> no order, bankrupt corporation -> no job, killed hauler -> no station delivery, no cargo means no job, player sells minerals -> legitimate new production.
- Two solar systems and cross-grid movement: No remote inventory without physical freight, no goods minted by offline time catch-up.
- Real EVE client: buy item, see in native hangar, equip/use ammunition; source stock and actual ISK change; relog and restart persist.
- Diagnostics: `npc-economy-audit` must report per-station stocked, reserved, WIP, produced, market-held, sold and unresolved quantities with type IDs and operation IDs. Any conservation mismatch is a blocker, never a green badge.

## 13. Definition of Done

**Phase A complete only when a real NPC ore cargo item is traceably deposited as real native station inventory.**
**Phase B complete only when a real NPC-owned job debits that inventory and generates native manufacturing output exactly once.**
**Phase C complete only when a real player buys the output via the native market, wallet and hangar are correct after restart.**
**Living economy complete only when real events drive stockouts, factory decisions and replenishment with positive/negative tests.**

No claims of production, stock, payout or game-client UI until evidence crosses the native runtime and two-client gates.