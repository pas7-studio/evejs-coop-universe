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

**Verification:** In an isolated V8 harness using native-shaped source fixtures, `tests/coop-npc-probe-evidence.test.mjs`: 15/15 PASS; `tests/coop-npc-expedition-director.test.mjs`: 19/19 PASS (including 3 new remote proof guard cases); `tests/coop-npc-probe-wiring.test.mjs`: 5/5 PASS. The original pinned native `probeScanRuntime` has been inspected, but **its actual Node/SQLite integration and 2-client scene behavior remain NOT RUN**; no false claim of full gameplay readiness.

**EX-03B original launch blocker is addressed in source, not yet accepted in live gameplay.** EX-03B2 below adds a one-unit original cargo-row debit, synchronous `gameStore.flushTableSync("npcCargo")` barrier, physical probe spawn and idempotent scene recovery. It remains explicitly default OFF until real pinned Node/SQLite process-kill testing and original client acceptance. No wormhole jump is permitted by this feature.

## EX-03B2 — Original NPC probe charge launch + crash reconciliation (new, default OFF)

`integration/coopNativeNpcProbeFlight.cjs` now implements an opt-in native cargo-to-probe writer **without inventing a character session or a parallel inventory**:

1. It requires a real named NPC + original controller + original fitted and online group-481 scanner launcher + compatible group-479 non-singleton charge record from `nativeNpcStore`. For safety, each original source charge row must hold **exactly one unit** (`quantity===1`); stacked ammo and singleton items block until a genuine native split/custody implementation is available.
2. The original `cargoID` is the only probe item identity. One original cargo row becomes `quantity:0` plus `deployedProbe:{status:"IN_SPACE",probeID:cargoID,...}` in that **same** row, with initial probe position derived from the physical NPC ship's location (not hidden site coordinates).
3. `nativeNpcStore.upsertNativeCargo` is immediately followed by `gameStore.flushTableSync("npcCargo")`. A probe is NEVER spawned before the synchronous source durability barrier succeeds. The native in-memory ship cargo projection is rebuilt from original source stock to exclude the expended item before spawn.
4. `probeSceneRuntime.buildProbeSceneEntity` plus `scene.spawnDynamicEntity` creates the genuine visible probe with the same original cargoID. If the process crashes between the durable debit and scene spawn, the same in-flight cargo receipt is reconciled into the same scene ID on the next authorized tick. ID collisions and invalid/expired receipts block without minting replacement ammo. Failed flush is quarantined, not optimistically rolled back.
5. The original `probeScanRuntime.buildSignatureScanResults` is then the ONLY scanner authority. Four original in-space probes must overlap the authentic signature; certainty=1, native target identity and original exact coordinates are required before any NPC corporation gets private remote site intel and a same-corp native warp.

**Enabled independently** by `EVEJS_COOP_NPC_PROBE_LAUNCH=1` / `-EnableNpcProbeLaunch`, requiring the independent `EVEJS_COOP_NPC_PROBE_SCAN` opt-in and the existing A-Life/Exploration gates. OFF by default.

**Verification performed now:** 12/12 isolated original cargo debit, durable-flush order, failure/reconciliation, collision and duplicate-prevention tests PASS; 15/15 scanner/hardware proof tests PASS; 19/19 expedition director tests PASS; 7/7 native-source wiring checks PASS in isolated JS execution. The pinned original `probeScanRuntime.buildSignatureScanResults` was also loaded into a dependency-injected V8 harness and returned a genuine perfect native result with four probe positions. The complete original-to-new scanner adapter yielded exactly one proof for that original native scan. This is **not a full native SQLite process-kill / real client integration test**.

**Explicit remaining deployment gates:** isolated real pinned Node suite, SQLite kill-after-write/flush/before-spawn and process restart with exact same cargoID, multi-process writer exclusion, native client rendering and scanner UI, original loadout recipes that provide genuine scanner launchers and *four individually tracked probe charges*, safe expiry/recovery/loot handling, and optional wormhole transit. The gameStore interface does not export a cross-process CAS primitive, so an operator must not activate native NPC probe launching in a replicated multi-writer deployment. This PR is Draft and not game-ready.

## EX-03B3 — Original NPC probe loadout unitization and CI gate

The pinned EveJS `nativeNpcService.buildNativeCargoRecords` allocates **one** original `npcCargo` row per compatible module/charge entry, with `quantityPerModule` saved as a stack. The EX-03B2 debit service correctly rejects un-split stacks. EX-03B3 closes this **at NPC loadout authoring time**, without duplicating already-owned items or touching any existing NPC storage.

- `scripts/coop-npc-probe-loadout-split-patch.cjs` modifies only the *pinned original* `nativeNpcService.js` loadout writer. With **both** `EVEJS_COOP_NPC_PROBE_LAUNCH=1` and `EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT=1`, an authored compatible group-479 scanner probe charge, group-481 fitted launcher, non-singleton persistent hull and 4–8 quantity produces exactly 4–8 **separately allocated original native cargo IDs**, each one unit. No artificial post-spawn stock writes.
- When either flag is disabled, the native original one-row stack behavior is byte-equivalent. Existing NPCs, non-scanner modules/charges, transient NPCs, singleton charges or oversized stock are not split.
- Installer chains the native-source transform with the existing escort materialization patch in reversible order. `Deploy-Coop-RuntimeProbe.ps1` adds `-EnableNpcProbeLoadoutSplit`, which requires separately enabling native probe launch, physical scan, exploration and A-Life. All flags default OFF.
- `.github/workflows/ex03-native-npc-probes.yml` adds a new PR-scoped Node 22 source gate: the eight NPC expedition/probe/hacking suites run against the branch, while `coop-npc-probe-loadout-source.test.mjs` downloads the exact pinned original native service and asserts split-vs-unsplit allocation, original distinct IDs, flag gates, reversibility and restrictions.

**Verification performed so far:** 6/6 original pinned native source split assertions PASS in a dependency-injected JS harness; 8/8 additional EX-03 wiring checks PASS. The new GitHub Actions workflow has been created in the PR but GitHub had **not reported a workflow run** at the time of writing. Do not label this as CI PASS.

**Current functional blocker remains:** pinned upstream `npcLoadouts/data.json` contains **no authored scanner/probe exploratory NPC loadout**. EX-03B3 safely unitizes any correctly authored new native scanner loadout, but does not covertly fit all existing patrols or mint modules. Introduce actual scanner hull presets/capability loadouts and verify native charge compatibility and 2-client visibility in a separate EX-03B4. Current probes launch near the original NPC hull and there is no trusted autonomous probe reposition/sweep across remote system space yet. These are independent gameplay-completion requirements.

**Also not accepted:** process-kill at all GameStore durable barriers, multi-writer CAS, expired-probe cleanup, probe scanning coverage over real faraway signatures, native hacking/loot E2E and wormhole travel. Release flags must remain OFF.

## EX-03B4 — Authored original NPC scout hardware + blind native geometry sweep (2026-10-26)

**Source implementation, default OFF; physical two-client + SQLite process-kill acceptance still pending.**

- A small deterministic subset of **new, durable, named** A-Life `patrol` pilots is eligible for real native scout equipment on spawn (named `coop-pilot-NNN` with numeric suffix divisible by 4). Existing hulls are not retrofitted, and no second independent NPC spawn system was added.
- The opt-in `coop-npc-scout-loadout-patch.cjs` attaches `coopNpcScoutLoadout.cjs` at the original `nativeNpcService.spawnNativeNpcEntityInContext` **before** the original hardware/fitting validator. The authoring helper verifies the real item type metadata and original `explorationAuthority.getCompatibleProbeChargeTypeIDs` for Core Probe Launcher I (`typeID=17938`, group 481) and Core Scanner Probe I (`typeID=30013`, group 479). Original native module/charge IDs are allocated by EveJS, not this helper. Existing modules/charges remain unchanged; a duplicate scanner launcher is rejected.
- Source-verified `coop-npc-probe-loadout-split-patch.cjs` then authors 4 **individually allocated original cargoIDs** for a fresh scanner launcher, each quantity 1 and non-singleton; the EX-03B2 writer persists the original cargo flight receipt before original scene spawn. Presets are not silently enabled for generic NPCs.
- `coopNativeNpcProbeSweep.cjs` adds a 32-cell bounded, deterministic spiral rooted in the genuine NPC ship's durable probe launch origin. It NEVER reads hidden site positions or creates a resolved scan result. It moves **one physical original probe per A-Life tick**, persisting the updated geometry to that same original `npcCargo` row and synchronously flushing before the physical scene movement. Four real probes still have to overlap the target to achieve original `probeScanRuntime` certainty 100%.
- Original probe scene entities are now marked with server-owned `nativeNpcProbe` / `nativeNpcCargoID` so a source-first crash-window geometry change can be replayed on the **same ID**, while unknown or unmarked object collisions are refused. Ambiguous durability failures quarantine the **entire NPC sweep**, preventing further movements until operator recovery. Native cargo unit prices, wallets, hacking loot and scanner math are unchanged.
- The probe sweep runs **after** the original native scan evidence on the existing 30-second A-Life tick and stops when a perfect scan is witnessed; no second scheduler or new player character probe account.
- Separate explicit switches, both OFF by default: `-EnableNpcScoutLoadout` / `EVEJS_COOP_NPC_SCOUT_LOADOUT=1` (requires materialization, split loadout and launching), and `-EnableNpcProbeSweep` / `EVEJS_COOP_NPC_PROBE_SWEEP=1` (requires launching and existing scan gate). An operator must separately opt in to earlier A-Life/native exploration flags.
- Updated native installer chain to apply/remove the scout authoring patch in reverse order around the existing NPC escort and original cargo split patches. Updated the EX-03 Actions workflow to include new source and Node tests.

**Evidence executed:** 8/8 isolated sweep contract tests PASS, 14/14 original NPC probe custody/restart/reconciliation fixture tests PASS, 6/6 scout loadout authoring checks PASS, 10/10 updated wiring checks PASS. The exact pinned `nativeNpcService.js` scanner split + scout source patches parse, apply idempotently and reverse byte-for-byte in an isolated V8 check. **GitHub CI, real pinned Node/SQLite process-kill and native two-client gameplay remain UNVERIFIED.**

**Important remaining gaps:** We still need verified scene/bubble broadcast propagation after an NPC probe's position moves, client-visible scanner probes, real native hull slot/fitting acceptance on an actual spawned patrol scout, full SQLite crash/restart with original item ownership, expiry/recovery of probes, coordinated expedition response, actual hacking and original physical loot custody, NPC wormhole crossings. A deterministic blind sweep might require tuning to real per-system spatial bounds; no hidden signature position is used to accelerate it. These are not gameplay-ready claims. Do not merge or deploy EX-03B4 until CI and live integration gates pass.

## EX-03B5 — Original NPC probe end-of-life and two-phase recover (2026-10-26)

**Source implementation complete in a Draft PR; default OFF; real pinned SQLite process-kill / two-player scene E2E not verified.**

The new `integration/coopNativeNpcProbeLifecycle.cjs` owns a single **native NPC source-of-truth** end protocol. It does not mint objects, use the player probe state, or establish a new wallet/inventory database.

- **Expiry:** `IN_SPACE` → durable `EXPIRED` (`quantity:0`, original `cargoID` tombstone) → verified removal of only that sealed original physical probe. Crashes between commit and physical removal are idempotently recovered. An expired probe is *not* a free refund.
- **Recall:** an original probe must be genuinely within 2,500 meters of its linked live NPC hull **and** have position consistent with its original durable flight receipt. `IN_SPACE` → durable `RECALLING` (`quantity:0`) → original physical entity removed → durable `STOWED` (`quantity:1`) → original ship cargo projection refreshed. A crash at each boundary resumes without simultaneous visible in-space probe and reimbursed inventory.
- Source first: original `nativeNpcStore.upsertNativeCargo` then `gameStore.flushTableSync("npcCargo")` before any original probe removal/refund. All native system/owner/ship/corporation/physical `itemID`/kind/sealed cargoID invariants are checked. Unknown collisions and durability ambiguity fail closed; an ambiguous flush quarantines that original cargo row for operator repair.
- Runs as part of the **existing** native expedition scan phase, before the read-only native scanner; a separate same-phase recall request is allowed only when a perfect native scan is witnessed. Only sealed original NPC probes are removed through the native runtime `removeDynamicEntity`.
- Additional explicit flag `EVEJS_COOP_NPC_PROBE_LIFECYCLE=1` / `-EnableNpcProbeLifecycle`, requiring existing native probe launch and the scan/A-Life gates. OFF by default.
- Added `tests/coop-native-npc-probe-lifecycle.test.mjs` (12 source/scene fault and recovery fixtures) and `tests/coop-native-npc-probe-full-cycle.test.mjs` (2 whole original-cargo-ID lifecycle/restart fixtures), included in the existing EX-03 Node CI source gate; expanded `coop-npc-probe-wiring.test.mjs` (12 checks). All 26 isolated JS callbacks PASS. CI itself has NOT run.

**Critical remaining acceptance:** real original `gameStore` SQLite persisted operation after abrupt OS process kill, two native clients and destination bubble movement visibility, native scanner 100% in an actual star system, cross-process exclusivity, physical movement broadcast, stock actual-fitting checks, remote recall trajectory and long-duration probe management. A near-hull recall is not a teleport: an originally faraway probe cannot be reimbursed until physically present within reach. No warrant to enable in a live multiwriter universe or merge PR based on mock/fixture PASS alone.

## EX-03B6 — Bubble-visible native probe projection + actual SQLite crash-gate (2026-10-26)

**Code and CI harness added; actual live two-client and pinned SQLite process-kill CI still not executed. All switches stay OFF.**

The earlier EX-03B4 sweep committed original probe geometry durably but then mutated `physical.position` directly. That in-process assignment is insufficient proof of bubble-visibility or client destiny notification. This stage replaces the unsupported projection with `coopNativeNpcProbeSceneTransition.cjs`:

- A previously durable `npcCargo` `IN_SPACE` receipt with original `cargoID`, owner, type, system and position is required before any scene action.
- Only a sealed in-scene original NPC probe (`nativeNpcProbe === true`, `nativeNpcCargoID === cargoID`) may be relocated. A foreign/anonymous entity collision is denied.
- Original native `spaceRuntime.removeDynamicEntity(systemID, originalCargoID, {allowSessionOwned:false,broadcast:true})` must succeed **and** the entity must actually disappear. The original `probeSceneRuntime.buildProbeSceneEntity` is then used to create the same ID, owner and type at the durable destination; original `scene.spawnDynamicEntity(candidate,{broadcast:true})` must report success and the new physical entity must be read back.
- If remove/spawn fails after a durable coordinate write, the unchanged `npcCargo` receipt is retained; the next existing A-Life flight reconciliation may spawn the **same** original ID again. No synthetic replacements, silent coordinate mutation, player session or extra scheduler.
- The original EX-03B2 flight recovery and EX-03B4 sweep now **require** this source-native projection adapter, and the original installer overlay copies the module. Broadcast calls are tested with two isolated receiver simulations, but this is *not* yet a real two-client gameplay acceptance.

A separate executable `scripts/verify-npc-probe-sqlite-crash.mjs` now covers the original pinned EveJS SQLite `npcCargo` path. The CI workflow sparse-checkouts **exact** `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, performs `npm ci` for the pinned server and launches actual Node subprocesses against a fresh, attested, disposable `EVEJS_GAMESTORE_DATA_DIR`. Each stage calls original `nativeNpcStore.upsertNativeCargo` + original `gameStore.flushTableSync("npcCargo")`, then intentionally sends itself **SIGKILL** (no graceful cleanup handlers). Fresh child processes verify source cargo identities after preparing stock, launching, moving, expiry, recall, stow and final restart: no extra original rows, no returned expired cargo, and exactly the original stowed charge. The harness checks that `gamestore.sqlite` actually exists. It does not yet run a native game world or a real physical-scene crash; those remain separate acceptance gates.

**Verified now in isolated JavaScript source/scene fixtures:** scene projection 6/6 PASS, original flight 14/14 PASS, sweep 8/8 PASS, lifecycle including false removal success ACK 13/13 PASS, original combined launch/sweep/expiry/recall with controller recreation 2/2 PASS, and 14/14 source-wiring checks PASS. The external SQLite SIGKILL script parses in a JS syntax check but **its pinned SQLite command has NOT yet been run**; GitHub Actions reported no feature-branch runs. Do not call its result PASS.

**Mandatory before main merge / feature enablement:** get the EX-03 Actions workflow to complete (including real pinned SQLite SIGKILL tests); perform two authenticated clients in one system and across public-grid boundaries to verify native remove/add broadcasts and exact same item identity; prove real NPC scout launch module fit, four original charges, materialized and visible probes; verify native scan certainty and NPC corporation intel/warp; confirm GameStore single-writer deployment and NPC crash recreation. Further hacking loot custody and wormhole transit are separate uncompleted goals.

## EX-03B7 — Original physical provenance, production-state-machine SQLite crash gate (2026-10-26)

**Implemented on PR #286 (Draft), with all runtime flags default OFF. Native SQLite kill/restart remains NOT RUN because feature-branch GitHub Actions reports no runs.**

An EX-03 security review identified a replay and scan admission weakness: merely matching a probe scene object's itemID, owner and coordinates was insufficient; an unrelated server-side physical probe could impersonate the original cargo. The original scanner and the launch replay now require **both** `physical.nativeNpcProbe === true` and `physical.nativeNpcCargoID === original cargoID`, plus exact native source systemID. The original flight materializer's idempotent already-present case also demands these seals. Unsealed, wrong-cargo-seal or missing-system physical probes never generate a scan proof or satisfy replay.

New negative tests cover this: scanner evidence **18/18 isolated PASS**, original launch/recovery **16/16 isolated PASS**; pinned original upstream `probeScanRuntime` and `probeSceneRuntime` integrated with a sealed NPC proof **1/1 isolated PASS**.

The existing `verify-npc-probe-sqlite-crash.mjs` checks durable original row transitions. A **new, stricter source-integration** `scripts/verify-npc-probe-feature-sqlite-crash.mjs` exercises the production modules `createNativeNpcProbeFlight`, `createNativeNpcProbeSweep` and `createNativeNpcProbeLifecycle` against the actual pinned `nativeNpcStore` and SQLite-backed `gameStore`, with separate fresh Node processes and OS `SIGKILL` after each successful durable transition. The workflow now runs both subprocess suites after installing pinned original EveJS native dependencies.

New production-module test stages:
1. Seed four ORIGINAL separately identified `npcCargo` charges plus native entity/module/controller source rows into disposable pinned SQLite.
2. Launch all four through `createNativeNpcProbeFlight`, reloading the actual database after an OS `SIGKILL` between launches.
3. Move one original probe through `createNativeNpcProbeSweep`; persist/kill/reload.
4. Authorize a nearby physical return for the second probe via original `RECALLING` durability fence; kill; reconstruct scene without the removed physical item and use `createNativeNpcProbeLifecycle` for original `STOWED` return; kill/reload.
5. Expire the first probe with no refund; kill/reload; assert exact original IDs, correct quantities, original scanner geometry, no duplicate items.

The scene in this test is **native-shaped and controlled**, not the actual two-client EveJS runtime; original cargo access and SQLite persistence are real *when CI executes*. Do not label the test PASS until it runs on an actual pinned native checkout.

**Safety:** both SQLite crash scripts require `EVEJS_TEST_STORE_ISOLATED=1`, exact `<os.tmpdir>/evejs-ex03b{6,7}-*` roots, a correctly matching `.evejs-test-store-attestation.json`, no symlink root/data, and `EVEJS_GAMESTORE_DATA_DIR=<that root>/data` before importing the original native GameStore. They must never touch the production database.

**Remaining release gates:** GitHub Actions execution of both actual SQLite SIGKILL suites; original server-backed NPC scout fitting/cargo provisioning; verified physical probe bubble visibility with two authenticated clients; authoritative scanner certainty against a real live signature; probe reclaim and warehouse/loot economic settlement; single-writer deployment. Keep PR #286 Draft and all feature flags OFF.

## EX-03B8 — Original recovered probe reuse & safe relaunch (2026-10-26)

A real gameplay limitation was found during lifecycle review: EX-03B5's completed `IN_SPACE → RECALLING → STOWED` returned one original probe charge with `quantity:1`, yet the launch writer and hardware preflight both required a charge with no `deployedProbe` receipt. NPC explorers therefore could not reuse recovered probes.

**Fixed in source:**
- `coopNpcProbeHardware.cjs` now considers the **same original item** with a verified durable `STOWED` receipt as ready stock; it never treats `IN_SPACE`, `RECALLING`, `EXPIRED` or ambiguous receipts as charge inventory.
- `coopNativeNpcProbeFlight.cjs` permits `STOWED → IN_SPACE` on the **exact original cargoID**. It requires matching receipt `probeID`, `entityID`, `ownerID`, `typeID`, a valid original system, source launch time, and a completed `recoveredAtMs` between launch and current time. No new ID, wallet settlement, synthetic stock or hidden scanner certainty is generated. The new in-flight receipt overwrites the completed one only **after** the original `npcCargo` debit is synchronously flushed.
- Any native scene entity occupying a candidate charge's original ID is now rejected **before debit**, including new charge units. This prevents a foreign original-ID collision from consuming legitimate NPC scanner stock. A post-spawn ACK must also confirm exact original `cargoID`, owner, system and server-owned provenance seal.
- `verify-npc-probe-feature-sqlite-crash.mjs` now includes `stow → relaunch → recall again → stow again` in the real pinned SQLite production-state-machine test sequence, with an actual OS SIGKILL between each stage when the workflow executes.
- Expanded GitHub Actions `paths` triggers to include the crash harnesses and **all** native NPC probe suites, not just the original first-stage test files.

**Verified in isolated JS source fixtures:** native launcher/recovery 19/19 PASS, scanner evidence with STOWED preflight 19/19 PASS, original flight+sweep+lifecycle source-cycle 3/3 PASS, native scene transition 6/6, sweep 8/8, lifecycle 13/13. The SQLite SIGKILL/production test files have been added and syntax-checked but **have not run against pinned SQLite on a GitHub Runner**. Live two-client and real native scout fit acceptance remain unverified. Do not enable any experimental flags in production or merge based on isolated fixture PASS alone.

### EX-03B8 post-review hardening

The scanner hardware readiness probe now accepts **only physically launchable, non-singleton original charge rows with exactly `quantity:1`**. It refuses stacked stock and invalid/unfinished `STOWED` receipts rather than presenting misleading `NATIVE_SCANNER_HARDWARE_READY` status. The launch path also blocks ANY pre-existing scene item with a candidate original cargoID **before** the original source debit. Successful scene-spawn ACKs must revalidate the original source seal and exact systemID.

An additional original-source test scenario in `verify-npc-probe-feature-sqlite-crash.mjs` validates scanner hardware availability **4 original charges before the first launch, exactly 1 recovered original charge before re-launch**, and follows `STOWED → IN_SPACE → RECALLING → STOWED` through pinned native SQLite across separate SIGKILL-restarted processes. **The CI execution of this script is not yet verified.**

Isolated JS fixture results after these changes: scanner hardware/native evidence **21/21 PASS**, launch/recovery **19/19 PASS**, full original lifecycle **3/3 PASS**, native scene transition **6/6 PASS**, blind sweep **8/8 PASS**, lifecycle **13/13 PASS**. Separate real GameStore process-kill and live two-client gates remain open.

## EX-03B9 — Bounded native NPC scout scheduling (2026-10-26)

**Implemented as opt-in A-Life integration on PR #286, still Draft.**

A source-level scheduling review found an actual gameplay bug: the original expedition director scanned only `all.slice(0,2)` patrols, even though only a minority of fresh patrols are source-authored with a genuine probe launcher. Two ordinary patrols could occupy these slots permanently, preventing the already-materialized probe scout from ever launching, sweeping or scanning. A separate pre-cap `assignments.slice(0,32)` allowed miners and haulers to starve patrol discovery.

The director now:
- Filters by original verified named pilot + `patrol` role **before** the per-tick `maxPilotsPerTick` cap.
- Accepts a read-only `isNativeProbeScout(entityID,systemID)` native-store authority; the world injects the source `npcModules` check for a durable original NPC with a real fitted, online group 481/category 7 launcher, matching owner and system.
- Selects **up to two real equipped patrol hulls** for native probe scan per existing 30-second A-Life tick. Unfitted NPCs do not consume those two scan slots; lookup errors fail closed, and no new scheduler, non-native scanner or fake intel is created.
- Keeps the original read/list native site witness and order-bridge arbitration; even a successful scan never bypasses original cargo/physical probe evidence checks for private signature coordinates.

**Source test evidence**: `tests/coop-npc-expedition-director.test.mjs` 23/23 isolated PASS (including 40 earlier miners/haulers, wrong first two patrols, store exception and bounded native scanner selection); `tests/coop-npc-probe-wiring.test.mjs` 17/17 isolated PASS. Source workflow now additionally accepts push on the specific PR feature branch, so the source gate can be scheduled without first merging the workflow into main. As of this update GitHub Actions reports **0 runs** on this branch; no CI PASS or real player/NPC two-client runtime can be claimed.

**Live acceptance still required**: actual spawned patrol fitting and inventory, sighting of first physical NPC probes by two authenticated clients and after scene bubble movement, original native 100%-certainty on a real site, real SQLite SIGKILL process recovery, then hacking + physical loot. All feature flags remain OFF.

## EX-03B10 — Scanner-first admission, bounded fairness and CI filter parity (2026-10-26)

**Implemented in PR #286. Feature remains DRAFT, with all experimental flags OFF.**

EX-03B9 still had a live starvation path: the director first truncated `candidateIDs` to `maxPilotsPerTick`, then searched that truncated set for scanner-equipped NPCs. Forty actual **patrol** ships (not miners) ahead of a source-fitted scout could therefore prevent launch/scanning indefinitely; the earlier miner-prefix test did not catch it.

Changes:
- Before building the ordinary patrol cohort, try original `isNativeProbeScout(entityID, systemID)` over a bounded, sorted candidate window; only a separately verified durable native pilot and controller may be admitted.
- Prioritize at most **two fitted scouts** into the usual `maxPilotsPerTick` cohort. A missing hardware authority and exceptions from the original module store **fail closed** (no fallback to an unverified patrol).
- Inspect no more than **128 candidate hardware records per tick**. Advance the window by the full inspected budget even when two scanners are found early, so >128 patrols do not permanently starve late scouts. Uses the pre-existing 30-second A-Life tick; no extra scheduler, cargo creation or remote intel shortcut.
- Fixed the EX-03 workflow `push.paths` list to mirror the `pull_request.paths` list. The old push list omitted `integration/coopNpcExpedition*.cjs`, so changes to the scheduling implementation alone could not match that push event.
- Added regression cases for 43 preceding patrols under a tiny 2-pilot cap, 128-check sliding window, and missing native hardware authority; updated source-wiring contracts.

**Verification completed here:** 26/26 director tests in an isolated V8 harness using the actual director and competition modules, plus 17/17 wiring assertions reading the current actual files from the feature branch. These are **not a substitute for real `node --test` execution**, the pinned source `npm ci`, SQLite SIGKILL process tests, or a real two-client server session.

**CI diagnostics:** the workflow file is absent on `main`, so its `workflow_dispatch` UI cannot be invoked until the workflow is registered on the default branch. GitHub supports branch-local `push` workflows, but this alone does not prove the organization's Actions setting permits a run. Check repository **Settings → Actions → General** and the full Actions runs UI if new pushes still yield no runs. The connected run lookup only exposes PR-triggered runs; a zero response there is **not** proof that no `push` event ran.

**Release acceptance still OPEN:** GitHub Node 22 job with pinned upstream checkout, native SQLite actual production-state-machine SIGKILL and restart, original NPC scout fitting verified inside a running server, two authenticated clients observing native probe launch/sweep, native 1.0 certainty signature, NPC warp, followed by independently implemented hacking, physical loot and warehouse delivery. No production enablement or merge claimed.
