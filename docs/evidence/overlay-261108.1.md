# Overlay evidence — EveJS 261108.1 (import `1d6b691`, port head `1ebf774`)

Date: 2026-11-10. Machine: owner PC (Windows), Node 22.14.0 host run, Docker
Desktop engine **not running** during the whole session.

This file records what was actually measured for the 261108.1 port. It is not a
gameplay acceptance: no client was launched, no owner stack was touched.

## What was delivered

| Item | Value |
| --- | --- |
| Release archive | `EveJS-261108.1.zip`, SHA-256 `373266A05FD9ACF0C220D06D5469907637A6D09BF2CF926ADF4AAEE97A3CCC59` |
| Import commit (release tree over `c3ea396`, content packs excluded) | `1d6b691` on branch `upstream/261108.1` |
| Construction branch | `coop/261108`, head `1ebf774` |
| Diff vs the import | 800 files, +10 289 323 / −16 565 lines (637 restored files + ported hooks + ported feature blocks) |
| Unchanged branch | `coop/pas7std` `f64fed0` — the engine the owner plays on today |

## Gates

| Gate | Result |
| --- | --- |
| `node --check` on every touched `.js` | 0 failures (checked after each pass, and again on the final tree) |
| `scripts/coop-engine-audit.cjs --code-path O:\tmp\c261108\Code` | `AUDIT_OK` — 563 co-op modules, 66 stock files touched, 372 co-op lines, 0 runtime-patching sites of ours (upstream ships 23, reported separately) |
| `scripts/coop-perf-audit.cjs --code-path O:\tmp\c261108\Code` | `PERF_OK` (same attribution rule: co-op code only) |
| `scripts/coop-overlay-presence.cjs --engine O:\tmp\c261108\Code` | 54/73 files complete, 156 co-op lines still missing, 2 files gone from the engine (documented below) |
| Headless boot (`node index.js`, host Node, `EVEJS_DATA_ROOT=O:\tmp\boot261108-data`) | **passes**: `EveJS Elysian is running!`, 8490 solar systems / 5210 stations / 461 881 celestials / 40 928 belts / 13 978 stargates, express secondary service starts, 75 s of ticks with no exception |

Boot log tail (trimmed):

```
[SpaceRuntime] Startup solar-system preload complete in 404ms (3 systems, 0 stargate activation updates)
EveJS Elysian is running!
(direct listener: 127.0.0.1:26000)
[Startup] Runtime: 2 accounts, 4 characters, 17 items
[Startup] Space: 8490 solar systems, 5210 stations, 44 station types, 461881 celestials, 40928 asteroid belts, 13978 stargates, 29 stargate types
TIDI autoscaler disabled
```

Warnings that are expected without Docker: `MarketDaemonClient ... 127.0.0.1:40111 ECONNREFUSED`
(the daemon is a container).

## Boot-loop defects found and fixed (all bulk-port artifacts)

1. `services/agent/missionAuthority.js` — export referenced `isMissionContentMaterializable` that was never copied.
2. `services/mining/miningNpcOperations.js` — `stopRunawayFullThrottle()` displaced to module top level.
3. `services/dungeon/dungeonUniverseRuntime.js` — broad-definition flush block displaced between two functions.
4. `services/killmail/killmailState.js` — export of `buildKillBlob`, which 261108 does not have in that module.
5. `space/npc/npcSceneActivity.js` — the fork's memoised `getSceneActivityState` duplicated upstream's own function and called a name upstream never had.
6. `_secondary/express/gatewayServices/index.js` — 21 registry entries without their imports.
7. `_secondary/express/gatewayServices/skillPlanProto.js` — `SKILL_PLAN_ALIASES` / `assertAliasShapes` missing.
8. `services/newEdenStore/storeGatewayProto.js` — duplicate `Price`, `offer.Attributes`, `offer.api.*` and catalog enum definitions; upstream's newer superset kept, the fork's older duplicates removed.

## Still open (deliberate, not hidden)

* **`services/market/marketProxyService.js`** — 75 of our P2P settlement hooks are not ported.
  261108.1 rewrote the proxy to a 7 487-line durable market (saga, idempotency
  keys, durable expiry/recovery jobs). Porting our settlement fence into it is a
  design decision, not a transplant. **To make that impossible to forget, the
  proxy now refuses to load when any flag that expects the fence is on**:
  `EVEJS_COOP_PLAYER_MARKET_ATOMIC`, `..._SETTLEMENT_FENCE`, `..._BUY_RESERVE`,
  `..._FILL_GUARD`, `EVEJS_COOP_MARKET_CANCEL_CUSTODY`, `EVEJS_COOP_MARKET_SELL_CUSTODY`,
  `EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT` → `COOP_MARKET_FENCE_NOT_PORTED: <flag>`.
  Verified: the flag on throws at require time, off loads normally.
* **Two movement files deleted upstream** — `movementWarpState.js` and
  `movementSceneRefresh.js`. All three behaviours are re-homed now: the warp-range
  fix in `destiny/simulation/warpTargets.js`, the drone resync in
  `runtime/scene/presentation.js`, the escort motion witness in
  `destiny/simulation/evolve.js` (`realWarp`).
* **`coopNpcRunawayGoto`** — re-homed: `destiny/simulation/evolve.js` `behaviour()`
  case `GOTO` parks a native NPC whose target is further than a solar system
  (the stock "straight for ever" sentinel) instead of flying it for ever.
* **Warp landing tracer** (`coopWarpLandingTrace`) — still not wired: the new
  warp pipeline has no single completion site that carries the fields the tracer
  logs. Diagnostics only; open.

## Retired after checking upstream now does it natively

| Ours | Superseded by 261108.1 |
| --- | --- |
| corporation recruit/member guards (`coopPlayerCorporationAccess`) | `canManageCorporationRecruitment`, `requireCorporationReadAccess` |
| trade custody journal + atomic trade hooks | durable completion saga with idempotency legs |
| mining cycle conservation / atomic wrapper | `miningCargoCommits` commit/extract with receipts |
| NPC mining cargo appender | receipt-based `npcMiningCargo` |
| salvage death/atomic transfer cargo guards | `prepareNativeNpcWreckItems` + `commitMiningCargoWreckTransfer` + `itemCustody` |
| career-goal gateway stubs | native `careerGoalGatewayService` |
| `logMovementDebug` early return | upstream already returns early |
| startup dungeon resume patch | persistent site advancement moved to `globalSiteSchedulerRuntime` |
| native NpcStore root shape helpers | `shapedRootsByTable` + `readCollectionRaw*` |

## Compose changes required by this host

* Market daemon host publish `40110` → `41120` (already known) and **RPC
  `40111` → `41121`**: Windows reserves 40064–40163 (WinNAT) and refuses to bind
  them, which used to make `docker compose up` fail with "socket ... forbidden".
* The fork's `EVEJS_COOP_CONTENT_BIND` / 127.0.0.2:28443 CDN publish is dropped:
  upstream serves gateway binaries on its own loopback CDN responder, and the
  coop title/achievement resolvers default to `https://127.0.0.1`.

## Not done in this session

No `docker build`, no container, no client, no gameplay. Docker Desktop's Linux
engine was down; starting it would have restarted the owner's containers, which
the two-stack rule forbids outside an explicit restart window. The boot evidence
above is host-Node only.
