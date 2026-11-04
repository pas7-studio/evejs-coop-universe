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

## PF-01B: reciprocal legacy-writer admission guard

Files:
- `scripts/lib/personal-fleet-writer-guard.cjs` (non-deployed reference)
- `tests/coop-personal-fleet-writer-guard.test.mjs` (13 authored scenarios)

### Mandatory fork integration anchors

The following are **source anchors verified in `pas7-studio/EveJS` @ `coop/pas7std`**, not already installed PF hooks:

1. `Code/server/src/space/coopWarFleetRegistry.js` → `createWarFleetRegistry().execute(command)` → existing `transact(tx => { ... })` → `ASSIGN` case, BEFORE `s.ships[id] = {...details,...}`. Call the `assertPersonalFleetActorFree(tx,{entityID,pilotID})` guard on exact original native IDs. Refuse if `.ok!==true`. Validate both WAR registry and PF registry through the SAME authoritative SQLite commit. Do not add `corporationRuntime` to a separate transaction.
2. `Code/server/src/space/coopPlayerMiningShiftOrders.js` only owns funded shift *directives*; it does NOT itself own initial NPC mining fleet spawning. Find and guard **actual hiring/slot/custody writers** (including `coopPlayerMiningHiring`, `coopNativeMiningFleetDurable`, their active engine fork counterparts) where new ship/pilot assignment is first committed. A guard on only `assign()` shift command is insufficient.
3. `coopNpcExpeditionDirector` and `coopNpcOrderArbiter` own movement/lease, not necessarily durable entity custody. Verify whether expedition changes exclusive ship assignment; if it does, guard that writer too. Ensure actual client-directed orders cannot bypass `coopNpcOrderBridge`.
4. During PF claim admission, `verifyMiningFree`, `verifyOtherClaimsFree` and `verifyNativeActor` are **placeholders for authoritative checkers**, not permission callbacks from client data. If writers and claims span different storage authorities, refuse new PF claims until a serializable cross-owner claim bridge exists.
5. Do not allow a config flag or `writersIntegrated:()=>true` by itself to certify integration. Prove by executable cross-writer tests: WAR claim first -> PF refused, PF claim first -> WAR refused, funded mining claim -> PF refused, PF claim -> miner acquisition refused, concurrent competing writers -> exactly one succeeds, restart preserves winner.

### PF-01B phase status

`SOURCE_IMPLEMENTED` as portable orchestration code; **NOT DEPLOYED**, native fork PR **BLOCKED (GitHub branch creation 403)**; authored tests **NOT_RUN**. Do not claim a passing Node run, real SQLite transaction, WORK runtime validation or two-client gameplay from GitHub commits alone.

Run locally from the co-op repository after checkout:

```sh
node --check scripts/lib/personal-fleet-contract.cjs
node --check scripts/lib/personal-fleet-claims.cjs
node --check scripts/lib/personal-fleet-writer-guard.cjs
node --test tests/coop-personal-fleet-contract.test.mjs tests/coop-personal-fleet-claims.test.mjs tests/coop-personal-fleet-writer-guard.test.mjs
```

Avoid merging into PLAY or turning on PF flags before the reciprocal fork hooks and native crash tests pass.

## PF-02: first personal squadron roster code

New non-deployed reference:
- `scripts/lib/personal-fleet-roster.cjs`: pure revisioned personal squadron model with immutable `HIRE`, `ASSIGN`, `UNASSIGN`, `SET_DOCTRINE`, `SUSPEND`, `DISMISS` operations and bounded pilot roster.
- `tests/coop-personal-fleet-roster.test.mjs`: 21 authored isolated cases covering original ship references, hire/custody/release/termination evidence gates, stale per-fleet and per-pilot revisions, replay, double assignment, and doctrine restriction.

**Security boundary:** booleans such as `verifiedHire`, `verifiedCustody`, `verifiedRelease`, and `verifiedTermination` are INJECTED TRUSTED ADAPTER ASSERTIONS, **not input supplied by clients**. `payloadHash` must be computed from the canonical command on the trusted server, not accepted from the EVE client. `apply()` is a pure reducer only: no wallet debits, no native ship adoption, no authenticated session, no persistence or cross-writer lock. Its `HIRE` operation must run only AFTER the actual GameStore hiring/wallet authority has proven the exact contract and receipt in the same durable operation or reconciled saga. `ASSIGN` requires the separately verified global actor claim and ship custody evidence. Do not call this pure module from a public RPC with client-selected verification flags.

### PF-01 hardening

- Missing row **`null`** and unreadable row **`undefined`** are different: the durable PF claim registry and WAR registry require explicit absence evidence and block an indeterminate read.
- Cross-writer guard validates all claim entries before admitting any other actor; it cannot overlook an unrelated corrupt entry after finding a matching reservation.
- WAR claim admission rejects malformed unrelated WAR ship/transfer projections.
- Four additional targeted PF-01 tests cover undefined PF/WAR rows and malformed unrelated WAR records.

### Evidence status

All PF-01/PF-02 code is only in the orchestration-side Draft PR, not in the engine fork. The current session's GitHub connector is permitted to write `evejs-coop-universe` but fork branch creation returned 403. Node tests and native WORK stack tests have **NOT been executed** in this session. Do not claim a green test count from authored tests. Treat the source as implementation material for a permitted local fork agent.

## PF-03 native original-item custody reference (added 2026-11-05)

Source files added to this Draft PR:
- `scripts/lib/personal-fleet-custody.cjs` — PF-03 pure `prepare`, `advance`, `observe` contract.
- `tests/coop-personal-fleet-custody.test.cjs` — 16 negative/positive cases for unique original identity, immutable fitting/cargo hashes, dispatch intent, fenced transitions, real docking, wreck-confirmed loss, unknown/duplicate physical locations, and never-spawn-on-missing.

**Evidence:** A matching locally authored source/test fixture executed under Node.js v22.16.0: 16 tests passed, zero failed (`node --check`, `node --test`). The files were also created and verified in the GitHub branch; full PR tests and a WORK native SQLite/GameStore E2E remain **NOT RUN**. The portable module does not mutate or lock real ship items, acquire native controller, or deploy a ship by itself.

**Source-verified fork behavior:** `coopNpcMaterializer.js` is a bounded identity-to-native SPAWN adapter, not a proven adopter of existing player-owned hangar items. `coopNativeRestore.js` restores a persisted native entity/controller and refuses a missing durable identity; `coopNativeGateTransfer.js` journals actual native transfer with original modules and cargo. None alone establish safe original Player ItemStore → NPC controller conversion. PF-03's `ORIGINAL_HANGAR_ITEM_VERIFIED` receipt must come from an actual **trusted ItemStore custody adapter**, and `exclusiveUnavailable` must mean a committed reservation that makes the original hull unavailable for normal player undock/sale/transfer. It cannot be supplied as a boolean by the EVE client or as an uncommitted read.

**Canonical state flow:** PREPARED → NATIVE_REQUESTED → ACTIVE → RETURN_REQUESTED → DOCKING → COMMITTED_DOCKED, or confirmed original wreck → CONFIRMED_LOST. An unknown outcome is a durable quarantine, never permission to re-spawn. Physical observations return read-only `OBSERVED_*` statuses; a state transition additionally requires independently sourced durable evidence. Docking requires original hangar item custody and absence of the native actor; mere station approach does not satisfy it.

**Native implementation prerequisites:** (1) player-inventory native row and fitting/cargo provenance discovery; (2) original item ownership and exclusivity locks in native GameStore; (3) creation/attachment of exact native NPC entity/controller without a second item; (4) crash journal and idempotent restoration; (5) station sessionless reverse custody transaction. Until proven, activation and docking remain default OFF and no production behavior must use this pure reference.

## PF-04: Personal Fleet durable order intent policy (added 2026-11-05)

This PR now has two additional **non-deployed reference** files:
- `scripts/lib/personal-fleet-intents.cjs`: immutable intent admission, trusted authority proofs, bounded TTL, safe per-command target requirements, durable dispatch phase fencing, native ACK vs actual completion distinction, permanent `OUTCOME_UNKNOWN` and replay with `dispatchAllowed:false`.
- `tests/coop-personal-fleet-intents.test.cjs`: **26 authored unit cases** (including initial roster revision zero). Note: committed files verified in GitHub, but **NOT EXECUTED** with Node in this session.

### Required engine fork integration (not done)

1. `Code/server/src/space/coopNpcOrderArbiter.js`: the existing `OWNERS` Set currently permits only RAID/TACTICS/GATE/PATROL/CIVILIAN/WAR/EXPEDITION. `PERSONAL_FLEET` requires explicit opt-in owner registration and rules; never masquerade as WAR, TACTICS, RAID or a fake player session.
2. `Code/server/src/space/coopNpcOrderBridge.js`: all real orders pass its unique named-pilot, matching scene/entity/controller, WAR claim exclusion and native busy checks. Add the PF ownership proof without bypassing this bridge, and preserve TACTICS-only emergency preemption. A bridge `success:true` is **ACK** only, not movement/kill/arrival proof.
3. A command from the client is first bound to an actual authenticated `characterID` on the server. `authenticatedIssuer`, `actorProof`, `targetPermitted`, `leaseAvailable`, `payloadHash`, and `proof` are **trusted server-derived values only**. Never accept their values as client-controlled authorization.
4. `QUEUED -> ISSUING` transition must be DURABLY COMMITTED in GameStore **before** invoking the existing native `coopNpcOrderBridge.issue()`. After a crash, an `ISSUING` operation is UNKNOWN until original native proof reconciles it; never blindly redispatch.
5. Native `execute()` may return a synchronous definite rejection (`success:false`), a success acknowledgement, throw, or an ambiguous value. Map these respectively to `NATIVE_REJECTED`, `NATIVE_REQUESTED`, or `OUTCOME_UNKNOWN`. Do not mark `COMPLETED` from an acknowledgement or a timer.
6. Independent completion evidence: FOLLOW -> actual native follower distance/position to correct leader and current scene; WARP -> verified destination arrival; ATTACK -> allowed native firing/damage or combat end per semantic order completion; DEFEND -> actual guarded entity controller behavior; RETREAT -> real escape/arrival; RETURN_TO_BASE -> verified sessionless docking and original ItemStore custody. If not yet supported, expose `NATIVE_REQUESTED` or explicit BLOCKED rather than fabricate completion.
7. Any command that requires a target must be checked for legality (Crimewatch, hostile flags, immunity, target still present) and authorization **again at dispatch**. Client-supplied IDs alone never authorize an attack.

### Executable unit command

```sh
node --check scripts/lib/personal-fleet-intents.cjs
node --test tests/coop-personal-fleet-intents.test.cjs
```

**Status:** PF-04 source reference authored, not deployed, native bridge unchanged, checked-in unit tests not run, no PLAY/WORK stack touched. `pas7-studio/EveJS` remained non-writable in the previous attempt (GitHub integration 403). This is not a gameplay-ready personal fleet order subsystem.

### PF-04 continuation: reconciliation and stale fleet fencing

- Intent admission and pre-dispatch both check the **current trusted fleet revision**, original assignment generation and active physical custody. A stale client roster cannot issue an order after ownership changes.
- `reconcile()` resolves an `OUTCOME_UNKNOWN` operation only from an independently verified, exact original native receipt (same operationID, payload hash, physical native entity and assignment generation), and only to `NATIVE_REQUESTED`, `COMPLETED` or `NATIVE_REJECTED` under distinct physical proof requirements. It NEVER invokes the native command again.
- 32 authored PF-04 cases now exist; the six Personal Fleet test files contain 124 authored `node:test` cases in total, **not a claim of 124 passing tests**. All server fork runtime, native SQLite and WORK two-client gates remain unverified.

Cross-module critical point: a real PF order cannot be enabled merely by writing a good durable intent. The authoritative fork arbiter must explicitly recognize owner `PERSONAL_FLEET`, and the order bridge must verify the Personal Fleet claim and preserve the existing native WAR exclusion, native busy state and TACTICS emergency arbitration. These fork patches were not committed due to a previous GitHub 403.

## PF-05: per-ship cross-system navigation and native formation (2026-11-05)

**Reference source (NOT DEPLOYED):**
- `scripts/lib/personal-fleet-navigation.cjs`: per-ship `PLANNED -> APPROACHING -> AT_GATE -> TRANSFER_PENDING -> TRANSFERRED -> ARRIVED` with `BLOCKED/OUTCOME_UNKNOWN` quarantine, immutable route revision/member revision fencing, original ship and native entity uniqueness, and read-only snapshot of partial arrival.
- `tests/coop-personal-fleet-navigation.test.cjs`: 17 deterministic Node test cases. Locally executed matching source under Node.js 22.16.0: **17/17 PASS**; full PR tests / WORK native SQLite and client gameplay NOT executed. The exact GitHub files were verified through the GitHub connector after upload.

**Native integration contract:** `formation()` generates `NATIVE_FOLLOW_REQUEST` descriptors, **not coordinates or teleportation**. A trusted adapter must recheck native scene/controller, authenticated owner and matching assignment generation, then dispatch through the real `coopNpcOrderBridge` (requiring `PERSONAL_FLEET` support in the fork arbiter). Formation ranges are advisory only, not a new kinematics engine.

**Cross-system:** reuse the existing `coopNativeGateTransfer.js` journal and same original entity/controller/module/cargo authorities. Each ship transfers independently. `TRANSFER_PENDING` must be durable before invoking native transfer; `TRANSFERRED` requires verified original item preservation; `ARRIVED` requires destination scene and original controller proof. Partial squad arrival is a first-class outcome; never mark the squad arrived from the leader's position. An unknown transfer must remain fenced until independent source/destination original-native reconciliation.

**Blocking dependencies:** the authoritative `pas7-studio/EveJS` fork cannot currently be written with this integration's GitHub credentials (previous `403`); initial player-owned native ship adoption/docking are still unverified; no real movement was issued. The new route reducer is therefore an **isolated source-tested reference**, not evidence of gameplay readiness.

Test command (co-op repository): `node --check scripts/lib/personal-fleet-navigation.cjs && node --test tests/coop-personal-fleet-navigation.test.cjs`.

## PF-06: real-native-combat safety reference (2026-11-05)

New Draft PR code:
- `scripts/lib/personal-fleet-combat.cjs`: non-deployed pure policy for original NPC pilot/ship ownership, trusted issuer and current roster/generation, native target attack legality, installed original weapon/charges/capacitor evidence; durable attack intent phases and fail-closed unknown outcome, native damage attribution and original payout receipt inspection.
- `tests/coop-personal-fleet-combat.test.cjs`: 26 authored isolated tests for identity, legality, weapons, ammo, ACK-vs-damage, physical combat completion, replay fencing, duplicate damage events and native settlement deduplication. **Not executed** on WORK/native runtime in this session.

### Native engine contracts required before this policy can authorize gameplay

1. Call `coopNpcOrderBridge.issue` with `PERSONAL_FLEET` owner ONLY after explicit enablement in the native arbiter and cross-owner claim integration. Existing fork `coopNpcOrderArbiter.js` does not support this owner yet.
2. The original `coopNpcAmmoSupply.js` inspects real installed NPC weapons, charge cargo and native controllers; it explicitly does **not** generate shots or inventory. Use its native inventory authority and the engine's original dogma/weapon fire path; no synthetic HP damage or fitted-weapon shadow inventory. `nativeWeaponActive`, capacitor, charge compatibility, target legality and ownership proof must be **trusted server-derived**.
3. Crimewatch/standing/faction-war legality, war target status and friendly-fire restrictions must be checked on every native attack dispatch, not inferred from the client.
4. Durable `ISSUING` intent must commit before invoking native bridge; `success:true` is an ACK, NOT evidence of hit/damage or combat completion. Unknown result is a no-redispatch quarantine.
5. Combat contribution is a **read-only projection of original native damage events**, not an economic source. Attribution must use the existing authoritative kill/wreck/reward owner and player eligibility. The `coopNpcLossBridge.js` uses a real wreck and pending exactly-once accounting; PF must not create a second loss.
6. `inspectNativeSettlement` only reads already authoritative and finalized `NATIVE_EVEJS_SETTLEMENT` receipts and always returns `payoutAllowed:false`. It cannot mint ISK, items, XP, bounty or a new reward. Missing/foreign/conflicting settlement stays blocked until source-native receipt verification.
7. Release requires original native fire, hit, ammo use, legal target, safe loss and one canonical reward receipt in native SQLite/WORK tests. No test harness synthetic damage may be represented as real gameplay.

**Status:** PF-06 source reference committed and verified in GitHub; its 26 tests are authored, not yet run. No engine fork modifications, no PLAY or WORK deployment. Do not mark real combat implemented.

## PF-07: physical hull loss, pilot clone recovery and restart reconciliation

**New non-deployed source** (added 2026-11-05):
- `scripts/lib/personal-fleet-loss-recovery.cjs`: pure reducer for `ACTIVE -> LOSS_PENDING -> LOSS_CONFIRMED -> CLONE_RECOVERING -> PILOT_AVAILABLE`; ambiguous native loss is permanently quarantined in `OUTCOME_UNKNOWN`. Requires exact original native wreck, original ship absence in scene and hangar, original native loss-ledger receipt and generation fencing. The clone state may become available without restoring the lost ship or releasing a new physical item.
- `tests/coop-personal-fleet-loss-recovery.test.cjs`: 23 authored cases including duplicate-loss prevention, stale identity, early recovery, wrong wreck, incomplete ledger, ship+wreck double existence, unknown ship location, and restart recovery without respawning an original hull.

**Verified engine fork interfaces:** `coopNpcLife.js` persists `markLoss` / `canFly` / `recover` using its own JSON file. `coopNpcLossBridge.js` creates persistent `PENDING` before economic `recordLoss`, later `COMMITTED`, also JSON-backed. `coopNativeRestore.js` only rematerializes already-authoritative existing native entity+controller, never infers a missing durable ship can be spawned. `coopNativeGateTransfer.js` has a separate filesystem journal. These are multiple persistence authorities — **NOT a single atomic transaction**. A correct fork implementation must reconcile them after crash with proof of native wreck/ship and committed one-time economic consequence; do not assert that a JSON marker is a shared SQLite atomic receipt.

**Required original authority checks:** validate same (pilotID, generation, originalShipItemID, nativeEntityID, systemID, wreckID) in the native loss hook; exactly one wreck for the original ship; no conflicting player hangar item, live native entity or duplicate loss record; no fabricated wreck or replacement ship. `lossLedger.status=COMMITTED` in the pure interface is a trusted native adapter observation, never client-supplied. Keep uncertainty quarantined and require operator repair on inconsistent original evidence. If the pilot is marked `PILOT_AVAILABLE`, original pilot life registry must independently confirm `AVAILABLE`.

**Important crash-recovery gap:** the current reference reducer models the rules but neither makes durable writes, produces a native wreck, modifies an actual NPC clone, nor heals pending filesystem/SQLite commits. A production solution must implement a committed intent/reconcile saga across real EveJS authorities and inject SIGKILL at each step; avoid claiming this unit module provides crash-safe persistence by itself. No live ship spawn, player inventory custody, payment, PLAY/WORK restart or deployment occurred.

**Evidence:** 23 PF-07 unit tests authored and GitHub files verified, **NOT_EXECUTED** in this session. Container could run Node v22.16.0 but cannot resolve github.com to fetch the exact GitHub branch; do not claim tests green until checked-out branch is executed. Run `node --check scripts/lib/personal-fleet-loss-recovery.cjs && node --test tests/coop-personal-fleet-loss-recovery.test.cjs` in an authorized checkout.

## PF-08: original-wallet NPC salaries, arrears and payroll ledger (2026-11-05)

New portable, **NON-DEPLOYED** source:
- `scripts/lib/personal-fleet-payroll.cjs` — immutable invoice and wallet settlement policy, independent reconciliation of ambiguous wallet outcomes, and a bounded canonical payroll ledger. Key: `coop-personal-fleet\u001fpayroll-ledger-v1` in the native `corporationRuntime` SQLite table (proposed; not installed).
- `tests/coop-personal-fleet-payroll.test.cjs` — 36 authored scenarios including original active contract, integer ISK, salary/arrears and integer overflow, durable intent, dual-sided native wallet debit/credit proof, no debit when insufficient funds, unknown commit quarantine, exact idempotent receipts, **overlapping payroll periods across different invoice IDs**, unique settlement IDs, and independent reconciliation.

**Evidence:** In this session the EXACT two file contents fetched from GitHub after commit were executed through a synchronous in-memory V8 JavaScript harness with a small `node:test`, `node:assert/strict`, and `structuredClone` compatibility shim: **36/36 PASS (0 failed)**. This is an actual isolated execution of checked-in code, **NOT a native Node test command, real SQLite transaction, real wallet transfer, WORK E2E, or payroll delivery**. The container has Node 22.16.0 but `github.com` DNS is unavailable to fetch the exact branch via git. Run the real test in a checked-out repo before merge:
```sh
node --check scripts/lib/personal-fleet-payroll.cjs
node --test tests/coop-personal-fleet-payroll.test.cjs
```

### Mandatory production integration

1. Contract authority: bind each payroll period and wage to the authenticated employer, exact active native NPC contract, employer wallet, payee wallet and server-derived tariff. No arbitrary payee or salary from client input.
2. All amounts must be safe-integer **ISK units**, never JS fractional floating point or presumed USD values. If the original native economy stores fractional ISK, implement a proven canonical integer conversion or block.
3. In a native `coopAtomicNativeRows.transact` callback (SQLite `BEGIN IMMEDIATE`), load and validate the entire payroll ledger; refuse overlapping periods within a single contract **even with different invoice IDs**. Insert before any payment attempt, never discard the invoice to bypass an unknown outcome.
4. Commit a distinct `SETTLING` intent **before** attempting native wallet transfer. A native wallet debit+credit must happen in the same authoritative GameStore transaction with a stable original settlement ID, exactly one debit, exactly one credit and durable receipt; otherwise `PAID` is forbidden. `PAID` from callback success without validated original wallet rows is invalid.
5. When debit/credit outcome is unknown, permanently fence the invoice in `OUTCOME_UNKNOWN`; never retry settlement or create a replacement invoice for an overlapping period. Independent reconciliation examines original wallet ledger/settlement history to decide committed paid versus definite no-effect, with no assumption based on a timeout.
6. `INSUFFICIENT_FUNDS` carries no proof of payment and may schedule another attempted settlement ONLY after definite no-debit proof. Partial payments must not be silently represented as full settlement; introduce a separate auditable installment contract if required.
7. Termination/suspension/payroll arrears need a single contract and liability source-of-truth. Do not dismiss a contracted pilot while original unpaid liabilities are orphaned; explicitly settle, transfer or retain them under native contract policy.
8. The current standalone module is a **pure reducer** and accepts abstract trusted adapter assertions. It is not itself the original EveJS wallet service, does not verify the actual character table or perform writes, and cannot guarantee cross-module atomicity by an unconnected callback. Fork write access remained blocked with GitHub 403 in prior attempt. No PLAY/WORK wallet balances were modified.

**Scope note:** Native payroll wire-up and two-player economy QA are still release blockers. Continue work on the existing PR #350 without claiming real salary payments are implemented.
