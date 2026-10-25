# Living Universe: Unified A-Life Architecture

Date: 2026-10-26. Status: DESIGN ONLY. No code/runtime flags, main branch, Docker, market, private game data or client modified.

## Decision

Unify the existing Living Universe modules into **one native-evidence-driven world simulation**. Do not introduce a second EveJS server, economy, item database, market, wallet, scheduler, client window or speculative NPC asset generator. Preserve the pinned reversible overlay policy in docs/DEVELOPMENT_DOCTRINE.md.

## Audit: what already exists

| Domain | Current owners | Integration need |
| --- | --- | --- |
| Persistent NPC / physical scene | coopVirtualWorld, coopIdentityRegistry, coopNpcLife, coopNpcMaterializer, nativeNpcStore | stable identity, physical vs off-grid reconciliation |
| NPC decisions / native orders | coopNpcPersonalGoals, coopNpcHuntPolicy, coopNpcOrderArbiter, coopNpcOrderBridge | one priority and ship lease |
| Mining / haul / cargo | original native mining, coopNativeHaulCargo, coopNativeStationArrival, coopNativeWarehouse, ALIFE-07 through ALIFE-12 | crash-safe source provenance |
| Industry | coopNpcManufacturingPlanner, coopNpcNativeEconomyDirector, coopNpcRefinery, original BPO/job records | dispatch real shortage-driven work |
| Market / ISK | native GameStore + Rust market, coopNpcBuyerCoordinator, coopNpcCorporateSettlement, corp escrow | durable original wallet and items only |
| Combat / piracy / salvage | coopNpcSquadDirector, coopNpcAmmoSupply, coopNpcWeaponAmmoGate, coopSalvageNpcRivals, coopRescueNativeGame | physical loss / consumption -> demand |
| Player opportunities | coopWorldOpportunityBoard, coopNpcJobBoard, coopNativeJobAgent, coopNativeJobNotifications, coopEscortPricedOffers | one typed read model over original contracts |
| NPC memory / faction consequences | coopNpcMemory, coopNpcRecognition, coopFactionDirector, coopEscortReputation | common verified consequence feed |
| Observability | coopRuntimeProbe, coopAlifeNews, native evidence receipts, gameplay testing | one evidence trail and release gates |

## Confirmed architectural gaps in reviewed main

1. integration/coopVirtualWorldRuntime.cjs is approximately 2,400 lines. It already owns a 30-second world timer plus a separate read-only 5-second combat evidence sampler. Split coordination responsibilities without adding timers or changing behavior implicitly.
2. The A-Life read-only economic observer, station authority and BUY_SUPPLIES buyer are connected, but this world runtime does not invoke coopAlifeNativeEconomyAct or coopNpcNativeEconomyDirector for MANUFACTURE / COMPLETE_JOB / LIST_OUTPUT. coopAlifeNativeEconomyAct declares supportsLiveRuntime:false. The separate coopNpcEconomyScheduler has an explicit timer; never start it alongside the unified driver.
3. coopVirtualEconomy contains bounded virtual ore/goods/credits/demand while native ItemStore/GameStore/Rust has real ore, items and ISK. The virtual state is a nonspendable strategic forecast. It must not become a second native stock or corporate-wallet authority.
4. coopWorldOpportunityBoard has canonical RAID and CONVOY event records, while Rescue and Salvage expose additional command-specific interfaces. Native SDE agent dialogue + EVEmail cover verified eligible paid convoys only; the actual EVE client UX is not yet proved. The single opportunity model is currently missing.
5. Various original finance and cargo operations have their own journals and recovery; they must stay authoritative, but startup must reconcile pending original operations before a new mining or paid job. Issue #148 is the known ALIFE-13 cold-restart cargo gap.
6. scripts/patch-evejs-coop.cjs has one registered integration module list (171 in the inspected main); PR #151 already fixed 30 orphaned modules. Module-registration and reversible-install roundtrip are mandatory per PR.
7. At audit time open PRs #154 (Escort cargo route recovery), #156 (Node/SQLite+Rust gate and operator recovery), #158 (peaceful Escort exact-once payout). These must be reconciled sequentially on current main, with checks. Their source tests are not two-client gameplay proof.
8. state/NOW.md was published from older project revision da549fd2, so it is not release evidence for the latest merged or pending branches.

## Target runtime: one scheduler, many authorities

LivingWorldRuntime (existing 30s tick)
  -> NativeWorldSensors (bounded, owner/system/station/actor provenance)
  -> WorldDecisionCoordinator (goals, survival, resource shortages, priority)
  -> NativeIntentArbiter (actor + station/corp/resource leases)
  -> DomainExecutors (existing mining, hauling, combat, refining, industry, market, escort, salvage)
  -> OutcomeReconciler (original journal + native receipt + Rust claims)
  -> VerifiedWorldEventRegistry (source-backed opportunities and history)
  -> PlayerExperienceGateway (native agent, EVEmail, verified native client controls)
  -> NPC/Corporation Feedback (persistent identity, standings, history, threat, demand)

The separate 5s combat sampler remains observational. Native EveJS/GameStore/ItemStore/Rust remain the sole mutation authorities. Each external executor is an adapter around original authoritative receipts and transactions.

## Common domain contracts

### Intent: a plan, never an execution receipt
Required: intentID, tickID, observedAt, expiresAt, original pilotID/entityID/ownerID/systemID/stationID, stage, priority, proofRefs, resourceLeaseKey and explicit NATIVE_READ_ONLY marker.

### Operation: original native act with replay protection
Required: durable stable operationID, native source identity, original cargo/item/ship/order/contract identifiers, corp and station, exact quoted amount, executor owner, expected native receipts and quarantine reason. Common stage projection: ELIGIBLE -> RESERVED -> EXECUTING -> VERIFYING -> SETTLED, with OUTCOME_UNKNOWN / REPAIR_REQUIRED holds. Do not replace or migrate the executor's authoritative original wallet/escrow/journal rows.

### Opportunity: player-facing read model, not a new wallet
Required: opportunityID, sourceEventID, type, original native actor/corporation, system/station/site, stage, expiry, evidenceRefs, eligibility, genuine quote, native funding state, player consent and progress. Kinds: RAID, CONVOY_ESCORT, MINER_GUARD, COURIER, SALVAGE, RESCUE, SUPPLY, PATROL. Unsupported kinds remain absent/unpaid until genuine original native evidence exists.

Lifecycle: VERIFIED_SOURCE -> DISCOVERABLE -> ACCEPTING -> FUNDED -> ACTIVE -> DELIVERED/LOST -> SETTLED/REFUNDED -> HISTORY. QUOTED is not FUNDED; interest is not acceptance; a mail notification is not a mission journal row. Every lifecycle transition is grounded in the original authoritative transaction or observation.

## Scheduling and conflict policy

Ship priority:
1. Survival, native combat and safety;
2. Paid committed escort / rescue and human-approved fleet orders;
3. In-flight route, warp, cargo delivery and recovery;
4. Ammo/supply emergencies;
5. Ordinary mining, trading, scouting and patrols;
6. Idle persistent personal goals.

Corporation/station priority:
1. Reconcile uncertain prior source-cargo/ISK/Rust operations before new ones;
2. Complete existing READY jobs, list already-manufactured stock, even if wallet is exactly zero;
3. Read measured native fills/ammo consumption, compute bounded shortages;
4. Haul/refine or native-buy real materials;
5. Install new jobs only with proven BPO, station facility, funds and physical minerals;
6. Complete physical market sale/settlement and feed verified outcome back into demand.

At most one actor order and one financial writer per owner/station/resource. Recheck actor, corp, stock, control, wallet and station after each awaited RPC. Never infer success from a timeout or retry a possibly committed write with a different operation ID.

## Virtual and physical world boundary

Persist identity, planned goals and strategic pressure off-grid. Observe original real ships only within materialized systems, with bounded headless background scenes. A virtual forecast can influence *where* an NPC chooses to fly or what genuine resource to investigate; it cannot mint ore, ships, blueprints, loaded ammo, market orders or ISK. Transition from virtual to native must revalidate exact identity, owner, cargo, system and any original committed warp. Destroyed native ships never reappear from a timer without verified native spawn rules.

## Player UX

Provide a single logical Jobs and Opportunities feed, grouped by nearby paid work, urgent rescue, trading/supply opportunities, and active co-op operations. Prefer original stock Agent conversation for a genuine same-corp SDE agent, EVEmail for subscribed notices, stock fleet/market/contract screens wherever genuinely supported; keep chat commands only as explicit compatibility/debug fallback. Do NOT promise a new client Agency panel or mission journal until pinned-client protocol is verified.

Show states honestly: OBSERVED, QUOTED, FUNDED, ACCEPTING SECOND PILOT, IN PROGRESS, VERIFIED DELIVERED, PAYOUT PENDING, PAID, REFUNDED, CANCELLED and NEEDS OPERATOR REPAIR. History and reputation come only from source-backed damage, pickup, delivery and wallet receipts.

## Implementation PR sequence

- LW-01 (this document): frozen inventory, trust boundaries, release invariant list.
- LW-02 (P0): issue #148 startup cargo reconciliation; coordinate existing #154, #156, #158 against latest main. No activation on persistent world before real gates.
- LW-03 (P0): extract existing 30s runtime phase registry and bounded orchestration without behavioral change, preserve arbiter and installed modules.
- LW-04 (P0): connect A-Life MANUFACTURE/COMPLETE_JOB/LIST_OUTPUT intents to existing native economy director with durable per-owner/station claim. Ban parallel legacy scheduler in unified mode. Native demand/cargo/ISK only.
- LW-05 (P1): shared source-backed Opportunity projection and supported Agent + EVEmail adapters; no new wallet/escrow executor.
- LW-06 (P1): real miner guard shift (#105) and incremental native courier, salvage, rescue, supply work (#106), each own original source/consent/fund/deliver/settle evidence.
- LW-07 (P1/P2): NPC memory, faction strategic response, native economy/loot losses and verified career reputation feedback.
- LW-08 (release): complete local disposable Node/SQLite/Rust + fault injection + genuine two-client visual and wallet/cargo E2E, then selectively enable flags.

## Definition of done / acceptance

1. One named NPC retains native ship/cargo/route identity across login, scene movement, death and cold restart, and both clients see consistent outcomes.
2. Mine -> physical haul -> native warehouse -> refinery -> BPO manufacturing -> native Rust order -> real player/NPC buy -> ammo consumption -> finite replenish runs twice with exact original item, cargo, job, order, wallet and fill receipts.
3. Concurrent NPCs cannot command one hull or spend one corporate balance twice. Survival overrides normal economics. PAUSED/DELIVERED jobs and zero-ISK stock listing never deadlock.
4. Original paid convoy visible in client, separate two-player voluntary native consent, funded prewarp escrow, real physical route, delivery, exact-once character wallet payout/refund even across lost ACK/restart; no AFK or fabricated service.
5. Rescue/Salvage preserve sourceCargoID and original wreck item custody under player/NPC competition; no duplicate reward or item.
6. Rust, GameStore and native cargo uncertain states are reconciled or quarantined, never replayed as fresh work. Test crash before/after each relevant COMMIT and lost ACK.
7. All new overlay hooks reversible, integration modules registered, baseline and original pinned Node/SQLite/Rust gates green; real two-client scenarios separately marked PASS/FAIL/NOT_RUN, not promoted from mocks.
8. No unapproved production-world/Docker/evejs-data/client writes; all new financially mutating flags default OFF.

## Source references

README.md; docs/DEVELOPMENT_DOCTRINE.md; docs/GAMEPLAY_TESTING.md; state/NOW.md; docs/COOP_042_ALIFE_NATIVE_ECONOMY.md; docs/COOP_043_NATIVE_ALIFE_AUTHORITY.md; docs/COOP_044_NATIVE_ECONOMY_LOOP_AUDIT.md; docs/COOP_NATIVE_NPC_AGENT_UX_V1.md; docs/COOP_STAGE_J_FULL_AUTONOMOUS_ECONOMY.md; docs/ALIFE12_NATIVE_STATION_TRIP_CRASH_RECOVERY.md. PRs #72, #81, #94, #98, #101, #102, #118, #120, #137, #141, #147, #151, #155, #154, #156, #158. Issues #105, #106, #112, #113, #148.
