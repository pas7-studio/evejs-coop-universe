# EveJS Co-op — parallel agent handoff / current evidence (2026-10-25)

This document is a shared **source-of-truth progress note** so simultaneous agents stop reopening already-completed investigations or accidentally claiming adjacent work. It describes evidence, **not** a new promise that the game works end to end.

## Repository and authority

- Project: `pas7-studio/evejs-coop-universe`; working feature branch `feat/npc-personal-memory-20261024`; [draft PR #2](https://github.com/pas7-studio/evejs-coop-universe/pull/2).
- Audited upstream: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
- PR head **before this documentation update**: `c9897f1ed2fb539bd38022ad4f3fbe4bb47a3dea` (80 changed files at that moment, draft and mergeable). Refresh current head before touching anything.
- Friend's Windows game: `C:\Games\EveCoop\upstream-evejs\Code`; durable Docker data volume `evejs-data`. **Do not edit volume / restart / deploy / merge / run CI or market rebuild without explicit user authorization**; do not equate accessible repo with remote machine access.

## Verified from *source*, not accepted live

| Workstream | Current evidence in branch | What is still unresolved |
|---|---|---|
| Native two-player fleet | `integration/coopNativeFleetParty.cjs`, `coopDuoCoordinator.cjs`, `coopPartyNotices.cjs`, native `fleetRuntime` for invitations/roles | two independent game clients invite/accept, genuine fleet UI and permissions, no ghost duplicate sessions |
| Real fleet warp | `coopFleetWarpSafety.cjs`, `coopFleetWarpArrival.cjs`, pinned `beyonceService` overlay | actual simultaneous physical follower warp/arrival, opt-out, reconnect |
| Player items, spare ships | `coopFleetTradeSafety.cjs`; stock `tradeMgrService` supports docked native two-person trade and inactive ship | show owner/item changes in both UIs and after relog, negative quantity/split/failure, ISK+item trade atomicity |
| Shared mission turn-in | `coopFleetMissionTurnin.cjs`; client-free 14/14 P0 scenarios and 3/3 method-level tests reported in previous implementation context; tests in `tests/coop-fleet-p0-cooperative-actions.test.mjs` and `tests/coop-native-fleet-trade-mission-contract.test.mjs` | **not a real two-client PASS**; native dual automatic completion OFF because reward writes not crash-atomic |
| Native combat mission objective credit | `coopFleetDungeonCredit.cjs`, `scripts/coop-fleet-mission-native-patch.cjs`; `EVEJS_COOP_FLEET_MISSION_SHARE` set to 1 in LivingCoop configuration | source overlay currently invokes helper twice (critical check), no accepted actual shared dungeon, no durable contributor journal |
| NPC miners, haulers, raids | `coopNativeIndustry`, `coopNativeConvoyRenewal`, `coopNativeHaulCargo`, `coopNativeRaids`; observational virtual-world modules | no proven persistent ore ownership transfer into native stock; live native miners/pirates/loot still gated |
| NPC economy, native market | `coopNativeNpcMarket`, virtual economy; stock `marketProxyService` with order books | seed-market experiment is not NPC-owned real funded market-maker; no proven ore→real goods→orders |
| Blueprint industry / faster job time | stock `industryRuntimeState`, `industryParityHelpers`; `coopIndustryPacing`, `coop-industry-time-patch.cjs` | material receipt, native job installation/delivery into personal or corp inventory, replay/dupe tests |
| Capsuleer progression | LivingCoop config specifies `EVEJS_SKILL_TRAINING_SPEED=6`, `EVEJS_OMEGA_LICENSE=true` | actual two-account Omega status, Alpha cap, actual skill queue SP/min, offline state, UI equivalence, restart persistence |
| Faction consequences / NPC memory | native `standingMgrService`, missions, native miner aggression; co-op `coopNativeConsequences`, `coopNpcMemory`, faction world | true native per-character standings/LP/agent access, NPC memory actually changing encounter decisions in two-client play |

**Current LivingCoop switches (source observation only):** `EVEJS_COOP_FLEET_TRADE_SAFETY='1'`; `EVEJS_COOP_FLEET_MISSION_TURNIN='0'`; `EVEJS_COOP_FLEET_MISSION_SHARE='1'`; `EVEJS_SKILL_TRAINING_SPEED='6'`; `EVEJS_OMEGA_LICENSE='true'`; `EVEJS_COOP_MANUFACTURING_TIME_MULTIPLIER='0.35'`. A YAML line is NOT proof the resulting scene or skill queue ran. Apply through existing opt-in deployment script only with authorization.

## SOURCE-VERIFIED high-value discoveries to avoid unnecessary rewrites

See full [24-mechanic native gap audit](EVEJS_NATIVE_MECHANICS_COOP_GAP_AUDIT_20261025.md).

1. `planet/planetMgrService.js` already performs live PI colony edits, commodity transfers, physical launch containers; do NOT create virtual PI.
2. `exploration/scanMgrService.js`, `probes/probeScanRuntime.js` and `wormholes/wormholeMgrService.js` already handle real scanner, wormhole mass/polarization and physical jumps; do NOT fake fleet jump portals.
3. `_other/contractProxyService.js` connects to `contracts/contractRuntimeState.js` for real ITEM_EXCHANGE and COURIER contracts. **`_other/contractMgrService.js` is a stub**; this is a client routing/parity investigation, not permission to reimplement all contracts.
4. `evermarks/lpStoreMgrService.js` implements static LP offer purchases for characters; `corporation/lpService.js` has stub `Handle_TakeOffer`. Check client RPC route before calling LP store broken.
5. Insurance and station repair, native NPC bounty, corp hangar/wallet, jetcan fleet rights, bookmarks, storyline/epic arcs, moon mining and actual industry invention/reaction activities exist in source; each needs dedicated genuine two-client + persistence acceptance.
6. `industry/industryConstants.js` declares manufacture, time/material research, copying, invention and reaction; verify each activity actually supports quote/install/delivery and materials before advertising it as playable.
7. Existing stock service interfaces should remain the only authority for inventory, ownership, wallet, LP, SP, standings and ship state. A local virtual depot is not a native stock deposit.

## Current blockers / proposed owner allocation

| ID | Severity | Owner recommendation | Action / gate |
|---|---|---|---|
| CHECK-01 | P0 overlay maintenance | Existing mission/overlay agent | Duplicate helper call confirmed **idempotent on three pinned upstream source files** by read-only double-apply/double-remove test (second apply no changes; first remove restores byte-for-byte); still remove redundant call for clarity and run **complete** Node overlay dry-run/reapply/remove preflight; not a proven double-injection bug |
| BLOCK-02 | **P0** | Existing multiplayer/combat agent | Real two-client fleet invite→warp→combat→loot→reconnect; stop conflating isolated source tests with gameplay |
| BLOCK-03 | **P0** | Existing mission agent | Durable once-per-character reward journal and same shared mission/instance acceptance; automatic peer reward flag stays OFF until replay safe |
| BLOCK-04 | **P0** | Existing mining/industry agent | Native owner-tagged item transfer from NPC hauler to actual depot; ensure persistent stable transfer ID and debited source cargo |
| DISC-01 | P1 | Free exploration agent | Source-first PI, probes, bookmarks, wormholes co-op acceptance; no reimplementation yet |
| DISC-02 | P1 | Free commerce agent | Determine client RPC service routing contracts/LPStore; run native A→B contract and LP purchase, check shared corp warehouse and station repair/insurance |
| DISC-03 | P1 | Free economy/QA agent | Native market seed stock and real blueprint job audit; mining/resource/industry/market currency and item conservation invariants |
| DISC-04 | P1 | Free gameplay QA agent | Two new accounts Omega and x6 actual training, native bounty/insurance/repair, faction standing transaction checks |

**Assignment discipline:** these are suggested ownership boundaries, NOT claims that an agent has accepted them. If an agent already owns an area, update their existing task; do not duplicate implementation. Prefer read-only source tracing if two agents are concurrently editing a file.

## Definition of done and evidence requirements

Native feature: source read → validate RPC and payload → check permissions → two separate authenticated accounts → 2 real client-facing behaviors → persisted in-game state → disconnection and restart → negative exploit tests. Use the existing `scripts/Verify-Local-Coop.ps1`, test logs and `docs/GAMEPLAY_TESTING.md`, retaining exact upstream overlay/head hash. Do not invent source-controlled green CI if CI is absent/disabled.

**A real co-op gameplay PASS requires** two physical ships in the same real fleet, correct warp follower arrival, meaningful NPC combat/damage/wreck, real salvage/loot, and real item/ship ownership transfer after relog. Follow with group mission objective and nonduplicated per-character reward. Economy PASS requires ore mined once → native itemStore receipt → station reprocessing → blueprint consumes true minerals → real market order/trade.

## Do-not-claim / safety policy

- Existing on-disk source != correct RPC client UX.
- Virtual economy supply != actual mined items in a station warehouse.
- Two completed independent solo missions != shared mission instance and contribution.
- Running an overlay dry run != restarting Docker or deploying.
- Running 14 isolated tests and 3 mock-native-method tests != two-client live acceptance.
- P1 NPC "market trader" using `source=seed` daemon orders != independent actor with real wallet + escrow.
- Do not turn off abuse/duplication guards to make a demo pass.

## Communication for other agents

When finishing a task, post a short handoff entry in this document (or a linked new dated log if another agent has an active edit):
```
Scope / owner:
Upstream pin + co-op branch/commit:
Changed files:
Feature flags:
Tests + evidence (source/unit/native RPC/real 2-client):
Real item/ISK/LP/SP effect:
Remaining blocked scenarios:
Next independent handoff:
```

Keep docs short and independently linked. Do not grow `AGENTS.md` as a backlog, and do not use GitHub issues as the project's primary plan unless specifically requested.
