# Universe site density: what the real game does and what we run

Researched because the owner said our anomalies appear far less often than in the real game.

## What the real game does (sources below)

- A high-sec system normally holds **about three combat anomalies**; that number is the observed norm,
  not a per-system constant. Busy systems near trade hubs hold fewer because players keep clearing
  them, while rarely visited systems (high-sec islands, quiet low-sec, wormholes) **accumulate many**
  - "dozens" is reported.
- Cleared sites **respawn somewhere in the region**, effectively straight away: the server processes
  sites ready to respawn in a batch **every ~10 s**, creating a new dungeon. Where it lands is random
  within the region; the same system can get the same type back within seconds.
- Sites that are never visited eventually expire (older reports: a ~72 h neglect timer; modern
  expansion notes give explicit per-upgrade respawn times, 12 min maximum in sov null-sec).
- Sites are **not** regenerated at downtime; downtime is irrelevant to the cycle.

Sources: EVE University "Combat site" (anomaly tiers and the high/low/null split), EVE Online forums
"What influences the number of combat anomalies" (2017), "Combat Anoms and Spawn rates" (2024: batch of
~10 s, region-wide assignment, "3 combat sites has been the norm"), "Exploration question" (respawn
immediately in-region, quiet systems stockpile), Equinox patch notes (2024: respawn 20 → 12 min max,
+1 combat site per upgrade).

## What we had

`dungeonAuthority` spawn profiles, read from the DUNGEON_AUTHORITY static table
(`gameStore/data/dungeonAuthority/data.json`), per family and per band:

```
combat_anomaly  lifetime 1440 min  highsec slotsPerSystem=1 targetSystems=360
combat          lifetime 1440 min  highsec 1/120      data 1/36      combat_hacking 0
```

One slot on 360 of ~1200 high-sec systems, alive for 24 hours: most systems empty, and a system that
did get a site kept it for a day.

## What we run now

The same table, edited (backup written next to it as `data.json.bak-<timestamp>`):

| family | highsec | lowsec | nullsec | wormhole | lifetime |
| --- | --- | --- | --- | --- | --- |
| combat_anomaly | 3 | 3 | 4 | 3 | 360 min |
| combat | 2 | 2 | 2 | 2 | 360 min |
| data | 2 | 2 | 2 | 2 | 480 min |
| relic | 2 | 2 | 2 | 2 | 480 min |
| gas | 1 | 1 | 1 | 2 | 480 min |

plus every visited system eligible (`targetSystems: 0`, `targetSystemRatio: 1`) instead of a fixed 360.
The engine's own expire/rotate tick keeps moving them, so sites close and reopen elsewhere on their own.

Measured after the change: `listDesiredUniverseDungeonSiteDefinitions([system])` returns **6 for Jita,
5 for Perimeter, 5 for New Caldari** (combat + ore), where it used to return about one.

## Open gap

The reconcile allocator still spreads the desired definitions over the whole eligible band rather than
per visited system: a full reconcile for five systems reported `desired=7`, and the persisted instances
are 1 per system (Jita 1 ore, Perimeter 1 combat). The per-system desire is now correct (5-6), so the
next fix is the allocation step (`buildRandomAllocatedUniverseDefinitionsForBand`) - either seed every
visited system up to its `slotsPerSystem`, or accept the region-wide spread and raise `slotsPerSystem`
until the observed count matches the real "about three anomalies per system".
