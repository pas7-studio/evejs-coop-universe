# State — ALIFE stitch (economy loop), 2026-10-25 evening

## Deployed now (OVERLAY_OK, server healthy, 122 overlay modules current)
- New `coopEconomyDestination.cjs`: fleets pick their own delivery station by **real expected ISK**
  (`price × fillable volume` from live `GetOrders` of the system's own region). No station, ore type
  or region is hardcoded. Pure ranking is tested (`tests/coop-economy-destination.test.mjs`, 12/12).
- Wired into `coopNativeStationArrival.start()` behind `EVEJS_COOP_ECONOMY_DESTINATION=1`; emits
  `living-economy-destination {status, stationID, chosenRevenue, filled, unfilled, top[]}`.
- `observePreferredOre` + `living-economy-ore`: each ALIFE tick reports, per system, the ore a real
  buyer actually pays for. **Live proof:** Perimeter/New Caldari → `17464 Scordite III-Grade`
  @5203.7 ISK ×5000 at station **60014935** (New Caldari). The earlier "no buyer for 17464" is stale.
- A stalled haul is no longer silent: `living-npc-station-route {fleetID,status,fleetState}` (2 min
  throttle per fleet+status).
- Patcher fix: spec-patch lines containing `coopMiningTrace` are pushed into `oldLines`, so installs
  stay idempotent (`classifyFile` reports PATCHED instead of DRIFTED). **Still restore native files
  from git before every install** — spec patches are single-shot (re-running without checkout
  duplicates lines and corrupts `marketProxyService.js`).

## THE blocker, now measured (not guessed)
`living-mining-fleet-state` (30 s) shows miners fitted and at the rock:
- miner modules online with a real mining effect (typeID 17482 Strip Miner I, `miningEffects:1`)
- belt full: 258 mineable entities, 66 670 425 units; active rock 45 233 remaining, 1.8–3.6 km away
- **but** `lockedTargets: []`, `nativeCargoItems: 0`, `lastHauledVolumeM3: 0`, `state:"mining"`

New trace `living-mining-blocker` (env `EVEJS_COOP_MINING_TRACE=1`) proves the native loop ticks in
state `mining` with `activeAsteroidID: 0` and **never reaches any per-miner branch**
(`NO_MINING_MODULE`, `NO_MINING_SNAPSHOT`, `TARGET_OUT_OF_RANGE`, `TARGET_LOCK_FAILED` all silent).
Conclusion: in `tickMiningFleet` the loop
`for (const minerEntityID of fleetRecord.minerEntityIDs) { const minerEntity = scene.getEntityByID(...); if (!minerEntity || ...) continue; }`
skips **every** miner — the fleet record's `minerEntityIDs` are not resolvable in the scene the tick
receives, while the same IDs resolve fine through `runtime.ensureScene()` in our observation.

## Next step (single, concrete)
Trace the skip itself: add `require("../../space/coopMiningTrace").note("MINER_NOT_IN_SCENE",
{fleetID,systemID,minerID})` right after the `if (!minerEntity || ...) continue;` line in
`tickMiningFleet`, then compare `scene.getEntityByID(minerEntityID)` against
`spaceRuntime.ensureScene(systemID)`. Suspects, in order:
1. fleet record restored with pre-restart entity IDs (durable restore/reuse path) while the scene holds
   new ones → re-link or prune+respawn the fleet;
2. the tick runs on a scene object whose `entities` map was rebuilt by materialization;
3. `scene !== runtime.ensureScene(systemID)` (two scene instances).
Fix must re-link native ships, never fabricate cargo or spawn substitute miners.

## Do not
- Do not enable `EVEJS_COOP_NATIVE_NPC_MARKET=1` until a haul is actually paid (no cargo exists yet).
- Do not hardcode station 60014935/60003724; they are only live examples.
- Do not run the installer twice without `git checkout --` on `marketProxyService.js` and
  `miningNpcOperations.js`.

## Commands
- deploy: `node scripts/patch-evejs-coop.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code` →
  `--check` = `OVERLAY_OK` → `docker build -t evejs-local .` → `docker compose -p evejs -f compose.yaml
  -f compose.coop-probe.yaml up -d` (in `Code`).
- telemetry: `/var/lib/evejs/coop-events.jsonl` in `evejs-server-1`; `docker cp` probe scripts to
  `/tmp/ag` (dir is recreated with the container).
