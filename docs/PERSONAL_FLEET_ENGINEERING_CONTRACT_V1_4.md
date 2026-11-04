# PERSONAL NPC FLEET — Engineering Contract Freeze v1.4

**Date:** 2026-11-04  
**Status:** DESIGN FROZEN FOR IMPLEMENTATION, NOT GAMEPLAY VERIFIED  
**Engine authority:** `pas7-studio/EveJS` @ `coop/pas7std`  
**Tests/orchestration:** `pas7-studio/evejs-coop-universe`  
**Policy:** default OFF; WORK stack only; no PLAY restart/deployment/volume mutation without owner authorization.

## Scope and provenance

A player hires existing or newly enrolled persistent named NPC pilots, assigns ORIGINAL player-owned ships with original modules/fitting/cargo, commands an active squadron through verified native EveJS movement/combat, and recovers consistent roster and physical ship custody across restarts. No virtual damage, phantom ship, fake sessions, cloned items, free ISK or second world scheduler.

**Critical repository rule:** `AGENTS.md` declares the engine fork authoritative; `integration/*.cjs` are archived source copies, and the legacy overlay is not the delivery mechanism. Verify source from `pas7-studio/EveJS/Code/server/src/space`, not archived .cjs alone. Resolve conflicting instructions in older `docs/AGENT_START_HERE.md` before executing builds.

Source-verified fork contract anchors as inspected November 4:
- `coopNpcOrderArbiter.js`: owner list RAID/TACTICS/GATE/PATROL/CIVILIAN/WAR/EXPEDITION; per-native-entity lease; UNKNOWN outcome fence.
- `coopNpcOrderBridge.js`: validates matching `coop-pilot-NNN`, native scene/entity/controller; WAR claim is a separate exclusion.
- `coopWarFleetRegistry.js`: exclusive durable WAR ship registry in `corporationRuntime`.
- `coopGameStoreAtomic.js`: native SQLite `BEGIN IMMEDIATE`, allowlisted tables, synchronous writes, ambiguous COMMIT poisoning; exact integration must be verified on WORK.
- `coopNativeGateTransfer.js`: journaled entity transfer; physical arrival and restart proof still needed.
- `coopNativeRestore.js`: persisted native entity/controller restore, rejects inconsistent records.
- `coopNpcLife.js`: **fork version uses JSON file**; archived integration copy may use a GameStore migration. This is drift, not a confirmed migration.
- `coopFlags.js`: only exact string `1` enables feature.

Current `state/NOW.md` at audit time reports 7015 pass, 14 fail, 84 skip; targeted existing failures include `coop-fleet-slot-recompose` and `coop-native-durable-slot-heal`. Do not assert a green baseline without executing and classifying these cases.

## C1 — Global invariants (mandatory on every mutating path)

| ID | Invariant | Proof / authority | Failure behavior |
|---|---|---|---|
| INV-01 | A ship item has at most one canonical physical location: hangar OR native active OR confirmed wreck/loss | native ItemStore/GameStore + NPC store + custody record | BLOCKED/REPAIR, never clone |
| INV-02 | One pilot is assigned at most one active ship; one active ship has one pilot | global durable unique claim (pilot and ship) | reject conflicting claim |
| INV-03 | One actor has at most one exclusive command owner, including WAR, Mining, Expedition, Personal Fleet | atomic global claim plus checks against legacy claim registries | UNKNOWN -> fence |
| INV-04 | No two live scenes contain the same native entity ID at once | scenes + native persisted controller + transfer journal | quarantine transfer |
| INV-05 | A player command is authorized against current authenticated session, employment, roster revision, claim generation, same native scene and PvP legality **at dispatch** | live authorities, not client payload | deny |
| INV-06 | No amount or item is newly created by assignment, deployment, travel, loot or recovery; money/item conservation checked per operation | native wallet/item receipts and item IDs | block settlement |
| INV-07 | One valuable operation produces at most one committed effect per canonical operationID, independent of retries and restart | durable idempotency record with canonical payload hash | return previous result or reject mismatch |
| INV-08 | Native accepted order != completed effect; completion requires independent physical evidence | controller/scene/destination/damage/wreck/custody | keep NATIVE_REQUESTED |
| INV-09 | Unknown native/SQLite outcome cannot be retried merely because TTL expires | durable operation journal + fencing | OUTCOME_UNKNOWN / operator repair |
| INV-10 | Pilot clone recovery never recreates an original lost ship | authoritative wreck + coopNpcLife | pilot may recover; ship stays LOST |
| INV-11 | Feature flag OFF produces no new writes or changed native behavior | regression/flag tests | default OFF |
| INV-12 | Never materialize unloaded scenes just to satisfy UI/read-only queries | bounded snapshot APIs | PENDING/NOT_LOADED |

Canonical keys must use the actual native record format (note that existing GameStore atomic adapter uses `\u001f` for stored keys, and `/` for higher-level read projections). Do not handwave a `/personalFleet/...` path as a directly valid SQLite key. Test persistence and cache read-back through both APIs.

Ship item ID, native entity ID, and pilot ID are DISTINCT semantic identifiers even if some current EveJS NPC paths map `entity.itemID === entityID`. Never assume a player hangar ship item already has a corresponding native NPC entity. No session spoofing or artificial authenticated NPC characters.

## C2 — Transaction boundaries and recovery ownership

| Operation | Authority | Transaction and side effects | Retry / ambiguous case |
|---|---|---|---|
| Hire pilot | validated native player wallet + durable contract | one native GameStore atomic debit/credit + contract/receipt, with pinned server-owned quote; if not same scope, journal an intent and reconcile | exactly-once; no second debit |
| Assign pilot to ship | native item custody, pilot registry, fleet roster, global actor claim | in one atomic commit when all rows in same GameStore; otherwise PREPARED -> native action -> independent verification -> COMMITTED; prohibit availability in hangar during in-flight state | no new spawn from pending |
| Deployment | existing item -> sessionless native ship conversion adapter (NOT proven yet) | record PREPARED and original item ID; native materialize once; verify physical entity/controller and absence of duplicate hangar item; commit | quarantine if ownership or store conflict |
| Order issue | durable intent + existing `coopNpcOrderBridge`/arbiter + native controller | persist intent BEFORE native dispatch; native ACK -> REQUESTED; independent evidence -> COMPLETED | ambiguous ACK => no automatic reissue |
| Warp | native movement + controller | per-ship route journal, same-system destination proof | ACK != arrival; retain fence |
| Stargate transfer | existing `coopNativeGateTransfer` journal is authority | reuse existing same-ID transfer, not second transfer journal | repair incomplete original transfer before new routes |
| Dock/undock | must discover/implement verified *sessionless* adapter | physical station proof, original item custody, atomically transition to unavailable/available; docking not equal approach | feature BLOCKED until real adapter proven |
| Ship destruction | original native wreck/loss hook and `coopNpcLife` | original ship permanently LOST; correlated single wreck/loot; separate pilot clone recovery | never create replacement ship |
| Rewards | native PvE/reward authority | one authoritative settlement for kill/mission, NPC damage contribution only an attribution read model | do not mint bounty or repeat payouts |
| Salary renewal | native wallet + contract | integer money units, bounded billing windows, deterministic billing ID, one debit per period | UNPAID blocks next deployment, no automatic disappearance |

**Cross-store consistency**: The atomic SQLite adapter cannot atomically commit a JSON journal, in-memory native scene, Rust market transaction and GameStore rows in one ACID transaction. State this explicitly. Use a forward-recoverable, idempotent saga and authoritative receipts. Every phase has EXACTLY ONE recovery owner, avoids invoking a second writer, and records whether a compensation is safe. Do not promise unconditional rollback after an ambiguous physical action. Fence on ambiguity.

**Claim adapter**: first read existing WAR/mining/expedition claims, then durable conditional claim in SAME serialized write as Personal Fleet reservation; claims from sources outside that SQLite transaction require an explicit coexistence gate / coordinated migration. Read-then-write across separate registries is not sufficient concurrency protection. Lease expiration never transfers durable ownership.

## C3 — Lifecycle transition matrix

### Pilot
`AVAILABLE -> CONTRACTED -> ASSIGNED -> DEPLOYED -> RECOVERING (on confirmed native loss) -> AVAILABLE (after clone recovery)`. `UNPAID` and `SUSPENDED` are employment policy states, not ship disappearance. Pilot loss need not be permanent unless an explicitly designed policy says so. Termination cannot release an in-flight ship.

### Ship and assignment
| From | To | Trigger | Required evidence / fail gate |
|---|---|---|---|
| HANGAR | RESERVED | player assigns verified ship | exact native ItemStore row, owner, station, module refs, unique claims, committed receipt |
| RESERVED | DEPLOYING | explicit undock/deploy order | journal with operationID, existing item identity, controller creation authorization |
| DEPLOYING | ACTIVE | native deployment verified | ONE live native entity/controller + original item custody (not hangar-available) |
| ACTIVE | RETURNING | accepted player return order | authorized native movement; not yet docked |
| RETURNING | DOCKING | physically arrived at real station | scene coordinates, radii, valid station ID, native constraints |
| DOCKING | HANGAR | sessionless dock/custody adapter commits | original inventory item accessible once; no active NPC entity |
| ACTIVE/RETURNING/DOCKING | LOST | authoritative original native ship destruction | exact ship+system+positive wreck ID+loss receipt, no second active entity |
| ANY nonterminal | OUTCOME_UNKNOWN | lost/ambiguous transaction/native ACK | permanent fence until independent reconcile |
| OUTCOME_UNKNOWN | resolved state | operator/automated evidence-based reconcile | proof of exact matching original entity, journal, item, receipt; no timer-only guess |

No safe `DOCKING -> HANGAR` implementation => disable RETURN_TO_BASE completion and dock capability; allow physical approach and explicit BLOCKED status only.

### Per-member route
`PLANNED -> APPROACHING -> AT_GATE -> TRANSFER_PENDING -> TRANSFERRED -> ARRIVED`, or `BLOCKED/OUTCOME_UNKNOWN`. A multi-ship squad NEVER jumps atomically: partial arrival is a supported state. A disconnected commander cannot cause teleport/despawn.

### Required crash points
Before/after every durable PREPARE, during native mutation, after native effect before ACK, after ACK before completion record, before/after wallet debit, during station custody handoff, during gate journal write, after destination materialization, during confirmed loss before roster update. Kill and restart the actual WORK process with persistence retained; verify native IDs, stores and journal consistency.

## C4 — Integration compatibility matrix and contract owners

| Existing module | Contract for Personal Fleet | Acceptance regression |
|---|---|---|
| `coopNpcOrderArbiter`, `coopNpcOrderBridge` | add explicit PERSONAL_FLEET owner, global durable actor claim; preserve TACTICS-only verified emergency preemption; no second scheduler | WAR/raid/patrol/gate/expedition remain fenced and same physical controller cannot receive conflicting commands |
| `coopWarFleetRegistry` | WAR exclusive claim checked transactionally; no implicit migration | WAR ship cannot be recruited |
| `coopPlayerMiningShiftOrders`, mining native operations | committed mining/haul cargo operations outrank fleet recruitment, with explicit handover only after source completed | paid shifts never lose miner/hauler; cargo/title unchanged |
| `coopNpcExpeditionDirector`, native probe/hack and wormhole | scout only through original physical probe/hack gear; expedition and wormhole state remain separate authorities | no virtual scan/loot, no duplicate transit |
| `coopNativeGateTransfer`, `coopNativeRestore` | reuse original transfer journal and recovery-before-identity-prune ordering | restart during transfer has one original ship; corrupt journal fenced |
| `coopNpcLife`, `coopNpcLossBridge` | original wreck proof, exactly-once loss and pilot clone recovery; fork JSON-vs-archive drift must be reconciled explicitly | recovered pilot does not regain lost item |
| `coopNpcAmmoSupply`, tactics/combat | native ammunition, capacitor, dogma, target legality; no fake player sessions | zero ammo blocks firing, no illegal player attacks |
| `coopNativeNpcMarket`, native inventory and wallets | purchases, fitting, wages and rewards must use native source receipts | no double ISK, no duplicate item or extra bounty |
| `coopNativeStationArrival` | physical approach is NOT station docking | cannot report DOCKED from arrival-only proof |
| `coopNativeFleetParty`, `coopFleetWarpSafety` | native player fleet remains distinct from player-owned NPC squad; verified client RPC contract | no phantom member in native player fleet, two clients see same physical NPC |
| `coopNpcMemory`, faction/standing | do not overwrite NPC faction, crime state or standing for employer | no spoofing aggression or affinity |
| `coopObserve`, `coopFlags`, central world tick | common event envelope, call-time exact-1 flags, existing world scheduler; read-only diagnostics | no independent timer, no unbounded scenes, no event-loop regression |

**Client contract check**: use `docs/client-contracts/*` and the pinned client contract audit; no synthetic Fleet UI calls. Stock Agent UI allowed only after its real actions and priority are verified against other agents.

**Source drift**: prior docs and co-op archival `integration/*.cjs` may differ from engine fork. A code-facing PR must identify function/commit SHA and include a targeted compatibility test; fork runtime behavior is authoritative. In particular compare `coopNpcLife` JSON persistence and `coopGameStoreAtomic` table/row constraints before wiring any new transactions.

## C5 — Definition of Done and evidence requirements

### PR gates (every PR)
1. Read `AGENTS.md`, `state/NOW.md`, `docs/TWO_STACKS_PLAY_AND_WORK.md`, `docs/COOP_ARCHITECTURE_BOUNDARIES.md` and fork source at recorded commit; record failing preexisting baselines by test name.
2. Failing regression reproduction first; implementation in FORK, tests/orchestration in co-op repo; state exact changes and rollback.
3. Local tests for positive, negative, stale revision, spoof, duplicate, and missing-authority cases; no test dilution.
4. `node scripts/coop-engine-audit.cjs`, `node scripts/coop-perf-audit.cjs`, flag registry and client contract checks when relevant, test-parity comparisons; record their outputs, not assumptions.
5. Native GameStore/SQLite on disposable WORK with crash/fault injection for every valuable mutation.
6. No PLAY restart, live volume changes, client manipulation, automatic CI or deploy absent operator permission.
7. Each PR evidence records status as DESIGN_ONLY, SOURCE_IMPLEMENTED, ISOLATED_TESTED, NATIVE_SQLITE_VERIFIED, WORK_RUNTIME_VERIFIED, ONE_CLIENT_VERIFIED, TWO_CLIENT_VERIFIED, or BLOCKED; do not promote level from merely passing unit tests.

### Feature release gate
- Player hires real pilot and pays real ISK once.
- Player assigns real original hull and equipped modules once; no other owner can use it.
- Existing native NPC physically appears once and is visible to two authenticated clients.
- Follow, warp and actual arrival are witnessed for exact IDs.
- Native combat consumes genuine ammo/capacitor, reduces target HP, and preserves Crimewatch/friendly fire.
- Real destruction yields exact loss and one physical wreck; loss persists, clone recovery does NOT restore ship.
- Return-to-base is completed ONLY after actual sessionless docking/ship item custody is proven; otherwise feature remains blocked.
- Reconnect, mid-warp/mid-transfer crash and restart cannot mint/duplicate item or wallet value.
- Two players can each command only their authorized NPCs; stock real-player fleet behavior not regressed.
- A-Life/Mining/WAR/Expedition/Market/PvE original orders, custody and financial settlement continue to function.
- Performance budget established experimentally on 1/3/6 NPC scenarios, with stated P95 tick/event-loop latency and no unbounded scene loads.

### Unverified blockers as of freeze
- Actual adoption of player-owned hangar ship as original native NPC (same original item and fitting).
- Sessionless dock/undock lifecycle, including item custody and UI behavior.
- Formal cross-authority atomic global claim compatibility for WAR/Mining/PF.
- Live two-client gameplay and physical combat/warp proof.
- Full crash fault matrix on WORK.
- Existing 14 historical failing tests require triage; cannot call overall baseline green.

## PR implementation ordering

PF-00: fork-first native/SQLite/client discovery, source drift and red baseline triage.
PF-01: durable cross-owner claim authority with explicit WAR and mining proof.
PF-02: pure fleet/pilot domain, revisioned storage and typed contracts.
PF-03: ship item custody/adoption (must prove feasibility before deployment).
PF-04: Personal Fleet intents through existing arbiter and bridge.
PF-05: native FOLLOW/warp/formation and per-member route.
PF-06: native combat, legality, ammo and PvE attribution.
PF-07: lost ship/pilot lifecycle and crash recovery.
PF-08: native personal-wallet hiring/salary and contract UI.
PF-09: sessionless station docking/undocking proof + implementation.
PF-10: verified game-facing UI and two-client squad test.
PF-11: full gate travel/logistics/performance/release gating.

### Stop/rollback rules
- A failed authority, conservation, item, wallet, ownership or source-drift gate = STOP; do not merge as gameplay-ready.
- On unknown commit/native side effect = QUARANTINE; never repeat, auto-refund, auto-respawn or release claim by timeout.
- A dock adapter missing -> dock/return-to-base disabled; do not fake completion.
- Flag rollback prevents new operations but MUST NOT orphan active ships; provide safe read-only reconciliation and operator recovery.
- Merging code and enabling it for PLAY are **separate decisions**.

## Freeze decision

**Architecture: READY FOR PF-00 IMPLEMENTATION.**
**Production/gameplay correctness: NOT YET VERIFIED.**
This is a testable contract, not a guarantee that native APIs or live gameplay already work. Any native-source discovery conflict is an explicit change request against this document, not permission to silently invent a simulation.

## PF-00 first executable code slice (in this PR)

- `scripts/lib/personal-fleet-contract.cjs`: **pure, non-deployed, side-effect-free policy kernel** for unique pilot/ship assignments, external owner claim admission, revision/generation fences, physical evidence-gated transitions, ambiguous recovery fences, and operation replay checks. `admitAssignment` is advisory and MUST be revalidated transactionally.
- `tests/coop-personal-fleet-contract.test.mjs`: deterministic isolated regression suite (19 test cases), including conflicting WAR/mining claims, duplicate assignment/pilot/ship, wrong native evidence, stale revision/generation, wreck identity, irreversible LOST, malformed external claims and ambiguous operation replay.
- Run: `node --check scripts/lib/personal-fleet-contract.cjs && node --test tests/coop-personal-fleet-contract.test.mjs`.
- Local detached policy fixture verification: **19/19 PASS** on Node.js; the PR's exact checked-in files still require execution in the owner's repository/WORK environment. No GameStore, SQLite, fork runtime, Docker or EVE client is exercised by this test.
- This pure reference module is not the deployed implementation. Per `AGENTS.md`, production code belongs in `pas7-studio/EveJS` (`coop/pas7std`) and must use real native authority adapters. Do not import this orchestration-side helper as the live runtime without explicit extraction and source parity review.

## PF-01 code continuation (same PR #350)

This branch now also includes:
- `scripts/lib/personal-fleet-claims.cjs` — non-deployed PF-01 registry reference using `corporationRuntime` canonical `\u001f` row keys, GameStore's already-existing `coopAtomicNativeRows.transact`, WAR registry conflict checks inside the same transaction, globally unique Personal Fleet pilot/ship claims, transaction receipts and monotonically increasing per-ship generations.
- `tests/coop-personal-fleet-claims.test.mjs` — **19 authored test cases**, including default OFF, missing writer integration, poisoned GameStore, WAR ownership/transfer conflicts, Mining/other director/physical proof denial, generation CAS, idempotence, and corrupted durable state.
- Verification command: `node --check scripts/lib/personal-fleet-claims.cjs && node --test tests/coop-personal-fleet-claims.test.mjs tests/coop-personal-fleet-contract.test.mjs`.

**Evidence status: SOURCE_IMPLEMENTED / TESTS NOT_RUN in this remote GitHub session.** Do not report 19/19 or 38/38 PASS until the exact checked-in scripts are executed. GitHub file creation and fetch verification do not execute tests.

**Critical deployment blocker:** the engine fork's existing WAR assignment writer and any other competing actor-owning writers do not yet consult the PF registry in a shared transaction. Therefore PF-01 registry writes are explicitly gated by `writersIntegrated()`. The integration wiring MUST prove these reciprocal cross-writer checks (not simply set the callback to true); otherwise personal fleet claim writes stay disabled. The `verifyMiningFree` and `verifyOtherClaimsFree` callbacks must be authoritative and transactionally coordinated: an outside read-only check cannot enforce serializable ownership against an unmodified writer.

**Repo write permissions:** creating a branch in `pas7-studio/EveJS` @ `coop/pas7std` returned HTTP 403 in this session. Code is therefore intentionally maintained here as a **portable, non-deployed reference**, not falsely represented as installed in the engine fork. A fork-authorized agent must port it, add the reciprocal checks, execute WORK tests, and open the corresponding engine PR. No PLAY changes were made.
