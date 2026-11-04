# Co-op handoff (2026-11-05, fork tip `63ccce4`)

## Current state

**The fork had been left on a detached HEAD** (156 commits ahead of `coop/pas7std`,
reachable only from HEAD). Re-attached with `git checkout -B coop/pas7std`. Never
work detached here again.

Committed on the branch but **not deployed to the play stack** (one restart ships
all of it):

- Site batteries really shoot: `space/coopSiteSentries.js` (decision),
  `coopSiteSentrySpawn.js` (one native sentry per battery), `coopSiteSentryFire.js`
  (the type's own damage vector through the native damage path). Measured over 4
  real systems: 12 batteries -> 9 resolve (Angel/Sansha/Serpentis/Guristas), 3 are
  Sleeper batteries that stay inert (no Sleeper sentry type in this build). Native
  damage path proven live: ship shield 725 -> 706.679975. Switch
  `EVEJS_COOP_SITE_SENTRIES=1`, set in both compose files. Details:
  `docs/SITE_SENTRIES.md`.
- Campaign LP row is truthful now (`progress_interval 1`, amount 0, real militia
  issuer) instead of the raw `UI/Campaigns/RewardsPerNumberContributions`
  placeholders.
- The P2P env invariants moved out of the stock market service into
  `space/coopPlayerMarketEnvGuards.js` (same errors, same order); stock-char
  budget ratcheted 67 500 -> 65 500 (measured 65 315).
- A war side fields four hulls by default (was three), raised by
  `EVEJS_COOP_WAR_SIDE_SIZE` (1..8), per tick by `EVEJS_COOP_WAR_SIDE_TICK` (1..6).

## NEXT (owner actions)

1. **Restart window** for the play stack: rebuild `evejs-local` from the fork tip,
   then `scripts/Start-Play-Stack.ps1 -Action Up`.
2. **Stand in a site afterwards**: expect
   `[CoopLivingWorld] site sentries in <system>: battery <id> -> <type> #<id>`,
   `coop-site-sentry-fired` in `coop-events.jsonl`, then damage on the client.
   Until that exists the sentries are NOT verified in game.
3. **Name the jobs window** (Agency -> Careers, a career agent in station, or
   Agency -> Job Board) before any Explorer/Soldier-of-Fortune/industry job
   content is written; the three windows take different payloads.

# Historical handoff (2026-11-03 -> 04)

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

## Career portal does not open (root cause found 2026-11-04)
Client trace (server log, 23:10:23-24, character 140000005) after
`eve_public.career.goal.api.GetDefinitionsRequest` and `GetAllRequest` both
answered 200:
`careerPortalWnd.load_data_async → on_data_load_success → construct_career_portal
→ circleView → activityView.LoadActivities → activityNode.ApplyAttributes →
circleNode.PrepareUI → ConstructFrame → UpdateDashedCircle` and then
`EXCEPTION #107 ... ZeroDivisionError: float division by zero`.

Cause: `activityNode.UpdateDashedCircle` does
`len(completedGoals) / float(len(goals))`. `activities` come from the client's
static `careerGoalsConst.CAREER_PATH_GROUPS` (10 explorer, 9 industrialist,
10 enforcer, 10 soldier-of-fortune activity IDs), and each node asks
`get_goals_in_group(career, group_id)`. Our `CAREER_GOAL_DEFINITION_STUBS`
send no `ui_annotations`, so `GoalDefinition.from_proto` gets
`group_id = None`; the four definitions become only `career_path_goal_definition`
and every static activity group has zero goals → division by zero.

Fix: `coopCareerGoals` must emit one definition per static activity annotation
(key `'group'`, values `CareerAgentMissions`, `Scanning`, `Hacking`,
`AdvancedHacking`, `Wormholes`, `GasSites`, `CombatSites`, `Navigation`,
`AdvancedNavigation`, `ProjectDiscovery`; `IndustrialistCareerAgentsMissions`,
`Market`, `Salvage`, `ResourceHarvesting`, `Refining`, `Manufacturing`,
`DistributionAgent`, `MiningAgent`, `Research`; `CareerAgentMissions`,
`SecurityAgent`, `AbyssalDeadspace`, `Combat`, `Bounties`, `CombatSites`,
`EpicArc`, `Market`, `Standings`, `LoyaltyPoints`; `CareerAgentMissions`,
`Social`, `ElectronicWarfare`, `Combat`, `PvP`, `CapacitorWarfare`,
`FactionWarfare`, `Support`, `Destruction`, `Duels`) plus one career-path goal
per career, with `career` 1/2/3/4, `target` 1, `threat` 1, `career_points` > 0,
`order`, and `subtype`. `GetAll` must return a progress row for every emitted
goal. Other annotation keys: `'subtype'`, `'order'`, `'duration'`,
`'auraTextID'`, `'agencyLinkTextID'`, `'agencyScreen'`, `'videoID'`.

## Drones: done in code, needs one live launch (fork 60296b9 + 762aaf7)
The drone window reads 1/5 because the client counts
`michelle.stateByDroneID` minus the drone bay, and it rebuilds that dictionary
wholesale from `SetState(bag.droneState)`. Two server-side holes are now closed:
- `launchDronesForSession` was completely silent (no log, no event) and only wrote
  errors into the RPC response; it now logs `[Drone] Launch char/ship/requested/
  launched/active/bandwidth/ids`, warns with the exact reason for every refusal, and
  re-emits `OnDroneStateChange` for every controlled drone after a successful burst.
- `movementSceneRefresh.sendStateRefresh` (STATE_RESET) sent a visible-entity snapshot
  that could predate the launch and wipe the newer notifications; it now re-syncs the
  authoritative drone state right after the reset (`set-state.drone-resync`).
The wire shape, launch telemetry and the re-sync live in `space/coopDroneStateSync.js`
(`tests/coop-drone-state-sync.test.mjs` 3/3).

## Client tracebacks: read them locally, not from guesses
The launcher keeps the client's own console output under
`C:\Games\EveCoop\upstream-evejs\Code\_local\diagnostics\`: `evejs-client-stdout-<id>.log`
(full Python tracebacks with the exact client file/line, `session` locals and timestamps) and
`evejs-client-crash-<id>.txt` (launch/exit metadata). Grep the stdout log for `EXCEPTION #`,
`Traceback`, `Exception:`. Three bugs were root-caused from it on 2026-11-04:
`util.Rowset` (contractProxy state, 0e890d2), byte-str owner names in cfg.eveowners
(overview PrimeDisplayName, 17e3c78 + faaefa4 for pilots outside our corp, proven by
'IS 'SaSaNyah' = a [RAIH] pilot) and Loot All aborting on one item that did not fit
(MultiAdd NotEnoughCargoSpace available 0.8175 volume 388, ddf6bbb).
Related, same client path: 14 more overview failures were
`'NoneType' object is not iterable` in the same `ExtractLocalizedTags`, i.e. the slim item
yielded NO name at all (ownerID not yet in cfg.eveowners). If that survives the name fixes,
the next step is to prime owner rows for every pilot in the bubble instead of waiting for the
client to ask.

## Still open
1. Loot: confirm a real wreck/can drag now logs a reason; if the source is still
   unresolvable, materialize scene loot as real items (needs the new warn line live).
2. Overview: load a profile in the client to confirm the unicode error is gone.
3. Drone counter: exception #79 in the client log proves the SERVER refused extra launches
   with "Maximum active drones already in space." at 22:58:38 - so it counted five drones
   while the window showed 1/5. The display loss is the SetState rebuild (fixed by the
   resync); after deploy, launch five and read `[Drone] Launch ... launched=5 active=5/5`.
4. Logout: shipped in 7d99164, needs one live logoff to confirm no countdown.
5. 77 km pilot-distance desync; death loot scattered - the loot half is the flag bug
   (106f79f) plus Loot All aborting (ddf6bbb); the 77 km number still needs the owner's
   subject (distance between what).
6. "Изменения принадлежности" card: exception #83/#84 is a jobboard card crash in
   `jobboard/client/features/agent_missions/job.py subtitle -> _epic_arc ->
   epicArcController.GetActiveMission -> _GetAgent` returning None, then
   `IsAgentStandingSufficientToUse(None)` -> `'NoneType' has no attribute 'factionID'`.
   So cfg.agents does not contain an epic-arc start agent. Still needs one live `GetAgents`
   dump (or the owner's screenshot) to know which agent id is missing.
   Two FX crashes are client-side and need a two-client repro: `AttributeError: Activate`
   is `effects.GateActivity.Start -> gateBall.Activate()` on a raw `_destiny.ClientBall`
   (the FX reached a session before that stargate had a Python space object - we broadcast
   the observer gate flash in completeStargateJump), and `AttributeError: RemoveMissileImpact`
   is the client's own missile controller (`eveSpaceObject/missile.pyj`). `IndexError` in
   Project Discovery results is also client-side until the PD payload exists.
7. Warp landing for heavy hulls (~4 km): `WARP_COMPLETION_DISTANCE_MAX_METERS = 1` in
   runtime.js, so the server lands on the target; measure the real client value first.
8. After deploy: `militia_restore` for 140000005, then enlist both pilots into Caldari.

## Deploy procedure (only with the owner's explicit window)
Full per-commit checklist: [`docs/PENDING_VERIFICATION_20261104.md`](../docs/PENDING_VERIFICATION_20261104.md)
(21 commits, each with the exact observation that makes it PASS).
`cd C:\Games\EveCoop\upstream-evejs\Code; docker build -t evejs-local .` then
`docker compose -f compose.yaml -f compose.coop-probe.yaml -p evejs up -d --force-recreate server`.
Play stack only. Never restart it unasked.
