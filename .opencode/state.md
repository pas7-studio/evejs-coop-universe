## Durable fleet: tried, blocked on a real slot witness (2026-10-25 22:20 UTC)

`EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE=1` was deployed and then REVERTED. Not a win:
the fleet slots seeded while durable was OFF left `coopMiningFleetSlots` witnesses whose
ships were transient and vanished. On the next boot durable startup refused to guess:

```
[ALIFE08] ALIFE08 slot 30000145-1 blocked: ALIFE08_UNEXPECTED_OR_MISSING_MARKED_SHIPS
[ALIFE08] ALIFE08 slot 30000144-1 blocked: ALIFE08_RUNTIME_FLEET_SLOT_CONFLICT
```

Result: 30000144 got fleet 960004609 with `miners: 0`, 30000145 stopped ticking after 22:13:38,
every ship `STOP` with 0 ore. So no mining at all. Doctrine says never wipe the registry to
force a pass, so the flag went back to OFF until the witness can be reconciled legitimately
(legacy transient slots must be recognised as re-seedable, or an operator repair path used).

**Important insight:** the earlier trips kept dying because every deploy recreated the container
(a new transient fleet per scene boot). With no redeploy, the loop actually ran: 21:56 haul
loaded 26 153 ore, 21:57 station chosen, sale attempted.

## Current build

Transient fleet again, plus one real fix: `sellOnArrival` now receives the live arrival `scene`
from `coopNativeStationArrival`, instead of looking a scene up by system id, before adopting the
hauler identity through `coopNativeIndustry`'s existing `registry.link` + `presentVirtualPilot`
path. Background watcher: `%TEMP%\opencode\economy-watch.log`.

## Unverified failures seen (pre-existing, unrelated to these files)

`tests/coop-escort-durable-flight-recovery.test.mjs` 0/6 and
`tests/coop-npc-durable-ammo-debit.test.mjs` 2/18 fail on origin/main content that this work did
not touch. Recorded, not fixed.
