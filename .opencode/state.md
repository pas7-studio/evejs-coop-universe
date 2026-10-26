## Durable mining fleet / ore stall — state 2026-10-25 23:35 UTC

**World mode:** `EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE` is OFF in the live compose file
(the flag was removed after the durable roster kept decaying). Slot reconcile, trip
recovery, haul manifest, haul cargo, station delivery, mining trace stay ON. The durable
code (witness reconcile / repair / widen / controller re-attach) is committed and green
(25/25) but dormant until the flag is turned back on.

**Hard fact about restarts:** `npcCargo` is empty after a restart and the startup fleet's
ship rows are gone, so the whole startup-fleet state is transient. Only cargo that
`coopNativeHaulCargo` marks non-transient during a real haul survives. Therefore path B
(durable haul-cargo journal + adoption onto a freshly spawned hauler) is the short path;
path A (durable hulls) also has to beat entity transience.

**Current gameplay blocker (not durability):** the fleet reaches `state=mining` with real
asteroid targets, ticks run every second (`TICK_mining`), but the miners sit `STOP` with
`targets []`, `qty 0` and mining modules `active:false / online:true`. No `NO_MINING_MODULE`,
`NO_MINING_SNAPSHOT`, `TARGET_OUT_OF_RANGE` or `TARGET_LOCK_FAILED` reason was ever recorded,
so the loop is not skipping on those. Last `living-hauler-loaded` is 21:56; economy director
is healthy (ranks ore 17464 at 5203.7 ISK, station 60014935 for 30000144/30000145).

**Instrumentation added (overlay patches, not a fork):**
- `MINER_TARGET` — modules/fitted/activeEffects counts, distance, chosen target, once per
  2 min per fleet.
- `NO_MINEABLE_TARGET` — the silent `if (!targetEntity)` branch that never logged.
- `coopStuckWarpRecovery.release()` now also completes a **sessionless** warp whose own
  `completeAtMs` elapsed (`WARP_INGRESS_COMPLETED`); before this only `warpState` warps were
  landed and miners stayed `mode=WARP` forever (`MINER_NOT_IN_SCENE_OR_WARPING`).

**Anchor lesson:** the patch engine matches anchors after trimming indentation, so
`    if (!targetEntity) {` was "unknown or duplicate". Multi-line anchors that include the
body line are unique. Always require `OVERLAY_OK` with `patched: 53 / anchorMismatch: 0`
before building an image; a failed install still lets the build stage run on half-patched
sources.

**Next step:** Docker Desktop died mid-deploy (engine pipe gone). Restart it, rebuild
`evejs-local` from the verified overlay, `compose up -d`, wait ~3 min, then read
`living-mining-blocker` reasons for `MINER_TARGET` / `NO_MINEABLE_TARGET`. That answer
decides the fix: if `activeEffects` stays 0 while `modules > 0`, activation does not stick;
if `NO_MINEABLE_TARGET`, target selection is the blocker.
