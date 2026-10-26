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
- `coopNativeHackingAdmission.cjs`: transient one-use Dogma proof bound to the **same authenticated session**, ship, real locked materialized container, analyzer class, physical range (<=10 km), native calculated difficulty/virus stats, and original instance. Tickets expire in 5 seconds.
- `coop-native-hacking-admission-patch.cjs`: reversible hooks into the *existing* Dogma analyzer activation and hacking manager start/click calls. The Dogma service first verifies a legitimate module, target lock, range and analyzer type; it then issues the ticket. A direct hacking RPC without this ticket cannot create an attempt when strict mode is ON. The hacking manager uses authoritative server values, not the client-supplied values.
- An existing attempt cannot win after its ship warps, changes, loses target lock, disconnects, or flies outside the permitted range; the guard releases the temporary being-hacked state and does not falsely mark a failed hack as complete.
- `scripts/overlay-spec.cjs` registers both new native source files for the opt-in hardening and copies the module into the original EveJS runtime. `scripts/patch-evejs-coop.cjs` applies/removes these anchored transforms without introducing an independent source edit path.

**Feature flag (default OFF):** `EVEJS_COOP_NATIVE_HACKING_ADMISSION=1`. This flag is **not enabled by the living-world flag alone**; deploy only after the pinned original client and two-player tests.

**Verification actually executed:** The Dogma and hacking source transforms were applied against the full pinned upstream sources `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Each changed, parsed, reapplication was a byte-identical no-op, removal recovered the original byte-for-byte, and second removal was a no-op. The admission module parsed; 15 server-behavior assertions passed in an isolated V8 harness, plus 9 saved source/logic Node-test cases passed in an equivalent V8 harness. No Docker/native-client execution or GitHub Actions result is claimed. Run `node --test tests/coop-native-hacking-admission.test.mjs` and pinned upstream overlay preflight on-host before deployment.

**Not solved:** the stock synthetic 3-tile hacking puzzle remains simplistic; no complete minigame, NPC analyzer control, actual loot custody, reward credit, or player/NPC compete-for-container E2E has been established. EX-03 NPC remote probes are still blocked by the original scanner's **real character-bound probe state** and NPC materializations having `pilotCharacterID=0`. Do not emulate a player session or read hidden signature coordinates as a substitute for launcher/probe ownership. Resolve native NPC probe hardware, consumption and read-only scan evidence as a dedicated EX-03B integration, with native store receipts before turning it on.
