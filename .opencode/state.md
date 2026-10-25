## Durable mining fleet: where it stands (2026-10-25 23:05 UTC)

**Working:** witness reconciliation. Every boot logs a full slot:
`ALIFE08 slot 30000145-1 -> RESTORED miners=2 haulers=1 restored=2`. Abandoned
witnesses are archived (never wiped), orphan cargo/fitting of provably absent hulls is
archived then released, partly lost slots are repaired in place, and incomplete runtime
records are widened instead of raising `ALIFE08_RUNTIME_FLEET_SLOT_CONFLICT`.

**Still broken:** the roster does not survive the native tick. Within ~1-2 minutes the
mining fleet state shows `miners 0 haulers 1` or `miners 1 haulers 1`, and the ships sit
`STOP` with 0 ore. `pruneMiningFleet` drops any ship without a runtime controller; we
re-attach controllers at startup (`ensureControllers`, logged as `restored=N`), yet the
roster still decays. Next suspects, in order: (1) something unregisters the controller
after startup, (2) the fleet record is rebuilt from another path, (3) the ships are
destroyed and re-created with new IDs.

**Proven alternative (path B):** with `EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE` OFF the
transient fleet mines reliably (26 153 ore mined, haul loaded, station chosen, sale
attempted at 21:57). It only loses state when the container restarts.

**Open decision for the owner:** keep pushing path A (durable hulls), or switch to path B -
keep the fleet transient and make the ECONOMY durable: journal the hauler cargo and the
station trip, then re-attach that cargo to the freshly spawned hauler after a restart.
Path B is shorter and does not fight native lifecycle code.

Flags currently ON in compose.coop-probe.yaml: durable=1, slot reconcile=1, trip recovery=1,
haul manifest=1. Turning durable OFF restores the previously proven mining behaviour.
