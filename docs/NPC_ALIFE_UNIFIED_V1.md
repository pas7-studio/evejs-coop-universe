# ALIFE-1 — one living-world mechanism instead of six parallel ones

Status: **design proposal, no runtime change.** Every capability below already
exists as an opt-in module; this document defines how they must be composed so
the world behaves as one mechanism rather than six schedulers competing for the
same native ships.

## Why unify (evidence, not taste)

- **Six independent order sources** can command the same physical NPC:
  `coopNpcTactics`, `coopPatrolOrders`, `coopCivilianOrders`, `coopNpcGateTravel`,
  `coopNativeRaids`, `coopNpcHuntPolicy`. History already contains
  "prevent civilian/patrol/gate orders from overruling native combat" fixes,
  which is the symptom of missing arbitration — not of a missing guard.
- **Five value ledgers** can describe the same ore: virtual economy, virtual
  depot, warehouse receipt, native station stock, NPC market wallet. Each has its
  own exactly-once rule; only pairwise bridges exist
  (`coopNativeStationOreSettlement`, `coopNativeDepot`).
- **~40 `living-*` event names** with per-module payloads and no shared envelope,
  so "prove NPC X did Y" means reading five different shapes.
- **The market gate burned a full day on a silent skip**: the hauler sat
  190 173 786 376 m (~1.27 AU) from the nearest station and *nothing recorded
  why* the trade never happened. Silent blockers are the failure mode of a
  world built from independent feature flags.

## One tick, five stages

A single driver (`alifeTick`, 30 s) owns all state-changing phases; the 5 s
sampling loop stays strictly read-only. Per tick, per NPC, exactly one path:

1. **PERCEIVE** (pure read) — build one immutable `WorldSnapshot`:
   scene entities, positions, HP, cargo (`cargoID`), controllers, station list,
   market book rows, warehouse/depot receipts, previous evidence.
   No module may query the scene directly for decisions afterwards.
2. **DECIDE** (pure function) — every planner emits *intents*, never orders:
   `mine(rock)`, `haul(miner)`, `deliver(station)`, `sell(order)`, `buy(type)`,
   `patrol(route)`, `hunt(target)`, `defend(self)`, `travel(gate)`, `idle`.
   The **Arbiter** is the only place that picks one intent.
3. **ACT** (native, exactly one order per NPC per tick) — through
   `coopNpcOrderBridge` with the existing physical proof (named pilot + real
   hull + matching controller + same system). Accepted ≠ done.
4. **SETTLE** (custody, exactly once) — all value movement uses one contract:
   `prepare(key) -> commit(key)`, idempotent by receipt key.
5. **RECORD** (evidence) — one envelope per state change:
   `{tick, npcID, phase, intent, orderID, blocker, before, after, proof}`.

## Authority ladder (the only priority source)

Applied in order; a lower level never overrules a higher one:

| P | Class | Examples | May interrupt |
|---|-------|----------|---------------|
| P0 | Survival | HP loss, active aggression, wreck/capsule recovery | everything |
| P1 | Committed engine state | warp in progress, staged trade, accepted order, arrival dwell | P2–P5 |
| P2 | Player-adjacent safety | player in grid, fleet warp guard, trade safety | P3–P5 |
| P3 | Economy | deliver, sell, buy, haul | P4–P5 |
| P4 | Defence/faction | patrol, hunt, raid | P5 |
| P5 | Social/idle | chatter, recognition, presence | — |

Rule: an intent holds **reservations** (rock, station berth, market order id,
gate, target hull) with a TTL. No second intent may take a held resource; no
module may bypass the arbiter even with its own env flag.

## One economic truth

- Native state (itemStore / `npcCargo` / market orders / wallet) is the only
  source of truth. Virtual balances are **read-only projections**, never credit.
- One receipt namespace, one key per real object:
  `cargo:<cargoID>`, `order:<orderID>`, `grant:<receiptID>`.
- Every settle is `PREPARED → COMMITTED` or `NEEDS_OPERATOR_REPAIR`; a timeout
  never re-fires, and `audit()` must reconcile *all* ledgers, not one.
- Consequences of a wreck (`coopNpcLossBridge`) and of a deposit
  (`coopNativeStationOreSettlement`) use the same key, so loss + delivery can
  never both count the same ore.

## Graceful degradation: blockers are data

Every intent that cannot proceed returns a **named blocker** and is recorded
(`blocked: NO_SEEDED_COUNTERPARTY | NO_STATION_FOR_OWNER | FAR_FROM_STATION |
DEPOT_UNAVAILABLE | NATIVE_NPC_BUSY | MARKET_UNAVAILABLE …`). Silence is a bug;
the market trace added in `feat/npc-market-trace-20261025` is the interim
version of this rule.

## Module map (nothing orphaned)

| Stage | Modules |
|-------|---------|
| Perceive | `coopNativeActivity`, `coopCombatProbe`, `coopNativeCombatEvidence`, `coopNpcWeaponEvidence`, `coopPlayerCombatWitness`, `coopStockFleetCombatEvidence`, `coopStockFleetWreckEvidence`, `coopNativeLootPickupEvidence`, `coopNativeScanProof`, `coopSystemIntel`, `coopNpcIntelLedger`, `coopDuoPresence`, `coopSessionPresence` |
| Decide | `coopNpcOrderArbiter`, `coopNpcOpportunityPlanner`, `coopNpcHuntPolicy`, `coopNpcTactics`, `coopPatrolOrders`+`coopPatrolNavigator`, `coopCivilianOrders`, `coopNativeRaids`, `coopNpcGateTravel`, `coopFactionDirector`, `coopEncounterDirector`, `coopDuoRaidTactics` |
| Act | `coopNpcOrderBridge`, `coopFleetWarpSafety`, `coopFleetWarpArrival`, `coopNativeGateTransfer`, `coopNpcHostility`, `coopNpcDestructionAttacker`, `coopNativeStationArrival`, `coopNativeHaulCargo`, `coopNpcMaterializer` |
| Settle | `coopNativeDepot`, `coopNativeWarehouse`, `coopNativeStationOreSettlement`, `coopNativeNpcMarket`, `coopNativeTradeAtomic`, `coopNativeTradeCustody`, `coopFleetTradeSafety`, `coopVirtualEconomy` (projection), `coopNativeLossBridge`, `coopNativeConsequences`, `coopNativeLpStandings`, `coopIndustryPacing` |
| Record | `coopRuntimeProbe`, `coopWorldSignals`, `coopHeadlessScenePolicy`, `coopNativeMiningReadiness`, `coopNpcPresentation`, `coopNpcChatter`, `coopAgentDialogue`, `coopPartyNotices` |
| Lifecycle (cross-stage) | `coopIdentityRegistry`, `coopNativeRestore`, `coopNpcLife`, `coopNpcMemory`, `coopNpcRecognition`, `coopNpcRolePriority`, `coopNativeConvoyRenewal`, `coopFactionPatrolRuntime`, `coopNpcTopology`, `coopVirtualWorld`, `coopVirtualWorldRuntime`, `coopNpcLossBridge` |

## Migration phases (each shippable, default OFF, tests first)

- **A. Single scheduler.** `EVEJS_COOP_ALIFE=1` master flag; all order-issuing
  modules call the arbiter instead of native APIs. Guard: an NPC receives at
  most one order per tick (test asserts order count and source).
- **B. Intents + reservations.** Pure module with the ladder and TTL table.
  Tests: P0 interrupts P3; committed warp blocks P2; expired reservation frees.
- **C. One value path.** Route depot/warehouse/station/market settles through
  one key namespace; `audit()` reconciles every ledger. Tests: double settle,
  crash between debit and grant, loss+delivery of the same cargo.
- **D. One evidence envelope.** Emit `alife-*` records with the shared fields;
  `scripts/Inspect-Alife.ps1` answers "what did NPC X do and what proves it".
- **E. Client-visible loop.** Station arrival → sell/buy at the real station →
  cargo/wallet deltas visible to a player; names + chatter tied to intents so a
  human can see the world thinking.

## Acceptance for "one mechanism"

1. No module except the arbiter calls a native order API (static test).
2. Exactly one order per NPC per tick, with a recorded reason (runtime test).
3. No ore or ISK is counted twice across any two ledgers (conservation audit).
4. Every non-action has a named blocker (trace contract).
5. Two clients see the same NPC doing the same thing for the same reason
   (client gate, human-verified).

## Honest current state

- Mergeable now: A (arbiter exists), B (pure planner exists), C partially
  (depot/warehouse/settlement), D partially (probe).
- Not proved live: station arrival → sale; two-client visible Alife loop.
- Never claim a phase done from unit tests: each phase ends with a manual gate
  report under `docs/`, per `DEVELOPMENT_DOCTRINE.md`.
