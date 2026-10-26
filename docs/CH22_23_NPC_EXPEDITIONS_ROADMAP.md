# Chat 22 + 23 — Exploration, wormholes and competing NPC expeditions

**2026-10-26 status: EX-01/EX-02/EX-03 PARTIAL CODE_READY / ISOLATED_TESTED / OPT-IN NATIVE WIRING / LIVE_UNVERIFIED.** This branch adds a read-only expedition rivalry policy and negative tests. It does not deploy or merge into `main`.

## Reuse the original authorities

- Scan signatures and certainty: native `scanMgrService`, `probeScanRuntime`, `signatureRuntime`. The existing opt-in `coopNativeScanProof` protects **player** perfect scans; it must not be borrowed by NPC actors.
- Shared fleet bookmarks and real warp: native `bookmarkRuntimeState`, `beyonceService`, `fleetRuntime`; shared-folder ACL stays authoritative.
- Wormhole pairs: native `wormholeRuntime`, `wormholeMgrService` and optional `coopWormholeJumpFence` mass/polarization/transition safeguard. Preserve operator-repair quarantine for uncertain cross-store outcomes.
- NPC ownership and fleet actions: durable pilot ↔ real hull mapping, native ship controller, `coopNpcOrderArbiter`/bridge, and the existing single A-Life 30-second tick. **Never install a second action scheduler.**
- Resource ownership and economics: original `itemStore`, `npcCargo`, container/dungeon state, wallets and native station/market sale evidence. No exploration observation can mint items or ISK.

## Intended continuous gameplay loop

1. **Discover:** players use real probes; NPC scouts patrol actual landmarks, operate actual sensor modules once native support exists and only receive locally observed or legitimately relayed intel. A hidden native signature catalog is not a universal NPC GPS.
2. **Survey:** scout + guard + hauler make one expedition. Physical movement goes through native scene/warp, with actual ship and site fingerprints.
3. **Compete:** NPC and two players can find the same materialized site. First arrival yields knowledge/timing, **not ownership of a container**. Native custody decides who gets each real item. NPC react via risk, reinforcement, retreat, diplomacy and persistent reputation.
4. **Exploit:** safe native data/relic analyzer and hacking, salvage/rare gas/ore, physical haul, NPC settlement in wallet and inventory. No synthetic loot.
5. **Traverse:** real wormhole polarization, mass, lifetime, destination and collapse; stranded NPC fleets require legitimate recovery, not a teleport.
6. **Remember:** corporate intel, losses and expedition status recorded durably, without leaking private scan coordinates to other corporations or clients. Rumors and EVEmail derive only from observed facts.

## Staged implementation

| Stage | Content | Acceptance |
|---|---|---|
| EX-01 | Read-only on-grid NPC/player site witness + contested-site intent | Real scene + ship/pilot authority; stale-site, duplicate, spoof and expiry tests |
| EX-02 | Scout/escort/hauler fleet and one A-Life arbiter path | Actual native motion and destination; survival/pending-warp priority; recovery after restart |
| EX-03 | NPC scanning + corporation intel | Native sensor/cycle evidence, physically scoped observations; no hidden-coordinate or private bookmark leakage |
| EX-04 | Secure data/relic hacking, resource recovery and native sale | Correct analyzer/range/target lock, original container inventory, one custody transfer, ISK audited |
| EX-05 | NPC real wormhole transition | Original mass, collapse, polarization; same ship/cargo; uncertainty quarantine, native SQLite restart |
| EX-06 | Rival reactions, escorts, diplomacy, discoverable opportunities | Valid NPC combat/retreat via arbiter, player interference and truthful public events |
| EX-07 | Full coop live validation | Two authorized clients + NPC squads: scan → bookmark ACL → physical site → contested extraction → sale → reconnect |

## EX-01 design and restrictions

New `integration/coopNpcExpeditionCompetition.cjs` exports `createExpeditionCompetition`. The caller provides trusted server-only `resolveNativeSite` (the actual native catalog) and `resolveNativeNpcPilot` (durable named-pilot link **and** active native controller). `observe` checks the original scene, same system, physical non-warping real ship within 150 km of actual native site coordinates, and exact active player session or verified NPC identity. A site fingerprint includes identity, instance/pair and actual position; reused IDs or moved sites cannot reuse old observations. NPC/player competition preserves actual first observer; duplicate observations are idempotent. `plan` returns **only** `SURVEY_SITE` or `OBSERVE_RIVAL` intent, never executes orders. There is a bounded in-memory history with expiry; all results are read-only.

This PR deliberately does **not** add the module to `overlay-spec.cjs`, grant an order arbiter `EXPEDITION` owner, activate new env flags, inspect client data, persist game state or issue movement. EX-02 must wire the trusted adapter and existing A-Life phase before gameplay can exercise it.

## Unresolved native acceptance

- The pinned native `hackingMgrService` currently takes untrusted client difficulty fields and lacks complete native analyzer / module / range / lock / container custody verification. Do not enable rewards based on that.
- `coopWormholeJumpFence` remains opt-in and needs actual two-client + Node/SQLite crash window acceptance.
- NPC scan modules, materialized native exploration destinations, active controller/registry adapter, real loot and market movement, runtime persistence and two-client native E2E are **not yet done** by this PR.
- Run `node --test tests/coop-npc-expedition-competition.test.mjs` on a normal checkout, then pinned native source preflight and host acceptance in EX-02. No merge, deployment, CI success or live game demonstration is claimed here.

## Follow-on implementation: EX-02 physical scouting and same-corp rendezvous

- `integration/coopNpcExpeditionDirector.cjs` is registered by the **existing central overlay manifest** and receives `signatureRuntime.listSystemSignatureSites`, original `nativeNpcStore`, native controllers, `coopNpcOrderBridge`, and `npcRuntime.warpToPoint` from the existing `coopVirtualWorldRuntime`.
- In the existing **30-second world tick only**, the opt-in `native-expeditions` phase samples at most 2 previously active scenes. No second interval, independent scheduler, synthetic site or NPC spawn.
- Source-backed NPC scanning is still limited to physically observing **already materialized original sites**, at most 150 km away. Both the native signature catalog and the original in-scene site entity must agree on exact ID and position. This is **not** a remote NPC probe-scanning implementation.
- Only an original, durable named NPC-to-hull mapping and matching native controller/physical corporation ID can claim a scout observation. Intelligences are transient, per-corporation, site-fingerprinted, expired after 10 minutes. NPCs of other corporations, player characters and private bookmarks cannot access an expedition tip.
- A second authorized `patrol` NPC of the same corporation may receive **one** true native warp order per scene tick to the revealed site, through the shared `EXPEDITION` order-arbiter owner. Active warp, combat, patrol and war leases, manual native orders, corrupt IDs and unverified scene or controller block. The target and native corporation are re-read immediately before invoking native warp.
- A source-level wiring regression suite covers the original arbiter semantics: existing patrol leases refuse expedition retasking, and emergency `TACTICS` can preempt an idle expedition order. No loot grants, hacking completion, bookmark changes or wallet writes are added.
- All runtime switches default OFF. Explicit `EVEJS_COOP_ALIFE=1` and `EVEJS_COOP_NPC_EXPEDITIONS=1` are both required. Other existing native ecosystem prerequisites still apply.

**Evidence:** 27 isolated source/fixture Node tests executed locally, PASS; additional native-bridge/wiring tests committed but their execution in a real checkout is pending. The deployed pinned upstream EveJS host, real NPC movement, scanned signatures, active modules, secure hacking and original SQLite/2-client E2E remain NOT VERIFIED. Do not classify EX-02/03 as gameplay-complete.

**Next:** strict native probe launch + scanning for owned NPC vessels (not server-catalog omniscience), safer analyzer/hacking entry point, durable corporate intel/restart reconciliation, and guarded wormhole escort/hauler transport.

### EX-03: physical player rivalry (follow-up)

The existing competition witness now observes up to 32 real initialized player sessions per native site tick, using current ships in the same scene. This **does not share player scans or private bookmarks** with NPC corporations. Only the count of newly witnessed players and newly contested sites is added to server-side opt-in telemetry. Repeated sightings do not repeat rivalry alerts. The original server only dispatches a same-corporation patrol if a genuine NPC scout previously physically witnessed the materialized site. Temporary corporate intel is capped to 512 tips, pending ship/site deduplication to 512 records. This is **not** full probe-based NPC scanning, persistent expedition fleet composition or hacking.

**Latest isolated local evidence:** Node 22 `node --test tests/coop-npc-expedition-competition.test.mjs tests/coop-npc-expedition-director.test.mjs`: **29 PASS / 0 FAIL**. Additional native arbiter wiring tests are checked into the repository, but have not run against a deployed native EveJS checkout. No end-to-end gameplay or live two-client acceptance is claimed.

## EX-04A / 2026-10-26 — Native hacking admission hardening (opt-in)

The pinned `hackingMgrService.Handle_StartNewGameInstance` trusts client-supplied game type, difficulty, virus coherence, strength, and slots; and a direct client RPC can request the same game without first using an actual analyzer. This is not acceptable for any eventual materialized site loot.

This branch adds:
- `coopNativeHackingAdmission.cjs`: transient one-use Dogma proof bound to the **same authenticated session**, ship, real locked materialized container, analyzer class, physical range (<=10 km), native calculated difficulty/virus stats, and original instance. Start tickets expire in 5 seconds, while a legitimately started game has a separate 3-minute validation window.
- `coop-native-hacking-admission-patch.cjs`: reversible hooks into the *existing* Dogma analyzer activation and hacking manager start/click calls. The Dogma service first verifies a legitimate module, target lock, range and analyzer type; it then issues the ticket. A direct hacking RPC without this ticket cannot create an attempt when strict mode is ON. The hacking manager uses authoritative server values, not the client-supplied values.
- An existing attempt cannot win after its ship warps, changes, loses target lock, disconnects, or flies outside the permitted range; the guard releases the temporary being-hacked state and does not falsely mark a failed hack as complete.
- `scripts/overlay-spec.cjs` registers both new native source files for the opt-in hardening and copies the module into the original EveJS runtime. `scripts/patch-evejs-coop.cjs` applies/removes these anchored transforms without introducing an independent source edit path.

**Feature flag (default OFF):** `EVEJS_COOP_NATIVE_HACKING_ADMISSION=1`. This flag is **not enabled by the living-world flag alone**; deploy only after the pinned original client and two-player tests.

**Verification actually executed:** The Dogma and hacking source transforms were applied against the full pinned upstream sources `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Each changed, parsed, reapplication was a byte-identical no-op, removal recovered the original byte-for-byte, and second removal was a no-op. The admission module parsed; 15 server-behavior assertions passed in an isolated V8 harness, plus 11 saved source/logic Node-test cases passed in an equivalent V8 harness. No Docker/native-client execution or GitHub Actions result is claimed. Run `node --test tests/coop-native-hacking-admission.test.mjs` and pinned upstream overlay preflight on-host before deployment.

**Not solved:** the stock synthetic 3-tile hacking puzzle remains simplistic; no complete minigame, NPC analyzer control, actual loot custody, reward credit, or player/NPC compete-for-container E2E has been established. EX-03 NPC remote probes are still blocked by the original scanner's **real character-bound probe state** and NPC materializations having `pilotCharacterID=0`. Do not emulate a player session or read hidden signature coordinates as a substitute for launcher/probe ownership. Resolve native NPC probe hardware, consumption and read-only scan evidence as a dedicated EX-03B integration, with native store receipts before turning it on.

### EX-04A review follow-up

- Prevented a valid hacking attempt from being invalidated after the 5-second one-use *start* token expires: active play remains possible up to 180 seconds, with continuing native lock/ship/range verification.
- Added a separate session-identity fence on `QuitHackingAttempt`. A second socket or impostor with the same character ID cannot force a real attempt to fail and increment failure counts.
- `Deploy-Coop-RuntimeProbe.ps1` exposes two independently explicit switches: `-EnableNpcExpeditions` requires `-LivingCoop -Alife`; `-EnableNativeHackingAdmission` requires `-EnableNativeExploration`. Neither is implied by `-LivingCoop`.
- Re-ran the full pinned Dogma/hacking source-patch parse, exact reversal and duplicate-apply checks: PASS. Re-ran the 11 saved opt-in hacking source/logic test callbacks in a V8 harness: 11 PASS. Real Node suite, protected SQLite recovery, and two-client site hacking are **still pending**.

## EX-03B — Native original NPC probe evidence (implemented 2026-10-26, fail-closed)

EX-03B's scanner **reuses the pinned native `probeScanRuntime.buildSignatureScanResults` for actual coverage and certainty** rather than reading full system signatures as if they were scan wins.

- `coopNpcProbeHardware.cjs` checks an actually materialized, durable, named native NPC hull and controller, a fitted/online group-481 launcher in original `npcModules`, authoritative type compatibility and non-transient group-479 scanner charges in original `npcCargo`. The result is only `HARDWARE_READY`; it does NOT launch anything.
- `coopNpcProbeScanEvidence.cjs` is a strict read-only proof reader. At least four **unique original NPC cargoIDs** must have a persisted `deployedProbe` receipt with `quantity=0`, module/owner/system/type/range/time proof and an exact live `kind:probe` scene object with the SAME original cargoID, owner, system, type and current position. User/client probes, missing owners, expired flights, range spoofing and unmaterialized probes never count.
- Only `certainty === 1` from original `probeScanRuntime`, with matching original `signatureRuntime` site target ID and exact original coordinates, yields a private NPC corporation scan proof. <100% native scans carry no remote coordinates.
- `coopNpcExpeditionDirector.cjs` admits remote tips **only** from that native probe witness; the original signature fingerprint must agree and is recomputed before issuing a one-per-tick same-corporation warp through the original NPC order arbiter.
- Integrated into the already existing 30-second `native-expeditions` A-Life phase in `coopVirtualWorldRuntime.cjs`, with per-tick read caps. No second schedule, synthetic probes, signature spawn, item/ISK credit or client-session impersonation.
- New explicit opt-in `EVEJS_COOP_NPC_PROBE_SCAN=1` / deployment `-EnableNpcProbeScan` requires `-EnableNpcExpeditions -EnableNativeExploration`. Default OFF.

**Verification:** In an isolated V8 harness using native-shaped source fixtures, `tests/coop-npc-probe-evidence.test.mjs`: 13/13 PASS; `tests/coop-npc-expedition-director.test.mjs`: 19/19 PASS (including 3 new remote proof guard cases); `tests/coop-npc-probe-wiring.test.mjs`: 5/5 PASS. The original pinned native `probeScanRuntime` has been inspected, but **its actual Node/SQLite integration and 2-client scene behavior remain NOT RUN**; no false claim of full gameplay readiness.

**Remaining EX-03B blocker: native probe launch/charge custody writer.** The original `npcCargo` is not currently debited/converted into authoritative `deployedProbe` flight receipts by any safe native runtime path. The pinned gameStore uses asynchronous writes and no exported cross-table CAS transaction. Therefore EX-03B must remain a **negative-by-default dormant proof path** until a new source-integrated launch transaction (one original unit -> one deployed native cargoID, crash recovery, scene materialization, inventory projection, expiry/recover, no dupe across restart) has full SQLite fault-injection and client acceptance. NEVER synthesize such receipts or reuse the player `characterID` probe table for NPCs.

**Next implementation:** a staged in-place cargo-row state machine with explicit durable flush/recovery barriers and source-native materialization checks, then controlled real probe deployment and recovery. No wormhole jump may be triggered by this read-only proof pipeline until EX-03B writer and EX-07 transit safety pass.

## EX-03B2 — Original NPC probe charge launch + crash reconciliation (new, default OFF)

`integration/coopNativeNpcProbeFlight.cjs` now implements an opt-in native cargo-to-probe writer **without inventing a character session or a parallel inventory**:

1. It requires a real named NPC + original controller + original fitted and online group-481 scanner launcher + compatible group-479 non-singleton charge record from `nativeNpcStore`. For safety, each original source charge row must hold **exactly one unit** (`quantity===1`); stacked ammo and singleton items block until a genuine native split/custody implementation is available.
2. The original `cargoID` is the only probe item identity. One original cargo row becomes `quantity:0` plus `deployedProbe:{status:"IN_SPACE",probeID:cargoID,...}` in that **same** row, with initial probe position derived from the physical NPC ship's location (not hidden site coordinates).
3. `nativeNpcStore.upsertNativeCargo` is immediately followed by `gameStore.flushTableSync("npcCargo")`. A probe is NEVER spawned before the synchronous source durability barrier succeeds. The native in-memory ship cargo projection is rebuilt from original source stock to exclude the expended item before spawn.
4. `probeSceneRuntime.buildProbeSceneEntity` plus `scene.spawnDynamicEntity` creates the genuine visible probe with the same original cargoID. If the process crashes between the durable debit and scene spawn, the same in-flight cargo receipt is reconciled into the same scene ID on the next authorized tick. ID collisions and invalid/expired receipts block without minting replacement ammo. Failed flush is quarantined, not optimistically rolled back.
5. The original `probeScanRuntime.buildSignatureScanResults` is then the ONLY scanner authority. Four original in-space probes must overlap the authentic signature; certainty=1, native target identity and original exact coordinates are required before any NPC corporation gets private remote site intel and a same-corp native warp.

**Enabled independently** by `EVEJS_COOP_NPC_PROBE_LAUNCH=1` / `-EnableNpcProbeLaunch`, requiring the independent `EVEJS_COOP_NPC_PROBE_SCAN` opt-in and the existing A-Life/Exploration gates. OFF by default.

**Verification performed now:** 10/10 isolated original cargo debit, durable-flush order, failure/reconciliation, collision and duplicate-prevention tests PASS; 15/15 scanner/hardware proof tests PASS; 19/19 expedition director tests PASS; 7/7 native-source wiring checks PASS in isolated JS execution. The pinned original `probeScanRuntime.buildSignatureScanResults` was also loaded into a dependency-injected V8 harness and returned a genuine perfect native result with four probe positions. The complete original-to-new scanner adapter yielded exactly one proof for that original native scan. This is **not a full native SQLite process-kill / real client integration test**.

**Explicit remaining deployment gates:** isolated real pinned Node suite, SQLite kill-after-write/flush/before-spawn and process restart with exact same cargoID, multi-process writer exclusion, native client rendering and scanner UI, original loadout recipes that provide genuine scanner launchers and *four individually tracked probe charges*, safe expiry/recovery/loot handling, and optional wormhole transit. The gameStore interface does not export a cross-process CAS primitive, so an operator must not activate native NPC probe launching in a replicated multi-writer deployment. This PR is Draft and not game-ready.
