# state — evejs-coop (2026-10-25, session 2)

## Done
- `npm ci` in `Code/server` OK. Overlay deployed via `-Action CoopStart` (19 patched statements, 59 modules CURRENT, 0 drift).
- Local (non-upstream) suite: **518 pass / 0 fail / 16 skipped** (`EXIT=0`).
- Isolated upstream suite (`Run-Isolated-Upstream-Tests.cjs`): 9/11 pass; see below.

## Fixes applied (uncommitted)
- 44 `integration/<name>.js` stubs -> `./<name>.cjs` (Node CJS never resolves `.cjs`).
- `core.autocrlf=false` + CRLF->LF (215 EOL-only repo files reverted; other agents' content edits kept).
- `scripts/Diagnose-LivingWorld.ps1`: read-only script now sent as single LF string in base64
  (`sh -s`), was CRLF-per-line -> `then\r` syntax error -> false "server not running".
- `scripts/Diagnose-Coop-Telemetry.ps1`: same fix via `sh -c "echo <b64> | base64 -d | sh -s"`.
- Tests updated to current behavior: Ukrainian messages (3 regexes), `notifyRaid(scene,actions,send)` scene fixture,
  announce dedupe `UNCHANGED`, wreck fixture loot-quarantine anchor, `EVEJS_CODE_PATH`-loader path normalization
  (`\\` vs `/`), telemetry-wiring regex for the base64 invocation.
- `NODE_OPTIONS` must be cleared (VS Code js-debug bootloader breaks every `node`).

Still failing (deep upstream scene contracts, not yet fixed):
- `upstream-ship-prime-recipients` — `deliveredCount=0`.
- `upstream-two-pilot-movement-and-reconnect` — `Cannot read properties of undefined (reading 'x')`.

## Gameplay gates
- Telemetry gate **PASS**: `EVENTS_FILE: PRESENT_READABLE`, `START_ENTERED_COUNT 1`, `BOOT_REQUESTED_COUNT 1`,
  `NATIVE_TOPOLOGY_COUNT 1`; events show `living-world-topology` for Perimeter 30000144
  (33 waypoints, 3 belts, 5 stations, 5 gates, HEADLESS_NATIVE_SCENE) and `living-native-industry` ACTIVE
  (fleet 1: 2 miners + 1 hauler).
- First `World -WorldSystemID 30000144` returned `AWAITING_INGAME_ARRIVAL` / no topology because the report
  only looks 20 min back and the boot was older. Restarted `server` and re-ran World to re-emit boot events.
- Client gates (login, two characters, Party) remain BLOCKED_CLIENT_UNAVAILABLE.

## Results (final, 2026-10-25)
- Local suite (non-upstream): **518 pass / 0 fail / 16 skipped** (EXIT=0).
- Isolated upstream: 9/11; still failing `upstream-ship-prime-recipients` (deliveredCount=0) and
  `upstream-two-pilot-movement-and-reconnect`.
- Telemetry gate: PASS. World gate: **PASS** — `World -WorldSystemID 30000144` returned
  `READY_FOR_CLIENT_PLAYTEST`: 6 activity samples, 32 moved ships, oreGrowth 2, targeting 22,
  8 physical NPC ships; combat damage event correlated (28.204 HP shield loss).
- Party gate: `NO_ACTIVE_PILOT_EVIDENCE` -> BLOCKED_CLIENT_UNAVAILABLE (needs the human's client).

## Next
- Operator step: authorized EVE client login, verify named NPC visible in space, then two characters
  for Party. Nothing else on the server side is blocking.

## 2026-10-25 (later) - NPC market gate
- Disposable project `evejs-npcmkt-test` (own volume + ports) is isolated; live world untouched.
- 6.1 negative control PASS (flag ON, empty allowlists -> 0 market events).
- Counterparty found: type 1228 bought at station 60003724 @4605.77 in 30000145.
- 6.2 sell checkpoint produced 0 events -> added opt-in `EVEJS_COOP_NPC_MARKET_TRACE=1`
  diagnostic event `living-native-market-trace` (counters + first busy/station sample).
  Awaiting the first trace to learn the real skip reason (role / busy / distance).
- Suspected blocker: native haulers never approach a station (coopNativeIndustry keeps them
  at the belt), while the gate demands <=10 km from a real scene station.
