## Restart resilience — measured 2026-10-26 10:34 UTC

Test: `docker compose -p evejs restart server` on the co-op project only.

**What comes back by itself (verified in the log after the restart):**
- Headless boot re-entered every configured system within ~5 s:
  `living-headless-boot-system 30000144 / 30000145 / 30100032` at 10:34:08-10.
- The startup mining fleet re-seeded per slot: `fleet 1 mining miners 2 haulers 1`.
- Durable files on `/var/lib/evejs` survive: `coop-economy.json`, `coop-npc-links.json`,
  `coop-npc-life.json`, `coop-factions.json`, `coop-courier-flights.json`,
  `coop-courier-history.json`, `coop-courier-notices.json`, `coop-loss-ledger.json`,
  `coop-native-warehouse/` receipts. Market orders live in the Rust market service.
  Pilot ledgers and warehouse stock therefore do NOT reset.

**What does NOT survive (the real gap):**
- The startup fleet's native rows (`npcEntities`, `npcRuntimeControllers`, `npcModules`,
  `npcCargo`) are transient: after the restart the log shows new ship IDs and
  `lastHauledVolumeM3=0`. Ore sitting in a miner's hold, a partially filled hauler and a
  haul trip in progress are all lost; the fleet restarts its cycle from zero.
- Only cargo that `coopNativeHaulCargo` marked non-transient during a real haul survives
  restarts.

**Closing the gap (path B, chosen because path A needs entity transience beaten too):**
1. At haul load time persist a small journal per fleet slot: loaded stacks (typeID,
   quantity) and the chosen destination station, fsynced next to the other coop state.
2. On boot, after the slot's new wing is verified, adopt the journal onto the new hauler:
   grant the same stacks as durable native cargo tagged with the new entity IDs, keep the
   existing warehouse receipt identity rules untouched, then clear the journal only after
   the receipt is COMMITTED (or the ore is proven gone).
3. Never invent ore: the journal may only be re-attached once, and an unclaimed journal
   older than a configured TTL is archived, not credited.

**Also fixed in this window:** a physically arrived hauler may deposit using the trip's own
`arrivedAtMs` dwell proof while the live stability check still applies (the in-memory
`arrivals` record could be lost across a trip rebuild and blocked every sale with
`ARRIVAL_NOT_VERIFIED`).
