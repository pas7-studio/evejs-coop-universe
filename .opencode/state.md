# Handoff — server performance (2026-11-01)

## Goal
Stop the owner's world from feeling laggy: the tick must stay near 30 s, and the
HTTP/gRPC surface (26002/26003) must keep answering while a player is in space.

## Measured facts (play stack, 2026-10-31 ~20:50 UTC)
- Tick period 6–218 s instead of 30 s; process ~480% CPU on 11 threads.
- `/health`, `/`, `/status` on 26002 and 26003 never answer; 11+ healthcheck curls
  stuck inside the container. Game ports 26000/443 work.
- Hot phases (measured by gaps between consecutive event lines):
  `living-native-materialization-attempt` 39–43 s,
  `living-native-durable-slot` up to 75 s,
  `coop-player-prey-eligibility` 48 s,
  `universe-sites` p95 45 s (not dominant in the last window).

## Fixed already (fork, image `6d15d4b`)
1. `546936f` — existence checks called `runtime.ensureScene(system)`, which BUILDS a
   whole solar system (belts, gates, 40k asteroid records) just to answer "does this
   ship exist". Called once per stored identity link, every tick. Replaced with
   `findNativeShip()` in `space/coopVirtualWorldRuntime.js` (loaded scene answers
   directly, unloaded one from `npc/nativeNpcStore`). Three call sites.
2. `a2ec062` — `allowsPlayerPrey()` emitted a `coop-player-prey-decision` event with a
   synchronous `appendFileSync` for every attacker × player pair, every tick. Now one
   event per (attacker, target, verdict, reason).
3. `5345aca` — `EVEJS_COOP_PLAYER_PREY_DEBUG` was pinned to `1` in `Code/compose.yaml`
   (per-pair JSON dump into the container log). Now `0`.

None of it is live on the play stack yet: it needs one restart window.

## Next steps (in order)
1. Restart the play stack with the owner's consent, then re-measure with the two
   probes kept in `%TEMP%\opencode`: `stall-probe.cjs` (event-loop stalls) and
   `log-gaps.mjs` (stalls named by the log line before them).
2. If `living-native-durable-slot` is still huge: `space/coopNativeMiningFleetDurable.js`
   restores slots (entities, modules, cargo) — make it incremental (one slot per tick)
   and cache the per-slot signature instead of re-reading store rows.
3. `space/coopUniverseSites.js` `reconcile()` — split per system across ticks; it is
   called with the whole `visitedSystems` set.
4. Re-enable `EVEJS_COOP_PERF_METRICS` samples: `coop-perf-sample` events stopped on
   2026-10-30T22:26 although `enabled()` returns true in a fresh process, so the
   in-server 60 s timer is not emitting. Fixing that gives per-phase timings for free.

## Traps
- `docker cp` over `/var/lib/evejs/gameStore/gamestore.sqlite` makes the file
  root-owned; the server then logs `sync flush FAILED ... readonly database` and loses
  every write. Fix: stop, `chown 1000:1000` on the volume, delete stale `-wal`/`-shm`.
- The play stack is being recreated by something outside this session (19:58, 20:07,
  21:54, 20:44) — check that before blaming a measurement.
- Never measure during boot: 50 s stalls in the first 2 minutes are startup, not lag.
