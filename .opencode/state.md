# State — co-op loop (mining → haul → station → sale)

## 2026-10-31 08:45Z (UTC) - the loop ran out of DEMAND, which is the point

MEASURED: Jita's Tritanium buy order is now **quantity 0** (price 3.71) - the fleet sold into it
until it was gone. Seeds still offer 4 000 000 units at 3.93 (that is other people selling),
and Pyerite still bids 2 541 923 at 15.13. The corporation holds 3 037 466 minerals at
60000682.

So the two hulls that report NO_TRIP_WORTH_TAKING are RIGHT: flying Tritanium to a station that
no longer bids is a loss dressed as activity. The binding constraint moved once more: not
ships, not refining, now DEMAND.

Also fixed this round:
  - the blueprint purchase now happens WHERE THE HULL LOADS (the station that holds the
    materials), not where it sells, so a bought blueprint can be built at once;
  - the chooser prefers blueprints whose recipe can be run AT THAT STATION (runsAtStation),
    because a cheap blueprint nobody can feed is a purchase that only looks productive.

OPEN: one hull (980000000002) is blocked UNRESOLVED_MARKET_JOURNAL with 1 959 units of Pyerite
aboard. The world's own reconcile proves the market row is NOT filled, so it refuses to credit
it - correct behaviour. The pilot-swap fallback did not take for this hull; that is the next
thing to check (the swap relies on the journal being named after the bound pilot).

NEXT, in order:
  1. sell into the demand that still exists (Pyerite 2.54 M at 15.13) and let the planner look
     further than one gate when the near system is exhausted;
  2. get the first blueprint bought and its product made - that is what replaces exhausted raw
     demand with something the corporation can keep supplying;
  3. the blocked hull's journal swap.

## 2026-10-31 08:25Z (UTC) - the blueprint purchase exists but has not fired yet

Answer to "is production crafting varied goods?": NOT YET, and now for one measurable reason.
The corporation owns 4 blueprints (3 buildable, 1 static-data artifact), so its product range
cannot grow. Measured: the seeded world DOES sell blueprints - seed_stock carries 2 772 of them
at 10 500-20 000 ISK across Jita and New Caldari - and the market has a real sell side
(GetStationAsks returns 18 640 rows for Jita 4-4).

BUILT AND TESTED (5/5) this round:
  - space/coopBlueprintPurchase.js - pure: which blueprint is worth the ISK, by the demand its
    product really has, against its price; refuses owned/overpriced/no-recipe/no-buyer by name;
  - coopVirtualWorldRuntime.buyFromStationStock() - buys ONE unit through the native trader
    (seeded ask only, real ISK, real copy) and emits living-npc-blueprint-bought;
  - the loop's buyBlueprint() gathers asks (seed_stock), demand (seed_buy_orders) and recipes,
    and the distribution run calls it once per trip after a sale, at the buyer station.
  Env on the agents stack: EVEJS_COOP_BLUEPRINT_PURCHASE=1, price cap 500 000, budget 5 000 000.

WHY IT HAS NOT FIRED: the buy step needs a completed distribution sale, and since the deploy the
fleet has been blocked or cooling down (a pending trade journal, cooldowns, a hull loading).
The drain's sales are separate and do not trigger it.

Also fixed this round (each measured): the manufacturer's "Cannot access 'ready' before
initialization" throw (production had been dead for hours); UNRESOLVED_MARKET_JOURNAL now settles
itself from market proof or hands the cargo to a clean pilot identity; an empty hold ends the
trip; a hull that times out three beats is blocked instead of looking busy for ever.

NEXT: watch for one completed distribution sale, then verify the first blueprint lands in a
hangar (jobs/blueprints), let the manufacturer build its product, and the freight run sell it.

## 2026-10-31 07:35Z (UTC) - the manufacturer runs again, and has nothing legitimate to build

The stack was down for ~3 hours (containers exited 255, engine gone); it was brought back with
Start-Agents-Stack.ps1 -Action Up and is healthy.

BUG FIXED (this was the real outage of production): the demand-gap block added in alife26a was
inserted ABOVE `const ready`, so every manufacture tick threw
"Cannot access 'ready' before initialization" - `living-npc-manufacture-blocked RUN_THREW`
every cycle for hours. The block now lives after the declaration, with a regression test that
reads the file and asserts the order (15/15 manufacture tests).

MEASURED AFTER THE FIX (07:30):
  - attempts run again (no RUN_THREW); the first ones after a restart report NO_REAL_BUYER
    because the neighbour lookup needs scenes/gates that are still loading, then recover:
    living-npc-manufacture-buyer-elsewhere BUYER_ELSEWHERE for 60764 at 07:30:52;
  - still NOTHING installed, and the newest job in the directory is 444 COMPLETED at 21:18
    yesterday. The honest reasons, in order:
      1. 60764 (Laelaps) is a static-data artifact - 1 unit of Tritanium for a ship worth
         446 800 000 ISK - and the trivial-recipe guard exists to refuse exactly that;
      2. 444 (Mining Survey Chipset) demand in Jita is 142 units and the hangar plus completed
         jobs already cover it (BUYER_ALREADY_COVERED);
      3. 28338 (faction ammo) has no remaining bid volume.
  So production is idle for a legitimate reason: it already holds what the buyer wants and the
  only big-demand product is an artifact. This is not a code defect.

NEXT: production cannot grow without blueprints (measured earlier: market_orders has 0 rows,
nothing can be bought), so the remaining real work is on the logistics side and on watching the
loop: keep the ledger current, keep the fleet cycling, and let the owner decide how blueprints
enter the world (seeded sell side or operator grant).

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

## FW-112 / FW-112b (fork 46efbae, 705e0bd): a front must never run out - war keeps rolling
After the first real capture (30003837 OCCUPIED by 500004) the frontier answered NO_FRONT 137
times in one hour with an EMPTY skip list: every owned system touched only friends, so the war
machine had nothing left to fight over and would have stayed silent for ever.

- FW-112: when no border exists between two REGISTERED territories, the planner rebuilds the
  frontier with the SDE faction owner of an unregistered neighbour; such edges are marked
  expanded, a registered controller always wins, and the navy-capability gate still decides
  whether both sides can really shoot. NO_FRONT now reports whether expansion was attempted.
- FW-112b: the opening proofs no longer demand defender ships already standing in a system
  nobody contested yet (circular for an expansion). The declaration and territory proofs accept
  the SDE owner of an unregistered system as the defender authority, only where the territory
  map is silent; a faction owning neither ground nor ship, and an attacker with no presence in
  the source, are still refused.

LIVE (verified on the play stack): the refusal reason went NO_FRONT -> NO_FUNDED_FRONT (6 fronts
derived) -> OPENED. New campaign war:500001-500004:campaign:30045339 is PREPARING,
30045344 (500004) -> 30045339 (500001); territory 30045339 registered and CONTESTED; garrison
GARRISON_APPLIED. Campaign states: 20 EXPIRED, 2 OCCUPIED, 1 PREPARING.

Suite: coop-faction-war-fronts 11/11, opening/front suites 17/17.

## FW-113 / FW-114 (fork f964aad, 5af2fe5): scale-up - 1 live campaign -> 7
- FW-113: expansion borders are ADDITIONAL candidates, not a last resort (registered borders are
  still planned first). maxPerSide 2 -> 3, still bounded by the merit rank.
- FW-114: the declaration proof accepts real military CONTROL of the source as the attacker
  authority, not only hulls parked there. MEASURED 2026-10-31: 500020 holds 30000144 with one
  hull in the world while 23 foreign ships sit there, so that faction could never open any war.
  START_CAMPAIGN already requires the source to be the attacker's own territory and the garrison
  is what puts hulls there; the navy gate still decides whether the faction can shoot.

LIVE after both deploys (07:52Z): campaigns 20 EXPIRED / 2 OCCUPIED / **1 ASSAULT + 6 PREPARING**
(was one live), territories **13** (was 6), active wars **6** (was 4), fleet 7 registered hulls.
Live fronts: 30045339 ASSAULT; PREPARING 30000139/30000140/30000143 (500001-500020),
30002642 (500004-500020), 30045338/30045342 (500001-500004). 3 war-opened events, 18
GARRISON_APPLIED, 4 casualties RECORDED.

## The one money blocker, now named exactly
living-native-war-bounty-wallet-backed -> reserve BLOCKED:WAR_TREASURY_FUNDS_UNAVAILABLE
(faction 500001 has 0 ISK; 500004 has 3000). FW-111 instrumentation is what made this visible.
Next: real income (sell loot to seeded buyers) or a funded side; no minting.

## FW-115 / FW-115b (fork 907104e, 1a5b1fe): garrison spawns are FORMATIONS
Every garrison spawn passed merit 0, and the doctrine composition reads merit 0 as a recruit's
single hull - so seven live campaigns fielded seven identical frigates (only typeIDs 14359/14361)
while the merit ledger held 1380 merit across 30 pilots. FW-115 passes the commander's real merit
into the sanctioned spawn path; FW-115b fixed the accessor (records() already answers the per-pilot
map, so every commander read as 0).

LIVE proof (08:17-08:18Z): coop-pilot-002 merit 155 (squad-lead) -> fleet 980000076319..623 (4+
hulls); coop-pilot-003 merit 25 (pilot) -> 2 hulls. Formation size now follows earned rank:
recruit 1, pilot 2, wingman 3, squad-lead 5, wing-lead 8, front-commander 14, admiral 25.

Roles the composition already enforces (coopWarFleetComposition): tackle always, EWAR from cap 3,
logistics from cap 5, heavy from cap 8, plus brawler/sniper fill. NOT yet true: conscripted A-Life
hulls carry no role, and the combat director does not yet give EWAR/logistics special behaviour -
tactics today = target selection (WAR_SHIP ranking), engagement posture, battle-line relief, gate
staging and engagement warp.

## FW-116 (fork 22a0dbe): more hulls, a new destroyer role, two cartels completed
Doctrine table extended with real SDE profiles already present in this build (nothing invented):
- NEW role anti-tackle (destroyer) in every fleet from cap 2: Caldari CA Destroyer (4x rail75 +
  web), Federation Arcus (4x light neutron blaster + web), Angel Defacer (4x gatling125 + web),
  Serpentis Trooper (4x rail75 + web). Requirement ladder now: tackle always, anti-tackle from 2,
  ewar from 3, logistics from 5, heavy from 8.
- Angel Cartel: + logistics (Breaker, 2x remote armour) + ewar (artillery cruiser, 2x tracking
  disruptor). Serpentis: + logistics, + heavy (blaster battleship), + sniper (rail battleship).
- Angel sniper deliberately unsupported (no long-range hull we can back with real modules).

Verified against the live SDE: 500001 7/7 roles, 500004 7/7, 500020 7/7, 500011 6/7.
LIVE proof 08:32:47Z - commander coop-pilot-009, merit 150 (squad-lead), spawned 5 DIFFERENT
hulls: 14359 Condor (tackle), 45462 CA Destroyer (anti-tackle), 15320 Moa (brawler),
15972 Delta II (logistics), 12394 Blackbird (ewar).
Suite: composition+doctrine+garrison+navy 42/42.

## Courier family - PROVEN LIVE 2026-10-31 (server side)
- Contracts delivered by the courier runtime: 980000002 (Jita->Perimeter), 980000003, 980000004.
  980000004 final: status=4, coop-events.jsonl `courier-accepted` 07:41:44Z, `courier-gate-hop`
  08:32:17Z JUMP_VERIFIED 30000142->30000144, `courier-delivered` 08:34:36Z HANDED_OVER at 60000358.
- Fixed this round (fork pas7-studio/EveJS): gate-hop event at the verified jump (875b685), hull-docked
  replan + bounded timeout restart (5df155c), resume from the hull real system (86aa4e6, ca971da,
  2f2587e), repaired station carries its solar system (c2831e4), drop a leg that can never progress
  (fb23e9b).
- Still open: courier legs are fragile when the ship row and the scene disagree (item locationID =
  system id + flagID 0 while the scene lost the entity). Recovery now repairs honestly, but a scene
  entity that vanishes between ticks is not explained yet; needs a targeted probe before claiming the
  family is stable.

## FW-117 (fork a1c887e): roles decide who shoots whom
A five-hull squad-lead formation fielded tackle, anti-tackle, brawler, EWAR and logistics, and
every one of them shot the NEAREST enemy - the destroyer, the EWAR ship and the repair frigate all
behaved like a brawler.

New pure module coopWarTargetPriority (7/7 tests): anti-tackle -> tackle, ewar, logistics;
ewar -> logistics, ewar, tackle; tackle -> tackle; sniper -> heavy, sniper; heavy -> brawler.
The battle director orders candidates by that priority, then by the old nearest-first rule, and
publishes attackerRole + per-candidate targetRole. A roleless hull scores 0 everywhere, so a fleet
without roles behaves exactly as before.

coopWarDoctrine.roleForHullType maps hull typeID -> role from the doctrines themselves.
LIVE: 14359 tackle, 45462 anti-tackle, 15320 brawler, 15972 logistics, 12394 ewar, 25127
anti-tackle. Event 08:40:55Z carries attackerRole tackle with a tackle target.

## Still honest gaps
EWAR (sensor dampener / tracking disruptor) and logistics (remote reps) are fitted but have no
engine effect - they are non-weapon modules, so the ship carries them and never uses them. Role
behaviour today = who is aimed at, not what the module does. Next: either native effect support or
a posture rule (logistics keeps range, EWAR stays behind the line).
