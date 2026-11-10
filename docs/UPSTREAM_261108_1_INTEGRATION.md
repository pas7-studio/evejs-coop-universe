# Upstream release 261108.1 — what changed and what it costs us

Status: **integration open, not merged, not built, not deployed.**
Owner stack `evejs`/`evejs-agents` untouched. Main fork checkout
`C:\Games\EveCoop\upstream-evejs` is clean at `f64fed0` (a test merge was
started there by mistake, aborted, `git status` empty, HEAD unchanged).

## Provenance

| Item | Value |
| --- | --- |
| File | `EveJS-261108.1.zip` (70.5 MB, 2026-11-08+09) |
| SHA-256 | `373266A05FD9ACF0C220D06D5469907637A6D09BF2CF926ADF4AAEE97A3CCC59` |
| `config/version.json` | `{"evejsVersion":"261108.1","configSchemaVersion":1}` |
| Root `package.json` | `name: evejs-repo`, `version: 261108.1` |
| Distribution time | ~800 upstream commits since 261028.1 (author's count) |
| Extraction | `O:\tmp\evejs-261108.1` |
| Import branch | `upstream/261108.1` = commit `1d6b691` in the fork (parent `c3ea396`) |
| Integration worktree | `O:\tmp\m261108`, branch `integration/261108.1` (half-merged, 137 conflicts = work queue) |

The original project still publishes **git-less zip releases**, not commits:
`gameboys84/EveJS` `main` is still `c3ea396` (pushed 2026-07-22), so the pin in
`docs/UPSTREAM.md` and `scripts/patch-evejs-coop.cjs` cannot simply be moved to
a SHA. A release is imported as a tree commit on `upstream/261108.1`, which is
what `1d6b691` is.

## Shape change: the dist now *is* the repo root

`c3ea396` keeps the engine under `Code/`; the release ships the same trees flat
(`server/`, `tools/`, `config/`, `docker/`, `doc/`, `externalservices/`,
`content-packs/`, root `Play.bat`/`Dockerfile`/`compose.yaml`). The import
therefore maps release root → `Code/`, so our build context and scripts keep
working unchanged.

Two new top-level things that did not exist at the pin:

* `config/` — `economy.json`, `gameplay.json`, `mining.json`, `npc.json`,
  `pos-legacy-production.json`, `server.json`, `world.json`, `version.json`.
  This replaces the single 55 KB `Code/evejs.config.local.json`, which the
  release **deletes**. `scripts/Verify-Private-Coop.ps1` still reads the old
  file and must be updated (grep hit, see §Risks).
* `content-packs/` — 24 built packs, 572 MB of JSON (`evejs-security-missions-level-1..5`,
  `evejs-ded-rated-sites`, `evejs-combat-anomalies`, `evejs-wormhole-sites`,
  `evejs-incursions`, AIR tutorial, career agents, Homefront, …). The server
  installs whatever it finds there at start. **Not imported into git** (data,
  not source); they stay on disk and are copied into the build context when we
  deploy.

## Volume of the change

Measured file-by-file (blob hash, `git ls-tree` vs release tree):

| | Files |
| --- | --- |
| Release files (excl. content packs) | 2480 |
| Base `c3ea396` files under `Code/` | 1201 |
| Added by release | 1380 |
| Modified by release | 901 |
| Deleted by release | 101 (83 inside `Code/`, 18 are repo-root paths that never existed in the release) |
| Unchanged | 199 |

Added, by area: `server/src/services` +590, `server/src/abyssal` +296 (whole new
subsystem, incl. generated catalogs), `server/src/space` +260,
`server/src/config` +33, `server/src/edge` +24, `server/src/_secondary` +21,
`server/src/network` +13, `tools/DatabaseCreator/staticTables` +13 (the big
tables: 165 MB), `tools/market-seederv3` +12.

Deleted inside `Code/`: `evejs.config.local.json`, `StartServeDebug.bat`,
`doc/NON_DOCKER_SETUP_AUDIT.md`, 55 dev helpers under `server/scripts/`
(`verify*Parity.js`, `verifyMovement*`), `space/npc/npcService.js`-adjacent
helpers, and four movement files our branch had patched (below).

Feature-level summary (author's release notes, 261108.1): Sansha incursions
(all 15 sites), AIR tutorial ON by default + career agents 1.4.4, security
missions L1–L5, fleet sharing of mission/bounty payouts, sovereignty work
(Mercenary Dens, player customs offices, skyhooks reinforcement), structure
market hubs, station/gate guns + CONCORD timers, fighter fixes, cloaked ships
off D-scan, K-space wandering wormholes + Thera statics, ESS auto-deploy, market
seed v4 "Iron Man", moon drill phases, GM commands (`/sov`, `/war start`,
`/extraction advance`). The 261028.1 notes earlier added AIR careers, hacking
and archaeology, auction contracts, freelance jobs, achievements/titles,
Project Discovery, Aura guidance and the Destiny movement/tick rewrite
("up to 90% performance").

## What it costs *us*: 137 conflicts, 63 of 64 hook files

Merging `upstream/261108.1` into `coop/pas7std` in `O:\tmp\m261108`:

* **2334 files auto-merged.**
* **137 files conflict**, grouped: `server/src/services` 82,
  `server/src/space` 22, `server/src/_secondary` 14, `gameStore` 3,
  `network` 2, `tools/*` 7, `externalservices/market-server` 2, plus
  `server/index.js`, `compose.yaml`, `Play.bat`, `common`, `utils`.
* **63 of our 64 hook-bearing stock files conflict** — i.e. the co-op overlay
  has to be re-anchored almost everywhere: 485 co-op lines / 66,329 chars
  (audit at the pin), largest surfaces `marketProxyService.js` (41 hook calls),
  `miningNpcOperations.js` (44), `runtime.js` (21), `agentMgrService.js` (10),
  `tradeMgrService.js` (9), `npcBehaviorLoop.js` (8), `nativeNpcWreckService.js` (8).
* **4 files we patched are deleted upstream** (movement/Destiny rewrite):

  | File | our lines |
  | --- | --- |
  | `Code/server/src/space/destiny.js` | +13 / −7 |
  | `Code/server/src/space/movement/authority/destinyAuthority.js` | +1 / −1 |
  | `Code/server/src/space/movement/dispatch/movementSceneRefresh.js` | +11 / −0 |
  | `Code/server/src/space/movement/warp/movementWarpState.js` | +2 / −1 |

  The hook in `movementWarpState.js` (1 line) and the 11-line insertion in
  `movementSceneRefresh.js` have no upstream home any more — they must be
  re-expressed in the new movement pipeline or dropped deliberately, with a
  recorded reason.

Why so much: the release is a **mass restructure**, not a patch series. Sampled
files (e.g. `services/chat/sessionRegistry.js`) come back with the BOM removed,
a header comment rewritten and helper functions extracted, while our edit is a
3-line insertion at `indexCharacterSession`/`register`. Anchors survive, line
numbers do not.

## Non-co-op conflicts (74 files, mechanical but must be reviewed)

`tools/market-seed/src/{main,config}.rs`, `tools/market-seederv2/src/main.rs`
+ config, `tools/NewEdenStoreEditor/editor.py`,
`tools/ClientCodeGrabber/extract.py`, `externalservices/market-server/src/{state,rpc}.rs`,
`Code/compose.yaml`, `Code/Play.bat`, `Code/server/index.js`. These are our
market-seed/Rust localisations against upstream's v4 seeder — the same family
of change that `docs/MARKET_*` describes for our own seed work.

## Plan (phases; each ends with a gate)

1. **Re-anchor the overlay** (63 hook files, 485 lines) in
   `O:\tmp\m261108` on top of upstream code. Rule: upstream code wins; our hook
   is re-inserted at the same semantic anchor; if the anchor is gone
   (movement/Destiny, market proxy rewrite) the hook is ported to the new
   pipeline or explicitly retired with a note. Gate: `AUDIT_OK` with the same
   64 stock files / comparable co-op line count, no new monkey-patching.
2. **Non-co-op conflicts** (74 files). Gate: `docker build -t evejs-local`
   succeeds (Rust + Node 24 stages).
3. **Pin + evidence**: new row in `docs/UPSTREAM.md` (`c3ea396 → upstream/261108.1`
   tree commit), `scripts/patch-evejs-coop.cjs` PIN in the same commit (test
   `tests/coop-overlay-drift-check.test.mjs`), `docs/evidence/overlay-<sha>.md`.
4. **Behavioural gates** on the **agents** stack only
   (`Start-Agents-Stack.ps1 -Action Up`): telemetry event present, named NPC
   materialises, market/refinery loop, then the World/`-Action Party` checks.
   Any real gameplay claim needs the owner's client.
5. **Deploy to the play stack only inside an owner restart window**
   (`NEEDS_OWNER_RESTART_WINDOW` in `.opencode/state.md`).

## Risks the owner must know

* **Client build.** 261108 notes say "Client build update might be coming". Our
  pinned client contract work (`docs/CLIENT_CONTRACT_STATUS.md`) is tied to the
  current client; a new client build changes 542 calls' answers. Do not assume
  the old client validates the new server.
* **`evejs.config.local.json` is gone.** Anything that reads it (private-host
  verify script) needs to move to `config/*.json` before it can pass.
* **Content packs** are not in git. A container built from the fork without
  copying `content-packs/*.json` into the build context gets no incursions,
  missions, AIR or wormhole content at all — and the failure is silent.
* **Destiny rewrite vs our movement work** (`docs/LAG_PROFILE_20261105.md`,
  monotonic lag clock commits `f64fed0`/`d8e91a0`): the files we touched are
  gone; the measurement code must be re-homed before we can trust lag numbers
  again.
* Repo growth: import adds ~9 MB of git objects (96 → 105 MB) because the big
  static tables compress well; the 572 MB of packs stay out.

## Appendix — conflicting files (tab: file / co-op hook calls)

```
Code/compose.yaml
Code/externalservices/market-server/src/rpc.rs
Code/externalservices/market-server/src/state.rs
Code/Play.bat
Code/server/index.js
Code/server/src/_secondary/chat/chatRuntime.js
Code/server/src/_secondary/chat/chatStore.js
Code/server/src/_secondary/express/gatewayServices/achievementGatewayService.js
Code/server/src/_secondary/express/gatewayServices/compatibilityGatewayService.js
Code/server/src/_secondary/express/gatewayServices/freelanceGatewayService.js
Code/server/src/_secondary/express/gatewayServices/fwAdvantageGatewayService.js
Code/server/src/_secondary/express/gatewayServices/index.js
Code/server/src/_secondary/express/gatewayServices/newEdenStoreGatewayService.js
Code/server/src/_secondary/express/gatewayServices/skillPlanGatewayService.js
Code/server/src/_secondary/express/gatewayServices/skillPlanProto.js
Code/server/src/_secondary/express/gatewayServices/sovereigntyGatewayService.js
Code/server/src/_secondary/express/publicGatewayLocal.js
Code/server/src/_secondary/express/server.js
Code/server/src/_secondary/fitting/fittingStore.js
Code/server/src/common/machoErrors.js
Code/server/src/gameStore/index.js   hooks=1
Code/server/src/gameStore/sqliteStore.js   hooks=1
Code/server/src/gameStore/tableOwnership.js   hooks=0
Code/server/src/network/packetDispatcher.js
Code/server/src/network/tcp/index.js   hooks=1
Code/server/src/services/_other/contractProxyService.js   hooks=5
Code/server/src/services/_shared/serviceHelpers.js
Code/server/src/services/_shared/sessionDisconnect.js   hooks=2
Code/server/src/services/account/accountService.js
Code/server/src/services/account/tutorialSvcService.js   hooks=1
Code/server/src/services/agent/agentMgrService.js   hooks=10
Code/server/src/services/agent/agentMissionRuntime.js   hooks=1
Code/server/src/services/agent/missionAuthority.js
Code/server/src/services/agent/missionRuntimeState.js   hooks=0
Code/server/src/services/cache/objectCacheRuntime.js
Code/server/src/services/character/achievementTrackerMgrService.js   hooks=0
Code/server/src/services/character/characterState.js   hooks=0
Code/server/src/services/character/charMgrService.js
Code/server/src/services/chat/chatCommands.js   hooks=2
Code/server/src/services/chat/chatHub.js
Code/server/src/services/chat/sessionRegistry.js   hooks=1
Code/server/src/services/contracts/contractRuntimeState.js
Code/server/src/services/corporation/allianceRegistryRuntime.js   hooks=2
Code/server/src/services/corporation/corpMemberActionState.js   hooks=1
Code/server/src/services/corporation/corporationRuntimeState.js   hooks=0
Code/server/src/services/corporation/corpRegistryRuntime.js   hooks=6
Code/server/src/services/corporation/fwCharacterEnlistmentMgrService.js   hooks=0
Code/server/src/services/corporation/officeManagerService.js   hooks=2
Code/server/src/services/dogma/dogmaService.js   hooks=1
Code/server/src/services/drone/droneRuntime.js   hooks=0
Code/server/src/services/dungeon/dungeonAuthority.js   hooks=0
Code/server/src/services/dungeon/dungeonInstanceCacheMgrService.js
Code/server/src/services/dungeon/dungeonRuntime.js
Code/server/src/services/dungeon/dungeonRuntimeState.js
Code/server/src/services/dungeon/dungeonUniverseRuntime.js
Code/server/src/services/dungeon/dungeonUniverseSiteService.js   hooks=4
Code/server/src/services/dynamic/dynamicResourceCacheMgrService.js
Code/server/src/services/dynamic/essMgrService.js
Code/server/src/services/evermarks/lpStoreMgrService.js   hooks=1
Code/server/src/services/exploration/hackingMgrService.js   hooks=0
Code/server/src/services/exploration/scanMgrService.js   hooks=1
Code/server/src/services/exploration/wormholes/wormholeMgrService.js   hooks=2
Code/server/src/services/exploration/wormholes/wormholeRuntimeState.js
Code/server/src/services/faction/facWarMgrService.js   hooks=0
Code/server/src/services/faction/fwVictoryPointMgrService.js   hooks=2
Code/server/src/services/fitting/liveFittingState.js
Code/server/src/services/fleets/fleetRuntime.js
Code/server/src/services/industry/industryAccess.js   hooks=6
Code/server/src/services/industry/industryManagerService.js   hooks=4
Code/server/src/services/industry/industryMonitorService.js
Code/server/src/services/industry/industryParityHelpers.js   hooks=1
Code/server/src/services/industry/industryRuntimeState.js
Code/server/src/services/inventory/invBrokerService.js   hooks=3
Code/server/src/services/inventory/itemStore.js   hooks=3
Code/server/src/services/killmail/deathOutcomeResolver.js
Code/server/src/services/killmail/killmailState.js
Code/server/src/services/login/authenticationService.js   hooks=1
Code/server/src/services/machoNet/machoNetService.js   hooks=0
Code/server/src/services/mail/mailState.js   hooks=0
Code/server/src/services/map/fwWarzoneSolarsystemService.js   hooks=3
Code/server/src/services/map/insurgencySolarsystemService.js   hooks=2
Code/server/src/services/map/mapService.js
Code/server/src/services/market/marketProxyService.js   hooks=41
Code/server/src/services/mining/miningNpcOperations.js   hooks=44
Code/server/src/services/mining/miningResourceSiteService.js
Code/server/src/services/mining/miningRuntime.js   hooks=1
Code/server/src/services/mining/miningRuntimeState.js   hooks=0
Code/server/src/services/newEdenStore/storeFulfillment.js
Code/server/src/services/newEdenStore/storeGatewayProto.js
Code/server/src/services/npe/airNpeService.js   hooks=1
Code/server/src/services/online/onlineStatusService.js
Code/server/src/services/overview/overviewPresetMgrService.js
Code/server/src/services/reprocessing/reprocessingRuntime.js   hooks=0
Code/server/src/services/ship/beyonceService.js   hooks=4
Code/server/src/services/ship/jettisonRuntime.js
Code/server/src/services/ship/mobileTractorUnitRuntime.js
Code/server/src/services/shipcaster/shipcasterRuntime.js
Code/server/src/services/skills/training/skillQueueRuntime.js
Code/server/src/services/sovereignty/sovGatewayProto.js
Code/server/src/services/sovereignty/sovModernState.js
Code/server/src/services/sovereignty/sovPlayerDeployment.js   hooks=3
Code/server/src/services/sovereignty/sovState.js
Code/server/src/services/sovereignty/sovStore.js
Code/server/src/services/station/reprocessingService.js   hooks=0
Code/server/src/services/support/petitionerService.js
Code/server/src/services/trade/tradeMgrService.js   hooks=9
Code/server/src/services/user/userService.js
Code/server/src/space/combat/killmailTracker.js   hooks=2
Code/server/src/space/combat/missiles/missileReloads.js   hooks=1
Code/server/src/space/destiny.js
Code/server/src/space/modules/hostileModuleRuntime.js
Code/server/src/space/modules/localCycleReloads.js   hooks=1
Code/server/src/space/movement/authority/destinyAuthority.js
Code/server/src/space/movement/dispatch/movementSceneRefresh.js   hooks=0
Code/server/src/space/movement/warp/movementWarpState.js   hooks=1
Code/server/src/space/npc/nativeNpcService.js   hooks=1
Code/server/src/space/npc/nativeNpcStore.js   hooks=1
Code/server/src/space/npc/nativeNpcWreckService.js   hooks=8
Code/server/src/space/npc/npcBehaviorLoop.js   hooks=8
Code/server/src/space/npc/npcCombatDormancy.js
Code/server/src/space/npc/npcData.js   hooks=1
Code/server/src/space/npc/npcDefaultConcordRules.js
Code/server/src/space/npc/npcEquipment.js
Code/server/src/space/npc/npcHardwareCatalog.js
Code/server/src/space/npc/npcSceneActivity.js
Code/server/src/space/npc/npcSelection.js
Code/server/src/space/npc/npcService.js   hooks=0
Code/server/src/space/runtime.js   hooks=21
Code/server/src/space/transitions.js   hooks=5
Code/server/src/utils/logger/index.js
Code/tools/ClientCodeGrabber/extract.py
Code/tools/market-seed/config/market-seed.local.toml
Code/tools/market-seed/src/config.rs
Code/tools/market-seed/src/main.rs
Code/tools/market-seederv2/config/market-seederv2.local.toml
Code/tools/market-seederv2/src/main.rs
Code/tools/NewEdenStoreEditor/editor.py
```
