# Co-op FW / client-visibility handoff (2026-11-03→04)

## Committed in the fork (`pas7-studio/EveJS`, branch `coop/pas7std`, tip)
All are committed but **NOT deployed** — the play stack has not been restarted.
- `b229dc3` Military Campaigns page served from the live war state (tests 8/8).
- `3544a1b` MTU scoop returns the haul to ship cargo (overflow to a can).
- `fc630f1` Fleet invite dissolves a solo leftover fleet instead of refusing.
- `5a6db18` Militia briefing "Decline" (action 9) no longer leaves the militia.
- `43fe233` Admin action `militia_restore` clears the re-enlistment cooldown on the
  real faction-war atomic row (only `cooldownUntil`), enlist stays the normal path.
- `ad5e96f` `Handle_Add`/`Handle_MultiAdd` warn with an exact reason
  (NO_BOUND_CONTEXT / SOURCE_ITEM_NOT_FOUND / SOURCE_ITEM_UNRESOLVED) instead of
  dropping a transfer silently; MTU activation sets `component_activate=[true,null]`
  on the live deployable and broadcasts the slim item immediately.
- `35e9380` `onlineStatus.GetInitialState` returns a DBRowDescriptor whose columns
  are real `(name, DBType)` marshal tuples (contactID I4, online BOOL). The old plain
  column strings made the C constructor raise
  `UnmarshalError: new style getargs format but argument is not a tuple`.
- `176e0fd` `overviewPresetMgr.GetStoredPreset` returns the profile as a `wstring`
  (the client parses text), fixing `TypeError: must be unicode, not str` in
  `OverviewWindow.OnOverviewPresetLoaded` / `_DoBallsAdded`.
- `98f1cdf` onlineStatus payload moved to `onlineStatusPayload.js` (no store
  dependency); `tests/coop-onlinestatus-rowset.test.mjs` 2/2 asserts the typed
  tuple columns and the rowset shape.
- `e78711b` **combat anomaly tuning** (`space/coopSiteTuning.js`): for combat
  families `getSpawnProfile` multiplies `slotsPerSystem` x2, `targetSystems` /
  `targetSystemRatio` x1.5, and shifts `difficultyRange` up one tier, so harder
  templates (more waves, tougher hulls) are eligible. `coopUniverseSites` seeds up
  to 24 visited systems per pass and samples 24 systems per band. Kill switch
  `EVEJS_COOP_SITE_TUNING=0`; knobs `EVEJS_COOP_SITE_DENSITY/COVERAGE/DIFFICULTY_SHIFT`.
  Tests `tests/coop-site-tuning.test.mjs` 3/3. Mining/gas untouched.

## Confirmed evidence worth keeping
- Owner 140000005, corp 98000001, faction 500001, Megathron Navy Issue
  `9988400124002`, system 30001390 (Pakkonen). Friend 140000107.
- Enlistment record: status LEFT, `leftAt 1793735429495`, `cooldownUntil 1793821829495`,
  rank 0 — caused by the briefing-decline bug. Friend has no enlistment record.
- Loot drag failure: `[InvBroker] Add itemID=… source=…` with no store record for the
  container/items; `Handle_Add` used to return null with no log.
- Overview/onlineStatus errors are in the client log: `must be unicode, not str` and
  `new style getargs format but argument is not a tuple`.
- Drone counter: server emits one `OnDroneStateChange` per launched drone; the client
  `michelle.OnDroneStateChange(itemID, ownerID, controllerID, activityState, typeID,
  controllerOwnerID, targetID)` drops a drone when `charid != ownerID AND shipid !=
  controllerID`; `SetState` builds `stateByDroneID` from `bag.droneState` (filtered by
  `controllerID > 0`). Not yet pinned why only 1 of 5 shows.
- Logout: in space the client calls `GetMenuService().SafeLogoff()`; the server answers
  `[]` and `_completeInstantSafeLogoff` sends `OnSafeLogoffTimerStarted(now + 1 s)` then
  `OnSafeLogoffActivated`. The client timer is `logoffTime - blue.os.GetSimTime() + SEC`.
  The 10 s the owner sees is not yet explained by the server constant alone.
- Warp: gate target uses `resolveStargateWarpTarget` with
  `WARP_EXIT_VARIANCE_RADIUS_METERS = 2500` and a random 1..2500 stop distance. The
  reported ~10 km landing is not explained by these constants yet.

## Still open
1. Loot: confirm a real wreck/can drag now logs a reason; if the source is still
   unresolvable, materialize scene loot as real items (needs the new warn line live).
2. Overview: load a profile in the client to confirm the unicode error is gone.
3. Drone counter 1/5: trace `bag.droneState` vs `OnDroneStateChange` on the client.
4. Logout 10 s: pin the server call behind `CmdLogOff` and compare sim vs wallclock.
5. 77 km pilot-distance desync; death loot scattered (`npcWreckService`).
6. Second "Изменения принадлежности" card (never identified).
7. Warp landing for heavy hulls (~4 km): measure the real client value first.
8. After deploy: `militia_restore` for 140000005, then enlist both pilots into Caldari.

## Deploy procedure (only with the owner's explicit window)
`cd C:\Games\EveCoop\upstream-evejs\Code; docker build -t evejs-local .` then
`docker compose -f compose.yaml -f compose.coop-probe.yaml -p evejs up -d --force-recreate server`.
Play stack only. Never restart it unasked.
