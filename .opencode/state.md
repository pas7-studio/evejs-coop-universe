# State — co-op loop (mining → haul → station → sale)

## 2026-10-31 15:20Z - importing inputs exists; it still needs a SHOPPING trip to fire

- `EVEJS_COOP_INPUT_RUNS=1` reserve computed live: Pyerite 481, Mexallon 119 (Miner I only - the
  demand filter keeps ammunition nobody bids for out of the reserve).
- New `SUPPLY` phase in the distribution run: a hull whose hold is empty at the buyer's station
  imports the factory's shortfall through the native trader (bounded to 40 beats, one event per
  intent `living-npc-input-bought`, payroll funds the pilot on INSUFFICIENT_EARNED_ISK).
- Market limits raised for this stack only: 20 units per purchase, 30 s cooldown (module floor),
  so a 481-unit Pyerite import takes ~25 small honest trades.

**Why it has not fired yet:** the import is reached only AFTER a sale at a station that sells the
inputs, and there is nothing profitable to sell there - Tritanium has no bid in Jita (measured:
3.9 M units, best bid 12 jumps away at 2.72). The next change is a SHOPPING TRIP: when the
factory is short and no cargo trip pays, the run should fly empty to the station that sells the
input, buy it, and come home. That is the last missing leg of the loop.

## 2026-10-31 15:10Z - the factory and the merchant no longer fight over the same minerals

Measured, then fixed: the lift shipped EVERY type the destination bids for, so the refiner's
Pyerite and Mexallon were sold the moment they appeared while the manufacturer kept answering
`MATERIALS_MISSING 34:1324/3892702 35:481/0 36:119/0`. The hangar held 3.8 M Tritanium and
nothing the two buildable-for-demand blueprints needed.

- `coopNpcInputSupply.planSupply` names the exact shortfall from the blueprints that really sit
  at a station, their real recipes and the real hangar (union across recipes, biggest hole
  first, bounded per trip); `heldAt` reads hangar rows honestly (a singleton counts as one).
- The reserve is DEMAND-AWARE: only a blueprint whose product has a seeded bid in
  30000142/30000144/30000145 reserves material. Live: Pyerite 962, Mexallon 238, Trit 2 650 -
  without that filter the ammunition nobody bids for would have locked 12 562 Pyerite.
- `planLift` and `planTrip` subtract the reserve, so the factory's stock is never freight.

**What is still missing for the loop to close:** the refinery only sees Veldspar in this window
(`living-npc-refined 17471 -> 1 mineral`, i.e. Tritanium only), so Pyerite arrives rarely; the
demand-backed Miner I needs 481 Pyerite + 119 Mexallon per run. Next: buy inputs at the station
that really sells them (Jita asks 16.03 / 48.61) and carry them home - payroll is already in
place, so such a purchase can settle from the corporation's own wallet.

## 2026-10-31 14:40Z - the economy can now BUY, STORE and ADOPT (and still cannot get materials)

Proven live on evejs-agents:
- **Blueprint purchase is complete**: `living-npc-blueprint-bought` type 785 (Miner I Blueprint)
  TRADE_SETTLED 92 720 ISK at 60000682 - the checkpoint goal is met.
- **A hold is not a warehouse** (`coopNpcCargoStow`): a bought blueprint now moves from the
  hauler hold into the corporation hangar, journaled once. Live: cargo 980200084340 COMPLETED,
  hangar shows 785@60000682.
- **Purchased blueprints are adopted** (`adoptHeldBlueprints`): the manufacturer used to read
  only manual seeding receipts, so anything BOUGHT could never be built. Live receipt
  `seed_1000129_60000682_785.json`; the manufacturer now plans Miner I (483) for Jita
  (BUYER_ELSEWHERE, 182 units @ 6 028).
- **Payroll** (`coopPilotPayroll`): the market settles a buy from the PILOT's earned balance and
  the treasury sweep leaves every pilot at 0 while the corporation wallet holds 1.45 B ISK. The
  corporation now pays its own pilot from its real wallet (native debit + earned credit, one
  eventID = one salary). Wired into the purchase path on INSUFFICIENT_EARNED_ISK.

**The one remaining blocker to production**: Miner I needs 1 324 Trit + **481 Pyerite + 119
Mexallon** per run and the hangar holds 0 of both (Jita sells asks at 16.03 and 48.61).
Next change: buy input materials at the station that really sells them, carry them home and
stow them - then the loop mine → refine → build → sell closes on its own.

## 2026-10-31 13:35Z (UTC) - the blueprint purchase names its refusals one by one, and each is fixed

The decision is proven: with demand read across reachable systems the chooser answers **BUY**
for the **Caldari Shuttle Blueprint (type 967) at 42 500 ISK, 1 227 runs buildable at station
60000682** - replaying the exact inputs of the live authority reproduces it.

Each live attempt then refused in turn, and every refusal was a real defect, now fixed:
  1. BUY_THREW 'registry is not defined' - the helper used the wrong variable name for the
     identity registry (it is `identityRegistry` in that file);
  2. INSUFFICIENT_EARNED_ISK - the market funds a purchase from the PILOT's earned balance, not
     the corporation treasury, so the hull now takes a pilot that has actually earned the price
     (same link mechanism as the sale);
  3. TOO_FAR_FROM_STATION - the trader only trades through a hull that is at the station, so the
     idle path flies there first and buys on the beat that arrives.

What is left is TIMING, not logic: an attempt needs a hull at the stock station while either no
trip is worth taking or it is loading there. Three hulls are cycling (HOME_AGAIN) and the buy
fires from the loading stop; watch for the first LOADED_STOP at 60000682 and then
living-npc-blueprint-bought.

Open from before: 980000000002 is blocked UNRESOLVED_MARKET_JOURNAL (market row proves NOT
filled, so the world correctly refuses to credit it).

## 2026-10-31 10:20Z (UTC) - the blueprint purchase decides correctly and then throws

MEASURED this round:
  - the corporation holds 3 231 796 Tritanium at 60000682 and Jita bids **0** for it - the raw
    mineral trade is over, which is exactly why production must grow;
  - station 60000682 offers **38 blueprints** (60014935 offers 189, Jita 60003760 the rest);
  - with demand read ACROSS reachable systems the chooser answers **BUY: Caldari Shuttle
    Blueprint (type 967) at 42 500 ISK, 1 227 runs possible at that very station** - the
    decision layer works end to end, verified by replaying its inputs;
  - the live call then fails: living-distribution-blueprint BUY_THREW with an EMPTY reason and
    stack. Instrumentation for both catch sites is deployed (loop + runtime helper), but no new
    attempt has happened since (the runs rest in DONE and the purchase only fires from the
    planning/idle path when the journal is replanned).

Fixed and kept:
  - demand for the purchase is read where the PRODUCT sells (system + one gate), not where the
    blueprint is bought - that alone turned NO_BLUEPRINT_WORTH_BUYING into BUY;
  - the chooser prefers blueprints whose recipe can be run at that station (runsAtStation);
  - the purchase runs at the loading stop AND when no trip is worth taking, at the station that
    holds the most corporation stock.

NEXT (precise): force one purchase attempt against the instrumented build and read the stack;
the empty message means a non-Error throw inside the trader path (most likely the market
trader refusing a hull that is not physically at the station scene it was handed).

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

## FW-118 / FW-119 (fork 140f5d9, 58e0e55): roles fly their own ranges, veterans lead
- FW-118 posture: one shared 500 m orbit became per-role engagement ranges - tackle 2.5 km,
  anti-tackle 6, brawler 5, heavy 12, EWAR 45, sniper 60, logistics 70 km, each with a matching
  leash. An unknown role keeps the operator posture exactly (5/5 tests). LIVE 09:14/09:17Z:
  living-native-war-engagement-posture applied role=tackle orbitDistanceMeters=2500.
- FW-119 commander: the garrison always took the FIRST free identity, so a merit-0 pilot led a
  whole side while 150-merit veterans stood idle. It now picks the highest earned merit. LIVE
  09:24Z: pilot-080 merit 150, pilot-018 merit 140, pilot-013 merit 75 each spawned a formation.

LIVE PROOF of the whole role stack (09:24Z, commander merit 150, five hulls):
14359 Condor = tackle | 45462 CA Destroyer = anti-tackle | 15320 Moa = brawler |
15972 Delta II = logistics | 12394 Blackbird = ewar.

Campaign states 09:17Z: 29 EXPIRED, 3 OCCUPIED, 1 ASSAULT (30045341) - captures keep happening.

## FW-120 (fork 4ab17f2): the roster knows the anti-tackle role - formations are recorded again
Right after FW-116 the garrison reported fleetID "" and the roster held ZERO fleets while five real
hulls with five roles stood in space. The new anti-tackle role was missing from the roster ROLES
set, so createFleet answered FLEET_DOCTRINE_REQUIRED and the whole formation was discarded - only
the commander ever reached the fleet registry, which is why 16 registered hulls were all tackle.

LIVE after the fix (12:53-12:54Z): garrison applied rows carry real fleet ids
(coop-fleet-500001-0198, coop-fleet-500004-0199) and the roster holds 199 fleets; the newest is
ACTIVE with 3 ships: tackle + anti-tackle + ewar. Campaigns at 12:5xZ: 38 EXPIRED, 4 OCCUPIED,
2 ASSAULT live.

## FW-121 (fork 4d44722): nearest real market by gate hops + measured money wall
MEASURED 2026-10-31: 1 576 native cargo rows across 19 types sit in NPC holds and NOT ONE of those
types has a seeded buyer in any of the six war or mining systems (30000144, 30000145, 30003837,
30045338, 30045342, 30045339). Money therefore REQUIRES travel; there is no in-system sale to
unlock.

New pure planner coopDistributionPlan.nearestBuyerForTypes: BFS over the real gate graph, one
seeded-book query per ring, returns {systemID, stationID, hops, volume, price} or NO_BUYER. Hop
budget honoured, unreadable book refused, ties broken by station id (6/6 tests). Also fixed the
sibling require suffix (.js deployed / .cjs mirror) that had kept the mirror unloadable.

## The money project (next, in order)
1. A hull that can CROSS a gate and carries cargo. Today every hauler is a mining-fleet hull and
   coopNpcGateCrossing refuses operatorKind coop-mining-* by design (HULL_ROLE_CONFLICT:MINING_FLEET).
   Either adopt such a hull into the distribution run for the trip (and release it back), or let the
   war looters travel. This is the single unlock.
2. Then: buyerForCargo -> nearestBuyerForTypes, planCrossingTo -> shortestGateRoute next hop,
   distribution run CROSS_AGAIN on intermediate arrivals (design already written).
3. Then bounties can be funded: FW-109 reserves per kill from the faction wallet, and the chest levy
   (coopWarChestFunding.fund) still has no phase that calls it.

## SKIN store purchase - PROVEN LIVE 2026-10-31 (server side)
- Root cause of "nothing to buy"/unbuyable SKINs: each seeded offer carried only
  fulfillment.licenseTypeID; storeFulfillment refuses that with INVALID_SKIN_LICENSE (it calls
  shipCosmeticsState.giveSkin(characterID, skinID, {licenseTypeID})). Script fix + repair pass:
  scripts/coop-seed-skin-offers.js, dry-run repaired=1387 of 1402 offers, --apply WRITTEN 1402.
- Live proof on a test pilot (not the owner): PLEX set 10 -> purchaseLegacyOffer(store 4, offer 9300000)
  = success, spent 10, balance 0, fulfilment skin_license skinID 1658 / licenceType 36326;
  shipCosmeticsMgr.GetLicencedSkins returned that licence to the client shape; expireSkin removed it,
  PLEX left at 0. No owner wallet was touched.
- Still needs the owner's click to confirm the store window itself (offers render + Buy button).

## SKIN apply - verified server side 2026-10-31 (no code change needed)
- Bought skin_34668 (Charon Wiyrkomi, 10 PLX) for the courier test pilot and applied it to their real
  Charon 9988400102932: applySkinToShip -> ok, getAppliedSkinRecord = {skinID 91, typeID 20185}.
- Refusal path proven first: applying a Bestower skin to a Charon was refused SKIN_NOT_VALID_FOR_TYPE.
- Cleanup: skin cleared from the ship, both test licences expired, PLEX back to 0.
- Other clients get an applied skin through the gRPC cosmetic.ship.api.GetAllInBubble (answered from the
  live scene, fork ff09ec8); nothing on the slim item carries it, so that gateway is the only path.

## Client surfaces re-checked 2026-10-31 (no code change needed)
- crateService.ClaimFitting/ClaimLoot/ClaimSkillBundle: implemented (they answer null on the happy path,
  which is why the register calls them stubs); OpenCrate/ClaimLootFromCrateStack move real items.
- overviewPresetMgr.StoreLinkAndGetID/GetStoredPreset: implemented (drag-a-link preset sharing).
- Industry window: blueprintManager.GetBlueprintDataByOwner answers an empty list because the character
  owns no blueprints; industryManager.GetJobsByOwner empty; GetLimits maxBlueprintResults=500. The window
  is functional - it has no content. Factory/industry therefore needs CONTENT (BPO items, materials,
  facility), not more client code.

## Industry monitor ownership - fixed and proven live 2026-10-31 (fork 5955015)
- Defect: `IndustryMonitor.DisconnectJob` deleted whatever id it was given. The handler never took
  the session, the persisted row carried no owner, a missing id answered success, and the row was
  rewritten on every refresh.
- Fix: row stores characterID; only the owner may detach (MONITOR_NOT_OWNED), a vanished id answers
  MONITOR_NOT_FOUND, connecting the same (character, activity, blueprint) reuses the row, and
  un-attributable legacy rows are dropped on load. Pure rules in industryMonitorOwnership.js.
- Live on evejs-agents (image e9346869): connect x2 -> id 1, reused=true, same id; second character
  -> id 2; cross-character detach -> false MONITOR_NOT_OWNED; id 999999 -> false MONITOR_NOT_FOUND;
  owner detach -> true; repeat -> false MONITOR_NOT_FOUND.
- Test: node --test tests/coop-industry-monitor-ownership.test.mjs -> pass 6 fail 0.
- docs/CLIENT_GAPS.md refreshed: petitioner.*, structureDeployment.*, charUnboundMgr cancel and the
  crate/overview claims were stale "unfinished" entries; they are implemented.

## FW-123d/e (2026-10-31): faction war chests are funded
- Fork 26d7c01: an INCOME command (CAPITAL_GRANT/TAX_INCOME) has no reservation, so
  `purpose` was null and the wallet verify read purpose.factionID inside an empty catch.
  Every grant reported NATIVE_CORPORATION_WALLET_UNVERIFIED with the wallet row present.
- Live play stack, journaled through coopWarTreasury, idempotent (capital:<faction>:v1):
  500001/1000035 -> 5 000 000 ISK, 500004/1000120 -> 5 000 000, 500011/1000436 -> 5 000 000,
  500014/1000129 -> 5 000 000, 500019/1000162 -> 5 000 000, 500020/1000135 -> 5 000 000.
  (wallet cents before -> after: 0->500000000, 300000->500300000, 0->500000000,
  43275->500043275, 0->500000000, 0->500000000).
- First verified war wreck of the session: 13:50:10Z, 30045338,
  campaign war:500001-500004:campaign:30045338:r2, PHYSICAL_NATIVE_WRECK_VERIFIED.
- Open: bounty.pay is not invoked for that casualty (no bounty event), so the money still
  has no payer. 500011 Angel doctrine fails NPC_NATIVE_HARDWARE_POLICY_VIOLATION.

## Industry content - PROVEN on evejs-agents 2026-10-31 (fork 74bbd64)
- Root problem was reachability, not data: `/bpauto seed|quote|build|deliver` needs a docked session and no
  QA client can dock. New bridge action `blueprint_auto` builds the session fields the command reads and
  runs the SAME `/bpauto` through the chat dispatch (nothing seeded or installed outside the runtime).
- Measured on characters 140000004 at station 60003760: `seed frigate 1 original` -> BPO Rifter
  itemID 9988400017127 + materials; `build frigate 1 ready` -> job 970000000000000, cost 20,480 ISK;
  `deliver ready` -> Rifter hull itemID 9988400017255 in hangar 60003760, materials consumed, wallet paid.
- Materials/recipe/product come from the local SDE (`/var/lib/evejs/sde/.../blueprints.jsonl`), 5005 BPO
  types available; 169 manufacturing facilities exist in The Forge (region 10000002).
- On the play stack the same thing needs only a DOCKED character: `/bpauto seed frigate 1 original`, then
  the Industry window install (no server change, the chat command is stock).

## SKIN component listings - the recorded blocker was wrong 2026-10-31
- `readStaticTable("itemTypes").types` already holds 52,590 types INCLUDING the 924 SKIN design components
  (group 4726, category 2118; e.g. typeID 82340 "Division - Limited"). So no typeID extraction is needed.
- The real gap: `eve_public.cosmetic.market.component.listing.api.GetAll` / `InitiatePurchase` are simply
  unanswered (not in the compat empty-success list). Implementing them needs a listing stock model
  (seed real component types + ISK price + bundle size, like the SKIN offers) and a purchase path that
  debits ISK and either grants the component item or an infinite licence via coopComponentLicences.

## SKIN component market - PROVEN on evejs-agents 2026-10-31 (fork 38bea4d, 3873cf9)
- The gap was never the typeIDs (924 component types are already in the item-type table). It was that
  `cosmetic.market.component.listing.api.GetAll` / `InitiatePurchaseListing` were unanswered.
- New store `space/coopComponentListings.js`: durable listings of real component types, each with its
  own stock and price; purchase reserves stock, debits the real wallet, grants the real item to the
  buyer's station hangar, and refunds + restores stock if delivery fails. Env-gated
  `EVEJS_COOP_COMPONENT_MARKET=1`, seeds once from real types only.
- New gateway `componentListingGatewayService.js` with CCP's proto shape; registered in the gateway index.
- Live: GetAll -> 200, 120 listings (comp:82340 type 82340 @ 250 000 ISK); purchase -> 200,
  transaction `comp:82340:...`, wallet 999 979 520 -> 999 729 520 (-250 000), component item
  9988400017511 in hangar 60003760; no character -> gRPC 7, unknown listing -> gRPC 5.
- Price honesty: this item-type table reports 0 as the component base price, so the world prices a
  design element at 250 000 ISK itself - stated as a world price, never claimed as CCP's.
- `immediately_activate` always answers false: activating a component needs a licence mapping this world
  does not have, so a purchase is "buy the item", never a pretend licence.
- Tests: tests/coop-component-market.test.mjs -> pass 7 fail 0.
- NEEDS_OWNER_RESTART_WINDOW: the play stack runs an older image, so it needs a rebuild + restart (and
  `EVEJS_COOP_COMPONENT_MARKET=1` in compose.yaml) before the owner can see the component window.

## FW-125..128 (2026-10-31, owner: "war must pay and never stop")
- FW-125 (c4b8a3a): the payout authority demanded an INTEGER pilot id, so every real kill was
  refused WAR_TREASURY_PAYOUT_NOT_AUTHORIZED while its escrow sat HELD. Named co-op pilots
  (coop-pilot-060) are now accepted; a pilot whose link was released with its wreck resolves
  its faction from the same war fleet registry row. FW-125b (d408909) keeps numeric ids valid.
- FW-126 (cba4764): every pirate hardware family listed its tackle modules only under
  utilityTypeIDs, so tackle resolved to "tackle" and failed the policy - the 500011 Angel
  garrison answered NO_SHIP_SPAWNED with loadout null. Angel + Serpentis now allow the real
  SDE modules the doctrine fits (448/527/3244, 2109, 11357, 2048, real turrets).
- FW-127 (94e8792) + FW-128 (05bef6d): a border's whole expiry history counted forever, so the
  multiplier reached 8x45 min = 6 h and the live war answered NO_OPENABLE_FRONT with 5 of 8
  borders closed (13:59Z, 14:14Z). Only recent expiries count, a border retries within 15 min
  and never waits more than 30. After the deploy all 8 borders read TARGET_ALREADY_CONTESTED:
  the cooldown no longer blocks anything.
- Money is real and journaled: wallets after the 5 000 000 ISK grants and the first war escrows
  - 1000035 Caldari Navy 4 999 000 (1 000 paid as a bounty escrow)
  - 1000120 Federation Navy 5 002 000 (1 000 paid as a bounty escrow)
  - 1000129 ORE 2 130 311.68, 1000436/1000162/1000135 5 000 000 each
  Two HELD bounty rows (1 000 ISK each) belong to the 13:52Z kill and will pay on the next kill
  of that campaign.
- Measured war state: 7 wars, 46 campaigns [40 EXPIRED, 4 OCCUPIED, 2 ASSAULT], 17 territories.
  Both live assaults are in 30045338 and 30045342; every other border is one of those two
  systems seen from a different edge, so the frontier is two systems until one resolves.

## Extraction gate state 2026-10-31 (honest, red)
- `node scripts/coop-engine-audit.cjs` -> AUDIT_REGRESSION: `integration drift 7 > 0` and
  `server/src/space/coopVirtualWorldRuntime.js 5671L (ceiling 4800)`.
- Drifted copies: coopCourierFlightDriver, coopCourierGateHop, coopCourierRuntime, coopMarketCatalog,
  coopVirtualWorldRuntime, coopWarAdvantage (+1). These are OTHER sessions' fork work (FW-125..128, courier,
  market catalog) not yet archived; I refreshed only the two files I changed
  (coopAdminBridge.cjs, coopAdminBridgeActions.cjs) - tests for them stay 14/14 green.
- Next real task: refresh those 6-7 copies and split coopVirtualWorldRuntime (coop-split-module.cjs) so the
  gate prints AUDIT_OK again. Not caused by today's market/industry work.

## FW-129 (2026-10-31 14:44Z): a front is a squadron, not a duel
- Fork 3e06b08: every fresh side mustered at merit 0 (composition reads that as a recruit's
  SINGLE frigate) and the battle director issued at most 2 attack orders per tick with a
  2-minute re-order. A side now starts at the wingman tier (merit 70, 3 hulls; earned rank still
  raises it), the mobiliser obeys the same floor, and the director arms 3 hulls per tick and
  re-orders every 45 s.
- MEASURED after deploy: garrisons spawn size 3, cap 3, roles tackle+anti-tackle+ewar in
  30045338 / 30045342 / 30000138 / 30000139 (was one lone tackle frigate).
- FW-126 confirmed live: 500011 Angel spawned in 30000142 (size 1, cap 3, roles ewar) - the
  pirate family can finally field hardware.
- FW-128 confirmed live: campaigns went 46 -> 52 with 6 PREPARING fronts opened after the
  border cooldown stopped blocking (was 0 PREPARING at 14:25Z).
- Real war casualties RECORDED at 14:27:04Z (30045338) and 14:35:27Z (30045342).
- Still open: those two casualties carry NO attacker proof (NATIVE_VICTIM_WRECK_ONLY_NO_KILLER),
  so no bounty is paid for them; the engine supplied NATIVE_DESTRUCTION_ATTACKER_PROVIDED only
  once in the last hour and that kill was in 30000144, not a war system. Bounty payment needs an
  explicit native attacker, which is now the single remaining gap between a fought war and a
  paid one.
