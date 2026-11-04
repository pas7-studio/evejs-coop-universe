# Pending verification — 22 fork commits (2026-11-04)

Everything below is committed on `coop/pas7std` and **not deployed**. Nothing here is
proven live yet; each line names the exact observation that turns it into PASS or FAIL.
Run only in the owner's restart window.

## Deploy

```powershell
cd C:\Games\EveCoop\upstream-evejs\Code
docker build -t evejs-local .
docker compose -f compose.yaml -f compose.coop-probe.yaml -p evejs up -d --force-recreate server
docker logs --since 10m evejs-server-1 2>&1 | Select-String "Server listening|ERROR"
```

Client launch stays through `Play.bat` (never `bin64\exefile.exe`).

## Checks, newest commit first

| # | Commit | Action | PASS evidence |
|---|---|---|---|
| 0 | `ef26dcb` frontlines-map allowlist | open the Faction Warfare landing page / "Occupancy changes" panel | map draws, no `KeyError: 30002803` / `30000132` in the client log |
| 0e | `c4af327` durable server log | deploy once, then read `/var/lib/evejs/logs/server.log` in the container | the file still contains the previous boot's lines after `--force-recreate` (verified 404 -> 754 lines) |
| 0b | `14da668` launcher `noconsole` | relaunch through `Play.bat`, then open the overview and the Neocom panels | no `IOError: [Errno 9] Bad file descriptor` from `logmodule.LogTraceback`; left Neocom strip and overview/selected-item panel stay after login |
| 0c | `85ce916` free SP keep earned points | inject a skill injector while a skill is training | the remaining time drops, it never jumps back to a restarted level |
| 0d | `d4e2b20` corporation wallet sale | sell loot with the Corporation wallet selected and no duration | the ISK lands on the corporation wallet; a personal sale is unchanged |
| 0a | `7c8f6cc` campaigns content tags | open Возможности -> Военные кампании | the campaign card renders with its title, progress and career icon; no `contentTagType` and no `_hover_frame` in the client log |
| 0a | `b2228b5` onlineStatus CRowset | log in, open contacts / address book, wait for a contact to log in | no `'blue.DBRowDescriptor' object has no attribute 'index'`; online dots update |
| 1 | `55a60cf` warzone renderable systems | open the Faction Warfare / theaters-of-war map | map window opens, no `KeyError: 30000132` in the client log |
| 2 | `ddf6bbb` Loot All partial move | `Loot All` on a wreck with a nearly full hold | items that fit are looted, no `NotEnoughCargoSpace` exception |
| 3 | `17e3c78` owner names unicode | open overview in a system with a named character | no `must be unicode, not str` in the client log; names render |
| 3a | `faaefa4` public character names unicode | fly next to a pilot from another corporation | their name renders in overview, no `must be unicode, not str` |
| 4 | `0e890d2` rowset class | open the Contracts window / wait for the Neocom blip | no `'module' object has no attribute 'Rowset'` |
| 5 | `a8764c0` drone/warp extraction | any drone launch | behaviour unchanged, `[Drone] Launch` still logged |
| 6 | `106f79f` wreck cargo-hold flag | die (or kill an NPC ship) and open the wreck | surviving modules/cargo appear in the wreck's cargo hold |
| 7 | `e8aa85a` warp diagnostics | one warp to a station and one to a belt | `[WarpComplete] ... stopDistance= shipMass= distToTargetEdge=` and one `[WarpLanding]` line in the server log |
| 8 | `762aaf7` drone resync after `SetState` | launch drones, then move so the scene refreshes | `set-state.drone-resync` appears in the movement trace |
| 9 | `60296b9` launch telemetry + burst resync | launch five drones | `[Drone] Launch ... launched=5 active=5/5 ids=...` and the drone window reads 5/5 |
| 10 | `7d99164` instant safe logoff | leave ship in space | timer closes immediately, no ~10 s countdown, single `OnSafeLogoffActivated` |
| 11 | `e21dd06` career catalogue | open the career portal | all four career paths render with activity circles, no `ZeroDivisionError` |
| 12 | `e78711b` site tuning | open the probe scanner in a combat system | more combat anomalies than before, unchanged mining/gas/wormhole sites |
| 13 | `98f1cdf` + `35e9380` onlineStatus rowset | log in, watch the contact/online list | no `not a tuple` / `UnmarshalError`, online dots shown |
| 14 | `176e0fd` overview profile unicode | load a saved overview profile | profile loads, no `must be unicode, not str` |
| 15 | `ad5e96f` MTU / transfer diagnostics | activate an MTU and let it scoop | `component_activate` broadcast, items arrive in the MTU, no silent refusal |
| 16 | `43fe233` militia restore | admin `militia_restore` for 140000005 | re-enlistment allowed immediately |
| 17 | `5a6db18` militia decline | decline the militia agent briefing | service continues, no `LEAVE_MILITIA` |
| 18 | `fc630f1` fleet invite | invite a pilot while a solo fleet exists | invite accepted, no `FleetError` |
| 19 | `3544a1b` MTU scoop | scoop a tractor unit with haul inside | haul returns to ship cargo (overflow to a can) |
| 20 | `b229dc3` militia campaigns page | open the Military Campaigns tab | page filled from live war state |
| 21 | `55a60cf` extra | reload the warzone map twice | no repeated `KeyError`, map stable |

## Log greps used for evidence

```powershell
docker logs --since 30m evejs-server-1 2>&1 | Select-String "\[Drone\]|\[WarpComplete\]|\[WarpLanding\]|set-state.drone-resync"
# client side
Get-Content C:\Games\EveCoop\upstream-evejs\Code\_local\diagnostics\evejs-client-stdout-*.log |
  Select-String "EXCEPTION #|Formatted exception info"
```

## Still unprovable without the client

- `cfg.agents` epic-arc start agent (`'NoneType' object has no attribute 'factionID'`,
  jobboard card) — needs a live `GetAgents` dump or a screenshot of the card.
- Warp landing short by 4 km / 77 km — server lands on the target
  (`WARP_COMPLETION_DISTANCE_MAX_METERS = 1`); the new `[WarpComplete]`/`[WarpLanding]`
  lines are what will show whether the client's own solver is the difference.
- `effects.GateActivity` `AttributeError: Activate` and `RemoveMissileImpact` — client FX
  paths, need a two-client repro.
