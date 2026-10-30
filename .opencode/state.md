# State — co-op loop (mining → haul → station → sale)

## 2026-10-31 00:30Z (UTC) - fitting: save works, the window is killed by the VGS offer service

MEASURED LIVE:

    charFittingMgr.SaveFitting() callID=188 -> response OK, OnFittingAdded charid
    savedFittings owner=140000005: 1620 "*Venture-My-Very-Expensive" 12 items (19:45:40Z)
                                   1621 "*Venture-My-Very-Expensive2" 11 items (20:12:09Z)
    GetFittings returns both (dict keyed by fittingID, util.KeyVal carries
    description/fitData/fittingID/name/ownerID/savedDate/shipTypeID)

So saving, persistence and read-back are correct. What breaks the window is the client side:

    EXCEPTION: Failed to search the NES for offers
      IOError: [Errno 9] Bad file descriptor
      eve/client/script/ui/shared/skins/skinPanel.py(1047) FindOffersAndReveal
    -> store.SearchOffersByTypeIDs() -> vgsService.GetStore() (VGS, NOT our gRPC gateway)

plus `ShipTreeDockablePanel.ToggleMinimize -> AttributeError: infoPanelContainer`.

Root cause: the client's NES/skin offers come from the **VGS HTTP service**, which this server does
not implement at all (`vgs` appears nowhere under server/src). Our store lives behind gRPC
(`newEdenStore`, `eve_public.cosmetic.*`), which the gateway does answer. The proxy only intercepts
`public-gateway.evetech.net` + launchdarkly; any VGS host is blocked/absent, so the client's HTTP call
dies with EBADF inside the skin panel tasklet.

Next: implement the VGS offer surface (get_offers for store 4 from `storeState.getLegacyCatalog` +
`publicOffers`) and route it through the local gateway, then the SKIN panel and product search work.

**High-sec NPC guard** (fork `3a2d1fb`) is live: NPC -> player aggression is blocked at security >= 0.45
unless the player shot first (5 min) or is an enemy militia hull; killmail 173 was a pirate kill in Jita 0.94.


## 2026-10-31 00:20Z (UTC) - sites in every band, scannable wormholes from known space

MEASURED LIVE (play stack, after fork `f95d822` + this repo's tests):

    [CoopUniverseSites] systems=30 desired=271 created=0 spawned=18
      anomalies={"30000142":4,"30000144":4,"30000145":4,"30003837":4,"30045344":4,"30100032":4}

    wormhole signatures: 30000142 Jita "Wormhole C125", 30000144 Perimeter "Wormhole Y683",
                         30000145 New Caldari "Wormhole Z060"
    persisted instances 1601: highsec 261, lowsec 320, nullsec 264, J-space 756 in 108 J systems
    Jita's hole leads to J165006 (31000845) and that system holds 7 sites (combat 5, gas 2)

What changed and why it was empty before:

1. null-sec definitions were computed all along (11-13 per system) but the reconcile only ever ran for
   the world's visited set, so no null-sec instance was ever created. The reconcile now also covers
   every live scene and a deterministic daily sample of 12 null-sec + 12 J-space systems. J-space is
   classified by its 31xxxxxx id range - the SDE solar-system rows have no `wormholeClassID` column -
   and special space (32xxxxxx, Pochven) is excluded because no player gate reaches it.
2. known space could not reach J-space at all: the engine makes the J-space source endpoint visible and
   the K162 end invisible, nothing scans from J-space, so `listWormholeSignatureSites(30000142)` was 0
   with 1193 active J->k pairs map-wide (the three pairs that landed in Jita were already collapsed).
   `space/coopWormholeEntrances.js` opens one real direct entrance per world system through the
   runtime's own `revealOppositeEndpoint`, or spawns one real native `spawnRandomPairs` hole when no
   pair lands in the system; the J-space side and any spawned destination are seeded with sites in the
   same pass (with a bounded retry when that seeding comes back empty).
3. opening holes in the whole region every tick was measured to spray the map (4 reveals / 10 min,
   instance count 1327 -> 1601 and 108 J systems): entrances are direct-only now (`maxScope:
   direct`), and the last reconcile reported `created=0` - no churn, no growth.

Tests: `tests/coop-wormhole-entrances.test.mjs` 7/7 (direct wins, region holes only when asked,
collapsed/expired/already-visible ignored, one pair opened once, J-space id range).

Still unproven in a real client: the owner must open the probe scanner in Jita/Perimeter/New Caldari
and see the wormhole signature, then scan, warp and jump. That is a human click, not a server claim.


## 2026-10-30 23:59Z (UTC) - fed, full, and self-restarting

MEASURED LIVE:
  freight        39 trips, 2 398 577 ISK, 370 962 units, RECONCILED (7 deliveries counted apart)
  treasury       766 087 600.48 ISK   (722 134 486.21 at the start of this work)
  ore @ 60000682 2 798 972 -> 15 076 units;  minerals 246 365 -> 5 708 787 units
  trip shape     389 999 / 550 000 / 309 999 units (holds full)
  cycle          median 10.9 min between settled sales per hull (was capped by a 45 s beat)

Changed this round: a DONE run RESTS 2 min and starts a new cycle (it used to end the hull for
good at its trip cap - four hulls sat idle while 5.28 M minerals waited); MAX_STOP_WAITS 40 -> 20;
the loop beat runs at 20 s on the agents stack instead of 45 s.

NEXT: the runtime line ratchet (5153, other sessions); blueprint acquisition stays the
strategic ceiling (market_orders has 0 rows - nothing can be bought); watch the ledger for a
full day to confirm the faster beat really raises throughput rather than just the event rate.

## 2026-10-30 10:00Z (UTC) - sites now ~3-4 per visited system; null/J-space: two concrete blockers

After the density change and the null/J sampling (fork `2d4318c`), the live reconcile reports:

    [CoopUniverseSites] systems=17 desired=152 created=121 spawned=11
      anomalies={"30000142":4, "30000144":3, "30000145":3, "30003837":3, "30045344":4}

i.e. the visited systems now hold 3-4 anomalies each, which is the real-game norm (see
`docs/UNIVERSE_SITE_DENSITY.md`). Persisted: 57 instances in 20 systems - highsec 37, lowsec 20.

Null-sec and wormhole space are still zero, and the two reasons are now measured, not guessed:

1. **The world map has no J-space at all**: `worldData.getSolarSystems()` returns 8490 systems,
   `highsec 1247 / nullsec 6556 / wormhole 0` - no system carries `wormholeClassID`. So there is nothing
   to seed a wormhole site into; importing the SDE's wormhole systems is a separate data task.
2. **Null-sec desired definitions work but are filtered out of the reconcile**:
   `listDesiredUniverseDungeonSiteDefinitions([30002149])` returns **11** definitions (combat 6, data 2,
   gas, relic 2), `[30003239]` 13, `[30003194]` 12 - yet no null-sec instance is created. The seeder
   normalises the passed `systemIDs` down to the systems the world manages, so systems outside that set
   never get an instance even though the definitions exist. Next fix: seed with an explicit
   allowed-system override, or register the sampled systems as managed before reconciling.


## 2026-10-30 09:30Z (UTC) - how the sites are actually spread right now, per band

Measured from the persisted dungeon state, security taken from `worldData`:

    INSTANCES 34 in 20 systems   highsec 24 | lowsec 10 | nullsec 0 | wormhole 0
    30000127 0.748 hs 1 | 30000131 0.607 hs 2 | 30000141 0.949 hs 1 | 30000142 0.946 hs 1
    30000144 0.949 hs 1 | 30000145 0.949 hs 1 | 30001376 0.817 hs 1 | 30001379 0.885 hs 2
    30002762 0.949 hs 2 | 30002802 0.847 hs 2 | 30002813 0.283 lowsec 2 | 30003039 0.647 hs 2

So: high-sec and low-sec are populated, **null-sec and wormhole space are not**, for two different
reasons:

  1. instances are only seeded for the systems the world reconciles (the visited/awake set), and the world
     loop lives in high/low-sec - a null-sec system never wakes here, so it is never seeded. Seeding it in
     advance WOULD work: `handleSceneCreated` materialises whatever instance exists the moment a scene is
     built, so the fix is to add a rotating sample of null-sec systems to `coopUniverseSites.reconcile`;
  2. the wormhole band is empty at the data level too: the spawn profiles carry no `wormholeClassIDs`, and
     no J-space system ever gets a scene in this world. Both have to be true before a wormhole site can
     appear.

What the owner asked for
One call instead of a dozen: issue a whole fitting at once, "he died → recreate
exactly the same ship" at once, and never wait 45–60 s. **Done and proven.**

## Root cause of the slow admin calls (this was the real bug)
`coopAdminBridge.drain()` only ran on the world tick. That tick is 30 s nominal
and **60–90 s in practice** when the world phases are busy, so every admin call
waited for it and often timed out. It was never "the bridge is dead".

Fix (fork `37e4197`): `startFastDrain()` drains the request file on its own 1 s
timer (`EVEJS_COOP_ADMIN_BRIDGE_MS`), started from the same env-gated block in
`coopVirtualWorldRuntime.js`. The world-tick drain stays.

## Tools (repo `12da23e0`, fork `37e4197` `33c6164` `4990672` + name fix)
- `admin_give_fit` — reuse or grant the hull, every module into its real slot
  family, drones to the drone bay (87), rest to the hold (5), optional board.
  **Idempotent**: items already on the hull count towards the request.
- `admin_restore_last_loss` — reads the newest native killmail for the character
  and rebuilds the exact hull + modules + drones + cargo.
- `admin_batch` — several whitelisted actions, one round-trip, one line each.
- Probe (`mcp/lib/probe-admin-command.cjs`): whole request as one base64 blob
  (`Q_REQUEST_B64`), answer read from the tail of the results file, 150 ms poll.
- Pure planner `space/coopAdminFitPlan.js` + `tests/coop-admin-fit-plan.test.mjs` (5/5).

## Measured on the evejs-agents stack (never the play stack)
| call | latency | result |
| --- | --- | --- |
| `admin_give_fit` (hull + 6 modules) | 0.4–1.1 s | all slots correct (27/28 high, 19/20/21 med, 11 low, 87 drones) |
| `admin_restore_last_loss` (killmail 54) | 1.09 s | 8/8 slots, hull granted |
| `admin_batch` (3 actions) | 0.83–1.12 s | 3/3 applied |
| after `docker restart` | — | fit still on disk (persisted) |

All three also proven through the real MCP stdio layer (schema + handler), not
just by calling handlers directly.

## Gotchas that cost time today
- A timed-out call may still have been applied: the request is on the volume.
  Read the result before repeating a mutating call.
- Killmail `flag: 4` cannot separate fitted modules from cargo. `singleton` marks
  a fitted module; category 18 marks a drone. That is the rule in the code.
- `resolveItemByName('Venture')` is ambiguous (published hull + two ♦ variants);
  the published exact match now wins.
- Cargo/drone stacks must move as one stack. Treating `count` as "N slots" for the
  hold turned a 1000-unit ore stack into 1000 grants (fixed in `4990672`).
- **Agents-stack trap I created and fixed:** `docker cp` a file into
  `/var/lib/evejs/gameStore/gamestore.sqlite` leaves it root-owned, so the server
  logs `sync flush FAILED ... readonly database` and silently loses every write.
  Fix: stop the container, `chown 1000:1000` on the volume, delete the stale
  `-wal`/`-shm`, start. Never `docker cp` over a live store.

## Owner's ship (verified in the server's own item store)
Character 140000005, docked at 60015157, active hull Venture `9988400116384`:
Mining Laser Upgrade I (11), Shield Extender (19), Multispectrum Hardener (20),
1MN Afterburner (21), **2× EP-S Scoped Mining Laser (27, 28)**,
**3× Hobgoblin I in the drone bay (87)**. Hangar: Mining Destroyer.

## Still open
- The play stack still runs the **old** bridge (no `give_fit`/`batch`), so admin
  calls there still take 20–60 s. The new code lands on the next play-stack
  restart — needs the owner's restart window (he and his friend are online).
- This session's MCP process also predates the new tools; they appear after the
  MCP server restarts.
- Wreck `9988400116382` in 30000141 still holds singleton module copies the bridge
  cannot delete. Do not loot it; it expires on its own.

## FW-108 (fork a424285): a gate route finder - the missing piece under the economy
`coopNpcGateTravel.tick` has always accepted a multi-hop `route[]`, but NOTHING in the server
built one: no BFS, no route helper, no caller passing more than two systems. So "sell the loot
where it is actually bought" was undescribable, let alone executable.

New pure module `coopGateRoutes.shortestGateRoute({fromSystemID,toSystemID,neighbours,maxHops})`:
deterministic BFS over an adjacency function, bounded, no store reads, no ship movement.
`UNREACHABLE`, `NO_GATE_GRAPH` and `INVALID_SYSTEM` are answers - never a guessed path.
The `living-npc-sale-type` refusal now annotates up to three real seeded buyers with their
system and gate distance, so a dead sale states the journey instead of a dead end.

Measured with the REAL SDE inside the running server (23:4xZ):
```
front  30003837 -> Jita 30000142   ROUTE  10 hops  (30003837,30045344,30045338,...)
source 30045344 -> Jita 30000142   ROUTE   9 hops
Perimeter 30000144 -> Jita         ROUTE   1 hop
```
Suite `tests/coop-gate-routes.test.mjs` 6/6.

## Next (the one thing left for real war income)
Give the loot chain a destination: when the station it is docked at quotes none of the carried
types, hand the hull a `shortestGateRoute` to a station that does (Jita 60003760 today) and drive
`coopNpcGateTravel` hop by hop until it docks and sells. Everything it needs now exists - the
seeded-buyer list from FW-106, the route finder from FW-108, and the multi-hop travel director.
Until that lands, the war pays only from money a faction already holds (FW-105/FW-107).

## FW-109 (fork a7cb78a, deployed on the play stack): a war bounty can finally reserve money
The wallet-backed bounty (FW-105) had **never paid once**. Every real front kill emitted
`living-native-war-bounty-wallet-backed` with `reserve: "BLOCKED"`, and the treasury said why:
`WAR_TREASURY_PURPOSE_UNAVAILABLE`. A `RESERVE` naming a campaign that already exists is
refused **by design** - correct for an *opening* (money is put aside before the campaign is
created) and structurally impossible for a *bounty*, which is earned by a kill inside a live
campaign. So the money in the faction's own corporation wallet could never be used for it.

Two fixes, both in the money gate:
- `RESERVE` honours an explicit `purpose:"BOUNTY"`: the named campaign must really exist, must
  belong to that war, and must still be `PREPARING` or `ASSAULT`. Openings, refunds and payouts
  are untouched, and no ISK can be created - the debit is the same journal entry as before.
- each kill reserves under its own hashed reservation id (treasury ids are capped at 96 chars),
  because the old fixed `bounty:<campaign>:<faction>` id collided on the second kill and the
  orphan-escrow reuse would have collapsed two kills into one escrow.

Also: a **refused casualty was silent**. The casualty ledger's status/reason is now published as
`living-native-war-casualty-skipped` instead of being swallowed, so `NO_DEFENDER_WRECK` in the
capture phase can finally name the predicate that refused the wreck.

Live after deploy: `healthy`, fleet registry restored to 10 hulls (500001 x7, 500004 x3),
1 casualty row, campaign `war:500001-500004:campaign:30003837:r18` still `ASSAULT`.

## What still blocks a full war (measured, not guessed)
1. The live front is a stalemate by numbers: the DEFENDER fields 7 registered hulls and the
   ATTACKER 3, and `coopWarCaptureByForce` needs a wreck of a *registered defender* hull
   (`victimFactionID === war.defenderFactionID`). In the last hour the verified wrecks at the
   front were all **unregistered A-Life ships** (`coop-pilot-023` respawning every ~3 min), so
   `objectiveEvidence` stayed empty and r13..r17 expired without ever capturing.
2. Money: corp 1000129 holds 432.75 ISK, refinery jobs need 22 525.47 ISK, faction wallets
   500001 = 0 / 500004 = 3 000 ISK. The only ISK source in the world is selling to real seeded
   buyers, and no hull can reach one (mining hulls are refused at gates by design:
   `HULL_ROLE_CONFLICT:MINING_FLEET`).
3. Next lever, in this order: (a) watch `living-native-war-casualty-skipped` on the next front
   wreck to learn the exact refusal, (b) give the assault a winnable, honest path (attacker
   hull count or a siege rule), (c) the loot journey to Jita (FW-108 route finder is ready).

## FW-110/110b/110c (fork fa74808, b084641, 9aebabb): the war now survives a restart
Root cause of "the front freezes and expires after every restart": the durable war fleet registry
keeps the OLD entity ids while the restart re-materializes the same pilots with NEW hulls.
MEASURED 2026-10-30: 6 of 10 rows pointed at ids the pilot no longer owned (pilot-003 registry
980000062777 vs real hull 980000067050) and 4 pilots had no link at all. Every muster then
answered PILOT_IN_USE, both sides reported `assigned 0`, and r13..r17 expired with
`objectiveEvidence: []` - the capture phase can never find a defender wreck that does not exist.

- FW-110: `staleCustodyRows({ships,links})` (pure, 6 tests) finds rows whose pilot provably flies
  another hull; the mobiliser releases that custody through the native RELEASE command, bounded,
  never in a dry run, never under a live order lease. A pilot with no link or two links is
  ambiguous and is never guessed at.
- FW-110b: `verifyRelease` refuses those rows by design (absence is not destruction), so a
  separate `verifyReplacement` proof was added: the pilot must have exactly one hull and the
  successor must be a real ship. Exact proof `native-replaced:<campaign>:<hull>:<successor>`.
- FW-110c: uniqueness is counted in distinct HULLS (a pilot legitimately appears in an order
  lease and in the identity link at once) and a durable record + controller also proves the
  successor while a headless scene is still being rebuilt.

LIVE after the third deploy (00:12Z): `living-native-war-custody-stale ... "status":"APPLIED"`
for pilot-002 (980000067361 -> 980000067524), registry back to real hulls, and the muster now
reports `DEFENDER assigned 1 limit 2` (was 0 for both sides). Remaining rejects are honest:
ORDER_LEASE_ACTIVE and WRONG_FACTION.
