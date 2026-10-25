## Fleet survivability (2026-10-25 22:45 UTC)

Goal: the mining fleet must not die with a scene or a container restart, and its cargo/trip
must resume. Five layers, all opt-in:

1. **Durable ships** - `EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE=1` (ALIFE08). Entity, controller,
   modules and cargo live in the native store; a boot materializes the SAME hulls by ID.
2. **Abandoned witness re-seed** (new) - `EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE=1`.
   A slot witness left by a transient generation (every recorded ship provably absent: no durable
   row, no physical ship, no cargo row, no module row) is ARCHIVED to
   `/coopMiningFleetSlotsArchive/<key>-<ts>` and that slot is seeded again. PREPARING stays
   quarantined, and any surviving cargo/module row keeps the slot blocked for an operator.
3. **Stale runtime fleet adoption** (new) - a runtime fleet record whose listed ships all
   disappeared is re-pointed at the verified survivors instead of throwing
   `ALIFE08_RUNTIME_FLEET_SLOT_CONFLICT` forever. A record that still owns a real ship is
   never touched.
4. **Trip resume** - `EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY=1` + `EVEJS_COOP_NATIVE_HAUL_MANIFEST=1`
   makes `resumePendingStationCargo` put a restored loaded hauler back into `loaded` so the
   station trip runs again with the SAME cargo.
5. **Stuck warp landing** - `coopStuckWarpRecovery` lands only a warp whose own clock elapsed.

Tests: `tests/coop-native-mining-fleet-durable.test.mjs` 20/20 (3 new: abandoned re-seed,
cargo protection, stale runtime adoption), overlay test 5/5, station arrival 15/15, market 23/23.

Deployed with all five flags; watcher `%TEMP%\opencode\economy-watch.log` waits for
`living-npc-station-sold` or the exact skip reason.
