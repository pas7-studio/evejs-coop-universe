# Chat 22 + 23 — Exploration, wormholes and competing NPC expeditions

**2026-10-26 status: EX-01 CODE_READY / ISOLATED_TESTED / NOT_NATIVE_WIRED / NOT_GAMEPLAY_READY.** This branch adds a read-only expedition rivalry policy and negative tests. It does not deploy or merge into `main`.

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
