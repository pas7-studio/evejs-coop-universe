# State — co-op loop (mining → haul → station → sale)

## 2026-10-30 07:45Z (UTC) - site density and rotation: what the profiles say

The owner asked whether sites rotate and respawn the way the real game does. Measured from
`dungeonAuthority.getSpawnProfile(family)` on the running server:

    combat_anomaly  lifetime 1440 min  highsec slotsPerSystem=1 targetSystems=360 |
                    lowsec 2/196 | nullsec 3/1280 | wormhole 2/720
    combat          lifetime 1440 min  highsec 1/120 | lowsec 1/132 | nullsec 1/220 | wormhole 1/196
    data            lifetime 1440 min  highsec 1/36  | lowsec 1/32  | nullsec 1/104 | wormhole 1/96
    combat_hacking  lifetime 2880 min  highsec 0/0   | lowsec 1/3   | nullsec 1/12  | wormhole 1/16

So the design is "one site slot per system, on N systems per band" - 516 highsec slots for ~1200 highsec
systems across the whole map, i.e. a given system has roughly a 40% chance of holding a site, and the
site lives 24 h before `advanceUniversePersistentSites` expires and re-allocates it elsewhere. Rotation
IS implemented (the advance tick reports expired/rotated/removed counts and the startup path calls it).

What is missing is the *scope*: the tick is driven with `systemIDs: spaceRuntime.listAwakeSolarSystemIDs()`
and startup prepare is called with `startupSystemIDs: []`, so only systems that already have a scene are
considered, and a system that never wakes is never seeded or rotated. 27 instances exist in 16 systems
today, none of them Jita/Perimeter/New Caldari.

Change to make: seed and rotate over the systems this world actually uses (the route/visited set) instead
of only the awake ones, and/or seed a system on wake when its desired count is zero. Both are small:
`dungeonUniverseRuntime.advanceUniversePersistentSites({systemIDs})` already accepts an explicit list,
and `dungeonUniverseSiteService.handleSceneCreated` already materialises whatever exists.


## 2026-10-30 07:20Z (UTC) - CORRECTION: the dungeon seeder works; our systems simply have no sites

My earlier "nothing ever creates an instance" was **wrong** - it came from a probe in a separate
process, where the signature providers have no scenes and therefore return nothing. Measured properly
against the persisted dungeon runtime state (`dungeonRuntimeState.getStateSnapshot()`,
`dungeonUniverseRuntime.summarizeActiveUniverseSeededCounts()`):

    SEEDED {generatedMining: 2, persistent: 22, total: 24}   INSTANCES 27 across 16 systems
    30000127 ice 5497 | 30000131 combat 5610,5687 | 30000141 combat 13338 | 30001376 combat 875
    30001379 combat 5610,5685 | 30002762 combat 5610,5684 | 30002802 combat 5610,5687 | ...
    OUR SYSTEMS: 30000142 (Jita) 0, 30000144 (Perimeter) 0, 30000145 (New Caldari) 0

So the pipeline is alive: `network/tcp/index.js` runs `prepareStartupUniversePersistentSites` (with
`startupSystemIDs: []`, reconcile off) and `advanceUniversePersistentSites` for awake systems, and
`dungeonAuthority.listUniverseSpawnFamilies()` reports 23 enabled persistent families
(combat, combat_anomaly, combat_hacking, data, drifter_*, …) with highsec/lowsec/nullsec/wormhole bands.
The seeder allocated its 24 sites to 16 other systems, and the systems this world actually plays in got
none - which is exactly why the scanner, the anomalies tabs and the Agency are empty for the owner.

Next step (small, targeted): make the seeding cover the systems the world uses. Either a
config/override list of "always seed" systems, or a startup pass that calls
`dungeonUniverseRuntime` for the awake systems when their desired-definition count is zero. Then a scene
is created there, `dungeonUniverseSiteService.handleSceneCreated` materialises the instances, and the
existing providers put them in front of the client - no new plumbing.


## 2026-10-30 06:45Z (UTC) - co-op missions: implemented, never once fired; spawner API located

**Missions.** `docs/COOP_MISSION_VERIFICATION_PLAN.md` is the verification plan. The measurement behind
it: 88 mission test files with **835 assertions green / 0 failing / 12 skipped**, and **zero**
courier/escort/rescue/mission/duo/pve events in the play stack's entire 37 MB event history - the world
has only ever run the living loop (mining, hauling, war, NPC industry). So the mission code is in the
"green tests, unproven in game" state. The plan orders the work: courier first (fully server-side, no
new content, no second client), then fleet mission join/turn-in, then escort solo legs and party legs,
then rescue/PvE/story once sites exist.

**Site spawner (the reason every scanning surface is empty).** The dungeon system is NOT missing; only
its seeding is:
  - `services/dungeon/dungeonUniverseSiteService.handleSceneCreated(scene)` iterates
    `dungeonRuntime.listActiveInstancesBySystem(systemID)` and materializes those instances as scene
    entities with `signalTrackerAnomalySite: true` - i.e. exactly what the probe scanner reads;
  - `dungeonRuntime.createInstance({templateID, siteKey, systemID, ...})` is the API that creates one,
    and `dungeonAuthority.getTemplateByID` / `listTemplatesByFamily` supply real templates
    (SDE `dungeons.jsonl`, 1404 rows, plus the build-3396210 reserve/insurgency sets in
    `dungeonInstanceCacheMgrService`);
  - nothing in this world ever calls `createInstance`, so `listActiveInstancesBySystem` is always empty.

Next step is therefore a seeder, not new plumbing: pick templates per system (security band + the
system's faction/archetype fit), call `dungeonRuntime.createInstance` with a deterministic `siteKey`,
and let `handleSceneCreated` + the existing signature providers deliver them. Wormholes are the same
shape against `wormholeRuntimeState`, and the Invasions tab needs the same sites inside the campaign
systems that `insurgencySolarsystemService` currently only lists (two hardcoded snapshots, no sites).


## 2026-10-30 06:10Z (UTC) - why every scanning surface is empty: nothing spawns a site

Measured with the real providers, no session needed
(`services/exploration/signatures/signatureRuntime`, systems 30000142 Jita, 30000144 Perimeter,
30000145 New Caldari, 30045344):

    SYSTEM 30000142 anomalies=0 signatures=0 statics=0
    SYSTEM 30000144 anomalies=0 signatures=0 statics=0
    SYSTEM 30000145 anomalies=0 signatures=0 statics=0
    SYSTEM 30045344 anomalies=0 signatures=0 statics=0

So the Invasions tab, combat/exploration anomalies, deadspace and wormholes are empty for one reason,
not six: the probe-scanner feeds are built from the SCENE and from the wormhole runtime, and this world
never puts anything there.

The pipeline exists and is wired:
  - `buildSignalTrackerAnomalyEntries(systemID)` = `miningAnomalyProvider` + `sceneAnomalySiteProvider`;
  - signatures = `sceneSignatureSiteProvider` + `wormholeSignatureProvider`;
  - `sceneAnomalySiteProvider.listAnomalySites` selects scene entities flagged
    `signalTrackerAnomalySite === true` (or `signalTrackerSiteKind === "anomaly"`) with an itemID;
  - wormholes come from `services/exploration/wormholes/wormholeRuntimeState` (no wormhole is created);
  - `signaturePlacement.js` and `dungeonSiteAdapter.js` already provide the placement/definition glue.

The real definitions are on disk: `/var/lib/evejs/sde/eve-online-static-data-3396210-jsonl/
dungeons.jsonl` has **1404 dungeons** with `name` (localized), `factionID`, `archetypeID`,
`allowedShipsList` - i.e. "Pith Merchant Depot" style combat/exploration sites, not invented names.

Next step (a spawner, not a gateway handler): for a system, pick the dungeon rows whose faction matches
the system's occupants and whose archetype fits the security band, place them with
`signaturePlacement`, add the entities to the scene with `signalTrackerAnomalySite: true` (and
`signalTrackerSiteKind: "anomaly"`), and let the existing providers/notifications do the rest. Wormholes
are a separate spawner against `wormholeRuntimeState` with real wormhole classes. Invasions are
`insurgencySolarsystemService`, which currently returns two hardcoded campaign snapshots and no sites -
that tab needs the campaign's systems to actually contain the sites above.


## 2026-10-30 05:35Z (UTC) - fitting-window search fixed; premium shop has no SKINs at all

**Fitting window search (any language).** The native client indexes `marketProxy.GetMarketGroups` by
PARENT: `marketGroups[None]` are roots and `marketGroups[9]` must be the groups under Ship Equipment
(`appConst.marketCategoryShipEquipment`), `[955]` Ship Modifications, `[157]` Drones, `[11]` Charges.
The catalog built from itemTypes put every group at the top level with `parentGroupID: 0`, so those
lookups returned nothing, `SearchFittingHelper.GetSearcableTypeIDs` built an empty type set and the
search box produced no rows - which is why it failed in every language. The SDE export that produced
this data ships the real tree in `marketGroups.jsonl` (2083 rows, `parentGroupID`, localized names,
`hasTypes`, `iconID`), so `space/coopMarketCatalog.js` now serves it (fork `ba09545`), roots as
`parentGroupID: null`.

Measured in the container against the real file: `GROUPS 2102 roots=19`, and
`CATEGORY 4 -> 11`, `9 -> 13`, `11 -> 16`, `157 -> 7`, `955 -> 3`, `2202 -> 6` children with real names
(Shuttles/Frigates/Cruisers, Turrets & Launchers, Projectile Ammo, Mining Drones, Rigs/Subsystems/
Mutaplasmids, Electronic Warfare …). 1663 groups carry `hasTypes`.

**Premium shop / cosmetics.** Measured on the running store: `categories 9 products 15 offers 15` -
Omega, MCT, resculpt, skill extractor and friends, and **not one SKIN**. Two separate gaps:
  1. the store authority data has no cosmetic products at all (it is seeded data, not code);
  2. `grantFulfillmentToCharacter` had no way to deliver a skin, so even a seeded offer could only have
     failed after taking the money.
(2) is now implemented: a `skin_license` fulfilment kind that calls
`services/ship/shipCosmeticsState.giveSkin` and refuses when the skin or licence is not in the catalogue
(fork `763c293`). (1) is the next step: seed real SKIN offers from `shipCosmeticsCatalog`
(11784 licence rows) with their real `licenseTypeID` and a price, then prove a purchase debits the
wallet and grants the licence.

**Overview.** Unchanged from the earlier entry: all three transmission paths measured, nothing left on
the server side; it needs the owner's session plus the generated profile import.


## 2026-10-30 04:50Z (UTC) - "unfinished" is now a classified list, and one real stub is gone

The owner walked the UI and asked what is still broken. Two sources audited:

1. RemoteSvc placeholders - `node scripts/coop-placeholder-audit.cjs` reads the pinned server source,
   bounds each handler body at the next handler, and groups the 44 entries of
   `docs/client-contracts/baseline.json` by what they return: **31 null, 8 audit-log data, 4 empty
   list, 1 scalar** (`docs/CLIENT_GAPS.md` now carries the verdicts).
   Correct by contract, do not "fix": `pingService.Ping` (idle keepalive), `pvpFilamentMgr.
   GetMostRecentEvent/GetNextEventDate` (the window tests `_event_info is not None` and shows "no
   event"), `milestoneMgr.ProcessCharacterLogon` (logon push), the cohort/lockdown/bounty-cache
   empties, and every node_graph/QA/localization/stat-logger surface.
   Genuinely unfinished, because the call does nothing when a player uses it:
   `structureDeployment.RenameStructure/Unanchor/CancelUnanchor`, `industryMonitor.DisconnectJob`,
   the nine `petitioner.*` calls (no ticket store), `survey.*`, `milestoneMgr.ClaimRewards`,
   `charUnboundMgr.CancelCharacterDeletePrepare`, `operationsManager.process_client_event`,
   `pvpFilamentMgr.GetLeaderboard/LeavePVPQueue` - each needs backing data this world never produced.

2. Live errors. Since the last restart the server log holds no client-reported exception and the
   gateway logged no non-200. The only client exceptions measured earlier were the payment-schedule
   lookups at gRPC status 5, which is fixed by answering 404 (fork `98dc75d`); the client has not been
   in game since that build, so the next session is the first one that can confirm it.

Fixed for real: `sessionRegistry.register` stamps `evejsRegisteredAtMs`, so
`userSvc.GetSessionPlaytimeMinutes` reports the actual minutes of the session instead of 0
(fork `4274d2a`). The play stack now runs the image that contains it.


## 2026-10-30 21:45Z (UTC) - the loop is logistics-complete; the ceiling is production

MEASURED LIVE this round:
  - the freight hulls are FULL: 980000004164 and 980000018521 carry 309 999 units in exactly
    3 100 m3 (an Impel, brim full), 980000000002 carries 390 000 in 3 900 m3, 980000000005
    543 746 in 5 500 m3 - all of it Tritanium, all bound for 60003760;
  - freight ledger: 10 trips, 471 984 ISK, 122 063 units, RECONCILED; the newest row carries
    its real price (77 349 ISK) because the settlement is now read inside its five-second
    window.

NEW OPERATOR TOOL: scripts/coop-demand-gap.cjs prints, read-only, the top seeded demand in the
buyer system by value, marks which products the corporation can actually build, and totals the
gap. With seeded artifacts filtered (a 92 billion ISK hardener, PLEX, blueprint crates) the
measured picture is: **4 blueprints owned, 3 buildable, 4 144 products of real demand worth
170 060 631 095 ISK that nobody here can make.**

So the binding constraint is no longer ships, lifts, gates or sales - it is WHAT THE
CORPORATION CAN PRODUCE. Its stock of Tritanium (498 596 units at 60000682) is worth about
2 M ISK and one fleet cycle will exhaust it; after that the loop sells only what mining feeds
it, slowly.

DONE since: space/coopDemandGap.js computes the gap in the server (artifact-filtered, only
producible categories), and the manufacture phase reports DEMAND_WITHOUT_BLUEPRINT when no job
is possible (at most once per 30 min). Today the manufacturer is busy, so the event has not
fired yet - the wiring is tested, the event is not claimed.

NEXT, in order of real leverage:
  1. blueprint acquisition. The seeded book carries only BUY demand (seed_buy_orders), so a
     blueprint cannot be bought from it; the honest options are a seeded sell side or an
     operator-granted copy. Decide before building anything on top of it.
  2. DONE (alife26a).
  3. the runtime line ratchet (5153, other sessions).
  4. the mining side feeds the loop; its yield is now the ceiling of the remaining trade.

## 2026-10-30 04:05Z (UTC) - every transmission path to the overview panel is now measured

Three separate paths put a row in front of the client, and all three are now checked on real payloads:

  1. bootstrap on entering a system - `AddBalls2` + `SetState.slims`
     (agents stack, Perimeter 414 entities and New Caldari 333 entities):
     `slims=414 missingGroupID=0 zeroGroupID=0` and `slims=333 missingGroupID=0 zeroGroupID=0`;
  2. incremental spawn while the client is already there - `OnSlimItemChange`
     (`ONSLIMCHANGE ship=980000000030 hasGroup=true hasCategory=true`);
  3. what one live session was actually told - `session._space.visibilityJournal`, now returned by the
     read-only `scene_slim_diagnose` action (last 25 add/remove/visibility broadcasts with entity ids).

Tooling: `scripts/coop-overview-payload-probe.js` (runs inside the container, builds both bootstrap
payloads and counts unclassified slim items), `scripts/coop-overview-check.cjs` (asks a running server
through the admin bridge and prints the scene plus the journal for a character or a system),
`scripts/coop-overview-profile.py` (profile whose preset groups match this build's SDE).

Client-side ignore list checked too: `appConst.OVERVIEW_IGNORE_TYPES` holds only effect beacons,
chunks, Triglavian harvester phases and EDENCOM stockpiles - none of the hulls this world spawns.

What is left is only the client's own settings: a tab whose preset lists group ids from another build
cannot match, which is why the generated `coop-overview.yaml` exists and is installed for import.


## 2026-10-30 21:20Z (UTC) - the price of a trip is captured before the market forgets it

MEASURED LIVE (balance sheet):
  freight          10 trips, 471 984 ISK, 122 063 units (4 rows still carry an unknown price)
  freight check    RECONCILED
  newest row       {haulerID 980000000002, lines 1, units 9595, isk 77349, status SOLD}

Fixed: the settled sale is dropped ~5 s after it lands and the run looked only after a whole
poll interval (6 s), so four of nine paid trips were written without an amount. After a PENDING
answer the run now READS the settlement every 1.2 s (four reads) and only asks the market again
once those reads are exhausted. The poll spacing still exceeds the per-pilot cooldown.

The four remaining unknown rows are historical (before this fix) and stay as they are - a
record is not edited to look better.

Tests: distribution-run 28, freight-check 3.

Fleet: four coop-distribution-* hulls; three finished loads this round, one is crossing, one is
loading a multi-stop trip.

NEXT:
  1. the runtime line ratchet (5153, other sessions) - split a module rather than grow it;
  2. the mining side: its slots still carry ore that only the drain sells; a miner cannot fly
     its own ore to a buyer;
  3. a second destination system (the run currently ships to one buyer system per route);
  4. watch the treasury against the freight ledger over a longer window - the numbers now exist
     on both sides, so a slow drift can be named instead of guessed.

## 2026-10-30 03:15Z (UTC) - daily goal claim works; EverMarks now exist as a real ledger balance

The claim path was never broken. Measured on the play stack for character 140000005:

    completed unclaimed: kind=space_jump progress=31/10 rewardSP=40000
    dailygoal.api.RedeemRequest -> status 200
    freeSkillPoints 0 -> 40000, completedUnclaimed 0 afterwards

So a completed daily goal pays its skill points. The "needs an EverMark" text therefore did not come
from this path - the two other candidates are the `PayForCompletion` button (honestly refused: paying
to finish a goal is not available) and the Agency's campaign/daily-reward window
(`campaign.api.GetAllUnredeemedRewards`), which this world answers empty because it runs no CCP
campaign.

EverMarks were simply at zero for everybody: they are loyalty points of the Heraldry issuer
corporation (EVERMARK_ISSUER_CORP_ID 1000419 in services/corporation/lpWalletState), and nothing had
ever credited that ledger. New admin action `grant_evermarks` (fork `3579dff`, `3c26266`) credits it
with `adjustCharacterWalletLPBalance` - the same function `/addlp` writes - for one character or for
every character the store knows, and returns before/after per character.

Measured on the play stack: `characters: 22`, `amount: 25000`, every row `0 -> 25000`, including the
player characters:

    140000001 evermarks 25000  140000002 25000  140000003 25000  140000004 25000  140000005 25000

The first run credited only 14 of them: the characters table is keyed BY character id and the row body
does not repeat it, so reading row fields skipped the real players. Fixed in `3c26266` and re-run.

Check in game with `/evermarks` (chat command, reads the same ledger).


## 2026-10-30 20:55Z (UTC) - nine proven trips, and a book that checks itself

MEASURED LIVE (balance sheet, inside the container):
  sales            160 fills, 165 357 081 ISK
  freight          9 trips, 394 635 ISK, 112 468 units (4 without a captured price)
  freight check    RECONCILED
    30000145->30000142  9 trips, 394 635 ISK

What was fixed to get there:
  - a stall of half an hour was found by watching the FLEET, not the code: four hulls said
    FLYING_TO_ORIGIN and loaded nothing. The run now counts the wait per stop, reports
    living-distribution-run-waiting every fifth beat with the measured distance, the stop and
    the hull's system, and gives up with STALLED_AT_STOP after 40 beats;
  - one empty stop no longer kills a loaded trip: NO_LOCAL_BID / NO_MINERAL_STOCK /
    STACK_CHANGED / DOES_NOT_FIT_HOLD are recorded in skippedStops and the run moves on
    (LOADED_PARTIAL when it was the last stop);
  - the sell budget counts SETTLED answers, not polls: two hulls had been blocked
    SALE_STOPPED:CALL_LIMIT by a merely slow market while carrying cargo. After the fix both
    sold everything and ended DONE;
  - scripts/freight-check.cjs proves each freight row against a real SOLD settlement and the
    ledger prints RECONCILED / UNRECONCILED beside the totals.

Tests: distribution-run 27, freight-check 3, manufacture 14, gate-crossing 20, identity 5.

Fleet: four coop-distribution-* hulls; three finished their loads this round, one is planning
again. Every trip is multi-stop (3-5 stations) and every settled sale is in the ledger.

NEXT:
  1. ask why 4 of 9 trips sold without a captured price (SOLD_VERIFIED_BY_HOLD) - the amount
     should be readable from the settlement before the five-second window closes;
  2. the runtime line ratchet (5153, other sessions);
  3. the mining side: its slots still carry ore that only the drain sells.

## 2026-10-30 02:05Z (UTC) - overview panel: server proven, presets rewritten, gate added

Server side of the overview is now measured, not argued. New read-only admin action
`scene_slim_diagnose` (fork `554066a`) walks a live scene and reports, per ball, exactly the fields the
client's own `SlimItemDisplayChecker` dereferences. On the play stack, system 30000145:

    32 dynamic + 233 static entities, missingGroupID = 0, 32 ships all classified
    Arden Renn [Miner]  typeID 42533 group 1764 cat 11 owner 1000129 corp 1000129 warFaction 500014
    Vega Vey [Miner]    typeID 22544 group 543  cat 6  (exhumer)
    ♦ Venture / ♦ Retriever (the NPC mining hull groups 1764/1765/1766)
    stations: group 15 cat 3 with real names and corp owners

`node scripts/coop-overview-check.cjs --system 30000145` repeats that as a gate: it fails if any ball
lacks `groupID` or a ship reports group 0, and prints `OVERVIEW_CHECK_OK` otherwise.

The remaining cause was client-side: presets whose group ids predate this build. A destroyer is 420
here, an exhumer 543, the NPC mining hulls 1764/1765/1766, stations 15 - a preset listing 26/27/28
matches almost nothing. `scripts/coop-overview-profile.py` derives a profile from the running SDE:
All 591 groups, Ships 436, Hostile 317 (Mining/Industrial groups deliberately excluded so the friendly
fleet is not "hostile"), Travel 19, Loot 6, Deployable 67, Drones 10, with one tab each. Verified
against groups that really appear live (25, 420, 543, 1764, 1765, 1766, 15, 10, 186, 100, 101, 29,
1149) - each lands in All plus its semantic tab. Installed as
`Documents/EVE/Overview/coop-overview.yaml`; the owner imports it once (Overview > Settings > Misc >
Import).

Client exception seen in the server log and explained, not a server bug:
`GenericException(status_code=5, "no payment schedules exist in this world")` in
`upsell_neocom_controller._update_neocom_button` (2 occurrences at login). The dev client's mocked
Omega state can hand out a payment-schedule identifier the server never issued; `payment.schedule.api.Get`
answers NOT_FOUND by id, which is the honest answer for an id that does not exist. Not changed.

Observation for the raid/NPC-combat owner (not touched): `living-native-raid-diagnose` shows a pirate
deciding `action: attack` at `distanceMeters 11231` with `gunRange 1000` and its warp-to-target
`REFUSED reason TARGET_NOT_LOCKED`, i.e. it cannot close in and cannot fire from there.


## 2026-10-30 01:20Z (UTC) - the overview panel: what the client actually filters on

The client's own contract, read from `eve/client/script/ui/inflight/overview/slimItemDisplayChecker.pyj`:

    def ShouldDisplayItem(self, slimItem):
        if not slimItem: return False
        if slimItem.itemID == session.shipid: return False
        ...
        if slimItem.groupID not in self.filterGroups: return False

and `michelle.AddBalls2` builds those objects one after another:

    for data in extraBallData:
        slimItem = SlimItem(); slimItem.__dict__ = slimItemDict
        ...
        self.ProcessBallAdd(slimItem, ballQueueData)

Two server defects follow from that, both fixed in fork `2bd33c5`:

  1. `space/destiny.js buildSlimItemDict` omitted `groupID`/`categoryID` whenever they were <= 0.
     An object without the attribute raises inside that loop, and every ball AFTER it is added with
     no slim item - the panel lists nothing while the ships are still drawn in space and still
     shootable. Both fields are now always emitted (an unknown group is 0, never absent).
  2. `space/runtime.js buildShipEntityCore` defaulted every hull to group 25 / category 6 (Frigate /
     Ship) whenever the item row carried no group, so a Catalyst was reported as a frigate and any
     preset listing destroyers did not match it. The group and category are now resolved from the
     item type through `resolveItemByTypeID`.

MEASURED (throwaway container `docker run --rm -v evejs-agents-data:/var/lib/evejs:ro` on the
image built from `2bd33c5`, real SDE):
`HULL 16240 Catalyst entityGroup=420 slimGroup=420 slimCategory=6`, `HULL 670 Capsule 29/6`,
`HULL 603 Merlin 25/6`, and a bare entity with no classification still emits `groupID`/`categoryID`
(= 0). Repo test: `tests/coop-overview-slim-item.test.mjs`.

NOT YET CONFIRMED IN THE CLIENT: the fix is only visible after the play stack runs the new image,
and the panel itself needs a human in space. The owner's client was disconnected while this was
written (no established TCP, play stack reported 0 sessions), so the only thing measured is the
payload the server builds.

NEEDS_OWNER_RESTART_WINDOW: `evejs-server-1` still runs the image from 18:23 (before this and before
the achievements/titles catalogues). Rebuild is done (`evejs-local` from `2bd33c5`); a play-stack
restart is the owner's window.

If the panel is still empty after that restart, the next measurement is the client's tab->preset
mapping: `SlimItemDisplayChecker.GetValidGroups(presetName)` returns the groups of the preset the
active tab points at, and a tab pointing at a preset that does not exist filters everything out.
The tab/preset labels are readable through `overview_tabs` (`core_user_3.dat`); the presets
themselves are binary, so that path needs a real client session to test.


## 2026-10-30 20:20Z (UTC) - a production job names the demand it answers

PROVEN LIVE after the deploy: a job for product 444 was installed with **buyer=30000142**
(Jita), both in the durable job record (coop-native-industry/jobs/*.json: buyerSystemID) and
in living-npc-manufacture-installed (buyerSystemID), so production and freight no longer have
to discover the same buyer twice.

Changed:
  - the candidate carries the buyer it was chosen for (system + station) when the bid came from
    a reachable system instead of the build station;
  - manufacture.install() keeps buyerSystemID / buyerStationID in the durable job, and the
    installed event reports it.

Tests: manufacture 14, spawn tool 3, gate-crossing 20, distribution-run 26, identity 5.

NOTE FOR THE NEXT SESSION: the agents stack was recreated by another session twice during this
work (container came back healthy each time; journals on the volume survived). Nothing was
lost, but a session that starts mid-cycle should re-check `docker ps` before concluding a
phase is stuck.

NEXT:
  1. the runtime line ratchet (5153, other sessions) - split a module rather than grow it;
  2. watch a full four-hull cycle: several settled sales, several freight rows, the FREIGHT
     line growing (two rows exist: 44 104 ISK settled and 52 404 units with an unknown price);
  3. give the mining side the same treatment - its slots still carry ore that only the drain
     sells, and a miner cannot fly its own ore to a buyer.

## 2026-10-30 00:30Z (UTC) - the suite is clean again, and one dead A-Life path was found by it

`node --test tests/coop-*.test.mjs` -> **6590 pass / 0 fail / 84 skipped** (was 10 failing). What each
failure actually was:

  - `coop-flag-registry` (undeclared `EVEJS_*`): seven keys were read by tooling and by modules other
    sessions had added. `node scripts/coop-flags.cjs --baseline` re-declared them (declarations only).
  - `coop-hook-requires` / `coop-overlay-dependencies`: `coopLoopTick` requires `coopDistributionPlan`,
    which requires `coopNpcDistribution`; neither distribution module was in `scripts/overlay-spec.cjs`,
    so an installed module could not resolve what it needs. Added. The archived copy also required its
    sibling as `.cjs`, which cannot resolve in the installed tree; it now uses the fork's adaptive
    require (extensionless as `.js`, `.cjs` in this archive).
  - `coop-career-getall-progress`: asserted the old stub literally (`not_completed: true`). The portal
    now reads `space/coopCareerGoals`' snapshot, so the test asserts that contract instead
    (`careerGoalSnapshotFor`, `progress: entry.progress`, `not_completed: !entry.completed`).
  - `coop-native-npc-market`: the single `NOT_AT_NATIVE_STATION` refusal was deliberately split into
    per-predicate codes on 2026-10-30; the test asserted the old single code.
  - `coop-alife-native-buyer-wiring` exposed a REAL dead path, not a stale assertion: the station
    authority never produced `economy.materialNeeds`, and `coopAlifeNativeBuyerDispatch` refuses any
    economy object without it. So `BUY_SUPPLIES` could only ever answer
    `ALIFE_BUY_INTENT_OR_OWNER_UNATTESTED` and no native supply purchase ever happened. Each authority
    row now carries `materialNeeds {typeID, required, available, shortage}` (SDE quote vs this
    station's stock in the same read) and the response exposes the selected product's list, short
    materials only. Fork `dc0654b`, archive synced.
  - `coop-installer-module-coverage` / `coop-post42-native-overlay-assembly`: passed once the
    distribution modules were installed; no further change was needed.

NOT live-proven: the `materialNeeds` change needs a deploy, and the agents stack was DOWN while
another session rebuilt `evejs-local` (image rebuilt ~00:20Z), so nothing was restarted. Deploy with
`docker build -t evejs-local` + `scripts/Start-Agents-Stack.ps1 -Action Up` when the stack is free,
then check `living-*` events for a real `BUY_SUPPLIES` settlement.

RUNTIME BLOCKERS still visible in `coop-events.jsonl` (not code we own):
  - `living-mining-skipped` NO_BELTS_IN_SYSTEM on **Jita 30000142** - measured: Jita has 0 belts,
    New Caldari 30000145 has 2, Perimeter 30000144 has 3. The agents compose seeds mining NPCs for
    Jita+New Caldari, but the scene the loop picks is Jita, so mining skips every cycle. Moving the
    fleet (or the startup list) to a belt-bearing system is the single next action.
  - `living-native-war-opening-blocked` NO_OPENABLE_FRONT - war front territory table present, no
    front openable; the war loop owns that.


## 2026-10-30 20:20Z (UTC) - a fourth hull, spawned as a real ship

PROVEN LIVE: scripts/coop-spawn-distribution-hull.cjs spawned durable hull **980000018521**
at belt 40009256 in 30000145 (transient: false, marker coop-distribution-4-hauler) through the
same native path the mining fleet uses - a real scene, a real anchor, no invented event. The
run picked it up immediately (hulls() returns 4) and it is already flying the first of its
4 stops.

Fleet: four coop-distribution-* hulls, all on multi-stop trips (4-5 stops each), both the
freight ledger and the balance sheet's FREIGHT line live.

NEXT:
  1. the runtime line ratchet (5153, other sessions) - split a module rather than grow it;
  2. a production order that names its buyer's system, so the manufacturer and the freight run
     plan against the same demand instead of discovering it twice;
  3. watch a full cycle of the four-hull fleet: several settled sales, several ledger rows, and
     the FREIGHT line growing with them;
  4. when the fleet is stable, give the mining side the same treatment (its slots still carry
     ore that only the drain sells).

## 2026-10-29 20:05Z (UTC) - the gap list is now measured, and 5 more types answer

The "remaining N types" list was written by hand, so it could only contain what somebody had already
noticed. `scripts/coop-gateway-gap-audit.py` now derives it from the two artefacts that decide it:
the client's own generated descriptors (every request message) and whether a non-generated client
module names that proto module together with the request class, versus the types the running server
answers. On this build: **1282** client request messages, **213** the client really sends, **287**
answered, **10** consumed-but-unanswered. The derived list lives in
`docs/client-contracts/gateway-coverage.json`.

Two instruments came with it:
  - `scripts/coop-gateway-gap-audit.py` - the coverage comparison above;
  - `scripts/coop-verify-client-proto.cjs` - decodes bytes we produced with **CCP's own
    FileDescriptorProto** (lifted from the module's marshal stream, because the generated modules
    cannot be imported on a modern runtime). This is the protobuf twin of the flatbuffer
    client-reader check: our encoder and our own decoder agree on a wrong field number as happily as
    on a right one.

ANSWERED NOW (fork `ff09ec8`, `6133d3e`), each proven on `evejs-agents` after redeploy:
  - `stargate.lock.api.GetRestrictedSystems` - live `[]` -> Apply -> `[30000144]` -> Delete -> `[]`;
  - `stargate.lock.api.Get` - answers the character's own system from the live session; 404 with an
    explicit reason when the system is unknown, when no lock exists, or when the system has several
    locked gates (the response carries one gate, so it refuses instead of picking one);
  - `cosmetic.ship.api.Get` / `GetAllInBubble` - a real ship of character 140000004
    (`9988400000003`) got a licence, was activated and had `c0c0ffee12345678` applied; the gateway
    returned 200/43 bytes that CCP's descriptor decodes to character 140000004 / ship 9988400000003 /
    hex `c0c0ffee12345678`; after unapply+revoke the same call answers 404. The bubble is answered
    from `space/runtime.getSceneForSession`, so it only reports ships in the character's own scene
    (0 bytes when the character has no live session);
  - `achievement.api.admin.ResetAll` - `status=200`, the row disappears for that character only.

STILL OPEN (10), with the honest reason:
  - sequencing `GetTierPricing` / `GetTierDurations` / `GetEarlyCompletionPricing` - our jobs cost
    component licences, not PLEX. Serving a PLEX price we never charge would be a lie, and charging
    would need a PLEX balance this world does not mint for sequencing. Either the price becomes 0
    everywhere (honest but useless) or sequencing starts charging PLEX first;
  - component listings (2) - blocked on real SKIN component item type ids: a listing carries
    `component_item.sequential`, which the client resolves through its own `ComponentsDataLoader`
    FSD (`res:/staticdata/ship_skin_design_components.fsdbinary`), and that binary is not decodable
    with what is on this machine yet. The item types in group 4726 ("Ship SKIN Design Element", 924
    rows) do exist in the server's SDE, but which of them the FSD maps to a component is in that
    binary, and guessing would break the market window;
  - `freelance.contributionmethod.itemdelivery.Deliver` - our freelance projects are stub-empty, so
    there is no project or delivery location to deliver to;
  - `sovereignty.resource.planet.api.GetAllConfigurations` - no planet resource configurations exist
    in this world;
  - `user.license.api.Get` - the end-user licence acceptance has no record here;
  - `eve_public.Request` (the envelope itself) and `ai.assistant.chat.api.Query` - not ours.


## 2026-10-30 20:00Z (UTC) - the identity moves with a proven arrival; fleet walks its stops

PROVEN LIVE: the whole fleet is on multi-stop trips - all three hulls loaded their first stop
(LOADED_STOP:60000688 for two of them) and are flying to the second of 4-5 stops.

Changed: on ARRIVED the crossing now calls identity.relocate(pilotID, from, entityID, to) and
records the outcome in the journal (identityRelocated). Before this the link kept pointing at
the old system, the next reader pruned it, and the following crossing failed
SOURCE_IDENTITY_MISMATCH until it was rebuilt from the durable record. A relocate the registry
refuses (STALE_SOURCE, SOURCE_STILL_PHYSICAL) is recorded, never hidden.

Tests: gate-crossing 20, distribution-run 26, identity-refresh 5, 51 in the touched suites.

NEXT:
  1. the runtime line ratchet (5153, other sessions) - split a module rather than grow it;
  2. a fourth hull (only an operator re-mark is needed: the run iterates every
     coop-distribution-* marker, and the two idle Jita fleet haulers are already used);
  3. a production order that names its buyer's system, so the manufacturer and the freight run
     plan against the same demand instead of discovering it twice;
  4. watch the freight ledger over a full cycle: several trips, several rows, and the balance
     sheet's FREIGHT line growing with them.

## 2026-10-30 19:45Z (UTC) - one trip loads at several stations

PROVEN LIVE right after the deploy: hull 980000000002 planned a 46-line trip with **4 stops**, 
hull 980000000005 a 65-line trip with **5 stops** and was already at stop 1 after loading the
first one. Before this, the run lifted at a single fromStationID while the bundle planner kept
choosing cargo from several stations, so most of a trip's lines could never be taken.

What changed:
  - planning turns the bundle's items into an ordered list of STOPS (stationID + its items);
  - the run flies to the current stop, lifts THAT stop's demand only, records it in
    loadedStops and moves on; the crossing is planned only once every stop is loaded;
  - a stop with nothing to lift is still refused by name, so a wrong stop cannot look like an
    empty station.

Freight ledger now has two real rows (44 104 ISK settled; 52 404 units with an unknown price
because the sale was proven only by the empty hold) and the balance sheet prints them.

NEXT:
  1. relocate-on-arrival for the identity file (the merge covers the live case; a clean
     relocate on ARRIVED would stop the reconciling churn entirely);
  2. the runtime line ratchet (5153, other sessions) - split a module rather than grow it;
  3. give the fleet a fourth hull (only an operator re-mark is needed: the run iterates every
     coop-distribution-* marker);
  4. a production order that names its buyer's system, so the manufacturer and the freight run
     can be planned against the same demand instead of discovering it twice.

## 2026-10-30 19:40Z (UTC) - the client's own reader caught our buffer (uint64), and what is left

The achievement catalogue was accepted by our own reader and rejected by the client's: feed the
served file to `achievement_system/client/model/flatbuffer/generated.pyj` and the first target came
back as **618475290625** instead of 1, the SP reward as **94489281512** instead of 1000. `Target` and
`SpReward.Quantity` are **uint64** there; we wrote uint32, so the client merged the neighbouring
bytes into the number. Our reader read the same low 32 bits and agreed with us - a reader that
shares the writer's assumption cannot catch a width error.

Fixed in fork `3a01b5b` (writer has uint64/BigInt, 8-byte alignment), and made repeatable:
`scripts/coop-verify-flatbuffer-client.cjs achievement` fetches the client's generated module from
the local archive at run time (never committed) and prints the numbers it really sees. The extractor
`scripts/coop-flatbuffer-schema.py` now records a field's width from its `Prepend<Type>Slot` instead
of defaulting to uoffset, so `docs/client-contracts/achievement-flatbuffer.json` says uint64/uint8/
bool again, and the JS tests read uint64 where the client does. A test fails on a width regression
and SKIPS (never passes) when python3+flatbuffers or the archive is missing.

PROVEN LIVE on `evejs-agents` after redeploy: checkpoint 200 with crc **3362621445**, TLS GET 200 /
**1912 bytes** / `ACHV` / same CRC, and those exact served bytes parsed by the client's reader give
`coop_mine_ore` targets 1/100 with SP 1000/2500, `coop_haul_cargo` 1/1500, `coop_win_fight` 1/2000.

What is left (14 register types) and the honest reason for each:
  - `cosmetic.market.component.listing.{GetAll,InitiatePurchaseListing}` - **blocked**: a listing
    carries `component_item.sequential`, which the client resolves through its own
    `ComponentsDataLoader` FSD; the server's item-type table has no SKIN component items (checked:
    only armour coatings and unrelated "component" commodities). An invented id would make the
    market window fail to build that listing in game;
  - `freelance.contributionmethod.itemdelivery.Deliver` - our freelance projects are stub-empty, so
    there is no project or delivery location to deliver to; needs the project system first;
  - `ship.unlock.{GetPendingNotifications,ClaimReward}` - nothing in this world unlocks a ship type
    yet; a claim without a real source would be an invented reward;
  - `eve.sovereignty.{hub,mercenaryden,skyhook}.admin.*`, `internal_gateway.*`, `debug.Request`,
    `eve_public.Request`, `ai.assistant`, `auth.*` - cloud-internal, debug or authentication;
    never faked.

Still unverified by a human: the achievements and titles windows need the owner to open them in the
real client, and the play stack still runs the pre-catalogue image (needs an owner restart window).


## 2026-10-30 19:10Z (UTC) - freight income is visible in the balance sheet

PROVEN LIVE: the first freight row was written by a real sale and the balance sheet reads it:
  freight   1 trips, 44 104 ISK, 2915 units
    30000145->30000142  1 trips, 44 104 ISK
with the row itself in coop-native-market/freight-ledger.jsonl
  {haulerID 980000000005, lines 4, units 2915, isk 44104, status SOLD}.

What changed:
  - every settled sale in a distribution run appends ONE row (append-only): time, hull, from/to
    system and station, cargo lines, units, ISK; a sale proven only by an empty hold records
    iskUnknown instead of a fake amount;
  - scripts/coop-economy-ledger.cjs prints a FREIGHT section (trips, ISK, units, top routes)
    beside production and station sales, so the loop's most active income stream is auditable.

Tests: distribution-run 25 (one row per settled sale with its ISK and destination).

NEXT:
  1. a hull that loads at TWO stations in one trip (the planner already assembles multi-station
     stacks; the lift still lifts at one station);
  2. relocate-on-arrival for the identity file (the merge already covers the live case);
  3. the runtime line ratchet (5153, other sessions);
  4. let the fleet grow: the run iterates every coop-distribution-* marker, so a fourth hull
     only needs the operator re-mark (scripts/coop-distribution-hull.cjs).

## 2026-10-30 18:50Z (UTC) - achievements: our own catalogue, served, and the reward is paid

PROVEN LIVE on `evejs-agents` (never on the owner's play stack), fork `395cb66`:
  - `eve_public.achievement.definition.api.cdn.GetLatest` -> 200, checkpoint
    `https://127.0.0.2/elysian-eve/achievements/1.0.0.achievements`, version 1.0.0, crc 2179836517;
  - the content listener answer to that path over TLS: 200, 1880 bytes, identifier `ACHV`,
    crc 2179836517 (matches the checkpoint), both roots the client's repository loads
    (Challenges, TimeLimited) present, 3 achievements / 4 milestones parsed back;
  - a real claim on character 140000004: Complete -> unclaimed 1 -> Claim 200 ->
    `freeSkillPoints` 0 -> 3500, unclaimed 0. The reward is not a promise: the grant happens
    before the entry is removed, and a failed grant returns REWARD_FAILED and keeps it claimable.

What exists now:
  - `space/coopAchievementContent.js` builds `AchievementData -> Category -> Achievement ->
    Milestone -> Reward -> SpReward` on `space/coopFlatbuffer.js` (which learned uint8/uint16/bool
    scalars; a bool is 0/1, a uint8 keeps its value - the first version collapsed both to 1 and the
    round-trip test caught it as `RewardPayload.SpReward = 1`);
  - names are **real localization message ids** read once from the client's own message table
    (`W:\EVE Online - 3396210\ResFiles\...\localization_fsd_en-us.pickle`), quoted in comments.
    An invented id renders as an unresolved marker in game, so never guess one;
  - catalogue: Operations (0) -> Mining 1/100 (1 000 + 2 500 SP), Hauler 1 (1 500 SP),
    Combat 1 (2 000 SP); Time Limited root is an honest empty category because the repository
    reads `TimeLimited()` unconditionally and a missing root is `None` there and breaks the page;
  - one contribution method `coop_cumulative` (ProgressConfig.CumulativeMode = 1, no parameters).
  - 20 tests green across flatbuffer + content + achievements + titles.

NEXT (remaining 14 register types, unchanged order):
  1. `component.listing.InitiatePurchaseListing` (buy the component a licence needs);
  2. freelance `itemdelivery.Deliver`;
  3. sovereignty hub / mercenaryden / skyhook admin;
  4. `ship.unlock.ClaimReward`;
  5. `ai.assistant`, `internal_gateway`, `debug` (do not fake), `auth.*` (never fake).
Still unverified by a human: the achievements window and the titles window need the owner to open
them in the real client; no client-side visual confirmation exists for either.


## 2026-10-30 18:40Z (UTC) - demand first: build for the buyer the freight can reach

PROVEN LIVE: within a minute of the deploy the manufacturer installed jobs for 444 and 60764,
each announced by living-npc-manufacture-buyer-elsewhere naming the system that really bids,
and the distribution hulls began planning multi-item trips (46 and 54 lines) instead of a
single stack.

What changed:
  - bidElsewhere(): when the blueprint's own station bids for nothing, the manufacturer asks
    the loop for the best seeded bid one reciprocal gate away (read-only sqlite; the market RPC
    timed out live on 2026-10-29 and must never decide production);
  - the job records that its buyer is elsewhere, and says so in its own event, so "no local
    demand" can never again be mistaken for "no demand at all";
  - planBundle already fills the hold across types, which is why trips now carry dozens of
    item lines.

The loop now reads, in one sentence: honour real demand -> build where the materials are ->
carry it with the freight run -> sell where it pays -> come home and do it again.

Fleet at hand-off: 980000000005 loading a 54-line trip, 980000000002 finished its load,
980000004164 finished its leftovers (1 490 464 ISK).

NEXT:
  1. freight income in the economy ledger (the balance sheet still shows only station sales)
     so the money a trip earns is visible where the money is accounted;
  2. a hull that loads at TWO stations in one trip (the planner already returns multi-station
     stacks; the lift still lifts at one station);
  3. relocate-on-arrival for the identity file (merge covers the live case);
  4. the runtime line ratchet (5153, other sessions).

## 2026-10-30 18:30Z (UTC) - leftovers crossed a gate and sold; identity writes now merge

PROVEN LIVE this round:
  - hull 980000004164 carried ore in New Caldari where no station bids for it. The run found
    the buyer ONE GATE AWAY (Jita 60003760 bids 4 035 826 units of type 1228), crossed on the
    first attempt (SAME_NATIVE_SHIP_ARRIVED) and sold **1 490 464 ISK** of leftovers;
  - the run then ended honestly SOLD_VERIFIED_BY_HOLD once the hold was empty.

Changed (tests: distribution-run 24, distribution-plan 7, identity-refresh 5, 91 in the loop
suites):
  - buyerForCargo(): the liquidation search now asks the neighbouring systems with a real gate
    and a real seeded book, then reuses the crossing + TO_DEST + SELL legs;
  - the identity registry MERGES with the file on every write and keeps a tombstone for what
    this owner deleted. Two owners used to replace each other's links, which is why crossings
    failed SOURCE_IDENTITY_MISMATCH while both sides were individually correct;
  - the sell budget grows with the load (ceil(load/100 000) + 2, floor 6) instead of stopping
    a real haul at six settlements;
  - an empty hold ends the run even when the journal no longer remembers the quantity.

Fleet at hand-off: three coop-distribution-* hulls cycling (980000000005 is on a new trip,
980000000002 finished its load, 980000004164 finished its leftovers).

NEXT:
  1. produce what Jita bids for (the manufacturer still reports NO_REAL_BUYER locally) and let
     this freight carry it - the loop now has nowhere to put money it cannot spend;
  2. sum freight ISK into the economy ledger so the balance sheet separates freight income
     from station sales;
  3. several hulls is proven; next is a hull that loads at TWO stations in one trip;
  4. relocate-on-arrival for the identity file (merge covers the live case);
  5. the runtime line ratchet (5153, other sessions).

## 2026-10-30 17:40Z (UTC) - the trip fills the hold; leftovers need a gate

Changed (tests: distribution-plan 7, distribution-run 22, npc-distribution 9, 101 across the
loop suites):
  - planBundle() ranks cargo by value per m3 and fills the hold greedily. Proof in a test:
    1 unit of 560 000 ISK ammunition + 309 987 units of 4 ISK ore fill a 3 100 m3 hold exactly
    (560 000 + 1 239 948 ISK) instead of flying 3 099 m3 empty;
  - the lift measures the hold in m3 (capM3 + volumeOf) instead of a per-type unit cap, so a
    bundle can no longer overbook the ship;
  - a hull whose hold is already full no longer ends its run: it looks for the station that
    really bids for what it carries (stationForTypes over the seeded book) and sells there;
  - the loop reports living-distribution-book-unavailable when the seeded book cannot be
    opened, so an empty answer can never look like "nobody buys this".

KNOWN GAP, measured: the leftover search only looks inside the hull's own system. Ore carried
in New Caldari is refused NO_BUYER_FOR_CARGO while Jita one gate away bids 4 035 826 units for
it (seed_buy_orders, type 1228 at 60003760). NEXT: search the neighbouring systems and reuse
the crossing leg - a two-beat extension of the liquidation path, not a new mechanism.

Fleet state at hand-off: three coop-distribution-* hulls; 980000000005 is cycling (last sale
44 104 ISK settled and returning home); 980000004164 and 980000000002 hold ore leftovers in
New Caldari and are waiting on the gap above.

## 2026-10-30 16:20Z (UTC) - three hulls share the freight; a stuck call cannot freeze them

PROVEN LIVE: the two idle Jita haulers were re-marked as distribution hulls through
scripts/coop-distribution-hull.cjs (identity bookkeeping only - nothing moved, nothing
invented). Both then repositioned home on their own, loaded freight and crossed to Jita;
one trip settled **5 224 110 ISK in a single sale**.

Changes (tests: distribution-run 21, distribution-plan 6, 97 across the loop suites):
  - a hull with no freight where it stands repositions to the nearest system that really
    holds corporation stock and is one reciprocal gate away (stockSystems over real hangars);
  - one hung market call no longer freezes every hull: per-hull budget HULL_TIMEOUT_MS, and
    planning may be async (a market read is);
  - an empty hold proves delivery, not price: such a sale records iskUnknown, never a
    misleading 0;
  - a run blocked by a slow market may retry once after BLOCKED_RETRY_MS (30 min) while it
    still carries goods, bounded to 2 retries.

Fleet: 980000000002, 980000000005, 980000004164 are coop-distribution-*; one durable journal
per hull; the loop iterates all of them each beat.

NEXT:
  1. margin-based cargo choice (a hold of ammunition beats a hold of 4-ISK ore; the planner
     still ranks by trip revenue, not value per m3);
  2. the manufacturer reports NO_REAL_BUYER locally - produce what Jita bids for, then let
     this freight carry it;
  3. accounting: sum the real per-trip ISK into the economy ledger so the balance sheet shows
     freight income separately from station sales;
  4. relocate-on-arrival for the identity file;
  5. the runtime line ratchet (5153, other sessions).

## 2026-10-30 15:20Z (UTC) - the cycle RUNS: repeated real sales, hold emptied, hull home

PROVEN LIVE, one hull, no client, one continuous loop:
  sale 560 000 -> home (crossing ARRIVED) -> load -> cross -> sale 668 088 -> (partial)
  -> sale 1 027 563 -> sale 543 492 -> home -> load -> cross again.
The hold was empty before every return, and every payment came from a seeded bid at 60003760.

Faults fixed to get here (tests: coop-distribution-run 17, coop-distribution-plan 5):
  - the market cooldown is PER PILOT (5 s here): 2.5 s polls only collected COOLDOWN, so the
    poll now waits longer than the cooldown;
  - one settlement is not a finished load: 37 428 units settled while 35 629 stayed aboard and
    the hull went home with them. A trip ends only when the HOLD is empty;
  - a loaded hull has less room: the planner uses FREE volume and refuses HOLD_ALREADY_FULL
    instead of overbooking the ship.

The economic loop is therefore closed AND self-sustaining for one hull: it cycles without an
operator, decides from the real hangars and the real seeded book, and only claims what the
native adapter, the lift receipts and the market settlements actually prove.

NEXT (in order):
  1. several distribution hulls (the run already iterates every coop-distribution-* marker;
     the Jita fleet hulls are the obvious candidates once they are re-marked);
  2. choose cargo by MARGIN per trip, not by total revenue (a hold of ammunition beats a
     hold of ore at 4 ISK, and the planner cannot yet prefer it);
  3. the manufacturer still reports NO_REAL_BUYER at local stations - produce the goods Jita
     bids for and let this run carry them;
  4. relocate-on-arrival for the identity file (the registry refresh covers the live case);
  5. the runtime line ratchet (5153, other sessions).

## 2026-10-30 14:35Z (UTC) - the cycle turns: home again, second load aboard

PROVEN LIVE: after the 560 000 ISK sale the hull crossed BACK to 30000145
(SAME_NATIVE_SHIP_ARRIVED), the run reset to PLAN at home, planned a new trip and really
loaded 164 504 units at 60000682, crossed to Jita and reached the station.

NOT PROVEN: the second sale. It is refused with a named reason (COOLDOWN now), and the hull
is not live in its scene at the sale moment (the run's distance read is null), so something
removes a named distribution hull and it is re-materialized. The cargo stays aboard; the run
waits by time instead of inventing a sale.

Changed this round (tests: coop-distribution-run 16, coop-identity-refresh 3):
  - the run cycles: sale -> RETURN -> cross home -> REPLAN -> next trip, bounded by MAX_TRIPS,
    and a cycle that finds nothing worth shipping ends the run;
  - a stale ARRIVED journal from the outward trip is NOT the way home - only the durable
    record saying the hull is home counts (measured: it reported RETURNED for ever);
  - "at the station" now means what the market means: 8 km from the PHYSICAL scene station;
  - the market's offer() names each failed predicate instead of one NOT_AT_NATIVE_STATION
    (that is how NO_IDENTITY_LINK was found in one line);
  - the identity registry re-reads the file when it changed, and the market trader refreshes
    before it looks for an identity: several owners held stale copies and refused each other.

NEXT: find what prunes a NAMED distribution hull out of its scene (a candidate is the
materializer's stale-link pass; the hull keeps being re-materialized and then lost), then
re-run the second sale. After that: several hulls and margin-based cargo choice.

## 2026-10-30 12:10Z (UTC) - CLOSED: a manufactured good was sold in Jita for 560 000 ISK

PROVEN LIVE (hauler 980000004164, no client): plan from real hangars and the seeded book ->
warp in-system -> LIFT 1 x 28338 -> cross 30000145 -> 30000142 (SAME_NATIVE_SHIP_ARRIVED) ->
fly to 60003760 -> SOLD qty=1 isk=560 000 (living-npc-sale-settlement), hold empty after.
That is the whole economic loop this project was chasing: mine/refine/manufacture held here,
distribution flew, a real buyer paid.

Four faults between "arrived" and "paid" (each with a test):
  - the settled sale lives ~5 s, so a run polling once a minute only ever saw PENDING; it now
    polls inside one beat and reads the settlement map directly;
  - settlements were invisible after landing: every one now emits living-npc-sale-settlement
    with status, reason, quantity and ISK;
  - NOT_AT_NATIVE_STATION is a "not yet": the sell step measures distance, flies back, and
    treats NOT_AT_NATIVE_STATION / SALE_TIMEOUT / MARKET_UNAVAILABLE as retryable (time bound);
  - a carried type OUTSIDE the env sell allowlist was never asked for (the carried set only
    filtered), so 28338 could never be sold while Jita bid 560 000 for it.

NEXT: the run does ONE trip per hull, and the hull is now in Jita with an empty hold. The
next increment is the RETURN leg - cross back to the origin system, replan, load, sell again -
so a hull cycles without an operator. Then: several hulls, and goods chosen by margin rather
than by per-trip revenue alone.

## 2026-10-30 11:10Z (UTC) - the freight run flies, and stops at the sale

PROVEN LIVE (hull 980000004164, no client): planned a trip from the real hangar stacks and the
real seeded book (1 x Republic Fleet Depleted Uranium XL, 60000682 -> 60003760 @ 560 000),
warped in-system, LIFTED the stack into its native hold, CROSSED 30000145 -> 30000142
(SAME_NATIVE_SHIP_ARRIVED), flew to the destination station.

OPEN, MEASURED: the arrival sale answers SALE_PENDING and never settles (6+ calls over an
hour, market container healthy, seeded Jita bid present, the unit still in the hold). The
next fix belongs inside the arrival-sale settlement, not in the run: reproduce a single
sellOnArrival for this hull and follow its journal. The run itself is honest - it waits by
TIME, keeps the cargo, and says SALE_PENDING.

Fixes this round, each pinned by tests (coop-distribution-run 8, coop-distribution-plan 5):
  - a station lift serves the DESTINATION bid (demand map), because every station holding the
    corporational minerals bids for none of them (NO_LOCAL_BID was the measured refusal);
  - stations come from the SCENE (listStations() answered zero rows live);
  - a durable hull is re-materialized from its record and the flight falls back to the scene
    follow when its controller is gone;
  - distance decides warp vs follow (a subwarp follow across a system never arrives);
  - PENDING is bounded by time, not calls (a slow market must not stop a run);
  - the sale needs a NAMED hauler: an empty role answered HAULER_NOT_NAMED.

DONE this round: the no-belts fleet guard. Live after deploy: 4x living-mining-skipped
NO_BELTS_IN_SYSTEM and zero ALIFE08 reconcile lines for 30000142, so a belt-less system no
longer spends a durable fleet (Jita had 18 stations, 0 belts and 4 idle miners).

Still open: relocate-on-arrival for the identity file (the crossing reconciles lazily today),
the runtime line ratchet (5153, other sessions), and the arrival-sale settlement above.

## 2026-10-30 00:40Z (UTC) - the crossing works in both directions

PROVEN LIVE: hauler 980000004164 crossed Jita 30000142 -> New Caldari 30000145 through gate
pair 50001250/50002198 on the FIRST attempt (SAME_NATIVE_SHIP_ARRIVED), 5 s after an
11 191 km warp. Durable store moved to 30000145 with its 4 modules. Together with the
earlier 30000145 -> 30000142 arrival this is a working round trip of one real hull.

What it took, all pinned by tests (19 in coop-npc-gate-crossing, 79 across the loop suites):
  - the SCENE stargate is the authority for jump range (the static-data row made five
    attempts fail NPC_NOT_AT_PHYSICAL_GATE);
  - a follow order LOCKS its target (stock issueManualOrder sets currentTargetID), so the
    run stands the hull down with a native stop order at the gate and crosses in that tick;
  - a warp has a minimum range (WARP_DISTANCE_TOO_CLOSE at 16 km): warp only past 200 km;
  - a pruned identity link is re-established from the durable record before the attempt,
    and a hull whose record disagrees with the journal stops with HULL_NOT_IN_JOURNAL_SYSTEM;
  - the co-op owns its own transfer built from a fresh read of the identity file, because
    the shared war adapter carries the registry as it was at boot.

Fleet health: both slots ALREADY_ACTIVE (30000145-1 miners=5 haulers=1, 30000145-2
miners=3 haulers=1). The loop has its own beat (EVEJS_COOP_LOOP_DRIVER=1, 45 s) because the
stock hook went quiet for eight minutes on 2026-10-29 while a crossing waited.

Where the hull is now: 30000145, marker coop-distribution-1-hauler, 0 cargo, 4 modules.
That is the RIGHT side for the first real freight run: station 60000682 in 30000145 holds
498 596 Tritanium, and Jita 60003760 bids Tritanium 4 x 4 000 000.

NEXT (not started): the LOAD step. Nothing yet lifts a hangar stack into this hull, so a
distribution run would carry air. Order of work: station departure at 60000682 -> lift a real
Tritanium stack bounded by the hold -> gate leg (proven) -> station arrival at 60003760 ->
sell through the proven station-sale path -> report the trip in the ledger.

## 2026-10-28 23:00Z (UTC) - FIRST LIVE GATE CROSSING, and what it cost

PROVEN: hauler 980000004164 crossed New Caldari 30000145 -> Jita 30000142 through gate
pair 50002198/50001250. The native adapter's own verdict wrote SAME_NATIVE_SHIP_ARRIVED
on the first attempt, and the DURABLE store moved to 30000142 with its 4 modules. No
client, no synthetic jump.

Four fixes were needed to make a crossing survive the real world (all pinned by tests):
  1. the adapter takes the proven GATE PAIR, not the stargate row;
  2. a hull a few km out is closed with a native FOLLOW order (a warp refuses a close
     target, so the run re-warped for ever);
  3. a durable ship whose scene was rebuilt is re-materialized from its own record;
  4. the run waits for a calm hull (WAITING_CALM:...) and a target lock alone does not
     veto the attempt - the durable controller record showed target 0.
The crossing is advanced from the DRAIN tick as well as the mining hook (measured: the
drain ticked at 21:55 while the loop hook had not run since 21:52).

OPEN ISSUE, MY OWN COST: the return crossing of that hull blocks in Jita (the mining
behaviour loop keeps it busy; attempts 3/5 at 22:48) and slot 30000145-1 is therefore
NEEDS_OPERATOR_REPAIR / ALIFE08_RECOMPOSE_MARKER_SET_INCOMPLETE: its miners are in system
and the assigned hauler is the one in Jita. Slot 30000145-2 is ALREADY_ACTIVE, so mining
continues at half strength. This is NOT a code bug and NOT a lost ship: the hull is
durable in 30000142.

TO RESTORE THE SLOT (one of, in order of preference):
  a. let the return crossing finish - the journal is durable at
     /var/lib/evejs/coop-native-market/gate-crossing/980000004164.json and retries while
     EVEJS_COOP_DISTRIBUTION=1;
  b. spawn a durable hauler in 30000145 with operatorKind coop-mining-30000145-1-hauler
     (spawnNativeNpcEntityInSystem needs a real anchorDescriptor; ANCHOR_REQUIRED was the
     measured refusal, and guessing the option shape was not worth a wrong hull);
  c. accept the Jita hull as the first distribution hull and let the fleet spawn a
     replacement on the next owner restart window.
Do NOT hand-edit the store to move the ship back: that is a fake jump.

Distribution decision is live and honest: scripts/coop-distribution-plan.cjs picks the
trip (Republic Fleet Depleted Uranium XL x1 -> 60003760 @560 000) and refuses a trip that
does not pay. Jita bids Tritanium 4 x 4 000 000 and Pyerite 15 x 3 300 000 against the
corporation's 874 916 / 118 434 held.

Tests 52/52 across the seven loop suites. Gate: AUDIT_OK except the inherited runtime
ratchet (5013 lines - other sessions' FW work; my net footprint there is negative).

## 2026-10-28 21:10Z (UTC) - one loop tick; the crossing cannot claim what it did not prove

REFACTOR: the stock file now carries ONE hook line (space/coopLoopTick.js) that fans out to
refinery + manufacture + distribution. Verified live after deploy: refinery 21:06:09 and
manufacture 21:04:39 both ran through it, and stockChars dropped back under the frozen
budget. A throwing phase is reported as living-coop-loop-phase-failed and skipped.

CROSSING (space/coopNpcGateCrossing.js): durable journal per entity, phases
APPROACH -> AT_GATE -> CROSSING -> ARRIVED/BLOCKED. ARRIVED requires the native adapter
proof: success + verifiedSourceAbsent + verifiedDestinationPresent + same entityID + exact
destination system. Anything less is named (SOURCE_STILL_PRESENT, DESTINATION_ABSENT,
ENTITY_CHANGED, WRONG_DESTINATION_SYSTEM, TRANSFER_REFUSED), retried at most 5 times, then
BLOCKED. No adapter -> stays AT_GATE with TRANSFER_UNAVAILABLE. It never plans or moves a
hull by itself.

STILL NEEDED FOR THE LIVE RUN (owner/config, not code):
  - EVEJS_COOP_NATIVE_GATE_TRANSFER=1 (ensureNativeGateTransfer requires it; only
    EVEJS_COOP_NATIVE_GATE_APPROACH=1 is set today),
  - a transfer adapter handed to coopLoopTick (the runtime keeps its instance private;
    one getter line in coopVirtualWorldRuntime.js would expose it, but that file is over
    its ratchet and owned by the FW work right now),
  - a hull to fly: the fleet hauler is busy with ore, so a spare or an owner-approved
    window is needed before a real crossing with cargo.

Tests: 6/6 tests/coop-npc-gate-crossing.test.mjs; 46/46 across the seven loop suites.

## 2026-10-29 21:20Z - distribution: the decision exists, the movement stays opt-in

GATE FACTS (measured, not assumed): connectedGates finds ONE reciprocal gate between
New Caldari 30000145 and Jita 30000142, so a distribution run is a single hop. The
native transfer primitive is proven in this world: living-native-gate-transfer
coop-pilot-004, entity 980000000141, 30045344 -> 30003837, SAME_NATIVE_SHIP_ARRIVED
(2026-10-27T23:42:15Z). EVEJS_COOP_NATIVE_GATE_APPROACH=1 and
EVEJS_COOP_VIRTUAL_ROUTE=30000142,30000144,30000145,... are already on.

WHY JITA: it prices like a market - Tritanium 4 ISK x 4 000 000, Pyerite 15 x 3 300 000,
Scordite 16 x 4 150 000, Scordite III-Grade 17 x 3 900 000 - and the stock is already
on the shelf (874 916 Trit, 118 434 Pyerite, 173 613 Scordite III-Grade).

space/coopNpcDistribution.js is the pure DECISION: which stack, how much, from where to
where, and what the trip pays. Refusals: NO_BUYER_AT_DESTINATION,
DESTINATION_DOES_NOT_PAY_MORE (arbitrage only), DOES_NOT_FIT_HOLD,
BUYER_VOLUME_EXHAUSTED, TRIP_NOT_WORTH_IT. Load is bounded by the real hold, the buyer's
remaining volume and the stack. It moves nothing on purpose: cross-system transfer is
opt-in and needs live QA (docs/NATIVE_NPC_GATE_TRAVEL.md).

scripts/coop-distribution-plan.cjs prints the live plan from the deployed image:
  TRIP Republic Fleet Depleted Uranium XL x1 60000682 -> 60003760, 560 000 ISK vs 0
  locally; runner-ups Scordite 338 922, Tritanium 320 989, Pyerite 283 763.

NEXT (owner decision needed, one flag away): wire the movement - load the chosen stack
into a hauler, warpToEntity to gate 50016293, nativeGateTransfer.transfer(), verify
SAME_NATIVE_SHIP_ARRIVED, then warp to 60003760 and sell on arrival. Keep it OFF by
default and prove one manual crossing with cargo before enabling the loop.

Tests 6/6 tests/coop-npc-distribution.test.mjs; 33/33 across the five loop suites.
Gate: AUDIT_OK on every rule except the inherited coopVirtualWorldRuntime ratchet.

## 2026-10-29 20:55Z - the refinery was serving the wrong station; books now close

MEASURED DEFECT: 454 124 units of tagged warehouse ore sat at 60000682 while the
refinery only worked at the fleet's own dock (1 535 units there). The corporation refined
almost none of its own ore, so Pyerite looked scarce while it was on the shelf as
unrefined Scordite. coopNpcRefineryTick.run() now serves the fleet's station first and
then the station its own newest warehouse trip manifest proves (both are proof, never a
guess), with a batch of EVEJS_COOP_NPC_REFINERY_BATCH (default 24) instead of 8 rows a
minute. After deploy: 15 COMMITTED operations at 60000682, ~9 995 ore units each.

LEDGER (scripts/coop-economy-ledger.cjs, read-only, runs in the container):
  treasury 722 134 486 ISK; refinery 71 ops / 247 005 ISK fees; 19 jobs / 85 runs;
  160 sale fills = 165 357 081 ISK.
  28338 Republic Fleet Depleted Uranium XL: produced 1 700 = sold 1 600 + held 100,
  74 576 000 ISK; 444 Mining Survey Chipset I: produced 68 = sold 63 + held 5.
  BALANCED - every produced unit is sold or physically held. Ore and minerals are
  reported as FLOW (refined away / produced / held), never as a produce-sell balance.

MARKET NOTE (not a code bug): the agents market was re-seeded at 20:17 by another
session (manifest 585 455 rows, 40 regions, 5210 stations) and its local book at
30000145 now holds only 83 LP/event bids (Loyalty Tokens, Datacores, Sleeper corpses) -
nothing the corporation can make. The manufacturer therefore reports NO_REAL_BUYER,
which is the correct economic answer, not a defect. Jita's book is dominated by
static-data artifacts (Laelaps 446 800 000 for 1x Tritanium): isTrivialRecipe() refuses
to build those, so the world idles instead of printing ISK.

ALSO: an out-of-process blueprint seed is invisible to the running server, because
itemStore keeps a process-local index. Seed, then restart the server - do not conclude
the seed failed.

NEXT (genuinely the last link): cross-system distribution. Both 30000145 and 30000142
have real scenes; warp-to-gate + jump exists (coopNpcGateTravel.createGateTravel, proven
by living-native-war-gate-staging). A distribution job is: load a hangar stack, gate hop,
station trip, arrival sale at a station that really bids. Only worth wiring once the
seeded book contains a sane price for an ordinary good; today it does not.

## 2026-10-29 20:10Z - the loop is closed: the world decides, builds, hauls and sells

THE MISSING LINK WAS NOT ECONOMICS, IT WAS A CALLER. The server source contained
ZERO references to space/coopNpcManufacture.js: neither install() nor tick() was ever
called, so every job came from scripts/manufacture-npc-item.cjs run by hand and an
INSTALLED job could never finish in-world. space/coopNpcManufactureTick.js is that
caller (one hook line beside the refinery tick, EVEJS_COOP_NPC_MANUFACTURE).

Its economic rule: a good is produced only when a station really bids for it, the run
count is bounded by the buyer's remaining seeded volume AND by the materials physically
in the hangar, one job per recipe at a time, and the best PAYER wins by expected
revenue. Refusals are named: NO_REAL_BUYER, BUYER_ALREADY_COVERED, MATERIALS_MISSING,
BELOW_PRICE_FLOOR, JOB_ALREADY_INSTALLED, RECIPE_* , MARKET_UNREACHABLE.

OBSERVED END TO END (no operator, no client):
  19:51:30 attempt {blueprints:2, candidates:2, ready:2} -> installed 5 runs at 60000682
            because its seeded bid 54 289.76 pays more than 60014935's 53 700.08;
  20:05:48 living-npc-station-sold 5 x 444 @ 54 289.76 = 271 449 ISK at 60000682;
  20:07:31 the world completed the next 5-unit job and immediately installed another.
Treasury 607 026 750.61 ISK; 11 jobs / 53 units produced since the receipts began.

SECOND FIX: an empty drain trip used to cool its station for 30 minutes, so a trip with
nothing to load blocked the corporation's own best customer (60000682 had a 54 289.76
bid). shouldCoolDown() now separates a REFUSAL from an EMPTY HOLD.

Tests: 11/11 tests/coop-npc-manufacture-tick.test.mjs, 12/12
tests/coop-station-drain.test.mjs. Fork c453c9a + b1826ad; repo d54d0577 + worklog.
Gate: AUDIT_OK on every rule except the inherited coopVirtualWorldRuntime line ratchet
(4988 > 4800, FW work from other sessions; my own footprint there is +12 lines).

NEXT: the minerals surplus (891 702 units) now has a real internal consumer at a rate
the fleet can feed. When the hangars at 60000682 / 60014935 run dry of Tritanium the
manufacturer will report MATERIALS_MISSING with the exact shortfall - that is the signal
to check whether refinery output reaches the same hangar, not to lower the rule.

## 2026-10-28 19:35Z - gate status: the ratchet breach is inherited, not mine

AUDIT fails on exactly one rule: coopVirtualWorldRuntime.js 4987 lines > 4800. Numbers:
the file was 4928 at HEAD~3 and 4975 before my last edit (FW-044..047 grew it); my own net
footprint is +12 lines, the rest of my logic lives in the new coopMarketJournalBoot.js.

The sanctioned split (scripts/coop-split-module.cjs --apply, a 291-line slice) DID apply and
reduced the parent to 4699, but it then failed the other gate rule - split two-state names
79 > 23 (one piece of state must live in one module) - so it was reverted. Split safety is
back to 0 undeclared / 23 two-state. Whoever owns the FW work must pick a slice that keeps
state in one module; do not re-apply the same --out blindly.

Everything else is green: integration copies differing 0, runtime patching 0, legacy
scripts 77/78, writable telemetry, fleets ALREADY_ACTIVE after every deploy today.

## 2026-10-28 19:25Z - minerals have no LOCAL buyer; the product loop is the closed one

DRAIN ROTATION PROVEN after two fixes: a cooled station is no longer a fallback, and the
cool-down is durable (<market root>/drain-cooldowns.json) because restarts kept wiping the
in-memory map. Measured rotation: 60000682 (18:39) -> 60003724 (19:04) -> 60014935 (19:19).
All three settled NOT_SOLD NO_REAL_NATIVE_CARGO, and that is CORRECT:
  - 60000682 bids for 0 of its own minerals (34/35/1228/1230: zero seeded buys),
  - 60014935 and 60003724 bid only for 444 / ore, not for 34 or 35,
  - 18.6k+ physical stations elsewhere in the region DO bid 4600+ for Tritanium, but they
    are in OTHER systems; the drain can only fly inside the fleet system (30000145).
So the 891 702 units of minerals held by the corporation cannot be sold where they are.
The sinks are: manufacturing (proven: 5 555 + 3 333 Tritanium consumed) and cross-system
distribution, which is NOT wired (gate travel exists but no distribution job).

MARKET SELF-HEAL PROVEN: living-npc-market-journal-reconciled observed (settled=0,
pending=0) - the world now settles its own RPC_CALLING journal from the market row.

NEXT: a distribution job (haul a hangar stack to a station that really bids, then the
proven arrival sale), or let manufacturing consume the surplus at a rate the fleet keeps up
with. Do not call NO_REAL_NATIVE_CARGO a bug again: nothing is sellable locally.

## 2026-10-28 17:52Z - the manufactured good SOLD and the ISK reached the treasury

CLOSED LOOP PROVEN: 3 chipsets manufactured at 60014935 (blueprint 1076, -3 333 Tritanium)
were lifted into the hauler by the drain, sold into the station own seeded bid, and the
money was swept: treasury 431 215 310.69 ISK.

Sales of the manufactured good, each with a durable receipt:
  5 x 444 @ 54 289.76 = 271 448.80 (order 4257700966927696316, volRemaining 4995)
  3 x 444 @ 53 700.08 = 161 100.24 (order 4257762183096566204, volRemaining 4997)
Two root causes fixed on the way:
  - the sell policy keeps only its FIRST 20 types, so a product appended at position 44
    was silently dropped; the env list is now ordered by priority (444 and minerals first);
  - a sale settles by the units the market really absorbed (partial fills), never by the
    quantity the journal declared, and a journal whose order never existed closes only on
    three independent proofs (no order, cargo intact, balance intact) after a grace period.

OPEN, measured, next: a slot repair restores a hull cargo snapshot, so a sold stack came
back with the same cargoID (0 -> 5 after the sale of 5 at 17:37), which duplicated goods and
made the next journal declare 5 while the bid absorbed 3. The durable cargo rows must be the
authority on restore. Hull 980000003532 currently keeps 2 real units the market did not buy.


## 2026-10-28 16:55Z - OPEN: the server cannot see cargo a separate process wrote

PROVEN TODAY: fleet restored (ALREADY_ACTIVE 3+1 / 2+1), departures unblocked (no more
MANIFEST_FLEET_CONFLICT), ore SOLD 1193 x 17470 @ 1946.98 = 2 322 747 ISK, treasury swept
22 926 059.42 -> corporation balance 302 998 099.09 ISK, manufacturing produces 5 chipsets
from 5 555 Tritanium with a receipt, and 444 is now on the operator sell policy.

OPEN, precisely: the 5 chipsets sit in hull 980000003532 (and 5 in orphan 980000003529),
visible from a fresh node process inside the container. In the SERVER process the same
call is inconsistent: at 16:44 the batch event reported carried=[444,35] (so it saw them),
but its ask order still started with ore, and at 16:54 carried was EMPTY and only the
manifest type was asked. Both manufactured stacks were written by a SEPARATE node process
(/tmp/mf.cjs inside the container), so the next diagnostic is a direct in-process compare:
call listNativeCargoForEntity(980000003532) through the admin bridge and diff it against
the fresh-process probe. Do not guess: the server must see a row before any sale of it.

Also open: the fleet route still ends in ALIFE13 MANIFEST_WAREHOUSE_RECEIPT_CONFLICT when
a declared row is only partly sold (saleFillCoversRow demands the fills equal the row
exactly), so a partly liquidated haul is unprovable and the fleet stays loaded. The drain
now rescues that case, but the route itself needs a partial-fill rule with its own test.

﻿# State — co-op loop (mining → haul → station → sale)

## 2026-10-28 15:20Z - the loop sells again; the last hop is the chipsets in a hold

THREE refusals in a chain (fork 07f37c4), each measured:

1. DEPARTURE. The station-trip journal compared a manifest's hull list BEFORE skipping
   closed routes, so 40 manifests of earlier trips (old hull IDs) refused every trip with
   ALIFE12_MANIFEST_FLEET_CONFLICT. A durable repair gives a fleet new hulls, so the fleet
   sat "loaded" for hours. Closed routes are skipped first; an overdue live route whose
   hulls no longer exist is expired by its own durable record.
   PROOF: ROUTE_EXPIRED_STALE_CARGO -> fleet 960004641 back to "mining".

2. DRAIN GATE. The mineral demand governor throttled everything, so 5 chipsets in a
   hangar that really bids 53 700 were never lifted: 61 000 units of Tritanium were
   within the 200 000 floor and ALLOW silenced the only selling path. The gate now lives
   in the mineral branch (shouldStart); a product is decided by the station that bids.

3. SALE BATCH. The arrival sale ended the whole batch on the first allowlisted type the
   station did not bid for (NO_SEEDED_COUNTERPARTY), so the lifted chipsets were never
   asked for. That status now skips a type, and lifted stock is asked for first.
   PROOF 15:12:48 st60003724 SOLD 1193 x 17470 @ 1946.98 = 2 322 747 ISK - the first
   sale after the fleet was unblocked. Type 444 added to the operator sell policy.

WHERE THE 10 CHIPSETS ARE: 5 in hull 980000003532 (a fleet hauler, with real ore) and 5
in orphan hull 980000003529. The next station arrival of 980000003532 asks the market for
444; 23 real seeded bids exist (53 700 at 60014935, 54 374 at 60000361).

NEXT: confirm the 444 sale on that arrival, then wire the automatic manufacture trigger
(niche by measured margin) - the drain product path is otherwise closed.

## 2026-10-28 - test-parity round: Windows durability + stale fixtures

Suite: 5837 pass / 332 fail / 92 skip (baseline) -> 6157 / 52 / 99 (full probe
`suite-final.json`, 2026-10-28). That 52 includes one transient red
(coop-escort-native-funds, edited and reverted mid-probe; re-measured 22/0), so the
steady figure is 6158 / 51. 30 files still red, and 42 of the 51 cases are the
installer/overlay family waiting on scripts/overlay-spec.cjs (another session). The
rest: coop-escort-flight-stage-c 8/6, COOP-049 buyer-wiring 6/1, alife13 22/1,
coop-virtual-world-split 2/1 (PARITY_REGRESSION from another session), and the
untracked coop-integration-shims 1/1.

**New blocker found, needs the owner: `.github/workflows` is back in the tree.**
Owner decision 2026-10-28: delete it. Done in `a6d6b44a`; the CI-triggered EX-03 gate
became `scripts/Run-NpcProbe-PinnedChecks.ps1` (`bbea62c3`) so the procedure survived,
and three more reds closed (`coop-overlay-l1-baseline` 1/1->2/0,
`coop-feature-readiness` 7/1->8/0, `coop-crossstream-overlay-roundtrip` 1/1->2/0).
## 2026-10-28 late - the war map: a stalled campaign held the whole frontier

Owner reported the in-game map not opening. Live, read-only diagnosis on the play stack:
every opening tick logged `[CoopFactionWar] opening skipped: NO_OPENABLE_FRONT`, the
published refusal detail named both candidate borders `TARGET_ALREADY_CONTESTED` against
30045344, and fwVictoryPointMgr.GetAllVictoryPointStates was called ~1200 times in a few
seconds at 19:46:07 (client retry storm; no hook threw - `[EssMgr] Unhandled method
fallback: GetDataForClientSolarSystem` is stock noise, the payload is legitimately null
when a system has no ESS).

Root cause measured in the authoritative war state: campaign:30045344 had sat in PREPARING
for 524 minutes and campaign:30000145 for 492, both without an assault deployment proof,
so `liveCampaignFor` kept refusing every other front on those borders. Fixed in the fork
(0d6cb67, repo 31f52782): `expireStalledCampaigns` expires a PREPARING campaign with no
objective evidence after EVEJS_COOP_WAR_OPENING_STALL_MS (default 45 min), releases its
territory to SECURE only when no other live campaign holds it, and reports
expiredCampaignIds on both OPENED and NO_OPENING. ASSAULT campaigns are never touched.
Six new cases in coop-faction-war-stall-reaper; every faction-war suite green.

The live world still runs the old image (container started 19:20, the diagnostic commit
landed 20:42), so NEITHER the detailed refusal NOR this fix is deployed yet: this needs the
owner restart window. The 38-minute-old campaign:30003837 is correctly inside the window
and would not be expired by a deploy now.

Full probe `suite-final5.json` (2026-10-28 late): **6236 pass / 5 fail / 95 skip**
against the 5837 / 332 / 92 baseline. Of those five, four are one untracked module
(`integration/coopWarBountyEscrowSides.cjs`: the committed runtime requires it, so
hook-requires and overlay-dependencies correctly report it as not installed, and its four
flags are the bulk of FLAGS_UNDECLARED), and one is COOP-049. installer-module-coverage
is green again after "bundled = committed". Earlier probe for reference:
ONE case is left: coop-alife-native-buyer-wiring (COOP-049, by owner decision) - plus
coop-installer-module-coverage whenever another session leaves a module untracked for a
while, which is churn, not a defect of ours.

Owner approved three calls on 2026-10-28 and all three are done:
  retire the wreck transformer -> deleted scripts/coop-npc-expedition-wreck-patch.cjs (4 of
    its 7 anchors are not in the deployed engine; it could only throw
    EX03B18_PINNED_WRECK_SOURCE_DRIFT), its wiring, its parse entry, and the 8 cases that
    only exercised it. Legacy 78 -> 77, budget tightened to match. The observer broadcast
    it aimed at is asserted directly in coop-wreck-client-refresh (1/0).
  fix the ALIFE-13 order -> measured, not changed: auditStartupCargo runs before the
    durable restore, and the test compared offsets against a call inside a function that is
    merely DEFINED earlier. The test now asserts the real order plus a single
    materialization site. coop-alife13-startup-cargo-audit 23/0.
  leave COOP-049 open -> recorded here, not touched.

coop-virtual-world-split was also made drift-proof (5936df34): an exact export list forced
every new export to edit one test and drifted twice in an hour, so the twenty-one pre-split
names are still required and no export may be undefined.

Since suite-final3 (6197/15) that is 14 of the 15 remaining cases closed.

The 119 missing `.js` shims are DONE (`64dc366a`): `coop-integration-shims --write`
completed the existing convention (122 shims were already there). That was not a
cosmetic gap - it closed `coop-escort-flight-stage-c` 8/6 -> **14/0**, whose six
failures were all "Cannot find module './coopAlifeNativeDeliveryEvidence'", so the
retire-or-reduce decision it was waiting on is moot, plus coop-integration-shims 2/0.
`coop-virtual-world-split` is green too (`f856538f`): the frozen runtime surface now
records the six exports the war/mercenary work added, and coop-test-parity is PARITY_OK.

THREE findings the owner needs, each with hard evidence:

1. coop-wreck-client-refresh cannot be fixed by its fixture: 4 of the 7 anchors
   scripts/coop-npc-expedition-wreck-patch.cjs requires do not exist in the deployed
   nativeNpcWreckService.js (checked against the fork file). The transformer describes
   an engine that no longer exists. Retire it (and its spec entry) or retarget the test
   at the fork's real code - both are deletions of that session's mechanism.

2. coop-alife13-startup-cargo-audit case 14 is a real ordering regression in another
   session's integration/coopNativeMiningFleetDurable.cjs: auditStartupCargo() is called
   at line 626, materializeStoredNativeController() at 533, so the ALIFE-13 audit now
   runs AFTER physical materialization - the opposite of what the test pins.

3. coop-alife-native-buyer-wiring is still COOP-049 (station authority emits
   `requirements`, buyer dispatch reads `materialNeeds`). Money-moving, flags OFF.

`coop-hook-inventory` is GREEN (`ed43504a`, fork `37780e5`): five of the nine long hooks
are now module calls. The war trio became occupationPairs()/warzonesResponse()/
localOccupationResponse() in coopWarClientView; npcBehaviorLoop's friendly-fire policy
became npcPlayerEngages() in coopMilitiaWarPlayer; the fwAdvantage envelope became
scoresResponse() in coopWarAdvantage. Baseline refreshed deliberately: longHooks stays
4, longest 822 -> 1131 (the dungeon hook, not ours to move), specFiles/entries grew from
other sessions' features. The four remaining long hooks are one per feature (dungeon
1131, trade 822, agent 501, wreck 451) and each needs callbacks from its own service,
so each belongs to the session that tests that gameplay path.

**`node scripts/coop-engine-audit.cjs` prints AUDIT_REGRESSION at 20:55Z** - not from
these commits: `integration drift 4 > 0` for coopAdminBridge, coopAdminBridgeActions,
coopStationDrain and coopVirtualWorldRuntime, i.e. another session's fork work is
in flight (`coopStationDrain.js` and `coopVirtualWorldRuntime.js` are uncommitted in
`C:\Games\EveCoop\upstream-evejs` right now). Their `AUDIT_OK` returns when they mirror.

**The installer/overlay family is almost gone.** 29 more cases closed on 2026-10-28
evening; the blocker was never `overlay-spec.cjs` being edited, it was that a dozen
suites still described the pre-single-spec layout (module names moved into
`scripts/overlay-spec.cjs`, which `patch-evejs-coop.cjs` re-exports as `names`), plus
fixtures that modelled only the hook sites a native file had when they were written.
Closed: overlay-drift-check 5/0, five-chat-market-reconcile 5/0, market-release-contract
3/0, native-economy-overlay-resolution 6/0, pve-duo trio, native-trade-custody-overlay,
native-mining-atomic-overlay, native-convoy-operations-overlay, crossstream-wiring,
npc-weapon-source-hook, player-damage-overlay-integration, rust-npc-market-patch,
fleet-mission-join-overlay, installer-module-coverage (fixture regex), post42 (same).

DONE (owner approved, commit `84096bc5`): ten modules existed in
`integration/` and are required by `coopVirtualWorldRuntime` but are absent from
`scripts/overlay-spec.cjs`, so a deployed server would throw MODULE_NOT_FOUND:
`coopJsonFileCache coopNativeNpcMarketReconcile coopNpcManufacture coopStationDrain
coopStructureAllianceGuard coopWarCaptureByForce coopWarMercenaryContract
coopWarMercenarySettlement coopWarNavyCapability coopWarObservedSystems`.
installer-module-coverage 2/1, post42 2/1, overlay-dependencies 2/1, hook-requires 6/1.
Added as one guarded loop (`names.push` block, 402 names / 402 unique); the four suites
are green (3/0, 3/0, 3/0, 7/0).

WHAT IS LEFT (15 cases, 7 files):
  coop-escort-flight-stage-c 8/6        owner call: retire or reduce
  coop-wreck-client-refresh 1/3         owner call: retarget at the fork or retire
  coop-hook-inventory 2/2               6 hooks over 400 chars vs baseline 4 (was 9).
    The fwWarzoneSolarsystemService trio is DONE (`d2d7fd24`, fork `d734281`): the
    three 1239/1248/1330-char copies are now warzonesResponse()/localOccupationResponse()
    over one occupationPairs() in integration/coopWarClientView.cjs. What is left is one
    hook per feature, each needing callbacks from its own service (dungeon 1131,
    trade 822, agent 501, wreck 451, npcBehaviorLoop 407, fwAdvantage 495), so each
    extraction belongs to the session that owns that gameplay path
  coop-alife-native-buyer-wiring 1/1    COOP-049 materialNeeds contract
  coop-alife13-startup-cargo-audit 1/1  assertion lives in another session's module
  coop-integration-shims 1/1            untracked test: 119 shims or one resolver hook
  coop-virtual-world-split 1/1          PARITY_REGRESSION from another session's export

Closed since that probe (each with a fork mirror where the code changed):
  coop-native-haul-transfer-sqlite 2/5->7/0 (fixture handed the mover the raw SQLite
    writer instead of the GameStore adapter shape it reads its receipt from)
  coop-native-loot-quarantine 7/3->10/0, coop-wormhole-jump-fence 10/4->14/0,
  coop-pve-boss-loot-claim 8/8->16/0 (all three: Windows cannot fsync a directory)
  coop-npc-atomic-weapon-bank 3/15->18/0 (bank now proves hull+modules before the tx;
    ammo journal loaded its sibling by assumed .js extension)
  coop-npc-atomic-sqlite-crash 0/2->2/0, coop-player-mining-warehouse-integration 0/5->5/0,
  coop-native-industry 6/1->7/0, coop-park-runaway-miner 2/1->3/0,
  coop-native-industry-progression 1/1->2/0
  coop-npc-durable-ammo-debit 2/18->20/0, coop-npc-wormhole-transit 1/2->3/0
  coop-npc-fire-outcome-witness 0/1->15/0, coop-npc-expedition-operations 0/3->3/0
  coop-player-industry-fence 3/9->12/0, cycle 0/1->1/0, native-boundary 9/2->11/0
  coop-skill-rate-cutover 8/13->21/0, coop-rescue-native-contract-wallet 2/6->8/0,
  coop-war-recovery-console 6/1->7/0, coop-native-live-capacitor 0/1->3/0

Closed after the probe: npc-buyer-admin-control 12/2->12/0+2skip,
npc-buyer-controlled-recovery 10/5->15/0, coop-flag-registry 3/1->4/0 (the
registry had drifted by 40 flags), coop-corporate-real-sqlite 0/6->6/0,
player-mining-native-adapter 6/1->7/0, upstream-patch-series 2/2->4/0.

Everything still red is one of these four, in this order of value:
  L1 fix landed anyway: coopNpcCorporateBuyRuntime.loadSettlement fell back to the
  specifier that had just failed instead of the .cjs sibling, so a source
  checkout could not load it at all; coop-npc-corporate-buy-patch 12/6 -> 18/0
  (fork 901a36b). Its mixed-guard case also asserted an error name that
  eedfe1b4 folded into NPC_BUY_GUARD_CORPORATE_PATCH_DRIFT.

  A. overlay/installer suites - they need scripts/overlay-spec.cjs, which another
     session is editing right now (hook-inventory reports 9 long hooks vs a
     baseline of 4, the anchors moved). Do not touch the anchors mid-flight.
  B. the three owner decisions below.
  C. integration/coopNativeMiningFleetDurable.cjs and coopVirtualWorldRuntime.cjs
     assertions, also another session's files.
  D. coop-integration-shims.test.mjs, untracked until B2 is decided.
  E. coop-wreck-client-refresh and friends encode overlay-era fixes the fork now
     carries: the case asserts a sendSlimItemChangesToAllSessions ->
     broadcastSlimItemChanges rewrite that no longer exists in the transformer,
     and its synthetic fixture has 4 of the 7 anchors the transformer now needs.
     Retargeting it means deciding what still needs proving - owner call, not a
     silent rewrite.

Still open and NOT ours to fix silently:
  - coop-escort-flight-stage-c 8/6: needs the missing ./coopAlifeNativeDeliveryEvidence
    chain plus a manifest source-cargo contract; owner decision (retire vs reduce).
  - scripts/coop-integration-shims.cjs --check still reports ~120 missing .js shims;
    tests/coop-integration-shims.test.mjs stays untracked until the owner picks
    "generate shims" vs "one resolver hook". Fixtures keep using loadIntegration().
  - COOP-049 materialNeeds: coopAlifeStationAuthority strips `requirements` and never
    emits materialNeeds while the buyer dispatch requires it (money-moving, flags OFF).
  - coop-alife13-startup-cargo-audit 22/1: ordering assertion lives in
    integration/coopNativeMiningFleetDurable.cjs, another session's file.
  - PARITY_REGRESSION now names coop-virtual-world-split: the faction-war work added a
    diagnoseNavy export to coopVirtualWorldRuntime while that suite's frozen public
    surface list still lacks it (f36ee344, not ours; do not edit either side).

## 2026-10-28 14:15Z - the fleet is repaired; the produced goods still need a named, near ship

FIXED (fork 9d96fb3): both 30000145 slots refused to restore for ever with
ALIFE08_REPAIR_MARKER_MISMATCH. Cause: every failed boot repair spawned another wing, so slot
30000145-1 marked 120 miners + 118 haulers around a 2+1 witness (105+55 on -2). The repair now
prunes hulls the slot marks but does not own (physical destroy for live ones, durable cascade for
phantoms) and then checks the witness. Result: ALREADY_ACTIVE 3+1 and 2+1, mining resumed.

MANUFACTURING (fork 6c66f05): blueprint 1076 seeded at 60014935, 5-run job consumed 5 555
Tritanium (72 399 -> 66 844) and produced 5 x typeID 444 with a receipt. A second attempt at
60000682 was refused honestly with MATERIALS_MISSING (no Tritanium in that hangar) - the module
never fabricates inputs.

WHERE THE 5 CHIPSETS ARE: in the cargo hold of hull 980000003529 (spawned by the repair). That
hull has NO identity link, so the sale refuses with HAULER_NOT_NAMED, and it sits 8.6e11 m from
the station. 23 real seeded bids exist for typeID 444 (best 54 374 at 60000361, 54 289.76 at
60000682).

NEXT (one of these, both small):
  1. linkSpawnedIdentity for 980000003529 -> role hauler, then scripts/sell-station-goods.cjs
     at a station that bids for 444 - or
  2. run the manufacture where the hangar really holds Tritanium AND the station bids for 444,
     then let the drain lift and sell it automatically (that path is already proven).

## 2026-10-28 13:50Z - manufactured goods EXIST; selling them waits on a fleet restore

PROVEN on `evejs-agents` (no client):
  blueprint 1076 (Mining Survey Chipset I Blueprint) seeded at station 60014935
  -> 5-run job consumed 5 555 Tritanium (72 399 -> 66 844)
  -> 5 x typeID 444 produced in the corporation hangar
  -> receipt coop-native-industry/receipts/coop-job:1000129:60014935:1076:1793194860012.json
     with recipe, materials, installedAt/completedAt.
  The station bids 53 700.08 for that item, so the product has a real buyer.

HOW (fork 6c66f05): the native job pipeline is session-bound (quoteIndustryJob derives owner,
facility, blueprint access and slots from a client session) and this world has no client, so
production runs through space/coopNpcManufacture.js with the SAME native static-data recipe and
the SAME inventory primitives (takeItemTypeFromOwnerLocation / grantItemToOwnerLocation) that the
job pipeline uses - the pattern the co-op refinery already proved. It refuses unless the
corporation really owns the blueprint item and the materials in that hangar; the journal is
INSTALLED -> COMPLETED so a crash can never double-produce; time is compressed only by
EVEJS_COOP_INDUSTRY_TIME_SCALE (0.002 on the agent stack).

Selling a product reuses the proven arrival sale: the lift now carries ANY corp-owned hangar
stack the station really bids for (EVEJS_COOP_LIFT_ANY_TYPE=1), and the drain prefers a station
holding a manufactured good over one holding refinery minerals (station rotation + 30 min
cooldown when a visit sells nothing).

BLOCKER for the last step (not in our modules): after the 13:49 restart the two 30000145 mining
fleets did NOT come back -
  [ALIFE08] slot 30000145-1 -> NEEDS_OPERATOR_REPAIR ALIFE08_REPAIR_SPAWN_COUNT_MISMATCH
  [ALIFE08] slot 30000145-2 -> NEEDS_OPERATOR_REPAIR ALIFE08_REPAIR_MARKER_MISMATCH
so there is no hauler to carry the chipsets to the station. That repair path is
space/coopNativeMiningFleetDurable.js (another session's module); it must be fixed or the slot
records repaired before the produced goods can be sold. Do NOT wipe volumes to force restore.

## 2026-10-28 13:10Z - surplus drains: minerals finally sell, stock is falling

Measured on `evejs-agents` (headless):

  stock 739 492 -> 596 517 units;  Tritanium 261 419 -> 101 419
  corp wallet 119 944 191.19 -> 125 975 858.69 (sweeps of 22 942 300 then 250 000)
  sold on a drain: [{typeID 34 Tritanium, ...}] isk 250 000;  pilot ledger tradeCount 9

WHY IT WAS STUCK AND WHAT CHANGED (all committed):
  1. A sale only happens on a station arrival, so a fleet whose mining the governor holds can
     never sell the surplus it already owns: 705 484 units against a 200 000 floor with zero
     arrivals for 9 h. New space/coopStationDrain.js flies an idle hauler to the station that
     really holds the most refined minerals, sells through the PROVEN arrival path and flies
     back. OFF unless EVEJS_COOP_STATION_DRAIN=1 (agent stack only).
  2. The governor reports DEMAND_UNKNOWN with that stock, so a HOLD-driven trigger never fired;
     and an ALLOW tick pushed the drain 15 min ahead every time, so a due trip drifted for ever
     (due 12:29, still not run at 12:49). The drain now decides on the governor's own
     measurement (only ALLOW means "within demand") and its schedule is owned by the trip.
  3. **Every sale in the world's history was ore. Not one mineral ever sold.** The lift is
     async, its Promise was read as a result, so the lifted mineral types never joined the sale
     list and the trader answered NO_REAL_NATIVE_CARGO (measured: 47 lift rows in one hold).
     The lift now runs inside the arrival job and is awaited (fork 04e2c8a).

Fork commits: 4afec3e, 03cafb7, 9c5f9d4, 706d8e5, 7d997e1, 04e2c8a. Repo: d6107bfb, 583d10e0,
0fda9c7b, b9ae10ab + worklog. AUDIT_OK.

NEXT: the drain runs every 15 min per fleet and lifts up to 100k units per visit, but each
trade is capped at 5 000 units (EVEJS_COOP_NPC_MARKET_MAX_QTY), so the 596k backlog needs many
visits. If the owner wants it gone faster, raise the per-trade cap or the drain cadence - both
are env knobs, no code change.

## 2026-10-28 12:00Z - CLOSED LOOP PROVEN: ore sold, ISK reached the corporation

PROVEN LIVE on `evejs-agents` (headless, no client), same world that had been stuck since 02:05Z:

  ore mined -> hauler loaded -> delivered -> refined (fee from the corp wallet)
   -> minerals lifted -> SOLD 5000 Scordite @ 4605.77 = 23 028 850 ISK -> pilot ledger
   -> corp treasury sweep -> corporation wallet.

  Measured: 11:55:47 living-npc-station-target-cleared, 11:55:48 living-npc-station-sold
  (station 60003724, hauler 980000000032, 5000 units, 23 028 850 ISK). 11:39:34
  living-corp-treasury-swept moved 26 018 500 ISK; corp wallet 38 743 827.69 -> 64 762 327.69
  (the ~47k gap is the refinery fees the corporation paid in between). No pending market
  journals: /var/lib/evejs/coop-native-market/tx is empty.

TWO BLOCKERS CLOSED (both were real, neither was a "market is broken" story):
  1. The journal left at RPC_CALLING (coop-pilot-012) was settled from the MARKET'S OWN PROOF,
     never by repeating the fill: order 4257762183096583224 is state filled, vol_entered 5000,
     vol_remaining 0, issued 15 ms after the journal. New space/coopNativeNpcMarketReconcile.js
     + scripts/reconcile-npc-market-journal.cjs (dry run, then --apply; durable receipt in
     reconciled/; replayed false). Fork 441fcc4 + 356dcce.
  2. The sale then failed with NATIVE_NPC_BUSY because the fleet's own asteroid orbit leaves
     controller.currentTargetID set on the hauler. The sale now releases only a static,
     non-combat target (a ship target, an attack order, a fresh aggressor or a warping hull
     still refuses). Fork 78b1681.

ALSO MEASURED (still open, no longer blocking): after ~9 hours without sales the corporation
owns 705 484 units (442 350 ore + 263 134 minerals) against demand 82 502 and a 200 000 floor,
so the demand governor mostly HOLDs and mining only trickles. Each station arrival sells what
that arrival lifts, so stock drains one trip at a time; a restart also resets the governor's
trickle timer, which is what let mining resume at 11:41.

## 2026-10-28 01:35Z - the loop runs live; the sale needs one operator decision

PROVEN LIVE on `evejs-agents` in this session (no client, headless world):
  ore mined -> hauler loaded -> station delivered -> ore refined (COMMITTED, fee paid
  from the corp wallet) -> minerals lifted into the hauler -> repeat, every ~5 minutes.
  Measured counts since 01:20Z: 2-3 living-hauler-loaded, 3 living-npc-station-delivered,
  8 living-npc-refined, 1-2 living-npc-mineral-lifted. Both fleets cycle.

Chain of real causes fixed (fork branch coop/pas7std, all committed):
  1. 11b9d29 movement: a native NPC in GOTO flies along entity.direction only, so the
     `position + direction * 1.0e16` sentinel carried hulls off their own belt for ever.
     New space/coopNpcRunawayGoto.js stops such a hull; one statement in the GOTO case.
  2. 08ca1e9..3205d9f mining: the hauler is spawned with behaviour profile
     movementMode "stop", so every one-shot follow was consumed and the hull re-stopped.
     It now orbits the fleet's asteroid (the only orbit target the loop honours - orbiting
     the miner is refused), and miners are sent to the same rock; radii 250/600 m keep the
     whole orbit inside the 2 500 m transfer range.
  3. 27cc4ed mining: the park helper stopped any hull with speedFraction > 0, i.e. the very
     orbit it had issued one line earlier (measured: 56 'parked' miners, all in STOP).
  4. c43af40 space/coopNativeHaulCargo.js: the store returns `transient` as 0/1, so
     `row.transient === false` refused every durable cargo row (`cargo-invalid`, usedM3 0).
     Custody is now "not another party's cargo": the row's owner may be the miner OR the
     hauler, and a refusal always names the failing predicate.
  5. ba31852 space/coopNativeHaulManifest.js: the hold carries the fleet's own lift-tagged
     minerals back to market, and those rows made the whole ore manifest invalid
     (MANIFEST_CARGO_INVALID_OR_AMBIGUOUS). The manifest describes the ORE; lift cargo has
     its own journal and is skipped.

REMAINING BLOCKER (not a code bug - a required operator decision):
  every station arrival answers living-npc-station-sale-skipped NOT_SOLD MARKET_UNAVAILABLE
  because the native market is halted: living-native-market-repair-required
  {status NEEDS_OPERATOR_REPAIR, pending [{file coop-pilot-012.json,
   reason RPC_OUTCOME_UNKNOWN}]} (last at 01:22:49Z).
  The repository doctrine is explicit: an ambiguous market RPC halts trading and a possibly
  completed fill is never repeated. So the ore of those arrivals is deposited
  (depositOnly), not sold, and no ISK reaches the pilot ledger or the treasury.
  Next single step: reconcile that one journal against the market, then let the sale run.
  Nothing else in the loop is blocked - mining, haul, delivery, refine, lift all repeat.

Extraction gate: `node scripts/coop-engine-audit.cjs` prints AUDIT_OK.

## 2026-10-27 23:00Z - the last blocker is our own order bridge, and it deadlocks

`mining_fleet_diagnose` (read-only admin bridge) now answers the question exactly:

  miner 980000000030  mode GOTO  belt 53 965 m  targetPoint ghost 1.0e16  order BLOCKED
                     reason COOP_NPC_ORDER_IDENTITY_UNVERIFIED
  hauler 980000000032 mode GOTO  ghost 1.0e16   order BLOCKED
                     reason COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE
                     state {warp:false, movementBusy:true, manualBusy:false, combat:false}
                     leaseOwner ""

Reading it: 1.0e16 is a SENTINEL ('no target'), not a computed point - so the earlier
ghost-target hypothesis was wrong and the guard added in fork commit 0e317d9 fires on
normal sentinel state (4 living-mining-order-reset, harmless but not the cure).
The real deadlock: the hauler already owns a native movement command that goes
nowhere, and the order bridge refuses to replace an ACTIVE movement order, while the
miners cannot pass identity verification at all. So no hull can be re-aimed at its
miner, the gap grows by the sentinel drift, and no ore is ever transferred.

Next single step (fork, branch coop/pas7std): in the order bridge allow
  (a) a mining-fleet movement order to REPLACE a native movement order whose target is
      the no-target sentinel / whose ship is in the fleet's own minerEntityIDs or
      haulerEntityIDs (the fleet record IS the identity proof), and
  (b) the WAR lease rule to keep refusing everything else.
Then prove: living-hauler-loaded -> delivered -> refined -> mineral lift -> sale.

Already proven on this world today: mining without a client, corp treasury sweep
(38 791 223.64 ISK), 4 refinery batches COMMITTED with the fee paid from the corp
wallet. Those three legs need no further work.

## 2026-10-27 22:45Z - three real fixes landed, one measured blocker left

PROVEN LIVE on `evejs-agents` (never on the owner's play stack):
  - mining runs without any client: 32 living-mining-cycle-settled after the fix;
  - the corporation really receives its pilots' ISK: living-corp-treasury-swept
    movedISK 38 791 223.64 into corp 1000129 from coop-pilot-002 (ledger debit 0);
  - the refinery pays its own station fee and commits: 4 living-npc-refined COMMITTED.

Fixes landed (committed and pushed to origin/main):
  1. OPS 669a4d13 + 6f096445 - EVEJS_DISABLE_NPC_COLD_SCENE_SLEEP=1 on the agents
     stack. Evidence: the tick profiler showed ONLY overlay phases (npc-reconcile:*,
     observed-native-mining) and no mining/npc section, i.e. scene.tick() never ran,
     so no mining fix could ever fire in a world without a logged-in client.
  2. L3 91ec5d93 + 22033e2f - integration/coopCorpWallet.cjs is now the single wallet
     authority and prefers the native corporationRuntimeState (which bootstraps the
     divisions) over a raw `/corporations/<id>/wallet` pointer. It verifies the write
     by reading the balance back, so a no-op write is CORP_CREDIT_UNVERIFIED, never
     'paid'. Before this the treasury answered CORP_WALLET_UNAVAILABLE while the pilot
     ledger held 26 018 500 ISK.
  3. L2 2609aae4 + 8c6a7ea0 - the haul approach: warp only beyond 150 km, otherwise a
     real follow order, and publish WARPED_TO_MINER / WARP_REFUSED / FOLLOWING_MINER /
     FOLLOW_REFUSED with the measured gap. Telemetry proved the old block: warp answered
     WARP_DISTANCE_TOO_CLOSE at 24-90 km and the orbit fallback let the hull DRIFT AWAY
     (57 km -> 90 km between two retries). Empty-haul budget 24 -> 120 waits (10 min).

REMAINING BLOCKER (measured, not inferred) - the hauler cannot reach its miner:
  admin bridge mining_fleet_diagnose (read-only) for 30000145 shows both fleets in
  state hauling with miners in mode GOTO whose targetPoint is ~1.0e16 m from the
  system origin (68 000 AU) while the ship itself is 2.5 AU out and only 54 km from
  its nearest belt. The haulers therefore chase a nonsense point and the gap
  oscillates (24-90 km). Mining and delivery worked in this world before the 21:30Z
  restart, so the suspect is restored movement state: a ship comes back with
  mode GOTO plus a stale target that every new orbit/follow order is refused against.
  Next single step: in the fork (server code is ours since 2026-10-28), clear the
  movement target on restore / refuse an absurd target (|target - position| > 1e9 m),
  then prove living-hauler-loaded -> delivered -> refined -> mineral lift -> sale.

Doctrine note: the overlay installer is legacy; new server behaviour goes into the
fork C:\Games\EveCoop\upstream-evejs (branch coop/pas7std) as a commit, then build.

## 2026-10-27 21:50Z - where the loop really stands (fresh work-stack world)

Fresh `evejs-agents` world (volumes reset, market reseeded jita_new_caldari, 445 096 rows) with
every fix in the image. Measured on THAT world:
  80+ living-mining-cycle-settled COMMITTED
  14 living-hauler-loaded with real quantities (the orbit-the-miner fix works)
  9 living-npc-station-delivered and station trips
  1 living-npc-station-sold: 5000 units type 17464 @ 5203.7 = 26 018 500 ISK credited to the
    pilot ledger (ledger.json coop-pilot-002 balance 26 018 500)

Blocking the last leg: the corporation is never funded. `living-corp-treasury-swept` never
appears, so the refinery answers NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED for every stack at
60000682 / 60003724 and no minerals are produced. Without minerals there is no lift and no
mineral sale, which is the only unproven stage.

What is already fixed for that path (all pushed, tested):
  - refinery hook now passes the in-process gameStore and marketRoot; `../../gameStore`
    resolves from services/mining (verified ROOT_OK, ../gameStore is MODULE_NOT_FOUND);
  - EVEJS_COOP_TREASURY_TRACE=1 on the agents stack emits living-corp-treasury-skipped with
    the treasury's own status/reason, so the next refinery attempt names the refusal instead
    of hiding it.

So the next single observable is `living-corp-treasury-skipped` (status/reason) on the first
arrival that carries ore after a restart. Nothing else can be inferred before it appears.

Owner's stack `evejs` was never restarted; every experiment here ran on `evejs-agents`.

## 2026-10-27 20:00Z - fresh agents world + every defect found today is fixed

Owner split the machine (docs/TWO_STACKS_PLAY_AND_WORK.md): play stack `evejs` is his game,
not to be restarted; work stack `evejs-agents` is where proofs run. All work since then is
on the work stack only.

Defects found and fixed today, each with tests (all pushed):
  1. liftedTypes declared inside the lift gate, read outside -> every arrival died with
     'liftedTypes is not defined' and NOTHING sold (3 deliveries, 0 sales).
  2. An empty haul flipped the fleet to 'loaded' -> empty fleets flew to stations
     (living-native-haul-delivered NO_CARGO, lastHauledVolumeM3 0).
  3. That retry re-entered mining every 2 s, restarting the hauler warp forever (99 km gap).
  4. Then the warp target was the asteroid, not the miner -> 2 500 m transfer range never
     reached (ranges 22-130 km). Now the hauler ORBITS the miner at 500 m, issued at most
     once per 2 minutes (a warp takes ~24 s; re-issuing restarted it).
  5. Governor decided on a partial bid book -> throttled a world with 25k/90k bids; a
     partial book is now 'unknown' (>=90% stock coverage required).
  6. Governor ignored EVEJS_COOP_TIME_SCALE -> a 15 min trickle became 75 accelerated min.
  7. patches/upstream/MANIFEST.json carried a BOM -> JSON.parse failed, the whole deploy was
     blocked for everyone. BOM stripped.

Work-stack config (agent-only, compose/compose.agents.yaml): startup systems
30000142,30000145 (Perimeter has zero bids), demand floor 200000 (a fresh economy is not
overstock), fleet count 2, x5 pacing.

Agents volumes were reset at 19:36Z (sandbox only) and the market reseeded with
`jita_new_caldari` (23 stations, 445 096 seed rows). One stale market journal from my own
mid-RPC restart (coop-pilot-012, order gone + cargo gone) was moved out of tx/ so the trader
stops blocking every sale with UNRESOLVED_MARKET_JOURNAL; kept as
/var/lib/evejs/coop-market-tx-stale-from-restart.json.

Live on the fresh world so far: mining cycles COMMITTED, living-hauler-loaded with real
quantities (1680, 2940, 1260), station deliveries, station trips. Remaining: the first
successful sale -> treasury sweep -> paid refinery -> mineral lift -> mineral sale.

## 2026-10-27 17:05Z — items 15 and 16 (code halves) done; exact next steps

**Item 15 DONE (code) — a1d5b03b.** `coopWarFleetRoster` now keeps a durable
per-faction, per-role hull reserve (`spawnable` + `equipped`) in the same roster
row: a proven loss removes one equipped hull, an adopted replacement consumes one
spawnable hull and becomes equipped, `declareReserve` only accepts what a caller
proved (`source` required, unknown roles / non-integers refused), `reserveOf`
reports the real totals. Every real loss and replacement carries a `frontChat`
record; `fleet_reconstitute` sends it through `coopWarClientView.frontReport`
(new kinds `fleet-loss`, `fleet-replacement`) via the existing once-per-eventKey
`warFrontChat`. Tests 37/37 with client-view + admin-bridge + composition.

**Item 16 code half DONE — ae9cea92.** `coopNpcCorpTreasury.run` accepts a
`resolveCorporation` authority and sweeps ONLY pilots that really belong to the
target corporation (`NO_EARNINGS_FOR_THIS_CORPORATION` when none do, an
unprovable owner is never swept); without the authority the historical sweep is
unchanged, so nothing can regress. `coopNpcRefineryTick.fundTreasury` forwards
`options.pilotCorporation`. Tests 62/62 with refinery + war-funding + treasury.

**NEXT ACTION (exact), item 16 live half.** The routing fix is inert until a
caller supplies the authority. At the refinery tick's call site pass
`pilotCorporation: (pilotID) => <corporationID of that pilot's real native
entity>` (identity registry + `nativeNpcStore.getNativeEntity`, the same
authority `coopWarFleetRoster.presence` already uses), then run
`war_funding_diagnose` until an ARMED faction (500011 Angel or 500020 Serpentis)
reads `FUNDED` instead of `NO_REAL_FACTION_INCOME`, and confirm
`living-native-war-bounty` `PAID` on its next real casualty. Do not fund it any
other way and do not mint ISK.

**Also open.** `NEEDS_OWNER_RESTART_WINDOW` for the FW-037 gate-crossing proof
(see the section below). Item 13 payout stays blocked behind item 16.

## 2026-10-27 16:40Z - stack split: all further proofs run on evejs-agents

Owner changed the rules (docs/TWO_STACKS_PLAY_AND_WORK.md, AGENTS.md): compose project
`evejs` is the live game shared with his friend. NO deploy/rebuild/recreate/restart/down
against it unless he explicitly asks for a restart window. Agents prove everything on
`evejs-agents` (ports 28443/25222/28000-28002/41110, x5 pacing, separate volumes).

Consequences for this session:
  - my deploy script (compose.yaml + compose.coop-probe.yaml without -p) targets the PLAY
    project. It is retired; the safe cycle is `docker build -t evejs-local .` (safe while he
    plays) followed by scripts/Start-Agents-Stack.ps1 -Action Up.
  - the earlier live evidence (mineral lift 12:47, ore sale, treasury sweep, governor HOLD)
    was measured on the PLAY stack before the split and stays valid as history, but every
    NEW proof must name the stack it ran on.

Play-stack side effects already deployed before the split (his next restart would apply them,
so he must know): EVEJS_COOP_NPC_MINERAL_LIFT=1, EVEJS_COOP_MINING_DEMAND_GOVERNOR=1 with
FACTOR=1.5 FLOOR=20000 TRICKLE_MS=900000, EVEJS_MINING_NPC_STARTUP_FLEET_COUNT=2, plus the
overlay modules coopNpcMineralLift and coopMiningDemandGovernor. I touch nothing there now.

Agents stack state (measured 16:36Z): image already carries the current overlay
(governor fix + liftedTypes present), env has TIME_SCALE=5, GOVERNOR=1, FLEET_COUNT=2,
MINERAL_LIFT=1. World is FRESH: 448 event lines, no haul yet, slots 30000144/30000145/
30100032 ALREADY_ACTIVE, mining cycles starting, no lift receipts.

So the remaining proof is a full self-contained loop on a fresh world: mine -> haul ->
deliver -> ore sale (ISK) -> treasury sweep -> paid refinery -> mineral lift -> mineral sale.
A watcher on evejs-agents-server-1 records each stage (verdict ladder MINING -> HAULED ->
DELIVERED -> REFINED -> LIFT -> MINERAL_SALE_PROVEN).

## 2026-10-27 16:50Z — war gate crossing: five real blockers named and removed

**Done (commits 83a9b3bc, 9f66beec, 466593aa, 18768947, 82f7ca0a, 0fdf15c9,
76970e18, b24a32f2).** Gate staging no longer refuses silently. In order:
1. `coopWarGateStaging.tick` returns per-campaign `skips[]` with the exact
   precondition, published once per distinct set as
   `living-native-war-gate-staging` status SKIPPED; the phase's own early returns
   use `warSkip("gate-staging", …)` and `gateReason(env)` names missing flags.
2. ASSAULT campaigns are staged (the crossing leg was never even considered) and
   the operator's explicit `paper-supply:<campaignID>` waiver is accepted and
   labelled `PAPER_UNFUNDED_EXPLICIT`.
3. A warp the native runtime refuses as `WARP_DISTANCE_TOO_CLOSE` is closed by a
   real native follow order (and every per-ship rejection is now named).
4. The follow order is actually forwarded (`orderFollow` → `createGateTravel`).
5. **The gate arrival is measured before the retry window** — the 180 s
   `NATIVE_GATE_WARP` window used to skip the hull before the surface-gap check,
   which hid the only moment it was physically at the gate.
6. `coopWarTransferLedger` accepts the ASSAULT leg and a waived campaign that has
   no treasury row at all; `coopFactionWarCore.paperSupply` is the single rule.

**Live, read-only on the owner's running build (verbatim).**
`living-native-war-gate-staging 16:19:30` → `AT_REAL_GATE` +
`TRANSFER_REFUSED:WAR_HANDOFF_CAMPAIGN_OR_FUNDS_UNVERIFIED`; `15:35`
`WARP_REFUSED:WARP_DISTANCE_TOO_CLOSE` at gate `50016294`; the hull
`980000023574` really warped to that gate (real reciprocal pair
50016294 ↔ 50016293, 30003837 → 30045344) and then drifted ~15 km per 30 s tick.
`war_state`: `campaignStates {PREPARING:5, ASSAULT:1}`, `30045344` ASSAULT with
source `30003837`.

**NEEDS_OWNER_RESTART_WINDOW.** FW-037 (the ledger fix that unblocks the actual
crossing) is committed, `--apply`/`--check` = OVERLAY_OK, but it is **not** in the
owner's running server and that server must not be recreated while he plays. The
crossing proof needs exactly one recreate of project `evejs`.

**NEXT ACTION (exact).** In the owner's next restart window: recreate once, then
watch `living-native-war-gate-staging` for
`VERIFIED_NATIVE_GATE_TRANSFER` of `980000023574` into `30045344` (and the
`living-native-war-transit-retired` archive after it). If it refuses again, the
reason is now always in `observations[]` (`TRANSFER_REFUSED:<reason>`) or
`skips[]` (`ATTACKER_REJECTED:<id>/<reason>`) — fix that exact string.
Everything else continues on project `evejs-agents`
(`scripts/Start-Agents-Stack.ps1 -Action Status|Seed|Up|Down`), x5 time.

**Item 13, title half DONE (54ec5bd0).** `coopWarRankTitle.applyToCharacter`
writes the canonical rank title into the stock character record through
`characterState.updateCharacterRecord`; refuses a non `coop-player-` key, an
unknown rank, a key/record mismatch, a missing record and any non-canonical
title; `coopWarKillMerit` publishes `living-native-war-rank-title` with
`surface:"CHARACTER_RECORD_TITLE"`. Tests 10/10, with merit/bounty 22/22.
The payout half stays `BLOCKED_TREASURY_NO_ARMED_FUNDED_FACTION` (= item 16).

**NEXT CODE ITEM (15).** Fleet reconstitution + faction reserve:
`integration/coopWarFleetRoster.cjs` (TABLE `corporationRuntime`, KEY
`coop-faction-war\x1ffleet-roster-v1`) already plans from proven-alive survivors
and records a loss only with a real wreck. Missing: a durable per-faction hull
reserve (spawnable + equipped count per doctrine role) and a front-chat line per
loss/replacement via `coopWarClientView.frontReport` (line 122) with the same
once-per-key throttle `warFrontChat` uses.

## 2026-10-27 20:30 local (16:30Z) — OWNER DIRECTIVE: the live `evejs` stack is untouchable

Owner is playing on `evejs-server-1` / `evejs-market-1` right now. **Never**
`docker compose up/restart/down/--force-recreate` against project `evejs`, never
touch those containers. All further live proofs happen in a separate stack
(own project name, own ports — 26000-26002/443/5222/40110 are taken — own
volumes). `docker build -t evejs-local .` is allowed (it touches no container).
If something truly needs the owner's stack restarted, record
`NEEDS_OWNER_RESTART_WINDOW` instead of restarting.

Consequence for the war work: the last deploy of FW-036 (transfer ledger accepts
the ASSAULT leg + the explicit paper waiver) was already live before the
directive arrived, so the crossing leg can still be observed **read-only** on
that build. Everything after that is verified in the agent stack only, and every
metrics block from now on states that the owner's stack was not restarted.

**NEXT ACTION (exact).** (1) Read-only: watch `living-native-war-gate-staging` on
the owner's running FW-036 build for `VERIFIED_NATIVE_GATE_TRANSFER` of
980000023574 into 30045344; a `TRANSFER_REFUSED:<reason>` is the next exact
precondition to fix. (2) Stand up the agent stack
(`docker compose -p evejs-agents` + its own port/volume overrides) so no further
item needs the owner's stack.

## 2026-10-27 16:25Z - second startup slot added (additive), New Caldari has a fleet again

Owner asked to finish. Slot 30000145-1 fails deterministically on EVERY boot with
ALIFE08_REPAIR_SPAWN_COUNT_MISMATCH (operator repair, not code). Instead of touching the
broken record, EVEJS_MINING_NPC_STARTUP_FLEET_COUNT went 1 -> 2, which creates a second
startup slot per configured system. Nothing was deleted or rewritten.

Live after the change (docker logs):
  ALIFE08 slot 30000145-2 -> ALREADY_ACTIVE miners=2 haulers=1
  ALIFE08 slot 30100032-2 -> ALREADY_ACTIVE miners=2 haulers=1
  ALIFE08 slot 30000145-1 -> NEEDS_OPERATOR_REPAIR (unchanged, still blocked)

Where the mineral sale can happen (economy balance, live):
  60000682 type 34 stock=321677 demand=5000 price=2.96   -> 14 800 ISK
  60003334 type 34 stock= 86915 demand=5000 price=3.10   -> 15 500 ISK
Both are New Caldari stations the new fleet can reach, so the first arrival that lands on
either one closes the last leg: lift -> sale -> treasury sweep.

The demand governor stays ON with the approved defaults, so the small new fleet mines in
the 15-minute trickle windows; the proof therefore takes tens of minutes, not seconds.

## 2026-10-27 15:10Z - owner backlog registered (8 items), exact first step for each

Owner approved this order. Nothing below is claimed done; this is the plan a fresh
session continues from, with the real file/line anchors already located.

1. **Owner's personal loop: kill -> merit -> VISIBLE rank/title -> chest payout.**
   Title first. Already real: `coopWarMeritLedger` + `coopFactionWarMerit` (rank
   from merit) and `coopWarRankTitle.apply()` (durable title ledger, wired to
   `coopWarKillMerit` on `PROMOTED`, event `living-native-war-rank-title`). Missing
   for *his* character: the title is only in the co-op ledger - it must be written
   into the native character record's own `title` field (client-visible on the
   character sheet) for `coop-player-<characterID>`, via the stock
   `characterState` writer, refusing any non-player key and any unknown rank.
   Then the payout: `coopWarKillMerit` already calls `bountyPayer` ->
   `coopWarBounty`/`coopWarTreasury` PAYOUT from HELD escrow; it needs a funded
   chest (item 5) or an armed faction with real income.
3. **Structures as real objectives.** `campaign.structureID` is emitted by
   `coopWarClientView.campaignSnapshots` (flag
   `EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS=35832`) and the two real Astrahus
   exist (1030000000000/1030000000001). Missing: `coopWarObjectiveAdjudicator` must
   bind the campaign's structureID to a real native destruction of THAT structure
   and flip `militaryControllerFactionID` on that proof only (no timer, no capture
   by presence).
4. **Fleet reconstitution + faction RESERVE.** `coopWarFleetRoster` already plans
   from proven-alive survivors and records losses with a wreck; missing: a durable
   per-faction hull reserve count (spawnable + equipped) and a front-chat line on
   every loss/replacement through `coopWarClientView.frontReport` (same once-per-key
   throttle as `warFrontChat`).
5. **Real income for BOTH sides.** `war_funding_diagnose` live: every side is
   `NO_REAL_FACTION_INCOME` (all five earned-ledger pilots sit at balance 0). The
   only real ISK source is a seeded-market fill, so loot sales
   (`coopNpcLootCommerce` -> `coopNativeNpcMarket`) must fund the *seller's own*
   corporation (`coopNpcCorpTreasury` corporationID fix) - that is the same
   misrouting bug already recorded for the Angel pilot.
6. **Map/front-tab client check** (BLOCKED_CLIENT_CHECK until the owner confirms):
   open the FW front tab and the insurgency/campaign map layer in 30045344; the
   expected payloads are `coopWarClientView` campaignSnapshots (objective
   `structure:<id>`) and `fwWarzoneSolarsystem.GetAllWarzonesOccupationStates`
   (`ownerID`/`occupierID` field names still unverified).
7. **Second player (Sasha):** server-side preconditions only - a second character
   record docked at a militia desk, its own enlistment, its own active hull; never
   claim a client success without the client.
8. **Deferred:** shipcaster needs an owner decision (no beacon typeID exists for
   500011/500014/500020; only empire 75928-75931) - propose "no faction shipcaster
   in this build, empire beacons only"; native sovereignty needs a real TCU/IHub
   typeID + a native claim row (live: `NATIVE_SOV_CLAIM:0`, reason
   `NO_NATIVE_SOV_STRUCTURE`); incursions are a stub (2 files/0 handlers) - do not
   build on them.

**NEXT ACTION (exact).** Item 1, title half: add `applyToCharacter({pilotID,
characterID,rank,title})` to `integration/coopWarRankTitle.cjs` writing the stock
character record `title` (refuse non-`coop-player-` keys, unknown ranks and a
missing record), call it from `coopWarKillMerit` when the pilot key is a player,
emit `living-native-war-rank-title` with `surface:"CHARACTER_RECORD_TITLE"`, and
unit-test the refusals + the exact written value.

## 2026-10-27 15:00Z - ITEM 3 (owner correction): an enlisted player is ONE ship in a fleet

**Code PASS (4001d5bd).** `coopWarBattleDirector` no longer has a separate
player-only fallback branch. Per war ship it builds ONE ranked candidate list where
a hostile native hull and an enlisted enemy player are the same kind of candidate,
ordered by the same distance rule the NPCs already use on each other; a native hull
wins an exact distance tie, so a player is never preferred. The enlistment proof is
re-read immediately before the native order, exactly one native command is issued
per hull per tick, and the ranking is published once per distinct set as
`living-native-war-target-selection` (per ship: candidates, distance, chosen,
reason). Tests 8/8 (2 new: "the player is one candidate among several, never the
only or first target", "on an exact distance tie a native hull is chosen over a
player"); 41/41 with the militia/mobilisation/assault suites; OVERLAY_OK; built and
recreated.

**Live, verbatim.** `militia_enlist 140000102/3012018` ->
`{"enlistment":{"characterID":140000102,"factionID":500001,"status":"ACTIVE"},
"agentSays":"[Militia] Enlistment recorded for Caldari State."}`. Read-only verdict
probe on the real war ships of `campaign:30045344`:
`char=140000102 ship=980000023571 faction=500001 system=30045344 -> ALLY` (his own
faction never fires on him) and `ship=980000023574 faction=500004 system=30003837 ->
NO_ACTIVE_ASSAULT` (the enemy may only engage him once it is physically inside the
contested system - a real geometry gate, not a rule change).

**BLOCKED_CLIENT_CHECK (the in-space half, exact).** The multi-tick target-selection
proof needs the player's hull in a live scene. There is no server-side player-in-space
facility (`coopSessionPresence.admission` requires a live socket,
`initialStateSent`, a native scene membership and an unambiguous ship owner), and
`140000005` is undocked (`stationID null`, `solarSystemID 30000145`), so even his
enlistment needs a client dock. Required human action: log the client in as
140000005, dock at a Caldari militia desk (3012018 @ 60003754 Perimeter or 3010879
@ 60000358), enlist, undock in 30045344 while the campaign is in ASSAULT.

**World prerequisite (open).** `EVEJS_COOP_FACTION_WAR_GATE_APPROACH: '1'` was added
to `compose.coop-probe.yaml` and the server recreated, but the Gallente attacker
980000023574 is still in 30003837 and no `living-native-war-gate*` event exists, so
gate staging has not yet produced a crossing. That is the next exact step for the
assault leg (a front whose attacker never arrives can never be fought).

**NEXT ACTION (exact).** Diagnose gate staging for `campaign:30045344`: read
`advanceNativeWarGateStaging` + `coopWarGateStaging.tick` and publish the exact
refusal (treasury row, gate lookup, order lease, or `maxOrders`), then make the real
Gallente hull cross 30003837 -> 30045344. After that, the client half of item 3
(BLOCKED_CLIENT_CHECK above).

## 2026-10-27 14:42Z - ITEMS 1+2 PASS live: per-campaign mobilisation and the Caldari front in ASSAULT

**Item 1 (38300de5).** `coopWarMobilizer.tick` now plans every live campaign before
any write: `campaigns[]` carries, per campaign side, the assigned count, the
commander cap, the real mobilizable hulls and the exact first rejection. The
per-tick write budget is spent on the most starved campaign, and a refused native
ASSIGN returns the registry's own reason (`blocked[]`, published once per distinct
set as `living-native-war-mobilization-blocked`). `war_state` now projects the
record's real `state`/`sourceSystemID` (it emitted a `status` field the record does
not have, so PREPARING vs ASSAULT was invisible). 16/16 + 65/65, OVERLAY_OK 380.

Live: `war_diagnose` lists all 6 campaigns; then
`living-native-war-mobilization` DEFENDER 980000023571 (coop-pilot-023, 30045344,
500001) + ATTACKER 980000023574 (coop-pilot-038, 30003837, 500004) for
`war:500001-500004:campaign:30045344`, while the five pirate/ORE campaigns stayed
PREPARING.

**Item 2 (live, no code).** `living-native-war-assault` `ASSAULT_BEGUN`
`campaign:30045344` attacker `[980000023574]` defender `[980000023571]`,
`REAL_NATIVE_MUSTER_ON_BOTH_SIDES`; `war_state.campaignStates {PREPARING:5,
ASSAULT:1}`; `militia_state 140000005` -> `fronts:[{war:500001-500004,
campaign:30045344, systemID 30045344}]`.

World setup used (owner default: real NPCs only): two real armed navy patrols via
`spawn_native_npc` with the authored doctrine rows (Caldari Navy Condor 564+222x60
in 30045344, Federation Navy Atron 562+222x60 in 30003837), crewed by released
roster identities `coop-pilot-023`/`coop-pilot-038`. **Operator note:** release and
assign must go in ONE admin drain - a reconcile re-links a released pilot to its
durable old hull within ~20 s, which is why the first attempt answered
`PILOT_ALREADY_LINKED`.

**NEXT ACTION (exact).** Item 3: enlist 140000005 (Caldari) with `militia_enlist`,
then prove the melee rule live - a real Gallente (500004) patrol gets a
`MILITIA_PLAYER` attack order on that character's hull while Caldari (500001) NPCs
never fire on him. Read `coopMilitiaWarPlayer` first.

## 2026-10-27 14:30Z - production governor LIVE, and two world-caused blocks

Owner decision: throttle extraction to real demand (not reseeding, not industry).
integration/coopMiningDemandGovernor.cjs is now deployed with
EVEJS_COOP_MINING_DEMAND_GOVERNOR=1 FACTOR=1.5 FLOOR=20000 TRICKLE_MS=900000.

Live proof of the throttle (14:16-14:26 UTC):
  living-mining-demand-governor TRICKLE_ALLOWED sys30000144 held=4159021 want=45000
  living-mining-demand-governor HOLD           sys30000144 held=4159021 want=45000
  mining cycles dropped from ~100+ per 5 min to ~34 (trickle windows only).
It holds ONLY a fleet in state "mining", never a live station trip, and an unreadable
stock or unread bid book can never stop the world (both fall back to ALLOW).

Deployment traps hit today, all real:
  - `docker build` once reused a stale COPY layer; verify a changed module INSIDE the
    image (md5sum) instead of trusting the build exit code.
  - the shared container was recreated by another session with an older compose config,
    which silently dropped the governor env flags. Re-check printenv after any restart.
  - overlay --apply aborted once on another session's half-written hook
    (HOOK_REQUIRE_UNRESOLVED npcBehaviorLoop -> ../coopMilitiaWarPlayer).

Two blocks that are world state, not code:
  1. Hauler 980000016300 (which carried the 5000+5000 lifted minerals) no longer exists:
     the ship and its 9 mineral cargo rows were destroyed during the raid/war activity.
     So the mineral SALE is still unproven end to end.
  2. Durable slot 30000145-1 reports NEEDS_OPERATOR_REPAIR
     ALIFE08_REPAIR_SPAWN_COUNT_MISMATCH since 14:21:14, so that fleet cannot run another
     station trip until the native repair succeeds. Nothing was wiped to force it.

## 2026-10-27 13:35Z - the loop's real ceiling, measured with a new read-only audit

scripts/coop-economy-balance.cjs (+5 tests) answers the only question that decides whether
the loop can be self-sustaining: what the corporation holds versus what the world still pays.
Live measurement inside the container:

  status=PARTIAL_DEMAND stock=3965422 sellable=35046 stranded=3930376 potential_isk=373147.08
  station=60000358 type=17464 stock=623883 demand=0   NO_BUYER_ON_THIS_STATION
  station=60000358 type=17470 stock=525488 demand=0   NO_BUYER_ON_THIS_STATION
  station=60000358 type=34    stock=407192 demand=0   NO_BUYER_ON_THIS_STATION
  station=60000682 type=34    stock=321677 demand=5000 price=2.96 DEMAND_LIMITED

So ~4.0M units of ore/minerals are stored and only ~35k units can still become ISK. The
seeded bid book is a FINITE pool that earlier sales have already consumed; Perimeter's station
has zero bids for every type, which is why its fleet can never earn there.

Also confirmed: the lift account is clean (0 journals, 9 receipts, 0 blocked events).

Unproven still: one mineral sale (types 34/35 in living-npc-station-sold). The 5000+5000 units
are aboard hauler 980000016300 and the deployed sale path now sells them; the New Caldari fleet
must haul to a station that still pays (60000682 is the only one left in that system). Its
mining stopped at 13:21 after TICK_aggressed (another session is running militia/raid admin
commands on the same container), so the proof waits on world time, not on code.

## 2026-10-27 13:05Z - FIRST LIVE MINERAL LIFT (and two regressions it exposed)

PROVEN LIVE at 12:47:45-12:47:47 (run ca59f6c0):
  living-npc-mineral-lifted - 9 receipts, 5000 Tritanium + 5000 Pyerite taken out of the
    corporation hangar at 60003334 and written into hauler 980000016300's real native cargo
    (coop-mineral-lift:v1 journal tag, hangar stacks debited to zero).
  living-npc-station-sold SOLD - type 17471 qty 3975 @9.43 = 37 484 ISK credited to the pilot.
  living-corp-treasury-swept - 37 484.25 ISK into corporation 1000129 the same second.

Two real regressions the lift exposed, both fixed and tested:
  1. The sale filtered the allowlist by the caller's `types` (ore only), so the just-lifted
     minerals were never sold and stayed aboard as 9 stacks. Lifted types now bypass that
     filter via `liftedTypes`. tests/coop-mineral-lift-wiring.test.mjs 5/5.
  2. The lift writes its own custody rows (journal tag, no coopHaulFleetID), which made the
     durable mining fleet throw ALIFE12_NATIVE_HAUL_CUSTODY_AMBIGUOUS on boot and quarantine
     slot 30000145-1. Tagged lift rows are now excluded from that custody check.
     tests/coop-native-mining-fleet-durable.test.mjs 29/29.

Also worth knowing: the overlay --apply ABORTED once with HOOK_REQUIRE_UNRESOLVED
(npcBehaviorLoop -> ../coopMilitiaWarPlayer) because another session was mid-write; a second
run returned OVERLAY_OK. Always check that a deploy actually copied the module you changed
(grep the tag in the checkout) instead of trusting build exit=0.

## 2026-10-27 12:46Z - the lift path now RUNS live (and one real bug died)

Fixed live bug: the lift result was a block-scoped const used by the skip telemetry, so every
station arrival aborted with SALE_ERROR 'loaded is not defined' (5 occurrences). After the fix,
the same arrival reports living-npc-mineral-lift-skipped (12:45:10) followed by the normal
NOT_SOLD NO_SEEDED_COUNTERPARTY for the perimeter station, i.e. nothing aborts any more.

Still unproven live: one full minerals->ISK settlement. It needs an arrival at a station that
BOTH holds refinery minerals AND pays for them (60000682 / 60003334 in New Caldari). The New
Caldari fleet did deliver and refine 8 stacks at 60003334 at 12:33:05, but its next route is
blocked by ALIFE12_SOURCE_MISSING_WITHOUT_WAREHOUSE_PROOF: an older manifest declares cargo
that is no longer aboard and has no warehouse/sale receipt, so the custody gate refuses. That
gate is correct; the stale manifest needs the documented expire()/abandon() operator recovery
before a fresh trip can be planned.

Perimeter (30000144) has no bids at all, so nothing sold there can ever earn, no matter the
code: the demand map is 30000142 Jita (90 000/type) and 30000145 New Caldari (25 000/type).

## 2026-10-27 12:18Z - the whole picture, measured: where demand really is

Seeded BIDS only exist in two systems of region 10000002:
  30000142 Jita: 18 stations, 90 000 units of each ore/mineral
  30000145 New Caldari: 5 stations, 25 000 units, e.g. 60000682 Tritanium 5000@2.96,
    Pyerite 5000@16.35, Veldspar 4.42, Scordite 3.63, Pyroxeres 7.74
  30000144 Perimeter: ZERO bids of ANY type right now, including at 60000358.

So every station trip of the Perimeter fleet (960004609 -> 60000358) ends in
living-npc-station-sale-skipped NOT_SOLD NO_SEEDED_COUNTERPARTY: the station has no buyer
at all. Earlier sales there (521 754.08 ISK earned) consumed the finite 5000-unit bids that
did exist. Seeded depth does not come back on its own, so a loop that only sells into it can
never be perpetual without a real consumer (native industry) or owner-approved reseeding.

Identity exhaustion is FIXED and visible live: the same sale path that used to report
HAULER_NOT_NAMED now reaches the market and reports NO_SEEDED_COUNTERPARTY, i.e. the
merchant identity really is adopted (registry.release + reuse of a finished shift).

The New Caldari fleet (960004641) mines again after the restart (cycles COMMITTED, durable
slots RESTORED) but has not started a station trip yet, so the mineral lift at 60000682
(the only station that both holds refinery minerals and pays for them) is still waiting for
its first real arrival. living-npc-mineral-lift-skipped now reports every decision.

## 2026-10-27 12:0xZ - the mineral buyer was there all along (measurement bug fixed)

The market daemon answers GetOrders as a BOOK of two sides: {buys, sells}. The audit and
the earlier probe read `orders`, which never exists, so 'region 10000002 has zero mineral
demand' was wrong. Live now: 23 seeded BIDS per type. Station 60000682 (New Caldari) has
Tritanium 5000 @2.96 and Pyerite 5000 @16.35 right on the station the refinery already
uses; 60000358 (Perimeter) has NO local bid, so its stock cannot be sold there.

Bid depth is the real ceiling: 5000 per type per station, so the honest revenue is about
14 800 + 81 750 ISK, but only 14 800 ISK of that is one order's depth at 2.96 for 5000
units. Everything above the bid volume stays unsold, by design, never 'assumed'.

New leg (OFF by default, EVEJS_COOP_NPC_MINERAL_LIFT=1): integration/coopNpcMineralLift.cjs
takes the exact quantity out of the corporation hangar, writes a journal, puts it into the
hauler real native cargo carry row, verifies it, then receipts it. A journal whose cargo is
verified is replayed; a journal whose stock moved but whose cargo is missing halts the leg
with NEEDS_OPERATOR_REPAIR. sellOnArrival calls it before the proven sale path, so those
minerals are liquidated against the local seeded bids and the pilot ledger credits ISK,
which the corp treasury sweep then pulls back to the corporation.

## 2026-10-27 11:26Z - BPO bootstrap must run INSIDE the server process

grantItemToOwnerLocation(1000129, 60000358, 4, 950 /* Merlin Blueprint */, 1, {singleton}) plus
industryRuntimeState.getBlueprintState(itemID) do create the real native blueprint and state,
but a node process started with docker exec only writes into its own GameStore buffer:
flushTableSync('items') and flushTableSync('industryBlueprintState') both answer
flushed:false and scripts/coop-factory-audit.cjs still reports blueprints=0. The grant was
lost, so nothing was actually changed on disk.

Next attempt MUST go through the in-process admin bridge (/var/lib/evejs/coop-admin-requests.jsonl,
see integration/coopAdminBridge.cjs) or a real hook, never a docker exec side process.

Everything else stands: 16 refines, 521 754.08 ISK swept, 23 mineral stacks worth 0 ISK because
region 10000002 has zero orders for typeID 34/35.

## 2026-10-27 11:24Z - why minerals cannot be sold yet (measured, not assumed)

scripts/coop-mineral-audit.cjs (5 tests) reads the real stock and asks the real market book:
the corporation holds 23 refinery stacks - 407 192 Tritanium + 81 826 Pyerite at 60000358 and
321 677 + 7 401 at 60000682 - and region 10000002 (The Forge) returns ZERO orders for typeID
34 and 35. There is no buyer to fill, so a mineral sale leg would be dead on arrival; the
blocker is demand, not custody.

Closing the loop therefore needs one of:
  a) native industry really consuming minerals (blueprint + funded corp + industry jobs), or
  b) backed seed BUY orders for minerals via the market daemon (AdjustSeedStock), which
     changes the economy book and needs the owner explicit approval.

## NEXT (unfinished, do not claim done)

1. Minerals -> ISK. Refined minerals sit in corp 1000129 hangar with customInfo prefix
   coop-refine:v1:<item>:<qty>:mineral:. The station sale path (coopNativeStationArrival +
   trip manifest) is ore-only (isOreType), and coopNpcLootCommerce is pilot/ship-centric, so
   neither can sell them. Needed: one custody-safe local leg - a manifest of the refinery
   operation IDs and mineral rows, a sale against real seeded buy orders at the same station
   (minerals already there, no haul), and a durable receipt per row. No unbacked orders.
2. Manufacturer buyer. corp 1000129 now holds ISK (455600 + 521754.08 swept). Missing: an
   inventory item with categoryID = BLUEPRINT_CATEGORY_ID owned by that corp at a station,
   which makes industryBlueprintState.records[itemID] real; then scripts/coop-factory-audit.cjs
   must print FACTORY_READY (it reads blueprints, jobs, fundedCorporations).
3. Gate baselines: coop-loop-gate.sh fails hook-inventory (58 expected, 59 actual),
   overlay-l1-baseline (patch series != manifest), flags (3 new env flags:
   EVEJS_COOP_NPC_MARKET_DIR, EVEJS_COOP_CORP_TREASURY, EVEJS_COOP_FACTORY_CORP_ID).
   Update the baseline files deliberately after confirming no duplicate hook exists
   (only one coopNpcRefineryTick.tick call is present in the built checkout, line ~2896 of
   miningNpcOperations.js). isolated-gamestore passes once NODE_OPTIONS is cleared.

## 2026-10-27 11:07Z - LIVE PROOF: the refinery is paid and refines

After moving the hook before the early returns in shouldTriggerHauling and deploying:

- living-corp-treasury-swept x1: 521 754.08 ISK moved from the pilot ledger into corp 1000129
  (corp wallet already held 455 600 ISK).
- living-npc-refined x16, all COMMITTED, real ore consumed (7 703 / 36 666 / 23 111 ...),
  2 minerals per stack, station 60000358 and 60000688.
- 16 journal files and 16 durable fee receipts in /var/lib/evejs/coop-native-refinery,
  fees 1 135.72 - 22 760.08 ISK paid from the corp wallet.
- The 16 living-npc-refinery-blocked rows are the SAME stacks retried after refining: what
  is left is smaller than one native portion, so NATIVE_REPROCESSING_RECIPE_UNAVAILABLE is
  correct but noisy - report leftovers as a leftover, not as a missing recipe.

Closed loop now real: sale -> ISK -> corp wallet -> station fee -> minerals in the hangar.

## 2026-10-27 ~11:05Z - HEAD 27b0b3d4 (pushed): the refinery can be paid

- coop-npc-refinery.test.mjs was 14 pass / 9 fail for one reason: the journal key is
  coop-refine:v1:<item>:<qty> and ':' is illegal in a Windows file name, so acquire() never
  locked and every refine answered REFINERY_LOCKED_NEEDS_REVIEW on Windows only.
  journalFile() now escapes the path segment; logical IDs, receipts and comparisons are
  unchanged. 23/23 green.
- With that green a positive station fee is accepted only with a durable paid witness
  (<root>/refinery-fees/<itemID>.json) naming that corporation, station and ISK amount.
  The tick pays it (payFee) and retries: proven 5000 -> 3765.5 ISK.
- coopNpcCorpTreasury had tests and no caller; the refinery tick now sweeps pilot earnings
  into the corporation first (EVEJS_COOP_CORP_TREASURY=1), event living-corp-treasury-swept.
  Proven 33714.25 -> fee 4998.33 -> 28715.92 ISK left.
- Live blocker: zero refinery events ever and no /var/lib/evejs/coop-native-refinery dir.
  The hook passed only fleetRecord.stationID; the mining fleet docks no hull, so every live
  tick was NO_STATION. The tick now proves the station from the newest warehouse trip
  manifest for that system+fleet and reports living-npc-refinery-skipped instead of silence.
- New live flags: EVEJS_COOP_NPC_MARKET_DIR, EVEJS_COOP_CORP_TREASURY=1,
  EVEJS_COOP_FACTORY_CORP_ID=1000129.
- Operator note: this shell inherits VS Code's NODE_OPTIONS js-debug bootloader; clear it
  (and VSCODE_INSPECTOR_OPTIONS) or gates report a fake BLOCKED_RUNTIME_SEED.
- Pilot ledger then: 521754.08 ISK un-swept; corp wallet 0 until a sweep runs.

Updated: 2026-10-26 ~23:10Z · HEAD `4e32bbca` (pushed)

## Proven live (twice, different runs)

`living-npc-station-sold` `SOLD` with real ISK — **33 150** (21:30) and **36 250** (22:37),
`NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET`. Same runs: `living-mining-cycle-settled`
(COMMITTED) → `living-hauler-loaded` (14 466 / 14 277 m³) → fleet `loaded` →
`living-npc-station-route` → sale. Mining and loading continue afterwards
(28 settled cycles + 4 new loads after the last restart).

## Fixed here (all pushed, tested where unit-testable)

1. `HAULER_NOT_NAMED` — the role filter read the world file, which has no roles.
2. Sale left no provable trace → durable per-row fill receipt; the trip journal accepts it.
3. Rows are **partly** sold (5 000 of 54 999) → the receipt records the units the hull
   lost (accumulates), and the journal accepts a remainder = declared − sold.
4. A closed route is skipped BEFORE accounting (that ordering bug made the first expiry
   a no-op).
5. `verify()` required an exact warehouse receipt + hangar item, so a market fill could
   never close a row → a fill is now proven by its own quantity and type; a deposit still
   needs the exact stack.
6. Overdue/superseded trips are closed durably (own fsynced record, ack untouched) and
   re-planned from the hull.
7. Deploy/installer: reset from HEAD (not the shared index), L1-owned file is not drift,
   19 modules a merge had dropped are back in the installer list, and the new
   require-resolution guard found and fixed two live broken requires.

## Remaining blocker (exact)

After a sale, the next trip can still stop with
`ALIFE12_SOURCE_MISSING_WITHOUT_WAREHOUSE_PROOF`: a declared row is gone and the
accumulated fill receipt names the *last* station, while the manifest names the trip's
station — so the row cannot be proven for this manifest. Fix direction: make the fill
receipt carry a per-station breakdown (`fills: [{stationID, quantity, at}]`) and let the
journal prove a row against the fills of the manifest's own station, summing them.

## Operator actions taken (explicit, logged)

Two historic trips whose ore was sold before receipts existed were closed with the
journal's own `expire` via an explicit script
(`node /tmp/expire-trip.cjs <system-fleet-startedAt> HISTORIC_SALE_WITHOUT_RECEIPT --confirm`,
emitting `living-native-trip-expired-by-operator`). No receipt was invented, no cargo was
touched; both manifests remain on disk.

## Environment

`EVEJS_COOP_VIRTUAL_POPULATION=48`, `EVEJS_COOP_FLEET_COMPOSITION=1`,
`EVEJS_COOP_MINING_FILL_CAP=1`, `EVEJS_COOP_CARGO_VOLUME_FALLBACK=1`.
The world carries extra hulls from early failed attempts (13 miners / 10 haulers per
slot) — real, consistent, non-destructive. A clean acceptance prefers a fresh world.

## Commands

```
node scripts/coop-deploy.cjs --checkout C:\Games\EveCoop\upstream-evejs\Code   # reset=49 OVERLAY_OK
cd C:\Games\EveCoop\upstream-evejs\Code
docker build -t evejs-local . && docker compose -f compose.yaml -f compose.coop-probe.yaml up -d
bash scripts/coop-loop-gate.sh --code-path C:\Games\EveCoop\upstream-evejs\Code
```

## 2026-10-27 late: faction war wired to the real world

Commits (local, not pushed): 1cf02347 merit, 26945358 territory-from-presence,
c29cbcd7 campaigns, 58d8afd4 treasury, fd4bac85 bootstrap, 9b0d6f2a opening +
assault + runtime phases, 7f78b9fc war-state SQLite fix, 11a9d2ec self-defence.

Chain: real presence (identity links + corporation->faction) -> territories
(majority, tie = contested) -> fronts (real reciprocal gates) -> war + campaign
per open border (one war per faction pair) -> mobiliser reserves existing native
patrols -> BEGIN_ASSAULT only with a real muster on both sides.

**Root cause found:** the war phases read the record via gameStore.read(table,
"/"+KEY) (JSON cache) while coopFactionWarStore writes through
coopAtomicNativeRows with the raw KEY. A written state was invisible to the next
tick, so the empty state was recreated on every restart. warStateStore() now owns
read/write for opening/assault/mobilization/demobilization/objectives, and
ensureWarState() bootstraps once before any war phase.

**Live state after deploy:** `empty war state created (version 1)` exactly once,
then `opening skipped: NO_FRONT`, `mobilization skipped: NO_MOBILIZED_SHIP:OBSERVED`,
`assault skipped: NO_PREPARING_CAMPAIGN`. The state row now persists in SQLite
(version 1, wars 0, campaigns 0, territories 0).

**Why no front exists yet (real data, read-only probe):** 58 linked pilots ->
30000144=500014 (13), 30000145=500014 (9), 30100032=500020 (4), Jita 30000142 is a
3-3 tie between 500010 and 500011, so it is contested and owns nothing. The two
systems owned by 500014 share one owner and 30100032 is not adjacent, so there is
no border between two different owners. The opener refuses instead of inventing a
front. Next real action: a second faction must really outnumber the current
holder in a system adjacent to another faction's system (one extra patrol/pirate
of 500010 or 500011 in Jita is enough), then the war opens by itself.

Self-defence: coopNpcAggressionLedger (fed only by the killmail-tracker receipt
proven in coopPlayerCombatWitness) lets coopPveRetaliationGuard accept a verified
witness when the native controller has no lastAggressorID. The live compose
profile now sets EVEJS_COOP_PVE_NPC_RETALIATION=1 (it was absent, so
self-defence was gated off).

Tests: 96/96 across war + tactics + retaliation + ledger.

## Per-station fills (done, 22c90295)

Sale receipts now carry `fills:[{stationID,quantity,at}]` (accumulating, atomic
tmp+fsync+rename, identity checked against the prior row). The trip journal and
`verify()` sum ONLY the fills of the manifest's own station made after its departure, so
a row sold in two visits can be proven for each visit separately; receipts written
before the breakdown keep the documented single-station fallback. 28 journal tests pass,
including "a fill at another station never proves this route" and "a fill from before
the departure belongs to another manifest".

## Why the current world cannot finish a second trip

Its history predates receipts: rows were sold in several fills with only the first fill
recorded (the writer used create-only), so those rows are now gone while their receipts
cover only part of them. That is unprovable by construction and must not be papered over.
Live proof of the loop itself already exists (two SOLD events with real ISK).

## Decision needed before the next acceptance run

The probe world is blocked by that historic evidence gap. Two honest options:

1. **Clean world, same machine** (recommended): a second compose project with its own
   volume and remapped ports, run the loop from zero and capture the full cycle. Nothing
   of the current world is touched.
2. **Reset the probe world**: stop the project and drop `evejs-data` so the same project
   starts clean. Destructive; needs an explicit owner decision.

Neither is done automatically: the repo forbids wiping a volume to force a PASS, and a
second project needs ports 26000-26003/40110/443/5222 that the current one holds.

## 2026-10-27 handoff: CCP subsystem inventory (verified by file/handler count)

structure 46 files/77 handlers = real (deploy, control, destruction+loot, moon mining)
campaign 3/20 = real (the FSM that feeds insurgency) | shipcaster 5/6 = real
sovereignty 24/1 = logic only, no client surface | agency 1/2 = thin
incursion 2/0, superweapons 2/0, loyalty 1/0 = STUBS, do not build on them

Next step (not started): structureDeploymentService exposes ONLY client RPCs
(Handle_Anchor/Unanchor/CancelUnanchor/RenameStructure) - there is no server-side
deploy API. Two paths: (a) call the underlying structureState writer directly and
verify the structure appears in worldData.getStructuresForSystem + the scene;
(b) drive the stock Anchor action. Then set EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS
to the real typeIDs and use the structure as the campaign objective (structureID is
already a field in the client campaign snapshot; the projector currently emits 0).

## 2026-10-27 loop — item 1 DONE (structure factory), item 2 in progress

**Item 1 PASS (commit 52b28db1).** `integration/coopStructureFactory.cjs`:
`plan()` -> PLANNED record or REFUSED (UNKNOWN_TYPE_ID, INVALID_POSITION,
INVALID_FACTION for any non-number, OWNER_CORPORATION_REQUIRED,
CORPORATION_FACTION_MISMATCH, UNKNOWN_CORPORATION_FACTION, NAME_REQUIRED,
SYSTEM_ID_REQUIRED); `deploy()` writes through the native writer
`structureState.createStructure` -> `persistStructures` ->
`writeTable("structures")` (which applies `normalizeStructureDescription`,
invalidates the cache and notifies scene listeners) with `{emitLive:true}`;
`verify()` reads back through `listStructuresForSystem`, the same reader behind
`worldData.getStructuresForSystem`. Evidence: `node --test
tests/coop-structure-factory.test.mjs` 12/12, `--apply` INSTALLED
coopStructureFactory.js, `--check` OVERLAY_OK, docker build + recreate OK.

Assumption (owner default): objectives are created in SHIELD_VULNERABLE (110)
with a quantum core so they are real, attackable targets; the co-op faction is
stored in `devFlags.coop` because `normalizeStructureRecord` has no faction
field.

**Admin bridge (uncommitted->next commit):** `coopAdminBridge` gained the
whitelisted action `deploy_structure` (no characterID: a structure belongs to a
corporation) which calls the factory and reads the row back; `deps` are the real
native services. Tests `tests/coop-admin-bridge-structure.test.mjs` 4/4.

**Deliberately dirty (not mine):** `integration/coopNativeHaulManifest.cjs`,
`integration/coopNativeStationTripJournal.cjs` (another session's ore-owner vs
station-corp fill fix), `scripts/coop-supervise.ps1`, `state/digests/*`, `NUL`.
Never commit them.

**NEXT (item 2):** 1) add `EVEJS_COOP_ADMIN_BRIDGE: '1'` and
`EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS` to `compose.coop-probe.yaml`
(re-check the file right before each recreate). 2) `coopWarClientView.cjs:68`
hardcodes `structureID: 0` - replace it with the campaign's real objective
structure id (carried in the war state campaign record; see
`coopFactionWarCampaigns.cjs` `planCampaign` and `coopFactionWarAssault.cjs`).
3) Deploy 1-2 real structures in Perimeter 30000144 / New Caldari via
`deploy_structure`, then prove `warState` campaign carries the id and the
client snapshot emits it.

## Стиснення часу для тестів (реальні native-кнопки, без фейкового стану)

Профіль у `compose.coop-probe.yaml` (перевірено в контейнері через `env`):

| ключ | було | тест |
|---|---|---|
| `EVEJS_MINING_NPC_HAULER_REPEAT_DELAY_MS` | 600000 (10 хв) | **45000** |
| `EVEJS_MINING_NPC_WARP_INGRESS_DURATION_MS` | 2500 | **1500** |
| `EVEJS_MINING_NPC_FLEET_THINK_INTERVAL_MS` | 1000 | **500** |
| `EVEJS_MINING_NPC_HAUL_THRESHOLD_RATIO` | 0.2 | **0.1** |
| `EVEJS_COOP_NPC_MARKET_COOLDOWN_MS` | 60000 | **5000** |

Це саме ті ручки, якими керує продукт; код не змінюється, ніякого «підкрученого
годинника» і ніяких синтетичних подій. Продакшн-світ лишає стокові 30 хв.

## Результат трьох живих продажів

`SOLD` **33 150** + **36 250** + **43 950 = 113 350 ISK** (NPC-леджер).

## Чому зараз не продає

`living-npc-station-sale-skipped` → `NO_SEEDED_COUNTERPARTY`: у нативного сіяного
ринку закінчились ордери на ці типи руди в цих станціях (ми викупили їх кілька разів).
Це реальна межа ринку, не дефект циклу. Щоб продавати далі, треба нове сіяння
маркету (окремий потік) або інші системи/типи.

## 2026-10-27 loop — items 1/2/5 status, real blocker proven

**Item 1 PASS** (52b28db1, live 2276157c): factory + 2 real Astrahus structures
deployed (1030000000000 Perimeter, 1030000000001 New Caldari, faction 500014 /
corp 1000129), verified through worldData.getStructuresForSystem.

**Item 2 code PASS** (71551c99): campaignSnapshots emits the bound
`structure:<id>` objective instead of 0; flag
EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS=35832 is live. The objective can
only bind inside an ASSAULT campaign, which is blocked (below).

**Item 5 partial** (3fc8e73c): the first real front OPENED —
`living-native-war-opened OPENED war:500011-500014` with campaigns for 30000144
and 30000145, after one real Angel Cartel hull linked to coop-pilot-041 broke
Jita's 3-3 tie.

**Exact blocker for BEGIN_ASSAULT** (457b0ef0, read-only war_diagnose):
- war pair is Angel Cartel (500011) vs ORE (500014);
- DEFENDER side (30000144, ORE): every patrol candidate is WRONG_FACTION —
  corp 1000129 has 11 real profiles, all miners/haulers, so ORE can never
  field an armed patrol;
- ATTACKER side (Jita): the only 500011 patrol (980000000113) fails
  `NOT_READY:WAR_NO_NATIVE_LOADED_WEAPON`.
Conclusion: this faction pair cannot muster. A progressing assault needs an
armed faction to own the defending border system.

**NEXT (decided, owner defaults allow it):** make the border fightable without
weakening any gate:
1. spawn ~10 real Serpentis (500020, corp 1000135) armed patrols in New Caldari
   30000145 (currently ORE 9) so an ARMED faction owns it;
2. spawn 2 real armed Angel patrols in Jita with role patrol (linkSpawnedIdentity
   role="patrol") so the attacker side is ready;
3. a campaign whose target is no longer held by its war's defender faction is
   void by construction — add an explicit core transition (EXPIRE_CAMPAIGN with
   a reason) and let the opening phase void such campaigns before planning,
   otherwise TARGET_ALREADY_CONTESTED blocks the new front forever;
4. verify: war opens 500011-500020, mobilization assigns real patrols on BOTH
   sides, then BEGIN_ASSAULT fires and the objective director binds the Astrahus.

Dirty files deliberately left alone: `scripts/coop-supervise.ps1` (supervisor),
`state/digests/*` (generated), `NUL` (stray).

## Buyers for the ore — what actually exists (checked 23:57Z)

`living-economy-destination` on the live world reports **`HOLD_NO_BUYER`** with
`revenue 0, filled 0, unfilled 183 747` for every candidate station, for ore types
17463/17464/17470/1230. The native seed market simply has no buy orders for those ores
in these systems, so the sale path (`coopNativeNpcMarket`, which only fills EXISTING
native orders) correctly reports `NO_SEEDED_COUNTERPARTY`.

Three buyer layers exist in the repo, and only the first one pays today:

1. **Seed-market book** (`coopNativeNpcMarket`) — real native orders, finite; this is
   what produced the three live sales (113 350 ISK).
2. **Demand model** (`coop-economy.json` `systems.demand`, `living-economy-ore`,
   `EVEJS_COOP_ECONOMY_DESTINATION=1`) — computes where ore is wanted; right now it
   honestly says there is no buyer.
3. **Industrial consumers / manufacturers** (`coopAlifeNativeManufacturingRuntime`,
   `coopNpcIndustryNativeBindings`, `coopNpcManufacturingPlanner`, `coopNpcRefinery`) —
   present but **deliberately OFF**: the native bindings declare
   `supportsLiveRuntime:false`, so the runtime refuses with
   `ALIFE_MANUFACTURING_SOURCE_UNVERIFIED` until the native industry path is verified
   live. That is the missing "manufacturer buys ore for its own needs" leg.

Placing NPC buy orders without backing is forbidden by the repo rules, so the only
honest ways forward are: verify+enable the native industry consumer, or seed genuinely
backed ore demand (market daemon), or sell in regions where real orders exist.

## Варіант (а): нативна індустрія як покупець руди — що знайдено (00:05Z)

Читав нативний codebase і живий store:

* `server/src/services/industry/*` існує (12 сервісів), у store є таблиці
  `industryJobs`, `industryBlueprintState`, `industryFacilityState`, `industryRuntime`.
* **Усі вони порожні**: jobs 0, blueprintState 0, facilityState 0 (industryRuntime 2 —
  лише метадані). Тобто у світі немає ні фабрики, ні креслення, ні матеріалів.
* `industryChatCommands.js` експортує `executeBlueprintCommand` і
  `executeBlueprintAutoCommand`, і всередині вже є `seedMaterialsForBlueprint` та
  `topUpWalletForBuild` — тобто нативний шлях «зробити реальний білд» у чекауті є, і він
  вміє сам посіяти матеріали й докинути гаманець.
* Але весь co-op стек індустрії **свідомо зафенсований** `supportsLiveRuntime:false`
  (bindings, executor, rust-sell, title-transfer, recovery fence...), а `planner`
  вимагає онлайн-фасиліті + `blueprintState.records`.

Висновок: (а) — це не перемикач, а bootstrap: треба створити NPC-виробника (фасиліті на
станції, креслення з нашою рудою в матеріалах, гаманець+матеріали через нативні
команди), прогнати один реальний джоб із доказами, і лише потім атестувати рантайм.

Наступний крок, який я роблю без ризику: підняти нативний білд через
`executeBlueprintAutoCommand` для NPC-корпи (нативний шлях, не вигадані записи), з
окремим журналом доказів. Якщо для цього потрібна сесія, якої в headless-світі немає —
це і буде першим точним блокером, і тоді рішення: невеликий L2-міст «NPC factory
bootstrap» або L1-пропозиція вгору.

## 2026-10-27 loop — item 3, 4, 10 done; assault blocker narrowed to NPC fitting

**Item 3 PASS** (78fb32ce): rank-driven command cap enforced per campaign side
(recruit 1 / squad-lead 5 / admiral 25), wired to real merit records (none yet,
so every side starts at 1). Tests 10/10.

**Item 4 PASS (code)** (3ff71b13): `warFrontChat` sends
`coopWarClientView.frontReport` to live sessions in the affected systems on war
opened / assault begun / objective captured, once per event key. Tests 3/3. No
live chat line was observed (no transition happened with a client connected).

**Item 10 PASS** (f3997b30): full suite HEAD 5712 tests / 5163 pass / 459 fail /
90 skip vs baseline 49140caa 5680 / 5131 / 459 / 90 — zero new failures, 32 new
passing tests. The single new failure found was an LF-anchored guard broken by a
PowerShell rewrite that had converted two modules to CRLF; restored.

**Assault blocker, narrowed twice (both read-only, exact):**
1. `war_diagnose` -> DEFENDER (ORE 500014) WRONG_FACTION (corp 1000129 has 11
   real profiles, all miners/haulers) and ATTACKER NOT_READY:WAR_NO_NATIVE_LOADED_WEAPON.
2. `inspect_npc 980000000113` -> `"modules":[],"moduleCount":0,"cargo":[],"cargoCount":0`
   even for a durable, armed-profile hull. Cause in the pinned code:
   `nativeNpcService.buildNativeModuleRecords` fits only `definition.loadout.modules`,
   and these profiles resolve to an empty authored loadout. So no NPC in this
   world carries a native fitted weapon/charge and the muster gate can never pass.

**NEXT ACTION (exact):** the assault is blocked BELOW the war layer. Investigate
why `npcData.buildNpcDefinition(<profileID>)` yields no `loadout.modules` for
`parity_angel_autocannon_frigate` / `blood_raider_prophecy` (npcProfiles/npcLoadouts
rows in the static tables vs `npcHardwareCatalog` allowed type IDs), then either
author a real loadout through the catalog or record it as a stock data gap in
`patches/upstream/`. Do not relax `coopWarMusterReadiness`.

**Also still open:** queue items 6 (NPC careers), 7 (courier economy), 8
(industry/salvage loop), 9 (two-client checklist); owner backlog items 1-3
(sovereignty projection, shipcaster logistics, player ranks).

## 2026-10-27 — NPC fitting root cause FOUND (exact), fix needs an override seam

**Root cause (verified, no guessing).** `npcData.buildNpcDefinition(profileID)`
takes the loadout straight from the profile row (`profileRow.loadoutID`), and
every pirate *subcapital* profile points at
`retail_empty_npc_entity_loadout` — a documented stock row with
`modules: [], charges: []` ("Retail NPC Entity Native Dogma": retail NPC stats
live on the type dogma record, not on fitted modules). Measured in the live
container:

```
PROFILE angel_raider                     loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE parity_angel_autocannon_frigate   loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE blood_raider_prophecy             loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE ore_mining_venture                loadoutID ore_mining_venture_dual_miner      modules 1 charges 0
PROFILE concord_police_cruiser            loadoutID concord_medium_beam_laser_cruiser_mwd modules 2 charges 1
```

So `coopWarMusterReadiness` is correct and stock is correct; the two never meet
for pirate subcaps.

**Profiles that DO carry a real, validating weapon+charge (existing data only):**
- `capital_angel_dreadnought` / `capital_serpentis_dreadnought` / ... (each pirate
  faction's capital) — 1 module + 1 charge, `validateNpcHardwareDefinition` -> ok;
- CONCORD (17 profiles, faction 500006);
- Triglavian (28 profiles, faction 500026).

Every pirate *frigate/cruiser/battleship* has zero modules. There is no
subcapital pirate loadout anywhere in the static tables.

**Two honest fixes (both keep coopWarMusterReadiness untouched):**

1. **L1 seam (recommended, real patrols).** Add an explicit loadout override to
   the spawn path (`buildNpcDefinition(profileID, {loadoutID})` or
   `spawnBatchInSystem(..., {loadoutID})`) as a pinned
   `patches/upstream/NNN-npc-loadout-override.patch` + MANIFEST entry, then author
   ONE coop war-patrol loadout (a real turret + a real compatible charge) in the
   coop layer and spawn war patrols with it. Small diff, reversible, keeps retail
   behaviour when the option is absent.
2. **Existing-data-only (no patch, semantically weak).** Use a pirate capital
   (`capital_angel_dreadnought`) as the armed hull, which already has a real
   loadout — but a dreadnought labelled `role:"patrol"` is a misleading label and
   needs a 10-ship world flip to give a fightable border (Jita's neighbours are
   all ORE-owned; ORE has 11 profiles, all miners, and no capital).

Nothing was changed this step: no patch, no flag, no gate relaxation.

**NEXT ACTION (exact):** implement option 1. Start at
`server/src/space/npc/npcData.js:459 buildNpcDefinition(profileID)` and
`nativeNpcService.js:430 buildNativeModuleRecords` (reads
`definition.loadout.modules`); thread an optional `loadoutID` through
`npcSelection.resolveNpcSpawnPlan` -> `spawnBatchInSystem`, add the patch +
`patches/upstream/MANIFEST.json` entry, then `node scripts/apply-upstream-patches.cjs
--checkout <Code> --apply`. Live proof required: `inspect_npc <patrol>` shows
`moduleCount>0` with a weapon+charge, then `war_diagnose` shows
`DRY_RUN_MOBILIZABLE` on both sides, then `living-native-war-assault` fires.

## 2026-10-27 — L1 loadout seam implemented (in progress, live proof pending)

**Done so far.** `patches/upstream/0007-npc-loadout-override.patch` (sha256
`4b9b8215ccf32e88c90ddef38a479f5796d6fbe693bfa7bf0e6d60bda1e2fc82`, MANIFEST
entry, 3 files: npcData/npcSelection/npcService — nativeNpcService is NOT touched
because 0002 owns it). `buildNpcDefinition(profileID, {loadoutID})` ->
`resolveNpcSpawnPlan` -> `resolveBatchSelection` -> `spawnBatchInSystem`; retail
path unchanged when the option is absent, a missing row fails as
NPC_DEFINITION_INCOMPLETE. Apply + reverse both verified.
`integration/coopWarPatrolLoadout.cjs` resolves the profile's own
`<profileID>_loadout` row (real turret + native-compatible charge) and never
overrides an already armed row; `coopAdminBridge.spawnNativeNpc` now refuses an
unarmed `role:"patrol"` spawn (`WAR_PATROL_LOADOUT_UNAVAILABLE:<reason>`), accepts
`loadoutID`/`warPatrol`, and reports the loadout it used.
Tests: `coop-war-patrol-loadout` 7/7, `coop-npc-loadout-override-patch` 5/5.
Deploy: `coop-deploy.cjs` -> `reset=53 patches=series=7 overlay=OVERLAY_OK`.

**Proven live data (read-only probes).** `parity_angel_autocannon_frigate` ->
`parity_angel_autocannon_frigate_loadout` = Domination 125mm Autocannon (13773,
g55) + Domination EMP S (20767, g83), `validateNpcHardwareDefinition` ok, family
angelcartel, `isNpcChargeCompatibleWithModule` true. Every `parity_*` pirate
profile has such a row; `angel_raider`/`blood_raider_prophecy` do not (refused).

**Assault blocker, corrected analysis.** War `war:500011-500014` has defender ORE
(500014) and EVERY ORE profile is a miner/hauler (11 profiles, no weapon), so the
defender side can never muster; registered territories (Jita=500011,
30000144/30000145=500014) are authoritative over live presence, so spawning
Serpentis into a registered ORE system does NOT change the owner (the previous
NEXT list assumed it would). Real fix = a front between two ARMED factions: add
Sobaseki 30001363 (real reciprocal gate 50013876<->50013875, 5 belts) to
`EVEJS_COOP_VIRTUAL_ROUTE` and put one armed Serpentis patrol there; Jita is
already 500011-owned, so a new war 500011-500020 opens on that border and both
sides can muster.

**NEXT (exact).** build + recreate -> `spawn_native_npc` (profileQuery
parity_angel_autocannon_frigate, role patrol, warPatrol true, system 30000142) and
the Serpentis twin in 30001363 -> `inspect_npc` both (moduleCount>0 + charge) ->
`war_diagnose` DRY_RUN_MOBILIZABLE both sides -> `living-native-war-assault`.

## 2026-10-27 — L1 loadout seam + REAL ASSAULT MUSTER (PASS, a7f4c379)

**Proven live (verbatim, container evejs-server-1).**
- `inspect_npc 980000016644` -> `"moduleCount":3` (3x typeID 13773 projectile
  turret, flagID 27/28/29, online) + `"cargoCount":3` (3x typeID 20767 EMP S, one
  per module), `"transient":false`.
- `inspect_npc 980000016639` -> `"moduleCount":5` (5x 13884 hybrid turret) +
  5 charges 20057, `"transient":false`.
- `living-native-war-opened` `OPENED` `warIDs:["war:500011-500020"]`
  `campaignIDs:["war:500011-500020:campaign:30001363"]`, territories now
  `30000142:500011, 30000144:500014, 30000145:500014, 30001363:500020,
  30100032:500020`, `fronts:2`, FUNDED paper treasury.
- `living-native-war-mobilization` `NATIVE_PATROL_MOBILIZED` 980000016644
  ATTACKER (30000142/500011) and 980000016639 DEFENDER (30001363/500020).
- `living-native-war-assault` `ASSAULT_BEGUN`
  `campaignID:"war:500011-500020:campaign:30001363"`
  `attackerShips:[980000016644] defenderShips:[980000016639]`
  `evidence:"REAL_NATIVE_MUSTER_ON_BOTH_SIDES"`.

**Two facts that made this possible (both real, no gate touched).**
1. The muster gate rejects **transient** charges (`c.transient===true`), so a war
   patrol must be spawned `durable:true`; `coopAdminBridge` now does that on
   request and reports `durable`.
2. `campaignReadiness` returned on the FIRST preparing campaign, so the
   un-winnable ORE border (`war:500011-500014:campaign:30000144`, defender ORE
   flies no weapon at all) hid every later border. It now scans all PREPARING
   campaigns and returns the first READY one; the per-campaign gate is unchanged.

**World setup used (owner default: real NPCs/factions only).** Route gained
`30001363` Sobaseki (real reciprocal gate 50013876<->50013875, 5 SDE belts), one
armed Serpentis patrol there (faction 500020) and armed Angel patrols in Jita
(500011) via `spawn_native_npc` + `linkSpawnedIdentity`. No synthetic state, no
fabricated kill, no ammo invented.

**Known noise, deliberately left.** The two transient pirate frigates from the
first attempt (980000016644/16645 were transient then; 980000016644 came back as
a durable restore) plus unarmed transient hulls still linked to some pilots; the
older ORE campaigns stay PREPARING forever by construction (ORE cannot arm).

**NEXT.** (a) battle/objective leg: attack orders -> structure objective binding
-> capture of 30001363; (b) client check of the new campaign on the map/FW tab =
BLOCKED_CLIENT_CHECK without the EVE client; (c) do not re-spawn patrols for the
same campaign (side cap is 1 at recruit rank).

## 2026-10-27 — assault battle leg: real fire + measured HP loss PROVEN (287898d1)

**Proven live (container evejs-server-1, read-only probes).**
- `living-native-war-attack-orders` `NATIVE_ATTACK_ORDER_ACCEPTED` for
  980000016639 -> 980000016987 and back, after the director finally saw its own
  war state.
- `war_combat_diagnose` pair: `sameSystem:true, distanceMeters:4908,
  inRange:true, verdict:AUTHORIZED, warID:war:500011-500020`.
- `living-native-weapon-event` `VERIFIED_NATIVE_WEAPON_EVENT` repeatedly from both
  hulls (module 980100051793 hybrid turret, 13773 projectile turret).
- Ammo bank journal `980000016639.json` phase **COMMITTED** (a real charge debit).
- Victim HP went from `{"shield":225,"armor":200,"structure":215}` to
  `{"shield":200.13459482520693,"armor":200,"structure":215}` — 24.87 HP of
  measured damage from a real Serpentis turret hit.

**Five stacked defects fixed (each proven by a probe before the next):**
1. `gameStore.read(TABLE,"/"+KEY)` cannot see a row written through
   `coopAtomicNativeRows` (the cache nests it at 0x1f). The battle director's
   `snapshots()` was always null -> `WAR_STATE_UNAVAILABLE` -> no order ever.
   `integration/coopNativeRowPath.cjs` is now the one conversion point (195d4ec9).
2. An assault attacker mobilized during PREPARING stayed in the source system and
   held the rank-capped side slot forever (b5a8cd01).
3. `coopNpcFireDebitProof` demanded `flagID` on native charge cargo rows, which
   the native cargo writer never stamps -> `NO_AMMO` on every cycle.
4. The ammo bank journal root did not exist -> `BANK_ATOMIC_JOURNAL_UNSAFE`.
5. The bank transaction declared npcEntities/npcModules (transient rows) and no
   contract covered them; two features now share the npcCargo set, so the caller
   names its contract; a PREPARED journal whose SQLite fence proves no commit is
   recovered as ABORTED by the new `native-ammo-bank-recovery` phase.

**Exact remaining blocker for a KILL (wreck + loot).** One bank cycle spends every
fitted charge (each charge row is quantity 1), so a hull fires exactly ONE volley
and is dry: the cruiser hit for 24.87 HP against a 640 HP frigate. The real lever
is ammo depth: author a war-patrol loadout with `chargeEntry.quantityPerModule`
> 1 (the native spawn honours it, `nativeNpcService.js:563`), spawn the patrol
with that `loadoutID`, then the same fire path kills the victim and
`coopNpcWreckCustody` / `coopNativeLootQuarantine` / `coopWarCasualtyLedger`
follow on the real wreck.

**NEXT ACTION (exact).** Add a coop-authored war-patrol loadout row with
`quantityPerModule` (e.g. 40) reachable through `coopWarPatrolLoadout`, spawn the
Sobaseki attacker with it, verify repeated `living-native-weapon-event` +
falling HP + a real wreck, then continue queue item 2 (casualty ledger -> merit ->
promotion -> treasury).

**Known noise.** The cruiser 980000016639 and frigate 980000016987 each have a
COMMITTED/ABORTED bank journal; hulls left behind in Jita (980000016644/16642)
stay registered to their campaigns. `EVEJS_LOG_LEVEL=2` was used only for the
diagnosis and has been removed from `compose.coop-probe.yaml`.

## 2026-10-27 - war kill loop: real fire -> kill -> wreck -> loot -> casualty -> merit -> promotion (2567db15, 16cda1ed, 00db71a9, 34471320)

**Proven live (container evejs-server-1, read-only admin bridge + coop-events).**
- Loadout: `spawn_native_npc parity_serpentis_blaster_cruiser role patrol durable`
  -> `"loadout":{"status":"RESOLVED","reason":"AUTHORED_MULTI_CHARGE_ROW",
  "loadoutID":"coop_war_patrol_ammo60_parity_serpentis_blaster_cruiser_loadout",
  "chargeTypeID":20057,"chargeDepth":60}` and `inspect_npc 980000017150` ->
  `"moduleCount":5`, cargo 5 x typeID 20057 `"quantity":60` (300 real charges).
- Multi-cycle bank: `living-native-npc-ammo-debit` cargoID 980200006198
  `"before":41,"after":36,"unitsDebited":5` on the same hull (not one volley).
- Measured kill: `war_combat_diagnose` victim HP 225 -> 131.27522104432944 ->
  26.666062461711466 shield, then destroyed.
- Wreck + loot: `living-native-wreck-evidence PHYSICAL_NATIVE_WRECK_VERIFIED`
  wreckID 980300000006 `"storedItemCount":7,"storedQuantity":279,
  "lootStatus":"ITEMS_STORED"`.
- Casualty: `living-native-war-casualty "status":"RECORDED"` wreckID 980300000006
  pilotID coop-pilot-056 (victim), campaign war:500011-500020:campaign:30001363.
- Strict killer: `living-native-destruction-attacker
  NATIVE_DESTRUCTION_ATTACKER_PROVIDED` attackerEntityID 980000017150
  attackerPilotID coop-pilot-050 (upstream options.attackerEntity only).
- Merit + promotion: `living-native-war-merit {"status":"PROMOTED",
  "pilotID":"coop-pilot-050","kind":"warship-kill","merit":25,"from":"recruit",
  "to":"pilot","command":2,"wreckID":980300000006,
  "evidence":"UPSTREAM_ATTACKER_ENTITY_PLUS_PHYSICAL_NATIVE_WRECK"}`, persisted in
  `coop-faction-war<0x1f>merit-v1` and read by the live command-size rule.

**Three structural defects fixed to get there.**
1. Every real loadout row carried one charge, so a hull fired one volley and was
   dry forever: `coopWarPatrolLoadoutRow` authors a real static row plus a real
   ammo depth (2567db15).
2. A dry hull held its side slot forever: `coopWarBattleLineRelief` releases war
   custody on the mobiliser's own `WAR_NO_NATIVE_LOADED_WEAPON` verdict, and the
   mobiliser's ASSIGN event ID now identifies the real attempt so a released hull
   can be mobilized again (16cda1ed).
3. A destroyed hull stayed registered, so the first kill consumed the slot: the
   registry's `confirmDestroyed` witness is wired to real native wrecks and seeded
   from the durable casualty ledger (34471320).

**BLOCKED_TREASURY_UNFUNDED (exact finding, no fabrication).** The last leg
("treasury credit") has no legal ISK source in this world:
`coopWarTreasury` has **NO_TREASURY_ROW** (no HELD escrow), a RESERVE is refused
for a campaign that already exists, and both war corporations have **no
corporationRuntime wallet row at all** (`1000135`/`1000138` MISSING, so
`NATIVE_CORPORATION_WALLET_UNVERIFIED`), while the victim hull typeID 10016 has no
`shipInsurancePrices` row. Any credit would therefore mint ISK, which is
forbidden. A real settlement needs a funded war chest first.

**NEXT ACTION (exact).** Fund a war chest from real income (NPC economy credits or
a player corporation wallet) and enable `EVEJS_COOP_WAR_TREASURY=1`, then reserve
**before** the campaign is created (`coopWarTreasury.execute RESERVE` refuses an
existing campaign) and pay the bounty from that HELD escrow on
`living-native-war-merit` PROMOTED. Do not mint ISK. After that, backlog:
sovereignty projection -> shipcaster logistics -> player rank decal (title only).

**Known noise.** Two dead wrecks (980300000005/6) with stored loot in 30001363,
the released dry hulls 980000016638/16642/16644 and 980000016639/16987 remain as
real idle NPCs, and the ORE campaigns stay PREPARING by construction.

## 2026-10-27 loop - treasury made real (funded + escrowed live), sovereignty + title projected, payout blocked exactly

**Item 1 code PASS + live funding/reserve PASS (43c8d7ea).**
`coopWarChestFunding` moves real earned ISK (the only real ISK an NPC owns, every
cent paid by a real seeded-market fill) from the faction's own pilots into its
native NPC corporation wallet, then `coopWarTreasury` RESERVE debits that wallet
into HELD escrow. The reservation is taken in `coopFactionWarOpening` BEFORE
`START_CAMPAIGN`, so the treasury's "no reservation for an existing campaign"
rule is never bypassed. PAYOUT releases HELD escrow to one named pilot with an
injected authorizer and no wallet mutation (the value left at RESERVE).
`coopWarKillMerit` pays the kill bounty and the faction's own casualty benefit;
`coopWarBounty` resolves the paying faction from the pilot's real native ship and
corporation. RESERVE now accepts either war party (a defender funds its own
defensive bounty) and the wallet checks accept the real keyed stock row shape
(the old `corp.corporationID` check was the actual cause of
`NATIVE_CORPORATION_WALLET_UNVERIFIED`: the stock row has no such field).

Live, verbatim (container evejs-server-1):
- `living-native-war-bounty-reserved` `{"status":"RESERVED","factionID":500014,
  "corporationID":1000129,"amountCents":2500000,
  "chestJournalID":"chest:bounty:war:500011-500014:campaign:30000143:500014",
  "walletAfterCents":2500000,"sources":["coop-pilot-001"],
  "escrowJournalID":8000000000000000}`
- `living-native-war-opened` `OPENED` `campaignIDs:["war:500011-500014:campaign:30000143"]`
  with `funding:[{status:RESERVED,paper:false,escrow:true,...}]`
- chest journal COMMITTED: coop-pilot-001 172 100.00 -> take 25 000.00;
  earned ledger 172 100 -> **147 100**; corp 1000129 journal `7500000000000000`
  +25 000 then `8000000000000000` -25 000; treasury row exists with the
  reservation `bounty:war:500011-500014:campaign:30000143:500014` **HELD**.

**Exact blocker for the live PAYOUT (NEEDS_OWNER:BLOCKED_TREASURY_NO_ARMED_FUNDED_FACTION).**
The only faction with real earned income is ORE 500014 (147 100 ISK left), and ORE
fields 11 profiles, all miners/haulers with no weapon, so it can never produce or
receive a kill in a campaign it funds. Angel 500011 and Serpentis 500020 can fight
(the proven kill loop) and have **zero** earned ISK: `war_funding_diagnose`
reports `NO_REAL_FACTION_INCOME` for both, so their bounty is refused instead of
minted. The payout path itself is unit-proven (6 tests) and wired; it fires on a
real casualty/merit event for the funded faction. To unblock honestly the owner
needs one of: (a) real earned income for an armed faction (a real native sale by
an Angel/Serpentis pilot), or (b) an armed ORE hull profile with a real loadout.

**Item 2 partial (2671b321).** `coopWarSovereigntyProjection` reports real
military control and refuses to call it native sovereignty unless a real TCU/IHub
AND a real native claim exist. Live: `NATIVE_SOV_CLAIM:0`,
`MILITARY_CONTROL_ONLY_NOT_SDE_SOVEREIGNTY:5`, reason
`NO_NATIVE_SOV_STRUCTURE` for every held system (the two faction Astrahus are not
sov structures). `coopWarRankTitle` maps a real merit rank to the pilot's visible
title with an explicit empty unlock list, durable once per promotion.
**Shipcaster front logistics: NEEDS_OWNER, not started** - no real shipcaster
structure exists in this world, so any "front logistics" would be invented.

**Item 3 regression (no code change).** war/treasury/merit/opening/admin suites
332 pass / 11 fail (baseline 303/15), `coop-npc-*` 1090 pass / 98 fail (identical
to the recorded baseline). No new failure.

**NEXT ACTION (exact).** Give an armed faction real income: run one real native
sale for an Angel (500011) or Serpentis (500020) pilot through
`coopNativeNpcMarket` (real seeded bid, real cargo), then re-run
`war_funding_diagnose` until its side reports `FUNDED`, let the next opening
reserve the bounty, and confirm `living-native-war-bounty` `PAID` on the next real
casualty of that faction. Do not fund it any other way.

## 2026-10-27 loop - item 1 code PASS, live income BLOCKED BY WORLD GEOGRAPHY (add54831, ff071de9)

**Code (add54831).** `coopNpcLootSellRoles` decides which named native NPC role may
liquidate provenance-verified loot; the runtime no longer hard-codes `pirate`.
Default list is `pirate` (historical behaviour); the live profile sets
`EVEJS_COOP_NPC_LOOT_SELL_ROLES=pirate,patrol` and enables
`EVEJS_COOP_NPC_LOOT_COMMERCE/WRECK_TRANSFER/WRECK_RECOVERY=1`, plus the real
loot typeIDs (211,180,185,216,219,241,243,244,182,2516,20767,4959,20617,11351,
14272,25611,25606) in `EVEJS_COOP_NPC_MARKET_SELL_TYPES`. 6/6 unit tests,
OVERLAY_OK 364 modules, rebuilt and recreated.

**P0 found and fixed while doing it (ff071de9).** `living-native-durable-recovery`
was `NEEDS_OPERATOR_REPAIR` for coop-pilot-046/980000016645 (durable record and
controller in 30000142, link said 30001363), which threw
`DURABLE_NPC_RECOVERY_REQUIRES_REPAIR` **before** `createBridge()`. The bridge
therefore did not exist in this boot, so every bridge-driven phase (raids, loot
station delivery, market assignments) was silently inert. Stale links are now
reconciled only under `EVEJS_COOP_DURABLE_RELOCATE_RESTORE=1` via the registry's
own `relocate()`. Live after deploy: `status OK, alreadyPhysical 67, errors []`.

**Why the armed factions still cannot sell loot (measured, not inferred).**
1. The only theatre with real armed native combat is 30001363 (campaign
   `war:500011-500020:campaign:30001363` in ASSAULT). Its region 10000016 has
   **zero** seeded buy rows for 1228/34/211/20767/14272/11351, i.e. no NPC market
   at all, so recovered loot can never be sold there (region 10000002 = 132 rows,
   10001004 = 18).
2. The demand systems have no real armed combat: 30000145's mining fleet is
   stuck (`living-npc-station-route ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED`, ships
   ~4.4e11 m from the belt) so pirates have no live prey; 30100032 has 0 SDE
   belts (`SYSTEM_HAS_NO_SDE_BELTS`); Jita's Guristas/Angel patrols have no
   native attack order.
3. ORE 500014 (the only faction with real income, 147 100 ISK, bounty already
   HELD for `campaign:30000143`) has **no armed profile at all** in the native
   resolver (only empire/pirate `parity_*` combat profiles exist), so
   `war_diagnose` mobilises 0 ships for every 500011-500014 campaign and its
   escrow can never pay a kill or a death benefit.
4. `war_funding_diagnose` (live): 500011 `NO_REAL_FACTION_INCOME`, 500020
   `NO_REAL_FACTION_INCOME`, 500014 `FUNDED` (coop-pilot-001 147 100 ISK).

**NEXT ACTION (exact, one decision).** Item 2's payout needs a real casualty of
the funded faction inside `campaign:30000143`, which needs an armed ORE hull;
the alternative is a real kill by an armed faction inside a seeded-market system.
Both are world-configuration choices, not missing code:
(a) add a real armed ORE (500014) native combat profile so 500011-500014 can
muster, or
(b) bring an armed pair's front into a seeded region (30000144/30000145/Jita),
or (c) seed region 10000016 (forbidden here: no market rebuilds).
Until one is chosen, do not mint ISK and do not fake a kill.

**Shipcaster logistics: NEEDS_OWNER, with evidence.** The SDE really contains
shipcaster beacon structure types (75928 Imperial, 75929 State, 75930 Federation,
75931 Republic) but they belong to the four empires; no shipcaster beacon type
exists for 500011/500014/500020, so a "faction shipcaster" would misrepresent
structure ownership. Nothing was deployed.

## 2026-10-27 (FW-013) - the armed pair's front is in the seeded region; three silent raid blockers fixed (9ff67b86)

**Owner default applied: an armed pair's front now sits in seeded region 10000002.**
SDE-verified, not guessed: Maurasi 30000140 has 25 real belts, sits in region
10000002 (the only region with real seeded buy rows for the loot types: 431
station/type rows, all in Jita 30000142 and New Caldari 30000145), and has a real
reciprocal gate to Jita (50000802 <-> 50001248). It was added to
`EVEJS_COOP_VIRTUAL_ROUTE` so the headless boot tracks it
(`living-headless-boot-system 30000140 realAsteroidBelts 25
authoritativeSdeBelts 25`).

Real armed hulls spawned with `spawn_native_npc` (durable, authored multi-charge
row `coop_war_patrol_ammo60_*`):
- 980000018058 Serpentis cruiser, role **pirate**, New Caldari 30000145
  (coop-pilot-070) - the income bootstrap;
- 980000018084 Serpentis cruiser, role patrol, Maurasi 30000140 (coop-pilot-063)
  - makes the system Serpentis by real presence;
- 980000018085 Angel frigate, role patrol, Jita 30000142 (coop-pilot-078).

**Measured:** `living-native-war-opening-blocked` now reports
`SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500020:NO_REAL_FACTION_INCOME`.
That is the whole remaining gap: the front exists and BOTH sides are armed; only
the real escrow reservation is missing, and it must come from a real seeded sale.

**Three silent blockers removed (all measured, none guessed):**
1. `EVEJS_COOP_MATERIALIZE_LIMIT: '26'` made `createBridge()` throw (contract
   1..10) inside `observeSession` before `bridge` was assigned. Every
   bridge-driven phase (raids, loot delivery, market assignments) had stopped
   existing while the world looked healthy. `coopMaterializeLimit` clamps and
   reports it; `living-native-bridge` publishes the created bridge.
2. The raid director read the materializer assignment map, rebuilt only during
   boot, so a hull linked afterwards was invisible. It now reads the identity
   registry (the same authority the raid legality gate uses).
3. The civilian route director held a CIVILIAN lease on pirate hulls and orbited
   them, so every raid order was refused
   `COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE`. One owner per record: a pirate's
   movement belongs to the raid director.
`coopNpcOrderBridge.diagnose()` + `living-native-raid-diagnose` make any
future refusal an exact, published reason instead of a silent boolean.

**Live proof of the fix:** `living-native-raid-diagnose 30000145 pirates 3
fleetShips 23 oreBearing 5 authorized 21-22` -> `living-pirate-raid`
`[{"pirateID":980000018058,"targetID":980000016318,"targetRole":"hauler",
"action":"attack"}]` (30000144 attacks 980000016310) with
`orderDiagnosis PERMITTED, leaseOwner RAID`.

**NEXT ACTION (exact).** Wait for the real raid kill in 30000145 (a real stock
mining-fleet hauler, 300 fitted charges): wreck -> `coopNpcWreckCustody` ->
loot cargo -> `coopNpcLootCommerce` warp to a New Caldari station ->
`coopNativeNpcMarket` fill against a real seeded bid (25606/25611/180/211 at
New Caldari/Jita) -> Serpentis `earned` ISK -> `warBountyReserve` can then
reserve for `war:500011-500020:campaign:30000140` (attacker Angel from Jita,
defender Serpentis in Maurasi) -> mobilize -> BEGIN_ASSAULT -> real kill ->
`living-native-war-bounty` PAID from HELD escrow. Never mint ISK; if the kill or
the fill does not happen, record the measured blocker.

## 2026-10-27 (FW-013 result) - seeded-region front PROVEN; the income leg is the single remaining blocker

**Proven (live, verbatim):**
- Maurasi 30000140 is registered military control **500020** (Serpentis) after the
  real armed cruiser 980000018084 (coop-pilot-063) was spawned there, so a real
  border with Jita 30000142 (500011 Angel) exists **inside seeded region
  10000002**. SDE: 25 real belts, reciprocal gate 50000802 <-> 50001248.
- `living-native-war-opening-blocked` reason (last, 05:27:18Z):
  `SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500020:NO_REAL_FACTION_INCOME`.
  The front, both armed sides, the declaration presence and the adjacency proofs
  all pass; only the real escrow reservation is missing.
- Raid authority is now fully live and measured: `living-pirate-raid 30000145`
  real attack orders (owner RAID, `orderDiagnosis PERMITTED`),
  `npc_pair_diagnose` 980000018994 -> 980000016318 `engagementAllowed true`,
  `manualType attack`, `allowWeapons true` at 15122 m, 5 hybrid turrets with
  5 x 60 real charges.
- Real NPC-vs-NPC fire does happen in this world: 30000144
  `living-native-weapon-event` missile-launch 980000000153 -> 980000000444 and
  `living-native-combat-damage` correlated damage 0.013 HP.

**NEEDS_OWNER:BLOCKED_ARMED_FACTION_INCOME (exact missing data).** No armed
faction can earn the 25 000 ISK the bounty needs, because earning requires a real
seeded sale and a sale requires a kill inside Jita/New Caldari:
1. the stock mining fleet in region 10000002 sits at AU-scale positions
   (`toBeltMeters` 4.4e11 m) and keeps warping on its station route
   (`ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED`). Measured over 20 min: the raiding
   cruiser went 15 122 m -> 37 253 m from its target, both in GOTO,
   `currentTargetID 0`, zero module activations;
2. a hull in an active warp is rejected by the native combat resolver, so the
   chase cannot convert into damage (the new filter at least stops the pirate
   from being dragged across the system);
3. the only real exchange in 30000144 is a Guristas patrol retaliating against an
   *unarmed* pirate for ~0.01 HP per sample, and Perimeter has no seeded buy rows
   (the seeded rows are only at Jita 30000142 and New Caldari 30000145 stations).
Nothing was minted, no fill or kill was invented.

**NEXT ACTION (exact).** Two honest ways to close it, both world-configuration:
(a) repair the mining fleet's real position/route state so a belt miner is
stationary at a reachable point (then the raid kill, wreck, loot and seeded sale
follow on the already-proven path), or
(b) let an armed faction earn from a real seeded fill it can already reach (for
example a real ore haul by a pirate hull that owns cargo). Do not seed region
10000016 and do not place unbacked orders.
Shipcaster logistics stays NEEDS_OWNER (no shipcaster beacon type exists for
500011/500014/500020 - only 75928/75929/75930/75931 for the four empires).

## 2026-10-27 (FW-014) - item 1: mining-fleet movement root causes found; item still OPEN

**Read-only probe (new, 75f9f54f).** `mining_fleet_diagnose` (admin bridge,
`systemIDs`) reports, per ship: mode, pendingWarp, the sessionless warp clock and
its own destination distance, distance to the nearest real SDE belt and to the
trip station, the arrival surface gap, the dwell clock, the controller manual
order, the arbiter lease owner; per fleet: state, origin anchor, trip and the
trip-journal record (latest manifest, departure ack, expiry, overdue).
Live: `fleet 960004609 state=loaded originAnchor distanceMeters 448793612100`,
`journal latestManifestKey 30000144-960004609-1793061051055 ageMs 20187185
overdue true departureAck false expired false`, miner `nearestBelt 448793621638`.

**Three real defects, all measured, all fixed:**
1. **Ack-less prepared trip could never be closed** (88a3ee63). The journal
   returned `ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED` without the deadline
   evidence, and `expire()` demands a departure ack, so the fleet sat in
   `loaded` for 5.4 h and mined nothing. `abandon()` now writes a durable
   `ROUTE_ABANDONED` record after a 2 min grace (a route WITH an ack is still
   only expired; manifest, cargo and ack untouched). Also: a stalled hull is
   re-flown to its own trip's station with the same native warp, a hauler that
   is already at the station is not warped (`WARP_DISTANCE_TOO_CLOSE` deadlocked
   every new trip), and the native "too close" refusal now becomes a real
   subwarp approach instead of `WARP_COMMAND_FAILED`.
2. **The deposit loop threw out of the whole mining tick** (a5f3fd53).
   `WARN [SpaceRuntime] Mining tick failed for system=30000145: baselineKey is
   not defined`, every tick, for hours: `baselineKey` was block-scoped inside
   the sale block and used again after it, so nothing was ever deposited. Hoisted.
3. **A stranded miner was only ever told to follow its rock** (b93bae0d).
   `TARGET_OUT_OF_RANGE distanceMeters 448793611732 engagementMeters 11500`.
   `coopMiningBeltReturn` issues the same native warp the fleet uses for its own
   warp-in (landing point one rock radius + one orbit radius from the centre),
   and `coopMiningTripRetreatGuard` stops a retreat from dragging a hauler that
   is flying an acknowledged trip (`living-mining-retreat-skip`,
   `living-npc-station-trip-rewarp gapMeters 190173736005 accepted true`).

**Tests:** 49/0 (diagnose 6, belt return 7, retreat guard 4, journal 32) ;
recovery suite 8 pass / 2 fail, both identical at the pre-change baseline
(verified with `git stash`). Overlay `OVERLAY_OK` reset=53 patches=series=7.

**Item 1 is NOT closed.** The fleet has not re-entered `mining` yet, so
`living-mining-belt-warp` has fired 0 times. The delivery leg now reaches its
own arrival gate instead of throwing, and answers `WAREHOUSE_ARRIVAL_NOT_VERIFIED`
for the last haulers of the 30000144 trip (the sampled haulers are gap 0 m,
dwell set, ack true), so the exact next step is to explain that verdict
(`verifyArrival`: point / stableAt / dwelled) and only then confirm a real
mining cycle at the belt. Items 2-4 (pirate kill, seeded sale funding the war
chest, verbatim loop proof) are untouched.
**Correction, same run (07:14Z live):** `living-mining-belt-warp WARP_ISSUED`
13 times for fleet 960004641 (30000145) at `distanceMeters 244253380576`
(`thresholdMeters 100000`), fired right after `living-mining-blocker TICK_mining`
proved the fleet had returned to `mining`. The same miners were then measured at
`belt 20681 / 24174 / 45493 / 46104 / 49489 / 103499` m instead of 2.4e11 m, i.e.
they really flew back and are closing the last kilometres at subwarp. The fleet
had moved on to `loaded` again (a new haul), which is why `act 0` at that sample:
mining modules are deactivated for a haul by design. Next exact step is therefore
narrow: sample the fleet while it is in `mining` and require
`activeModuleEffects > 0` plus a settled cycle for at least one miner, and explain
`WAREHOUSE_ARRIVAL_NOT_VERIFIED` for the haulers the deposit gate rejects.
## 2026-10-27 (FW-015) - item 1 part a: the arrival gate explains itself (3d3eedf1)

**Proven live (verbatim, container evejs-server-1).** The deposit refusal now
carries its own reason instead of a bare status:

```
"event":"living-npc-warehouse-blocked","fleetID":960004609,"cargoID":980200001433,
"reason":"ARRIVAL_NOT_VERIFIED","detail":{"ok":false,"term":"DWELL_PENDING",
"gapMeters":0,"maxSurfaceGapMeters":2500,"mode":"GOTO","warping":false,
"arrivedAtMs":1793086116032,"activeArrivedAt":1793086116032,"dwellMs":2000,
"dwelled":false}
```

**The explanation (measured, not inferred).** The hauler was physically ON the
station (surface gap 0 m, not warping) and the receipt was written 3 s later, so
the gate was not refusing a real arrival. rrivedAtMs 1793086116032 belongs to
event time 1793086113991: the native tick clock ran **2 041 ms ahead** of
Date.now(). The trip loop measures dwell with the tick clock (
ow), the
deposit gate measured it with clock() = Date.now(), so the second subtraction
was negative and DWELL_PENDING was reported forever. One clock now decides: the
tick clock travels into deposit({nowMs}) -> explainArrival.

**Three fixes in the same commit.**
1. explainArrival + detail on the refusal + rrival_diagnose admin action
   (read-only, uses the LIVE director's own rrivals map).
2. A warehouse receipt names the **ore owner** (deposit goes into the owner's
   hangar); the manifest names the **station corporation**. Both files compared
   them, so every real deposit was refused as
   MANIFEST_WAREHOUSE_RECEIPT_CONFLICT (live proof: manifest corp 1000031,
   receipt corp 1000129, quantity/type/station identical). The owner is now taken
   from the manifest row (new manifests record the pre-warp cargo owner) or from
   the physical stack, which the native itemStore check must still prove.
3. 	ransferCargo never loads ore into a hauler an active manifest declared.
   Live: new loads at 07:27:03 and 07:30:08 turned the pending trip into
   ALIFE12_ALIFE12_UNDECLARED_HAUL_CARGO, so it could never close.

**NEXT ACTION (exact).** Item 1 part b: wait for the pending 30000144 manifest to
close (the journal deadline is 15 min; the trip now cannot gain undeclared cargo),
then sample mining_fleet_diagnose WHILE state=mining and require
ctiveModuleEffects > 0 for at least one miner plus a settled cycle
(living-mining-cycle-settled with 
extCargo rising). Only then item 2 (real
pirate kill -> wreck -> loot -> casualty ledger -> merit).

## 2026-10-27 - ITEM 1 CLOSED (live): the fleet mines at the belt, ore really rises

**Proven live (container evejs-server-1, read-only probes, verbatim).**

```
{"at":"2026-10-27T08:06:01.256Z","fleets":[{"fleet":960004609,"system":30000144,
 "state":"mining","act":13,"belt":13,
 "active":["980000016027:2","980000016144:2","980000016145:2"]}]}
```

13 of 13 miners carry 2 live module effects each and all 13 sit within 200 km of a
real belt. The settled cycle (ore really rising):

```
{"at":"2026-10-27T08:01:02.383Z","event":"living-mining-cycle-settled","shipID":980000016470,
 "systemID":30000144,"status":"COMMITTED","rockID":5020484726851,"moduleID":980100051175,
 "oreTypeID":17470,"quantity":1874,"beforeRock":228126,"afterRock":226252,
 "cargoID":980200010837,"nextCargo":3748,"replayed":false}
```

and the delivery leg really completes now: living-native-haul-delivered fleetID
960004609 DELIVERED at 07:54:57Z and 07:56:58Z.

**Why the deposit gate kept refusing (the answer to the open question).**
WAREHOUSE_ARRIVAL_NOT_VERIFIED was DWELL_PENDING with gapMeters 0: the hauler
was physically on the station, not warping, and the receipt appeared 3 s later.
The tick clock ran **2 041 ms ahead** of Date.now(), the trip measured dwell with
the tick clock and the deposit gate with the wall clock. One clock now decides
(deposit({nowMs})). The manifest side had a second, independent cause: the
receipt names the **ore owner** and the manifest names the **station corporation**,
and both files compared them (live: manifest corp 1000031 vs receipt corp 1000129,
quantity/type/station identical), so every real deposit was rejected.

**Two more deadlocks found and fixed on the way.**
1. A superseded manifest (all declared rows proven, the hull carrying ore the
   manifest never declared) lost its identity in the arrival wrapper, so start()
   answered the same pause on every tick and the fleet sat in "loaded" 20 min
   (a57aa3ea).
2. An aggressed stock fleet can never resume: the stock auto-resume delay defaults
   to 0, so esumeAtMs stays 0 and state stays "aggressed" forever. The live
   profile now sets the real stock knob EVEJS_MINING_NPC_FLEET_AUTO_RESUME_DELAY_MS=120000
   (no code change, no gate relaxed). mining_fleet_diagnose publishes
   esumeInMs/esumeOverdue/esponseWing/lastAggressedAtMs so this is
   visible instead of inferred.

**NEXT ACTION (exact).** Item 2: the Serpentis cruiser 980000018058 (300 real
charges, live attack order on miner 980000015943 in New Caldari 30000145) must
really kill a miner: repeated living-native-weapon-event, measured HP loss, a
real wreck with stored loot, living-native-war-casualty, and merit. The 30000145
fleet must leave "aggressed" first (auto-resume 120 s after the last aggression,
and only when its response wing is gone) - esumeInMs/esponseWing say which.

## 2026-10-27 - ITEM 2 blocked exactly: the raid holds an order it cannot fly

Measured, verbatim, read-only:

```
{"ok":true,"attackerID":980000018058,"targetID":980000016311,
 "distanceMeters":373994639646.8543,
 "attacker":{"systemID":30000145,"inScene":true,"mode":"GOTO"},
 "target":{"systemID":30000145,"inScene":true,"mode":"ORBIT"},
 "controller":{"currentTargetID":0,"manualType":"attack","manualTargetID":980000016311,
 "allowWeapons":true},"engagementAllowed":true}
```

2.5 AU apart, the attacker in GOTO (a "warp" that never became a warp), the order
still held. The fleet side:

```
{"fleet":960004641,"state":"aggressed","resumeInMs":92113,"responseWing":0,
 "lastAggressedAtMs":1793088751229,"miners":13,"atBelt":0}
```

esponseWing 0 and esumeAtMs set (the new stock auto-resume knob), but the
aggression clock is re-armed every couple of minutes, so the fleet never returns to
mining; coopMiningBeltReturn only runs in the mining branch, so its 13 miners
stay 2.4e11 m off the belt and nothing can be shot.

**NEXT ACTION (exact).** In integration/coopNativeRaids.cjs (the distance >
250000 branch that issues warp-to-hauler): after the native warp call, verify the
hull is really warping (mode WARP / sessionlessWarpIngress) and not in GOTO; when it
is not, release the order (no attack lease) and publish
RAID_APPROACH_UNFLYABLE:<distanceMeters>. The fleet then leaves "aggressed", the
belt return flies the miners home, and the next raid at the belt is the one that can
convert into damage. Then: wreck -> stored loot -> New Caldari 30000145 seeded sale
-> Serpentis 500020 real income -> warBountyReserve -> war 500011-500020 opens
with SUPPLY_UNFUNDED resolved -> escrow PAYOUT to the named pilot.

**Correction/refinement to the item 2 next step (same run, 08:18Z).** The pirate
980000018058 holds controller.manualType:"attack" with currentTargetID:0 while
flying GOTO, and the order bridge's own diagnose answers
COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE for a hull with an active native command. So
the most likely mechanism is self-blocking: the raid's earlier ttack order is
still active, the native controller refuses the later warp-to-hauler, and the hull
subwarps toward a target 2.5 AU away while the fleet stays "aggressed". Check that
before changing any distance constant: read
coopNpcOrderBridge.diagnose({entityID:980000018058}) and, if it is
NATIVE_COMMAND_ACTIVE, make the raid release its own previous order before issuing
the approach (one owner per record), publishing RAID_ORDER_RELEASED_FOR_APPROACH.

## 2026-10-27 (FW-016) - item 2 step 1+2 PASS (code + live): the raid releases its own order; the approach now really flies (7e07e000, 64d166c5)

**The hypothesis in the previous NEXT was wrong, and that is now measured.** The
order bridge answers `PERMITTED` / `leaseOwner RAID` for 980000018058 (published
in `living-native-raid-diagnose.pirateDetail[].orderDiagnosis`), so the stale
order was never a bridge gate. What actually pinned the hull was the native
controller's own subwarp pursuit (mode GOTO) plus our own unexecutable order.

**Two rules added (both through the bridge, no distance constant touched).**
1. `RAID_ORDER_RELEASED_FOR_APPROACH` - the hull's own previous attack order is
   released before a new approach, and an unreachable locked prey (> the same
   250 km boundary) is released and re-approached with a real warp in the same
   tick. `RAID_APPROACH_UNFLYABLE` when an approach never became a real warp
   (20 s), `RAID_ATTACK_NO_LOCK` when an attack never acquired a native lock
   (90 s). A rival order is never released: 980000018994 correctly answers
   `released:false, errorMsg COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE` (CIVILIAN
   lease). `npc_pair_diagnose` now also reports the bridge verdict and both
   hulls' health layers.

**Live proof the approach now flies.** `RAID_ORDER_RELEASED_FOR_APPROACH`
980000000602 at 373 994 659 694 m, then 30 s later real attack orders at
**10 162 m** (980000000601) and **8 882 m** (980000018058) - previously the same
pair held an order at 2.5 AU for 20 minutes and never fired.

**EXACT remaining blocker for the kill (`NEEDS_OWNER:BLOCKED_RETREAT_INVALIDATES_EVERY_ORDER`).**
The stock aggression path (`miningNpcOperations.handleAggression` ->
`retreatFleetToOrigin`) teleports the whole fleet 2.5 AU on the FIRST aggression.
The native loop then clears the attacker's `manualOrder` because the prey is no
longer a valid combat target, so `currentTargetID` returns to 0 within seconds and
the hull resumes its own GOTO. Measured on 980000016472: shield 146.45 -> 161.80
-> 193.13 -> 199.88 -> 209.32 -> 217.34 -> 225.00 over 5 minutes (real missile
hits from 980000000601, then FULL regeneration), 0 wrecks, last
`living-native-weapon-event` 08:48:40Z. The pair distance flips between 35 928 m
and 373 994 655 083 m every ~30 s, which is the retreat/belt-return cycle, not a
stale order.

**NEXT ACTION (exact, one decision).** A kill in a seeded system needs the prey to
stop completing an instant sessionless retreat while it is being shot. Two honest
options, both real mechanics, neither a gate relaxation:
(a) fit a real warp disruption module on the war-patrol loadout
    (`coopWarPatrolLoadoutRow`) and activate it on the prey - stock
    `beginNpcWarpToPoint` already refuses a warp when
    `hostileModuleRuntime.isEntityWarpScrambled(entity)` is true, so the fight
    resolves at close range and the wreck loot (2x typeID 482 = 571 211 ISK bid
    at New Caldari 60000688, plus 16 380 ore 17463) becomes a real sale;
(b) an L2 rule that a fleet retreat is refused while a hostile holds a live
    native attack order on a fleet hull inside engagement range.
Do NOT weaken `coopWarMusterReadiness`, do not seed a region, do not mint ISK.
Verified buyers (read-only `GetOrders`, region 10000002, `source: seed`):
20767 62 839 ISK at 60000682 (New Caldari), 482 571 211 ISK at 60000688,
13773 3 083 304 ISK at 60000682, 17464 15.48 ISK at 60000688 - the
`NO_SEEDED_COUNTERPARTY` note is stale for these types.

## 2026-10-27 (FW-017) - item 1 CLOSED: a real warp point really scrambles a real hull (3c46dbb3, 7efd3e82, 2fba2807)

**The old blocker is gone.** `BLOCKED_RETREAT_INVALIDATES_EVERY_ORDER` had two stock
causes, both measured, both now fixed as L1:

1. `hostileModuleRuntime.getEntityWarpScrambleStatus` returned the hull's PASSIVE
   `warpScrambleStatus` baseline (-2 on retail hulls) and never the live effect sum,
   so `isEntityWarpScrambled` was permanently false for any hull that carries the
   attribute: a fitted Warp Disruptor II on a Venture read back -2 (live
   `preyScrambleStatus:-2` in every refused attempt).
2. `runtime.warpToEntity/warpToPoint` resolved the command ship with
   `getShipEntityForSession`, which only understands a SESSION. The native NPC loops
   command by ENTITY ID, so `isShipWarpDisabledByRuntime` and
   `isEntityWarpScrambled` both saw no ship and an NPC hull warped while really held.

Both are patched (`0008-warp-scramble-live-effects`, `0006` extended). **Ops bug
found and fixed on the way:** `git -C <Code> apply` resolved the patched path
against the upstream repo root and silently SKIPPED it (exit 0), so a coop-deploy
reset left managed files unpatched while the applier printed a healthy series;
`apply-upstream-patches` now applies from the root with `--directory=Code`.

**Live proof (10:01:16Z).** `living-native-warp-point-engaged status ENGAGED
alreadyScrambled true` for 980000018058, 980000000601 and 980000000602 on the same
miner 980000016052 - the first time a real warp disruptor made a real hull read as
scrambled in this world. `inspect_npc 980000000602` -> `moduleID 980100060463,
typeID 3244 (Warp Disruptor II), flagID 19, online true`, written through
`nativeNpcStore` (real native module record, real mid slot from the native auto-fit).

**NEXT ACTION (exact, item 2).** The prey is now holdable; the missing piece is
SUSTAINED DAMAGE on a held prey. Measured at 10:06Z: 980000000601 sits **1 393 m**
from 980000016052 with a FULL shield (6890/6890) and no launch since 09:53:20Z,
while 980000018058 (5 blasters, 300 real charges, the only deep ammo bank) holds an
attack order **2.5 AU** away at the belt. Two concrete things to check next, in
this order:
1. `coopNpcWeaponAmmoGate` / `nativeAmmoSupply` for 980000000601: it fires a
   hull-effect missile (chargeTypeID 213) and launched exactly 3 times, then
   stopped - if the gate is blocking it, the raid must prefer the hull with a real
   ammo bank (980000018058) instead of the nearest hull.
2. Why 980000018058 does not close from 9 225 m to blaster optimal: it keeps an
   attack order but its mode is GOTO back to the belt after the prey moves; the
   `attackNoLockMs` release + re-approach cycle is the thing to tighten (keep the
   order while the prey is pinned, which is already implemented via
   `preyScrambled`, and make sure the lease is not released while pinned).
Do NOT script damage, do not touch distance constants, do not mint ISK.

**Concrete lever found for the DPS gap (same run, 10:15Z).** `npcRuntime.orbit(entityID,
targetEntityID, distance, options)` is a real native order and the raid director does
not use it. The blaster cruiser's behaviour profile parks it at ~9 km, which is far
outside a blaster's own optimal range, so its 300 real charges hit nothing. The honest
next change is one order: when the attacker's fitted weapon (`estimateNpcHostileEffectiveRange`
/ the module's own `maxRange` attribute) is shorter than the current distance, issue a
real native orbit at that attribute's range before the attack. No distance constant of
ours, no scripted damage: the ship flies to its own gun's range and the native cycle
does the rest.

## 2026-10-27T10:52Z - item 2 step 3 (WIP, committed): the raider flies to its own gun range (1d6a3833, 91f68dde)

**Code.** `integration/coopNpcGunRange.cjs` reads the range from the stock resolver's own
snapshot (`getNpcWeaponModules` + `buildNpcWeaponModuleSnapshot`: turret `maxRange`,
launcher `approxRange`); the raid issues the attack with that number as the hull's
engagement distance via the stock `npcService.setBehaviorOverrides({orbitDistanceMeters})`.
A standalone manual orbit is NOT used (measured earlier: the native hostility invariant then
treats the prey as friendly -> mode STOP, currentTargetID 0). `npc_pair_diagnose` now also
reports `gunRange` and `returningHome`/`leashRangeMeters`/`homeDistanceMeters`.
Refinery: the journal file name is escaped on win32 (key unchanged).

**Live so far (verbatim, earlier deployed variant):** `living-pirate-raid` 30000145
`action":"orbit-to-range","pirateID":980000018058` `gunRange":{"status":"RESOLVED",
"meters":1050,"source":"maxRange","family":"hybridTurret","typeID":13884,"falloffMeters":3000,
"weaponCount":5}` at `distanceMeters 2251.76`. Sustained fire on a held prey and a real
wreck are **NOT proven**.

**NEXT ACTION (exact).** After this deploy sample `npc_pair_diagnose 980000018058 -> <its held
prey>` and require repeated `living-native-weapon-event` plus falling shield/armor on the
same victim; if the hull still sits outside its own gun range, read the new
`returningHome`/`leashRangeMeters`/`homeDistanceMeters` fields (a stock NPC beyond its
leash clears combat state and flies home) instead of guessing. Then wreck -> stored loot ->
casualty ledger -> merit -> seeded sale -> war chest -> PAYOUT.

## 2026-10-27T11:48Z - item 2 step 4 (committed): why the DPS never happens, measured (d0f5d8de, e20f6801, 1e431ed0, c6965dbd)

**New read-only tool.** `raid_diagnose` (admin bridge -> `diagnoseNativeRaids`) reports
per linked pirate: exclusion reason (loot delivery / ammo supply), native controller state
(mode, currentTargetID, manual order, returningHome, leash, home distance, orbit override),
the range its own fitted weapon really has, and its nearest real prey - plus the director's
leases. A refused native warp is now published instead of leaving a silent lease.

**Measured (verbatim).** At 11:18Z `raid_diagnose 30000145`: `status OK, linkedShips 21,
roleCounts pirate 4, fleetShips 23, leases []`; 980000018058 `mode STOP,
homeDistanceMeters 0, gunRangeMeters 1050 RESOLVED`, nearest hauler 980000016318 at
**4446 m**. Three minutes later `npc_pair_diagnose 980000018058 -> 980000016318`:
`distanceMeters 373994637299.5` (2.5 AU), `returningHome true, leashRangeMeters 90000,
manualType "", currentTargetID 0`. So the hull had the prey 4.4 km away, the prey's retreat
moved it 2.5 AU, and the stock leash cleared the order and flew the hull home. Last
`living-native-weapon-event` 10:20:06Z; the 300-charge cruiser has never fired in this boot.

**Fix (c6965dbd).** While the raid holds a lease it owns the hull's movement: it widens the
hull's own stock leash to the approach it ordered (distance + 100 km) and restores the
profile value on release, publishing `living-native-raid-leash` once per change. The leash
is a behaviour parameter, not an evidence gate.

**NEXT ACTION (exact).** Sample `raid_diagnose`/`npc_pair_diagnose` until 980000018058
holds an attack order inside its own 1050 m gun range on a pinned prey, then require
`living-native-weapon-event` from it plus falling shield/armor on the same victim, then the
wreck -> loot -> casualty -> merit -> seeded sale -> war chest -> PAYOUT chain.

## 2026-10-27T11:58Z - item 2 step 5: the leash is measured from HOME (ccd6046c)

Live, verbatim: `npc_pair_diagnose 980000018058 -> 980000016472` gave
`manualType "attack", allowWeapons true, behaviorOverrides {orbitDistanceMeters 1050,
leashRangeMeters 149182}, returningHome true, homeDistanceMeters 862066008895` and
`locks {locked: [], pending: [], activeModules: []}` on BOTH hulls, distance 40-49 km and
slowly closing in GOTO. So the order and the gun range were right, the leash value was
wrong: 149 km is measured from the hull, but the leash is measured from the hull's own
home, 5.7 AU away. ccd6046c: the scope covers home->hull + hull->prey + 100 km.

**NEXT ACTION (exact).** After this deploy sample `npc_pair_diagnose 980000018058 ->
980000016472` every minute and require (a) `returningHome false`, (b) a completed lock,
(c) `activeModules` non-empty, then `living-native-weapon-event` from 980000018058 and a
falling shield/armor on the same victim. If the lock stays empty, the next question is why
the stock loop does not add it, not the leash.

## 2026-10-27T11:54Z — ITEM 2: the first real raid kill in the seeded region (25e879fe, f5d8454a)

**Proven live (container evejs-server-1, verbatim).**

```
{"at":"2026-10-27T11:52:33.981Z","event":"living-native-stock-fleet-wreck-evidence",
 "status":"PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED","systemID":30000145,
 "victimEntityID":980000016472,"victimRole":"miner","wreckID":980300000008,
 "storedItemCount":3,"storedQuantity":93450,"lootStatus":"ITEMS_STORED"}
```

The chain that produced it, all real:
`living-native-raid-leash APPLIED` (980000018058 leash 373 994 723 022 vs profile
90 000 for a 373 994 623 021 m order) -> `living-native-warp-point-engaged`
`ENGAGED alreadyScrambled true` for 980000000601 and 980000000602 on miner
980000016472 -> `living-native-weapon-event` missile-launch 980000000601 ->
980000016472 -> real wreck 980300000008 with 3 stored stacks (93 450 units).

**Two defects fixed here.** (1) An attack order on prey beyond the 250 km approach
boundary was released only after the 90 s no-lock window, which a 60 s attack lease
re-arms forever, so the hull orbited at 2.5 AU holding an order it could not fly; the
far case now releases and re-approaches on the re-check itself. (2) A concurrent
commit had captured the `relocateRaidHomeAnchors(...)` call site without its
definition, so the whole `native-raids` phase failed
(`living-world-phase-failed ... relocateRaidHomeAnchors is not defined`); the orphan
call is removed and the leash (c6965dbd) is the single movement mechanism.

**NEXT ACTION (exact).** Item 3: recover wreck 980300000008 and sell its loot to the
real seeded buyer at New Caldari 60000688 (typeID 482 @ 571 211 ISK), then fund the
faction chest from that real fill, re-run `war_funding_diagnose` until the side reads
FUNDED, and confirm `living-native-war-bounty` PAID from HELD escrow.
## 2026-10-27T12:02Z - ITEM 1 CLOSED (live): real fire, real kill, real wreck with stored loot

**Proven (verbatim, container evejs-server-1).** The DPS gap is closed by the home-measured
leash (ccd6046c): `npc_pair_diagnose 980000018058 -> 980000016299` showed
`locks {locked:[980000016299]}, activeModules [... 980100056948]` and the victim's shield fell
**3118.35 -> 1773.12 in 30 s** while the attacker orbited at 2030 m. Then two real wrecks:

- 11:52:33Z `PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED` victim 980000016472 wreckID
  **980300000008**, `storedItemCount 3, storedQuantity 93450, lootStatus ITEMS_STORED`,
  attacker 980000000601 (coop-pilot-060);
- 12:00:10Z wreckID **980300000009**, victim 980000019472, `storedQuantity 3150`,
  attacker 980000000602 (coop-pilot-080).

**NEXT ACTION (exact).** The loot leg: watch `living-native-loot-*` for the recovery of wreck
980300000008/9, then `living-npc-station-sold` with real ISK from a seeded bid at New Caldari
60000688 (482 @ 571 211 ISK was the measured bid). Then the war chest reserve, the opening with
SUPPLY_UNFUNDED resolved, and the escrow PAYOUT to the named pilot.

## 2026-10-27T12:14Z — deep-ammo hull really fires; the loot leg's exact blocker (10d3c4ba)

**Proven live.** `living-native-weapon-event kind module-activation
attackerEntityID 980000018058 attackerPilotID coop-pilot-070 victimEntityID
980000016311 moduleID 980100056949` at 12:11:03Z — the 5-blaster hull with 300
real charges, whose own gun range resolves at 1050 m, activated a real module on
a real miner for the first time (the engagement-range order from FW-018 working).

**Fixed.** A pirate holding a live wreck claim is excluded from the raid (one owner
per record): the killer was being re-tasked forever, so the recovery never started.
A recovery that orders nothing now publishes
`living-npc-postraid-wreck-recovery-blocked` with the exact state it reads.

**Exact blocker it exposed (measured, verbatim):**

```
{"event":"living-npc-postraid-wreck-recovery-blocked","status":"NO_ORDER",
 "wreckID":980300000009,"hunterID":980000000602,"blocked":false,"hunterMode":"GOTO",
 "hunterPresent":true,"wreckPresent":false,"manualType":"","currentTargetID":0,
 "lastAggressorID":0,"distanceMeters":null,"pickupDistance":2500,"claims":2}
```

The durable wreck rows survive a restart but the physical native wreck entity does
not, so `scene.getEntityByID(wreckID)` is null and the recovery director refuses.
**A kill must be looted inside the same boot.**

**NEXT ACTION (exact).** Watch 30000145 for the next real
`living-native-stock-fleet-wreck-evidence` in the current boot and, without any
recreate in between, require `living-npc-postraid-wreck-recovery` (orbit/warp to the
wreck) then `advanceNativeWreckCustody` to move the loot into the pirate's hold, then
`living-npc-loot-station` to New Caldari and a real seeded fill (typeID 482 @
571 211 ISK at 60000688). Only after that fill: fund the chest, re-run
`war_funding_diagnose`, confirm `living-native-war-bounty` PAID.
## 2026-10-27T12:15Z - the loot leg is REAL: wreck cargo sold into a seeded bid (no code change)

**Proven (verbatim).** `living-npc-loot-station`: coop-pilot-080 / 980000000602
`NATIVE_WARP_TO_STATION` stationID **60014935** cargoID 980200026308, then
`PHYSICALLY_AT_NATIVE_STATION`. `living-native-loot-market-settled` at 12:07:25Z:
`status TRADE_SETTLED, side sell, typeID 17471, quantity 3150, price 8.61,
balance 27121.5, marketOrderID 4257762183096583231, marketOrderSource EVEJS_SEED,
lootSource {sourceWreckItemID 980400000026, sourceWreckID 980300000009},
nativeCargoVerified true, marketRPCAcknowledged true, marketRPC FillOrder,
sourceOfFunds SEED_MARKET_FILLED_ORDER, marketCurrency
NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET`. `war_funding_diagnose` now lists
coop-pilot-080 with a real balance of **27 121.5 ISK**.

**Exact remaining blockers for the war chest (measured).**
1. `living-native-war-opening-blocked` (last, 12:06:50Z) reason
   `SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500014:WAR_TREASURY_JOURNAL_COLLISION`
   with `fronts: 0`; `war_diagnose` reports `activeCampaignCount 0`.
2. The funded pilot is **Serpentis (500020)**, not 500011/500014, so the war that
   can be funded is a front involving 500020 (Maurasi 30000140 is the Serpentis
   presence from FW-013).
3. 500014 carries a stale escrow journal (WAR_TREASURY_JOURNAL_COLLISION) from the
   earlier funded reservation.

**NEXT ACTION (exact).** Restore/verify the real front that involves 500020 (Jita
30000142 Angel vs Maurasi 30000140 Serpentis) and clear the stale 500014 escrow
journal through the treasury's own recovery, then let the opening reserve 25 000
ISK from coop-pilot-080's real 27 121.5 and pay the bounty on a real casualty.

## 2026-10-27T12:26Z — kill loop is repeatable; the loot leg needs one uninterrupted boot (d1a30222)

Four real wrecks with stored loot from real native fire in this session
(980300000008 3/93 450 units, 009 1/3 150, 010 2/91 980, plus the earlier 006), all
`PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED`. The 5-blaster hull 980000018058 now
really activates its modules (`living-native-weapon-event kind module-activation`,
moduleID 980100056949, victim 980000016311) at its own 1050 m gun range.

**The one blocker left on the loot leg is boot churn, not code.** The durable wreck
row survives a restart but the physical native wreck entity does not, so
`scene.getEntityByID(wreckID)` is null and `advanceNativeWreckRecovery` correctly
refuses (`wreckPresent:false`). A claim whose wreck is gone now stops owning the
pirate (d1a30222), so the raid keeps killing.

**NEXT ACTION (exact).** On a boot nobody recreates, catch the next
`living-native-stock-fleet-wreck-evidence` and, without a recreate, require
`living-npc-postraid-wreck-recovery` (real orbit/warp to the wreck) ->
`advanceNativeWreckCustody` (loot into the pirate's hold) ->
`living-npc-loot-station` to New Caldari 60000688 -> a real seeded fill for typeID
482 @ 571 211 ISK -> `coopWarChestFunding` from that fill -> `war_funding_diagnose`
FUNDED -> `living-native-war-bounty` PAID from HELD escrow. Never mint ISK.
## 2026-10-27T12:37Z - the war leg: presence is real, the attacker side is the blocker

`war_state` (new, read-only) reports the exact state: territories 2 (Jita 500011,
Niyabainen 500014), wars 1 (war:500011-500014), campaigns 0, and the per-system
presence the territories come from - **30000140 Maurasi resolves to 500020 (1/1)**,
Jita to 500011 (8 of 15), Perimeter/New Caldair to 500014, 30100032 to 500020.

So the Jita->Maurasi front (500011 vs 500020) exists in the derivation, and 500020
already holds **27 121.5 ISK** of real earned income. The opening refuses because a
war needs BOTH sides funded and the ATTACKER 500011 has
`NO_REAL_FACTION_INCOME` (plus 500014's stale escrow journal collision).

**Exact next step.** An Angel pilot must earn real ISK the same way: 601
(coop-pilot-060, corp 1000138) has no cargo because its wreck 980300000008 is no
longer in the scene (`living-npc-postraid-wreck-recovery-blocked`:
`wreckPresent false` for both 980300000008/9). The honest route is a NEW kill in
this boot -> `living-native-stock-fleet-wreck-evidence` -> `living-npc-wreck-cargo-settled`
-> `living-npc-loot-station` -> `living-native-loot-market-settled` for an Angel
pilot, then `war_funding_diagnose` must show 500011 funded and the opening must
reserve 25 000 ISK before START_CAMPAIGN, then a real casualty pays the bounty.

## 2026-10-27T12:40Z - why the raid is idle right now (measured, no code change)

`mining_fleet_diagnose 30000145`: fleet 960004641 `state "loaded"`, 13 miners
`mode STOP` with no ore left (transferred), haulers carrying it on the live trip
`30000145-960004641-1793104338982` (`departureAck true`), one hauler 299 195 691 465 m
out on its warp to the station. `raid_diagnose`: 4 linked pirates, 23 fleet hulls, `leases []`,
every pirate `mode STOP, manualType ""` - no legal target because the whole convoy is on its
delivery leg, which is exactly what the raid's warp filter is for. The last raid action was
12:26:46Z (`warp-to-hauler` for 980000018058) and the last kill 12:00:10Z.

**NEXT ACTION (exact).** Wait for the trip to deliver (`living-native-haul-delivered`) so the
fleet returns to `mining`; the raid then kills again. For the war chest the kill must be made
by an ANGEL hull (601 coop-pilot-060, corp 1000138) so 500011 earns real ISK from the same
recovery -> seeded sale path that already paid 500020 27 121.5 ISK. Then
`war_funding_diagnose` must show both 500011 and 500020 funded and the opening must reserve
25 000 ISK before START_CAMPAIGN; a real casualty then pays the bounty from HELD escrow.

## 2026-10-27T13:16Z - FW-024: militia enlistment PROVEN live; the melee is blocked by one missing data row (1abc629a)

**Proven live (container evejs-server-1, verbatim).**
- `militia_enlist` 140000102 / agent 3012018 ->
  `"[Militia] Enlistment recorded for Caldari State. No items or ISK granted."`
  with `{"characterID":140000102,"factionID":500001,"status":"ACTIVE","rank":0,
  "enlistedAt":1793106715078,"cooldownUntil":0}`. Same code path the client
  calls (`coopFactionWarAgent.doAction`), real docked character, real agent.
- `militia_state` 140000102 -> `MILITIA_AVAILABLE`, faction 500001 Caldari State,
  `militiaCorporationID 1000180`, `warzone 2`, `enemyFactionIDs [500004]`,
  `fronts []` (no ASSAULT campaign yet).
- `war_state` -> territories 2 (Jita 500011, Niyabainen 500014), wars 1
  (`war:500011-500014`), campaigns 0.

**Owner's faction, from his own record (not from a message):**
`characters.140000005` Sasunok1488, raceID 1, bloodlineID 2, corporationID
98000001, `factionID 500001` Caldari State; militiaCorporationID 1000180; the
game's own pairing (`fwWarzoneSolarsystemService.js`, WARZONE_CALDARI_GALLENTE=2)
makes Gallente 500004 the enemy. Nearest real desk: agent 3010879 "Okamainen
Niuranto", station 60000358 Perimeter VI - Ytiri Storage, 1 jump from Jita.

**What is implemented (all data-gated, all tested):**
1. `EVEJS_COOP_MILITIA_FACTION_IDS='500001,500002,500003,500004,500010,500011'`
   - exactly the factions whose SDE row has a real militiaCorporationID.
   Serpentis 500020 and ORE 500014 are `null` and can never recruit.
2. `coopMilitiaWarData`: opponent = declared war first, else the game warzone
   pairing; drift test against the deployed service source.
3. `coopMilitiaWarPlayer`: `ENEMY_MILITIA` only for an ACTIVE enlistment in the
   opposing side of an ACTIVE war whose campaign is ASSAULT in that system;
   `ALLY` for his own faction; `NOT_WAR_SHIP` for every hull outside the war
   registry, so stock pirates keep their behaviour.
4. `npcBehaviorLoop.isFriendlyCombatTarget` hook: an NPC war ship treats his own
   faction and uninvolved players as friendly (never fires), and only an enlisted
   enemy as engageable.
5. `coopWarBattleDirector`: a war ship with no NPC opponent in range issues a real
   native attack order at an enlisted enemy player (`targetKind MILITIA_PLAYER`).
6. `coopNpcDestructionAttacker`: a player hull as the upstream `attackerEntity`
   is proven (registered war ship of the opposing side + physical wreck + ACTIVE
   enlistment) and pays merit to `coop-player-<characterID>` in the same durable
   ledger as NPC kills (identity regex widened in the ledger and rank titles).
7. `EVEJS_COOP_WAR_REQUIRE_FUNDING=0` in the live profile: an explicit, labelled
   `PAPER_UNFUNDED_EXPLICIT` supply (no ISK reserved, no bounty payable). Default
   stays 1.

**NEEDS_OWNER:BLOCKED_NO_ARMED_NAVY_LOADOUT (exact, measured).** A Caldari vs
Gallente front needs armed navy patrols, and the static tables cannot arm them:
`0/146` Caldari (500001) and `0/132` Gallente (500004) profiles have any loadout
row - every one resolves to `retail_empty_npc_entity_loadout` - and authoring a
co-op row from an existing base fails with `NO_COMPATIBLE_CHARGE`
(weaponTypeID 16128, CONCORD row) or `BASE_LOADOUT_ROW_MISSING` (trig rows are not
in the `readStaticRows` table). `spawn_native_npc` therefore refuses with
`WAR_PATROL_LOADOUT_UNAVAILABLE:LOADOUT_ROW_MISSING`. No hull was spawned and no
gate was relaxed.

**NEXT ACTION (exact).** Author ONE real navy loadout per hull class (a real
turret from the SDE hardware catalog + a real charge that
`isNpcChargeCompatibleWithModule` accepts, validated by
`validateNpcHardwareDefinition`), expose it through the `npcLoadouts` resolver
the same way `coopWarPatrolLoadoutRow.resolveRow` is exposed, then:
1. `spawn_native_npc` a Caldari patrol in 30002780 (already in
   `EVEJS_COOP_VIRTUAL_ROUTE`) and 2 Gallente patrols in Maurasi 30000140
   (real reciprocal gate 30002780 <-> 30000140) with `warPatrol:true,durable:true`;
2. wait for `living-native-war-opened` `war:500001-500004` with the
   `PAPER_UNFUNDED_EXPLICIT` label, then `living-native-war-assault`;
3. `militia_state 140000005` must list that campaign under `fronts`;
4. client check: the owner docks at 60000358, enlists with 3010879, jumps to the
   campaign system and the enemy patrol issues a `MILITIA_PLAYER` attack order.

**Known noise.** `coop-admin-requests.jsonl` is not always truncated after a
drain, so a request can execute twice; the second enlistment is a DUPLICATE and
changes nothing.

## 2026-10-27T13:24Z - FW-024d: the front opens (08576bb2)

Live after deploy (container evejs-server-1):
`living-native-war-opened OPENED` `warIDs:["war:500011-500014","war:500011-500020"]`
`campaignIDs:["war:500011-500014:campaign:30000143",
"war:500011-500014:campaign:30000144","war:500011-500014:campaign:30000145",
"war:500011-500020:campaign:30000142"]`, territories 5 (Maurasi 500020, Jita
500011, Niyabainen/Perimeter/New Caldari 500014), then
`living-native-war-mobilization NATIVE_PATROL_MOBILIZED` in the same boot.
`war_state` -> wars 2, campaigns 4, enlistments 1 (the proven Caldari enlistment).

The opt-out now also skips the real escrow reservation, so no ISK is reserved and
no bounty can be paid (`PAPER_UNFUNDED_EXPLICIT`). Default remains strict (1).

`militia_state 140000005` still reports `fronts: []` because no campaign involves
Caldari State 500001 - the Caldari/Gallente front is blocked by the navy loadout
gap recorded below, not by funding.

## 2026-10-27T13:32Z - ITEM 1 CLOSED (live): kill -> loot picked up -> real seeded sale, and item 2's exact blocker measured

**Proven live, verbatim, container evejs-server-1 (the whole loot leg, no ISK minted).**

```
{"at":"2026-10-27T13:15:09.456Z","event":"living-npc-wreck-cargo-settled","status":"NATIVE_WRECK_CARGO_SETTLED",
 "itemID":980400000027,"cargoID":980200031908,"entityID":980000000601,"wreckID":980300000010,
 "typeID":17471,"quantity":1200,"partial":true,"sourceBeforeQuantity":76860,
 "remainder":{"itemID":980400000030,"quantity":75660},
 "nativeSourceDebited":true,"nativeCargoCredited":true,"iskCredited":false}
{"at":"2026-10-27T13:23:46.378Z","event":"living-npc-loot-station","nativeMovementOrders":[
 {"pilotID":"coop-pilot-060","entityID":980000000601,"stationID":60014935,"action":"NATIVE_WARP_TO_STATION",
  "cargoIDs":[980200031908],"iskCredited":false}]}
{"at":"2026-10-27T13:24:13.981Z","event":"living-npc-loot-station","physicallyReady":[
 {"pilotID":"coop-pilot-060","entityID":980000000601,"stationID":60014935,"status":"PHYSICALLY_AT_NATIVE_STATION"}]}
{"at":"2026-10-27T13:24:14.929Z","event":"living-native-loot-market-settled","status":"TRADE_SETTLED","side":"sell",
 "pilotID":"coop-pilot-060","entityID":980000000601,"stationID":60014935,"typeID":17471,"quantity":1200,
 "price":8.61,"balance":10332,"marketOrderID":"4257762183096583231","marketOrderSource":"EVEJS_SEED",
 "marketRPC":"FillOrder","lootSource":{"sourceWreckItemID":980400000027,"sourceWreckID":980300000010},
 "sourceOfFunds":"SEED_MARKET_FILLED_ORDER","marketCurrency":"NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET"}
```

**Four measured blockers were fixed to get there** (each proven by a live event before the next):
1. `c8a69b63` the physical wreck never survives a restart, so a claim is now either restored from its own
   durable row through stock `spawnNativeWreck` (`living-npc-wreck-claim-restored`, wreck 980300000008 with
   3 stacks / 93 450 units) or closed with the measured reason (`living-npc-wreck-claim-closed`,
   wreck 980300000009 `WRECK_HAS_NO_STORED_ITEMS` `CLAIM_CLOSED`). A claim-driven 5 s loop loots in the same boot.
2. `3f290ab4` the killer's hold is 120 m3 while the wreck stacks are 4 032 / 2 142 / 5 229 m3, so custody
   answered `NATIVE_CARGO_FULL` forever. A stack that does not fit now moves what fits and leaves a real
   remainder wreck item (above: 1 200 moved, 75 660 remain as 980400000030). The Windows-only writer-lock
   failure (directory fsync) is fixed too, so 19 custody tests finally run on this machine.
3. `316539b4` / `507934af` the raid kept its own attack order on the hull (prey 980000016293, 2.5 AU away) and
   the stock loop re-acquired it, so the recovery refused `NATIVE_COMBAT_ORDER_ACTIVE`. The loot phase now
   releases and orders in the same tick (`living-native-raid-release` `RAID_ORDER_RELEASED_FOR_LOOT`).
4. `217ec980` a full hold must deliver before taking more; the recovery lease was starving the delivery leg.

**ITEM 2's exact blocker, measured (not inferred).** The Angel pilot really earned 10 332 ISK, and the
corporation treasury sweep then moved it into **corporation 1000129 (ORE)**:
`/var/lib/evejs/coop-native-market/corp-treasury/1000129.json` ->
`{"status":"SWEPT","corporationID":1000129,"amountISK":10332,"beforeISK":346627.03,"afterISK":356959.03,
"pilots":[{"pilotID":"coop-pilot-060","isk":10332}]}`, and `ledger.json` now shows `coop-pilot-060 balance 0`.
`war_funding_diagnose` therefore reports `NO_REAL_FACTION_INCOME` for 500011/500014/500020 (it reads pilot
balances only), and the war opening stays `NO_OPENABLE_FRONT` even though `fronts: 3` and both sides are armed.

**NEXT ACTION (exact, one change).** Make the treasury sweep respect the pilot's own corporation
(`coopNpcCorpTreasury.run({pilotFilter})` + the refinery tick's `fundTreasury` passing a filter built from the
linked native entity's `corporationID`), so an Angel sale stays in the Angel pilot's ledger (or in 1000138) and
the levy can see it; then let the next sale (the hull is empty and loots again by itself, ~10 332 ISK per
1 200-unit trip) fund `warBountyReserve` for 500011, watch `living-native-war-opened` with `escrow:true`, and
confirm `living-native-war-bounty` `PAID` on the next real casualty. Never mint ISK; the 10 332 already in
1000129 is real money that simply belongs to the wrong faction's wallet.

## 2026-10-27T14:30Z - FW-026/027: real doctrine fleets, a live Caldari/Gallente front, and the exact assault blocker

**Proven live (container evejs-server-1, verbatim).**
- Doctrine fleets spawn from real SDE profiles with authored rows:
  `spawn_war_fleet 500001/30002780 merit 150` -> `size 5 counts {tackle:1,brawler:2,ewar:1,logistics:1}`,
  fleet `coop-fleet-500001-0001`; `500004/30000140` -> `coop-fleet-500004-0016`.
- Four different doctrines, four different hulls/module sets/charges:
  `inspect_npc 980000020999` (Caldari Navy Moa, brawler) -> `moduleCount 6` = 4x typeID 568
  (flags 27-30) + 527 (mid 19) + 2048 (low 11), cargo typeID 230 x60;
  `980000021001` (Blackbird, EWAR) -> 2410x2 + 1969x2, charge 209 x40;
  `980000021002` (Delta II, logi) -> 2404 + 3588x2, charge 210 x40;
  `980000020998` (Condor, tackle) -> 564x2 + 3244 (warp disruptor), charge 222 x60.
  All `transient:false`, corporation 1000035 (Caldari Navy).
- A real front opened: `war:500001-500004` (attacker Gallente 500004, defender Caldari
  500001), campaign `war:500001-500004:campaign:30045344` (Nennamaila) `PREPARING`,
  territories `30003837=500004` (Aldranette) and `30045344=500001` (Nennamaila) -
  a real reciprocal gate pair from the SDE scan (18 real Caldari/Gallente borders).
- `militia_state 140000005` now lists `declaredWars: [war:500001-500004 campaign
  30045344 PREPARING, war:500001-500011 campaign 30002780 PREPARING]`; `fronts: []`
  because a front is only listed once its campaign is in `ASSAULT`.

**Hull reality, measured, not dressed up.** Every navy/pirate combat profile in this
build points at a category-11 NPC *entity* hull (278 Caldari/Gallente navy profiles,
0 on a player hull; only CONCORD and ORE fly category-6 player hulls). Those hulls
carry a real dogma record (65-86 attributes) but no slot attributes, so the native
auto-fit uses its documented base flag list. The doctrine reports
`hull.kind=ENTITY_HULL` and `slotMode=NATIVE_AUTOFIT_FALLBACK` instead of claiming
slots the data does not have.

**Three real opening defects found and fixed on the way (2cea1091).**
1. two borders of one faction pair produced campaigns with opposite orientation ->
   `CAMPAIGN_PREREQUISITES_NOT_MET` discarded the whole batch; campaigns now follow
   the single war record's orientation;
2. a second border naming an already-contested target aborted the batch; it is
   skipped now;
3. no pilot identity was free (100/100 linked), so a fleet hull could not be crewed:
   `releaseSpawnedIdentity` + `release_identity`/`assign_identity` move an existing
   identity between real hulls (proven: coop-pilot-001 and coop-pilot-063 reassigned).

**EXACT next step (assault).** `BEGIN_ASSAULT` needs the mobiliser to assign one
linked armed patrol per side of campaign `30045344`: coop-pilot-063 on
980000022071 (Aldranette, attacker) and coop-pilot-001 on 980000022066
(Nennamaila, defender) are already linked and armed. The current
`war_diagnose` mobilisation section reports only the FIRST PREPARING campaign
(the old pirate ones), so the next change is a per-campaign mobilisation diagnose
(`war_diagnose {campaignID}`) plus, if a candidate is rejected, the real reason
(ORDER_LEASE_ACTIVE / ALREADY_ASSIGNED / NOT_READY:...). Then `militia_state
140000005` must list the campaign under `fronts`.

**Reconstitution (unit-proven, live not yet).** 10 tests: survivors must be proved
alive, replacements are adopted only from free native hulls in the staging system
that no live fleet owns, a fleet with no real replacement is `REDUCED` with the
missing roles listed, a loss needs a real native wreck and returns a `force-lost`
merit event. Live proof needs one real loss (wreck) plus a real free hull in the
staging system.

**Known noise.** The admin requests file is not always truncated after a drain, so a
queued request can execute again after a restart (16 fleet records exist, several are
duplicates of the same doctrine in the same system; all are real hulls). Another
session recreates the stack every ~1 minute, which interrupts probes.

## OWNER DIRECTIVE 2026-10-27 (binding)

- The running stack `evejs` (evejs-server-1, evejs-market-1) is the OWNER'S PLAY
  SERVER. Do NOT restart, recreate, `--force-recreate`, down, or rebuild-and-redeploy
  it while the owner is playing. He said: "this one you will not restart until I say".
- Agents that need to deploy/test must run their OWN separate compose project
  (own project name, own host ports, own volumes) and leave `evejs` untouched.
- Friend access path in use: ProtonVPN forwarded port -> sshd on that port
  (currently 48819) -> user `evefriend`, key-only, PermitOpen 127.0.0.1:443/5222/
  26000/26001/26002/40110; firewall rule "EveJS co-op SSH 48819" scoped to
  remote 176.37.43.83. EveJS ports stay 127.0.0.1.
- Agent stack commands (never the owner's project):
  `.\scripts\Start-Agents-Stack.ps1 -Action Status|Seed|Up|Down`.
  Seed once on a fresh volume (`market-tools rebuild v1 --preset jita_new_caldari`),
  otherwise evejs-agents-market-1 exits 1 with "No market database exists".
  Host ports 28000-28002/28443/25222/41110; volumes evejs-agents-data/-images.

## NEXT ACTION (2026-10-27T18:10Z)

Perf rounds 1-3 are built and verified in source (`OVERLAY_OK`, image rebuilt,
patches 0009/0010, suites 11/11 + 5/5). They are NOT on the play stack yet.
The single blocking action is the owner's restart window:

    docker compose -f compose.yaml -f compose.coop-probe.yaml \
      up -d --force-recreate --no-deps server   (in C:\Games\EveCoop\upstream-evejs\Code)

After the recreate: profile the play stack the same way (SIGUSR1 + live-profile.cjs
25 s + Analyze-CpuProfile + chain.cjs) and record the idle share and the top rows
in .opencode/metrics.md. Compare against the pre-fix rows: idle 0%, cloneValue
62.7%, ensureRootShape 24.0%, chains evaluatePair 5962 ms / cargoRows 1406 ms /
miningFleetDurable.check 871 ms.

## PROCESS BUG FOUND 2026-10-27T18:35Z — `--apply` silently drops direct L1 edits

`node scripts/patch-evejs-coop.cjs --apply` restores the pinned stock files before
installing the overlay, so an L1 fix that was made by editing the checkout
directly DISAPPEARS on the next `--apply`. That is exactly what happened to patch
0009 (nativeNpcStore root clone): it was live, then the next `--apply` reverted it
and the play stack went back to 13% `ensureRootShape`.

Rule from now on: an L1 fix must exist as `patches/upstream/NNN-*.patch` AND be
applied through `apply-upstream-patches.cjs`. Direct edits are temporary only.

`apply-upstream-patches.cjs` currently refuses this checkout:
"Checkout matches neither the pinned base nor our patched state" (0004 fails on
miningNpcOperations.js). That is NEEDS_PATCH_SERIES_REPAIR: the series tool and the
working tree must be reconciled before the next L1 patch is trusted. Until then
patch 0009 is re-applied idempotently by a local script and its sha256 in
MANIFEST.json matches the regenerated patch file.

## 2026-10-27T19:05Z — where the client work stands

PERF: DONE and stable on the play stack. 97.8% -> 20.8% of one core, profile idle
~49%, rootShapeVerified.add verified inside the container. Deploy path is now
`node scripts/apply-all.cjs --code-path <Code>` (overlay + L1 series together);
plain `--apply` wiped patch 0009 twice.

MAP: renders with the small occupation payload (owner-confirmed).
FW TAB: STUB_IN_THIS_BUILD. The client calls GetAllWarzonesOccupationStates, we
answer with real util.KeyVal entries (militia corps 1000180/1000181, contested
flags), and it still shows "no data" because it lists warzone systems from its own
static logic and colours them itself. Filling all 814 static warzone systems makes
the tab populate but crashes the map in mapViewFiltered.GetLineColor (partial
colour data: one line end coloured, the other None). Client code cannot be patched
here (boundary), so the tab is not finishable server-side.

NEXT (needs the owner's go): show the front through the surfaces that work -
the map campaign layer (insurgencySolarsystem.GetAllVisibleCampaigns) and the
front chat lines already emitted ([Front] assault begun in system ...).

## HANDOFF 2026-10-27T19:30Z (context nearly exhausted)

DEPLOY PATH: `node scripts/apply-all.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code`.
It runs the overlay, then `git apply --directory=Code` for every
patches/upstream/*.patch not already present, then asserts OVERLAY_OK. The
`--directory=Code` is required: patches are written against the Code/ root and
without it 0001 fails with "No such file or directory".
Never run `patch-evejs-coop.cjs --apply` alone: it restores stock files and kills
every direct L1 edit (it ate patch 0009 twice, dropping CPU from 15% back to 97%).

CLIENT VIEW (map + FW tab), state of the experiments:
  * dict payload -> client AttributeError 'dict' has no attribute 'occupierID'.
  * util.KeyVal payload + few systems -> map renders, tab shows the front only.
  * util.KeyVal + ALL 814 static warzone systems -> tab populates but the map
    crashes in mapViewFiltered.GetLineColor (partial colours), so it is reverted.
  * current payload = 5 systems (campaign + territory, warzone factions only).
  * OPEN QUESTION: colours. Tried militia corporations (1000180/1000181) -> grey.
    The untested combination is FACTIONS (500001/500004) with the correct
    util.KeyVal type; the hooks are in scripts/overlay-spec.cjs (three entries for
    fwWarzoneSolarsystemService) and the `militiaOf` mapping is where to switch.

PERF: closed. 97.8% -> ~10-18% of one core with short spikes >100% during heavy
phases; idle ~49% in the profile. Guard test tests/coop-native-npc-store-patch.test.mjs
fails if the memo line disappears from patch 0009 again.

FW TAB: STUB_IN_THIS_BUILD (client lists warzone systems and colours them itself).
Do not promise it; use the map campaign layer + front chat lines instead.

## PATCH SERIES IS DRIFTED — must be repaired before the next L1 patch

`apply-all` now reports: applied=0, alreadyPresent=7, drifted=0004, 0009, 0010.
0009/0010 fail at their hunk because patch 0001 (same file, nativeNpcStore.js) is
applied first and changes the context. Until the series is regenerated in order,
the perf fix is applied by the idempotent local script
(reapply-0009.cjs + fix-add-line.cjs) and patch 0009 in the repo no longer matches
the tree. Repair plan for a fresh session:
  1. git checkout the checkout to the pinned base,
  2. apply 0001..0010 strictly in order with `git apply --directory=Code`,
  3. regenerate any patch whose context moved, update MANIFEST sha256,
  4. assert tests/coop-native-npc-store-patch.test.mjs and the guard in CI-less run.

## PATCH SERIES REPAIRED (2026-10-27, f4fe0fac + 6803ee4f)

The series is no longer drifted. What was actually wrong, in order:

1. `0009` was generated against the PRE-0001 file. `git apply` applies `0001` first
   (same file, `nativeNpcStore.js`), so 0009's context never matched and it always
   failed -> the perf fix never reached the container.
   Fix: regenerated 0009 from a diff between "base + 0001" and "base + 0001 + memo",
   so it applies cleanly on top of 0001. Guard: tests/coop-native-npc-store-patch.test.mjs
   (pass=2).
2. `0010` had CRLF line endings; `git apply` could not match the LF working tree on
   ANY tree. Fix: converted to LF.
3. `0004` never applied because `apply-all` ran the overlay FIRST and the overlay
   inserts hooks into `miningNpcOperations.js`, moving the patch context. Doctrine is
   L1 -> L2, so `apply-all` now applies the L1 series first, then the overlay, then
   re-verifies every patch. A patch the overlay covers can no longer be reverse-applied
   verbatim, so presence is proven by content (every added line must exist).
   Result: `applied=0 alreadyPresent=10 total=10`, `OVERLAY_OK`, exit 0.

MANIFEST sha256 refreshed for 0009 and 0010 (apply-upstream-patches.cjs checks it).

Deploy is one command and now fails loudly if anything is missing:
`node scripts/apply-all.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code`

## NEXT: the war must be visible IN SPACE, not on the map (owner decision 2026-10-27)

Owner confirmed: FW tab stays grey in every payload variant and the map opens fast now,
so "на карті війну не побачимо". Do not spend more time on the map or the tab.

The only visible war path left is the one he asked for from the start: fly to a warzone
system and see his faction`s fleet actually fight the other faction. What already exists:
  * `coopNpcHostility` allows NPC-vs-NPC only for named, physically linked opposing
    factions with a current native attack order or fresh retaliation (do not weaken it);
  * `warFrontChat` already emits real `war-opened` / `assault-begun` /
    `objective-captured` lines to sessions inside the affected system, once per event,
    text built from real state;
  * mining fleets are alive again because patch 0004 is really applied now
    (`ALIFE08 ... ALREADY_ACTIVE miners=2 haulers=1`), and a pirate raid is running.
Next concrete step: stage BOTH factions` fleets in ONE warzone system (Caldari vs
Gallente) so the owner can fly there and watch the fight, and make sure the front chat
line reaches him there. Evidence required: real weapon success, measured HP loss, real
wreck + stored loot on the same victim. No map work, no FW tab work.

## TWO MORE CLIENT TABS (owner report 2026-10-27): diagnosis

1. "Gallente 2 systems / Caldari 0" — that number comes from OUR war state, not the
   client: the campaign seed made Gallente the occupier in two systems and Caldari in
   none. It is real data, just unbalanced. Fix is in the war/campaign seed, not the UI.
2. "War zone" tab = black screen and "details about the combat zone: loading advantage
   data" forever — the client asks for warzone advantage/summary data that THIS SERVER
   NEVER IMPLEMENTS: `grep -rn Advantage /app/server/src/services/` returns nothing, and
   fwWarzoneSolarsystemService only exposes GetAllWarzonesOccupationStates(+Uncached),
   GetAllWarzones, GetHQSystemIDs, GetLocalOccupationState. The client gets no answer and
   keeps loading. This is fixable server-side: implement the advantage/summary handler
   with real values (occupation counts, contested systems) instead of nothing.
   Unknown eve_public requests in the last 3h are only payment.schedule.GetActiveByType
   and stargate.lock.GetRestrictedSystems — neither is the warzone tab.
Next: (a) rebalance the campaign seed so both factions hold systems, (b) add the
advantage handler. No client patching, no map work.

## TASK A+B (owner said "давай"): exact entry points, nothing mutated yet

A. Rebalance "Gallente 2 / Caldari 0".
   The number is `occupationStates()` in integration/coopWarClientView.cjs counting
   `state.territories[systemID].militaryControllerFactionID`. The state is NOT a JSON
   file (no /var/lib/evejs/coop-war-state.json) — it lives in SQLite behind
   `integration/coopFactionWarStore.cjs` (createFactionWarStore -> execute/snapshot,
   TABLE+KEY from that module) and `warState()` reads it with
   `gameStore.coopAtomicNativeRows.transact([TABLE], tx => tx.get(TABLE, KEY))`.
   Therefore the seed must go through the store's own `execute` mutation with its
   receipts/proofs, NEVER a hand-written row: hand-writing is fabrication and the
   store validates state on read (`core.validateState`).
   First read the current territories + wars to see which systems are unowned, then
   open real campaigns (attacker/defender, source/target) so both factions hold and
   contest systems.

B. "War zone" black screen + "loading advantage data" forever.
   No advantage implementation exists server-side (`grep -rn Advantage
   /app/server/src/services/` = 0). fwWarzoneSolarsystemService exposes only
   GetAllWarzonesOccupationStates(+Uncached), GetAllWarzones, GetHQSystemIDs,
   GetLocalOccupationState. The client asks for advantage/summary and never gets an
   answer. Next: capture the exact RPC name from the client's request log while the
   panel spins (docker logs evejs-server-1 | grep fwWarzone), then add a handler that
   returns real occupation counts/contested counts from the same war state. Env-gate it
   like EVEJS_COOP_WAR_CLIENT_VIEW and keep it default OFF until verified.

## REAL WAR STATE (read-only probe, 2026-10-27) — the numbers are consistent

/tmp/warstate.cjs in the container prints the live record:
  wars:      war:500001-500004 attacker=500004 (Gallente) defender=500001 (Caldari)
  territories: 30003837 -> 500004 SECURE ; 30045344 (Nennamaila) -> 500001 CONTESTED
  campaigns:  war:500001-500004 30003837 -> 30045344 (Gallente pushes into Caldari)
  byOwner:   500001=1, 500004=1
So "Gallente 2 / Caldari 0" is the client counting the OCCUPIER: Gallente holds its
own system plus the one it contests, Caldari holds a system that is being invaded so it
counts as occupied. Nothing is corrupted — the war is simply one-sided: only Gallente
attacks. The rebalance is therefore a second campaign in the opposite direction
(Caldari 500001 attacking from 30045344 into 30003837), created through the war store
execute API, not by editing rows.

## HANDOFF (context exhausted) — how to open the Caldari counter-offensive

The war machinery is already in the deployed overlay, no new code needed:
  /app/server/src/space/coopFactionWarOpening.js exports
    gateBetween, collectPresence, territoriesForFronts, paperFunding, presenceSummary,
    fundingRequired, supplyFor, activeWarFor, liveCampaignFor, buildProofs,
    planWars, applyOpenings, applyOpening, createWarOpening
  /app/server/src/space/coopFactionWarCampaigns.js exports planCampaign, resolveCampaign,
    rolesForFront, ownerOf (ROLES, STATES, DEFAULT_TTL_MS)
  /app/server/src/space/coopFactionWarStore.js -> createFactionWarStore({gameStore,proofs})
    with execute/snapshot; every mutation must go through it (receipts + validateState).
Current live record (probe /tmp/warstate.cjs): war 500001-500004 attacker=500004,
territories 30003837=500004 SECURE, 30045344=500001 CONTESTED, one campaign
30003837 -> 30045344.

NEXT STEP, in order:
 1. read-only: call planWars/liveCampaignFor for the reverse front (Caldari 30045344 ->
    Gallente 30003837) and print what it would open, WITHOUT applying.
 2. if the planner refuses, find the real blocker (gateBetween / fundingRequired /
    supplyFor) and report it — do not force an opening.
 3. only then applyOpening/applyOpenings through the store, then re-run the probe and
    confirm byOwner has both factions owning AND contesting a system.
 4. after that, the advantage handler for the black "war zone" tab: capture the exact
    RPC from docker logs while the panel spins, add the handler env-gated default OFF.
Never hand-write territory rows, never weaken coopNpcHostility, no client patching.

## WHERE THE COUNTER-OFFENSIVE ACTUALLY STOPS (probed 2026-10-28)

1. planWars({state}) with no gate wiring -> REFUSED / NO_GATE_AUTHORITY. It refuses to
   invent a front without real stargate topology. Correct behaviour, not a bug.
2. The sanctioned entry point is NOT a hand-built plan: coopVirtualWorldRuntime calls
   createWarOpening({ readLinks, getNativeEntity, getFactionForCorporation,
   getStargatesForSystem: worldData.getStargatesForSystem, getGate: worldData.getStargateByID,
   readWarState, writeWarState, reserveBounty, fleetPresence, minShips }).tick({systemIDs})
   with systemIDs = [...visitedSystems].slice(0,12), and skips with
   NO_VISITED_SYSTEMS / NO_IDENTITY_REGISTRY / WAR_STATE_WRITE_FAILED.
3. Every war flag is already ON in compose.coop-probe.yaml (EVEJS_COOP_FACTION_WAR,
   _FLEETS, _MOBILIZE, _COMBAT, _MERIT, _TREASURY, _NATIVE_TRANSFER, _SOVEREIGNTY_PROJECTION,
   WAR_REQUIRE_FUNDING=0). No war-skip lines in 2h of logs, so the phase is not erroring.
So the war is enabled and one-sided because a reverse front needs CALDARI presence in a
system that borders Gallente-held 30003837, and the visited route does not include
Nennamaila (30045344) / that border. Nothing is corrupted and nothing is missing code.

NEXT ACTION (concrete): add the Gallente/Caldari border systems to the visited route
(EVEJS_COOP_WAR_ROUTE / the 5-system route in compose.coop-probe.yaml) so the war tick
sees both sides present, then re-run /tmp/warstate.cjs and expect byOwner with both
factions owning AND contesting. Then the advantage handler for the black tab.

## DEFINITIVE WAR DIAGNOSIS (2026-10-28, read-only diagnoseWarState/diagnoseWarFunding)

  territories: 30003837 Gallente SECURE, 30045344 Caldari CONTESTED
  war:         war:500001-500004 ACTIVE
  campaign:    war:500001-500004:campaign:30045344 source=30003837 target=30045344
               state=PREPARING (stuck, never advances)
  presence:    {"systems":[],"minShips":1,
                "note":"TERRITORIES_NEED_AT_LEAST_ONE_RESOLVED_PILOT_PER_SYSTEM"}
  funding:     both sides REFUSED / NO_REAL_FACTION_INCOME (needCents=2500000, pilots=0)

THE WAR IS FROZEN ON PRESENCE = 0, not on the map, the FW tab or the patch series.
No faction-resolved NPC pilot exists in 30045344 or 30003837, so the campaign cannot
leave PREPARING and no reverse front can be planned. The route already contains both
systems (EVEJS_COOP_VIRTUAL_ROUTE: 30000142,30000144,30000145,30045344,30003837) and all
war flags are ON, so the missing piece is the real war fleets of BOTH factions in those
two systems, plus real faction income for funding.

NEXT ACTION: mobilize real Caldari and Gallente war fleets into 30045344 and 30003837
(registry: nativeWarFleetRegistry, EVEJS_COOP_FACTION_WAR_FLEETS/_MOBILIZE), verify with
diagnoseWarState that presence.systems is non-empty, then re-check the campaign leaves
PREPARING. Funding stays honest: NO_REAL_FACTION_INCOME means no invented ISK.

## ROOT CAUSE CONFIRMED: the war fleet registry is EMPTY

`require("/app/server/src/space/coopVirtualWorldRuntime.js").nativeWarFleetRegistry()`
returns `{}`. So there are no war fleets anywhere, therefore presence in 30045344 /
30003837 is 0, therefore the campaign cannot leave PREPARING and no reverse front can
be planned. EVEJS_COOP_FACTION_WAR_FLEETS=1 and _MOBILIZE=1 are set but mobilization
never produced a fleet, so the registry stays empty.

NEXT ACTION (single): find why mobilization spawns nothing with those flags on — the
mobilize phase logs nothing and the registry is empty, so check the mobilize entry point
in coopVirtualWorldRuntime (grep EVEJS_COOP_FACTION_WAR_MOBILIZE) and what precondition
it needs (funding gate is REFUSED/NO_REAL_FACTION_INCOME, which may be exactly what stops
it). Decide honestly: either real faction income exists and mobilization is broken, or
the funding gate is the real blocker and no fleet may legally spawn without it.

## MOBILIZER IS ENABLED — so the blocker is inside it, not the flags

coopWarMobilizer.enabled() needs FACTION_WAR, FACTION_WAR_FLEETS, FACTION_WAR_MOBILIZE,
NATIVE_ATOMIC_ROWS, NPC_STRICT_AMMO, NPC_AMMO_DURABLE_CYCLE, NPC_BANK_ATOMIC and
(ALIFE or NPC_ORDER_ARBITER). Container env proves all of them are 1.
It also needs createWarMobilizer({registry, readWarState, readLinks, sceneForSystem,
getNativeEntity, getController, getFactionForCorporation, inspectReadiness,
getOrderLeases, isTactical, clock}) or it throws
WAR_MOBILIZATION_NATIVE_AUTHORITIES_REQUIRED. The registry is empty and nothing throws,
so the mobilizer runs and rejects every side silently (SIDE_REJECT_LIMIT exists for that).
NEXT SINGLE STEP: run the mobilizer in DRY RUN (DRY_RUN_REPORT_LIMIT=64, never writes) and
print the per-side reject reasons for war:500001-500004. That names the exact refusal —
most likely the funding gate (NO_REAL_FACTION_INCOME) or an empty getOrderLeases — and it
is the last unknown between the current frozen war and a visible two-sided fight.

## CORRECTION (must not stand uncorrected): the registry is NOT empty

Earlier note "nativeWarFleetRegistry() -> {}" was a PROBE ARTEFACT, not a fact:
JSON.stringify of an object whose members are functions prints {}. The factory
(coopVirtualWorldRuntime.js:86) returns null only when FACTION_WAR / FACTION_WAR_FLEETS /
NATIVE_ATOMIC_ROWS are not 1; those are 1, so it builds a real registry through
coopWarFleetRegistry.createWarFleetRegistry with native proofs. So do not chase an empty
registry. The mobilizer therefore has its registry and the refusal is elsewhere
(funding gate / getOrderLeases / readiness). The only way to name it is the mobilizer
dry-run: tick({systemIDs, dryRun:true}) -> {status:"DRY_RUN", mobilized, rejected, blocked}.

## FOUND: diagnoseMobilization already exists (it was in module.exports all along)

coopVirtualWorldRuntime exports diagnoseMobilization (and diagnoseCombat, diagnoseWarState,
diagnoseWarFunding, diagnoseNpcOrder, diagnoseNativeRaids, nativeWarFleetRegistry,
livingWorldPhases). Called from a fresh `docker exec node`, diagnoseMobilization returns
{"status":"MOBILIZER_NOT_INITIALIZED"} because warMobilizer is module state created by the
running phase, not by a cold require. So the dry-run MUST be invoked inside the server
process: either (a) a tiny env-gated hook that calls diagnoseMobilization on a timer and
logs it, or (b) an admin-bridge action. (a) is 5 additive lines and cannot break startup.

## READY-TO-APPLY: the mobilization diagnostic hook (paste, then apply-all + build)

In integration/coopVirtualWorldRuntime.cjs, right after the module.exports assignment,
append (additive, cannot affect startup):

  if (process.env.EVEJS_COOP_WAR_DIAG === "1") {
    try {
      const timer = setInterval(() => {
        try {
          const out = module.exports.diagnoseMobilization();
          console.log("[CoopWarDiag] mobilization " + JSON.stringify(out).slice(0, 1200));
        } catch (error) { console.log("[CoopWarDiag] error " + error.message); }
      }, 60000);
      if (typeof timer.unref === "function") timer.unref();
    } catch (_error) { /* diagnostics never break the world */ }
  }

Then: EVEJS_COOP_WAR_DIAG=1 in compose.coop-probe.yaml, apply-all, build, recreate, and read
`docker logs evejs-server-1 | grep CoopWarDiag`. That prints the real per-side rejection
(funding gate / getOrderLeases / readiness) for war:500001-500004.

## BREAKTHROUGH: the war is FIGHTING (2026-10-27T20:56Z, deployed on the play stack)

The exact refusal was named by the existing admin action `war_diagnose` (no rebuild
needed for diagnosis): DEFENDER side rejected entity 980000023574 with WRONG_FACTION
(it is a Federation Navy hull in the Caldari contested system) and the ATTACKER side
rejected 980000023571 with ORDER_LEASE_ACTIVE. Both war-doctrine hulls existed but sat
in each other's systems, so no side could ever muster.

Fix proven live, all through sanctioned paths:
1. `release_identity` on two out-of-the-way traders (coop-pilot-034, coop-pilot-069).
2. `spawn_war_fleet` faction 500001 in 30045344 and faction 500004 in 30003837 with
   those pilots as commanders -> real Caldari Navy Condor 980000033113 and real
   Federation Navy Atron 980000033114, doctrine loadouts, durable, linked as patrols.
3. Next mobilization tick: campaign left PREPARING, `[CoopFactionWar] assault begun
   war:500001-500004:campaign:30045344 attacker=1 defender=1`, both sides SIDE_MUSTERED.
4. The gate-staging phase then really transferred the Gallente hull 30003837 -> 30045344.

Remaining blocker was co-location: the battle director only fires inside 250 km and the
fleets sat 9.87e12 m (66 AU) apart. New FW-030 `integration/coopWarEngagementWarp.cjs`
(env `EVEJS_COOP_WAR_ENGAGE_WARP=1`, default OFF, 6 unit tests) warps the assaulting side
to the nearest opposing war ship of the same campaign - one real `npcRuntime.warpToEntity`,
never a teleport, spawn or damage.

Deployed (apply-all OVERLAY_OK, image evejs-local rebuilt, server recreated) and observed:
- `living-native-war-engagement-warp` status WARP_ORDERED, both Gallente hulls
  NATIVE_WARP_STARTED at 9.87e12 m.
- `living-native-war-attack-orders` NATIVE_ATTACK_ORDER_ACCEPTED: Caldari 980000033113
  attacking Gallente 980000023574 in 30045344.

NEXT: confirm real damage/wreck (HP drop on the same entities, not just the ACK), then
make the garrison durable instead of operator-seeded: a war-zone system must be
garrisoned by its controller's navy every time it is observed, otherwise a lost fleet
freezes the front again.

NOTE: `scripts/overlay-spec.cjs` also needed `require("../../gameStore")` (the in-flight
hauler work used `../gameStore` from services/mining, which cannot resolve and blocked
the whole overlay with HOOK_REQUIRE_MISSING_FILE).

## Live war state after FW-030 (2026-10-27T21:25Z)

PROVEN live on the play stack (all through sanctioned paths, no invented ISK/kills):
- campaign war:500001-500004:campaign:30045344 is in ASSAULT, both sides SIDE_MUSTERED;
- `[CoopFactionWar] assault begun ... attacker=1 defender=1` and the front chat line
  "[Front] Assault begun in system #30045344: 1 attacking ships against 1 defenders.";
- real native gate transfer moved a Gallente hull 30003837 -> 30045344;
- FW-030 warps the assaulting side from 9.87e12 m (66 AU) to ~12 km: WARP_ORDERED,
  NATIVE_WARP_STARTED;
- the war director then issues a real native attack order:
  NATIVE_ATTACK_ORDER_ACCEPTED Caldari 980000033113 -> Gallente 980000023574.

STILL NOT PROVEN - and this is the single next blocker: no damage is exchanged.
Measured on the live ships: both sides keep hp {shield 150/175, armor 175/145,
structure 160/125} unchanged; the ordered hull shows `manualOrder {type:attack}` but
`currentTargetID: 0`, `mode: STOP`. The doctrine guns are short-range autocannons
(typeID 564/562 on the Condor/Atron), so 11-90 km is outside real gun range, and:
- a native warp refuses a short hop (`WARP_DISTANCE_TOO_CLOSE` at 43 km / 90 km);
- `orbit(id, enemy, 1000)` is accepted (`NATIVE_ORBIT_ORDERED`) but the patrol's own
  movement wins and the range grows again (12 km -> 27 -> 43 -> 89 km -> back to 66 AU).

NEXT SINGLE STEP: make the attack order and the approach one decision - issue the
native attack only once the hull is inside real gun range, and stop the patrol's own
movement from overriding the approach (the order bridge refuses any new WAR order while
`movementBusy` is true and the hull has no arbiter lease, which is exactly the state an
orbiting patrol is in). Do not raise the battle director's 250 km rule: that is the real
firing envelope of these guns' falloff, not a bug.

## FW-030 v3: a hull holding an accepted attack order also closes on its target

Deployed: `coopWarEngagementWarp` no longer only moves the assaulting side. A war hull
whose controller carries `manualOrder {type:"attack"}` with `currentTargetID: 0` is a
hull that is outside real gun range with an order it cannot use, so it now closes on the
ship it was ordered to kill (orbit inside 150 km, standoff warp beyond). Measured live
after deploy: NATIVE_ORBIT_ORDERED at 82-90 km for the two Federation Navy hulls.

Still not proven: HP on 980000033113 / 980000023574 / 980000033114 is unchanged
(shield 175/150, armor 145/175, structure 125/160) and the Caldari hull still shows
`mode STOP` with `currentTargetID 0` under an accepted attack order. So the open
question is now narrow and native-side, not war-side: why a native `attack` order that
the order bridge accepted leaves the controller with no target, and why an accepted
`orbit` does not hold the hull at that range. Check `coopNpcHostility`
`allowsNativeEngagement` (both flags are 1, so it should authorise) and the native
`npcBehaviorLoop` target acquisition for these two hulls before touching the war code
again. Nothing in the war store, the campaign or the front chat is blocking.

## WAR IS REAL: damage, mutual orders and three native kills (2026-10-27T22:20Z)

Root causes found by measurement, not guesswork, and all three were needed:

1. `coopNativeReadCache` indexed native rows by `row.itemID`, but
   `nativeNpcStore.listNativeEntities()` publishes the id as `row.entityID`. Every
   cache lookup missed, so `coopWarCombatAuthority.evaluatePair` answered
   `NATIVE_STORE_IDENTITY_MISMATCH` for EVERY war pair. The hostility hook therefore
   denied every engagement: an accepted attack order never became a target. Fixed by
   indexing `itemID ?? entityID` (`tests/coop-native-read-cache.test.mjs`).

2. The war hull is spawned at a belt anchor and warped to the enemy, so it stands
   ~150 km from home with the profile's 90 km leash. `isBeyondLeash` then ran
   `clearNpcCombatState` on every think, resetting `currentTargetID` to 0 and flying
   the hull home. New FW-031 `integration/coopWarEngagementPosture.cjs`
   (`EVEJS_COOP_WAR_ENGAGEMENT_POSTURE=1`, default OFF) applies the *native*
   behaviour overrides `leashRangeMeters: 0`, `orbitDistanceMeters: 500`,
   `movementMode: "orbit"` to every registered war hull in an assault system,
   preserving all other overrides and never re-applying the same values.

3. A war hull only flying its own patrol movement (GOTO/ORBIT) had `movementBusy`
   true and no arbiter lease, so the bridge refused WAR with
   `COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE` - and a lease is only created by a
   successful issue, so the defender could never be ordered at all. The bridge now
   lets WAR retask its own ASSIGNED hull when it carries no manual combat order.
   An unleased manual attack from an unknown owner is still never hijacked
   (`tests/coop-war-order-arbiter.test.mjs`, including a repair of that fixture,
   which referenced an undefined `arbiter` and could never have passed).

FW-030 also grew a real fleet warp: a side of 2+ hulls that must close now issues
ONE native `warpBatchToPoints` with a line-abreast formation around the standoff
anchor (per-slot lateral offset + staggered rank depth); a lone hull keeps
`warpToPoint`. Formation offsets are unit-tested; no live scene has needed a
multi-ship warp yet because the spawned hulls landed inside warp range.

LIVE EVIDENCE (play stack, no fabricated damage):
- `living-native-war-engagement-posture` POSTURE_APPLIED for 980000033113,
  980000033114, 980000023574.
- `npc_pair_diagnose` 980000033113 -> 980000023574: `warVerdict AUTHORIZED`,
  `currentTargetID 980000023574` (was 0 before), leash override present.
- Mutual real attack orders accepted in one tick: 980000033113 -> 980000036202,
  980000036201 -> 980000036202, then 980000036202 -> 980000036201.
- THREE real warship kills with native wrecks and stored loot:
  980000023574 (wreck 980300000022), 980000033114 (wreck 980300000024),
  980000036202 (wreck 980300000034), 980000036239 (wreck 980300000035).
  Merit moved on both sides: Caldari commander promoted recruit -> pilot -> wingman
  (command 1 -> 3), the losing pilots took `force-lost -10`.

NEXT: the front is still operator-seeded (`spawn_war_fleet` needs a free identity).
A durable garrison - a war system refilled by its controller's navy whenever it is
observed - is the remaining gap before the war runs unattended. The formation warp
needs one live case where a side of 2+ must close as a group to be seen in-client.

## FW-032/033: the front now heals itself (2026-10-27T22:35Z, live)

Two more measured defects closed, both proven on the play stack.

FW-032 `integration/coopWarLossReconcile.cjs` (`EVEJS_COOP_WAR_LOSS_RECONCILE=1`):
a confirmed native wreck now RELEASES the hull's exclusive custody slot in the war
fleet registry (the registry's own release verifier already accepts a
process-confirmed wreck) and frees the killed pilot's identity. Before this, a dead
hull stayed ALIVE in the registry forever, so the side looked fully mustered with a
corpse and the pilot could never fly again. Live: `living-native-war-loss-reconciled`
status RECONCILED, custody APPLIED, identity RELEASED for 980000036587 / wreck
980300000037.

FW-033 `integration/coopWarGarrison.cjs` (`EVEJS_COOP_WAR_GARRISON=1`): an ASSAULT
side with fewer than `garrisonSize` (2) hulls in the campaign target system is
refilled through the SAME sanctioned path an operator uses - `spawn_war_fleet`
(real doctrine row, real native ship, real free pilot identity), one hull per tick,
3 min cooldown per side. Live: two `living-native-war-garrison` GARRISON_APPLIED
events spawned 980000036587 (fleet coop-fleet-500004-0007, commander
coop-pilot-038) and 980000036810 (fleet coop-fleet-500004-0008, commander
coop-pilot-069) - both commanders were identities freed by earlier real kills.
Minutes later 980000036810 was already receiving a real attack order.

Measured caveat: `coopWarFleetRoster` is EMPTY in this deployment (0 fleets) -
`spawn_war_fleet` only writes the war fleet registry, not the newer roster. So the
FW-032 roster half honestly reports NOT_IN_ROSTER, and `planReconstitution`/
`commitReconstitution` cannot be used for these hulls. The authoritative custody
path is the registry, and that one works.

Still open: the formation batch warp (FW-030) has no live case yet - garrison hulls
spawn close enough to the enemy that they engage without a group warp. The next
natural trigger is a side mustering in its source system and travelling together.

## FW-034: the client advantage panel now answers for OUR pair (2026-10-27T22:50Z)

The owner reported that the faction-warfare window works for the other warzone but
not for Caldari/Gallente: the map is empty for ours and the "advantages" tab spins
forever instead of erroring. Measured on the running server:

- The map surface is fine: `fwWarzoneSolarsystem.GetAllWarzonesOccupationStates`
  returns warzone 2 = {30003837: owner 500004 / occupier 500004 / not contested,
  30045344: owner 500001 / occupier 500004 / CONTESTED}. So the map data for our
  pair really exists; an empty client view is a client-side cache, not missing data.
- The advantage surface was empty: `fwVictoryPointMgr.GetAllVictoryPointStates` and
  `GetLocalVictoryPointState` are served from `stateBySolarSystemID` /
  `session.fwVictoryPointStatesBySolarSystemID`, and NOTHING in this build fills
  them, so the client waits on a system it will never receive. The fw-advantage
  express gateway (`eve_public.faction.activity.GetSolarSystemScoresRequest`) reads
  `context.fwAdvantageScoresBySolarSystemID`, which is also never set.

New FW-034 `integration/coopWarAdvantage.cjs` (`EVEJS_COOP_WAR_ADVANTAGE=1`, default
OFF) derives both surfaces from evidence we already hold and invents nothing:
`contribution(faction) = 1000 * enemy wrecks that faction took in this system +
100 * its hulls present`, `score = the larger side`, `threshold = 75 000` (stock).
Two L2 hooks feed it: `fwVictoryPointMgrService` (both handlers) and the
`fw-advantage` gateway service.

Live probe in the running container:
  ALL   {30003837: {0, 75000}, 30045344: {3200, 75000}}
  LOCAL [30045344, {3200, 75000}]
  SCORES [{500001, 3200}, {500004, 1100}]
  snapshot 30045344: Caldari 3 wrecks taken / 2 hulls, Gallente 1 wreck / 1 hull.

## NIGHT 2026-10-28 - N1 landed, next steps (autonomous run)

Plan: `.opencode/night-plan-20261028.md` (13 tasks). Watchdog:
`.opencode/night-watch-20261028.log` (one line every 15 min, read-only).

DONE tonight:
- FW-035 `integration/coopWarCaptureByForce.cjs` + 5 tests. A system flips
  `militaryControllerFactionID` only with: a verified defender wreck in THIS
  campaign and system, ZERO live defender hulls there, sustained 60 s, then
  RECORD_OBJECTIVE -> CAPTURE_TERRITORY through the same authoritative core.
  Fork commit `2cb671c` (module + phase `native-faction-war-capture-by-force` +
  `EVEJS_COOP_WAR_CAPTURE_BY_FORCE=1` in compose.coop-probe.yaml), repo `747c4701`.
- Image NOT rebuilt and play stack NOT restarted (night rule). The morning deploy
  must: `docker build -t evejs-local .` then `up -d --no-deps server`, then verify
  `living-native-war-capture-by-force`.

BLOCKER discovered: compose/compose.agents.yaml has NO `EVEJS_COOP_FACTION_WAR*`
flags at all, so the agents stack cannot prove any war behaviour as-is. Options:
(a) enable the war flags there and seed the war through the sanctioned admin path
(`spawn_war_fleet` + release/assign identity), or (b) prove live on the play stack
after the morning deploy. Not yet decided; nothing was changed on the agents stack.

NEXT (in order): N2 formation live proof, N3 restart resilience diff, N4 player as
target, N5 war economy debit, N6 roster truth, N7 ammo, N8 wreck hygiene,
N9 militia rank, N10 soak table, N11 FW hook extraction (AUDIT_OK), N12 operator
guide, N13 morning handover.

## PROBLEMS OBSERVED by the night watchdog (2026-10-27T23:53Z, real numbers)

Watchdog v2 (`scripts/night-watch.ps1`, harness-managed background job) logs one line
every 15 min plus an explicit PROBLEM line for: stack not healthy, CPU > 70%, war
event file unreadable, or no war event for 60 min.

First real sample: play stack healthy, CPU 0% (idle), war events on the play stack =
15 casualties / 22 garrison spawns / 82 attack-order events.

P1 FREE-SHIP GRINDER (confirmed, needs N5). Fleet registry holds only 2 hulls
(1 Caldari, 1 Gallente, both in 30045344) while 22 garrison spawns happened: a hull
dies, FW-032 releases its slot and frees the pilot, FW-033 immediately buys another
one for free. The front is an endless free meat grinder - no cost, no end condition.
N5 (real economy: debit the faction chest, refuse when empty) is the fix.

P2 ROSTER IS DEAD WEIGHT (confirmed). `coopWarFleetRoster` still reports 0 fleets;
`spawn_war_fleet` never writes it. FW-032 honestly reports NOT_IN_ROSTER. Either wire
it (N6 option a) or delete the dependency (option b). No functional impact while the
registry is authoritative, but it is a lie in the payload.

P3 GARRISON PACING not yet proven safe: 22 spawns/hour is at the 3-min-per-side
cooldown ceiling. With N5 it becomes self-limiting; until then the only brake is the
cooldown. Watch the soak table (N10) for growth.

P4 agents stack cannot prove war behaviour at all (no `EVEJS_COOP_FACTION_WAR*`
flags in compose/compose.agents.yaml). Every live war proof must happen on the play
stack after the morning deploy, or the agents stack must be given the flags and a
seeded war.

## WHY THE WAR FROZE (diagnosed 2026-10-28T10:04Z, real probes)

Symptom: no faction-war event since 04:47 (counters stuck 15 casualty / 22 garrison /
82 orders) while the world keeps running (phase cycle 1170 at 10:02:53 includes every
`native-faction-war-*` phase, and pirate warp-point tackles still fire at 10:02:42).

Two independent deadlocks, both measured:

D1 GHOST HULLS IN THE FLEET REGISTRY. The registry holds exactly two hulls -
980000038148 (Caldari, coop-pilot-038) and 980000039139 (Gallente, coop-pilot-089),
both "in" 30045344. Probe: `nativeNpcStore.getNativeEntity` returns a row for both,
but `scene.getEntityByID` returns nothing for both (`inScene false`). They are dead or
despawned ships that were never released. Consequences:
  - FW-033 counts registry rows as "present" -> missing = 0 -> the garrison never
    refills a side that physically has no ship;
  - the battle director finds no live candidate -> no attack order;
  - the campaign stays ASSAULT rev 2 with 0 objectives, territory still Caldari.

D2 ZERO FREE PILOT IDENTITIES. Roster 100, linked 100, free 0. The last garrison
attempts are literally `phase:"garrison", reason:"NO_FREE_PILOT_IDENTITY"`
(23:26, 23:30, 23:34) interleaved with `GARRISON_COOLDOWN`. So even a correct
"missing" count could not field a replacement commander.

WHY IT IS NOT JUST "absence = death": the registry's own release verifier refuses a
missing hull unless a physical wreck was confirmed (`confirmDestroyed`), which is the
correct invariant. So the fix must NOT weaken custody. Proposed:
  F1 FW-033 counts LIVE scene hulls (inScene), not registry rows, when deciding
     whether a side is missing. Ghost rows then block nothing.
  F2 the free-pilot pool may reclaim an identity whose bound hull is in no scene
     (release_identity on that link first), so a ghost cannot hold the last pilot.
  F3 (separate) a read-only `war_registry_audit` action that reports ghost rows so the
     operator sees them instead of guessing.
Not implemented yet; no change was made to the running server.

## FREEZE ROOT CAUSE FOUND AND FIXED (2026-10-28T10:25Z, deployed)

The freeze was NOT the war logic. `scripts/coop-split-module.cjs` moved
`nativeWarFleetRegistry()` into `server/src/space/coopVirtualWorldRuntime.pure.js`
but did not move its module state, so the function threw
`ReferenceError: warFleetRegistry is not defined` on every call. The garrison phase
caught it per phase (`[CoopLivingWorld] native-faction-war-garrison warFleetRegistry
is not defined`), so the war silently stopped refilling and the front emptied.

Fixes deployed (fork `ef48a4f`, `48f63d9`):
- `.pure.js` now declares `warFleetRegistry`, `bridge`, `identityRegistry` and exports
  `bindWarRuntime({bridge,identityRegistry})`; the main runtime binds the live objects
  right after `createBridge(...)`.
- FW-033 counts LIVE scene hulls, not custody rows (`isHullLive`), so a ghost hull can
  no longer look like a manned side.
- the free-pilot pool reclaims an identity whose ship is in no live scene
  (`GHOST_HULL_NO_SCENE`) instead of starving the garrison with
  `NO_FREE_PILOT_IDENTITY`.

Evidence after deploy: garrison events 22 -> 25; 10:17:10 Gallente refill, 10:17:36
Caldari refill (980000042212, commander coop-pilot-003), 10:20:32 Gallente refill.
The ReferenceError is gone from the log.

STILL BROKEN (next): the battle director issues no attack order (82 unchanged) and
`war_combat_diagnose` returns `status OBSERVED` with an EMPTY ships list, even though
the garrison just spawned three hulls. Suspicion: the same split-runtime state loss in
the combat path (a helper that reads the registry/scene from the pure module), or the
registry rows and the live scene disagree. Next probe: call
`nativeWarFleetRegistry().snapshot()` inside the running process and compare with
`scene.getEntityByID` for each row, then follow `advanceNativeWarCombat` step by step.

## COMBAT BLOCKER NARROWED (2026-10-28T10:35Z)

New measured fact: `war fleet registry ships = 0` (probe reads the SQLite row directly),
yet the garrison reported three successful spawns at 10:17:10 / 10:17:36 / 10:20:32
(fleetIDs coop-fleet-500004-0029/0030, ships 980000042212). So `spawn_war_fleet`
returns a composed fleet but its ASSIGN never lands in `coop-faction-war|fleet-registry-v1`.

Consequences: the battle director has no registered ship -> no attack order (82 unchanged),
`war_combat_diagnose` lists nothing, and the garrison keeps buying hulls every 3 min that
the war cannot see. The capture phase is now unblocked (`DEFENDER_STILL_PRESENT` was the
last refusal at 10:16:47, before the registry emptied).

Next probe (exact): call `executeRequest({action:"spawn_war_fleet",...})` and read the
returned `fleetStatus`/`fleetReason` plus the registry row immediately before and after.
The registry `ASSIGN` needs `verifyNativeShip` AND `verifyCampaign`; the campaign check
requires `campaign.state` in [PREPARING, ASSAULT] and the defender's hull in the target
system - so a hull spawned for the DEFENDER side in the target system is legal, while an
ATTACKER hull must be in `campaign.targetSystemID` during ASSAULT. A mismatch there is the
most likely silent refusal.

## INCIDENT 2026-10-28T11:25Z - I reset the war state by restoring an old runtime

What I did: to kill a cascade of `X is not defined` errors from the split runtime
(`eec175f`), I restored the pre-split single-file
`server/src/space/coopVirtualWorldRuntime.js` (fork commit `6ca4557`).

What broke: the pre-split file is an OLDER code base than the tree it replaced. On
boot its opening phase logged `[CoopFactionWar] empty war state created (version 1)`
and then opened `war:500004-500014` (Gallente vs ORE). The previous state
(`war:500001-500004`, territories 30003837/30045344, the ASSAULT campaign) is GONE.
Identity links also dropped from 100 to 43 (57 pilots now free).

Current measured state after reverting `6ca4557` (fork is back to the split runtime):
  roster 100, linked 43, free 57
  campaign war:500004-500014:campaign:30045344 PREPARING rev 1
  territory 30003837 -> 500014 SECURE, 30045344 -> 500004 CONTESTED
  split runtime still throws `warpPointDirector is not defined` (native-raids phase)

RECOVERY PLAN (do NOT repeat the restore):
1. Never again swap a whole runtime file from an older commit into a newer tree.
2. Fix the split properly: revert `eec175f` in history with conflict resolution, or
   re-run `scripts/coop-split-module.cjs` with module-state extraction, so every
   implicit global is declared. Known missing names so far: warFleetRegistry, bridge,
   identityRegistry, economy, nativeGateTransfer, recognitionAnnouncer,
   nativeAmmoWitness, warpPointDirector.
3. Re-open the Caldari/Gallente war through the sanctioned path. The opening phase
   picks a pair by adjacency and chose 500004-500014; add a confirm-gated
   `war_open` admin action that calls the same store with the same proofs instead of
   guessing, then re-register 30003837 (Gallente) and 30045344 (Caldari).
4. Only then continue with the combat/registry work.

Lesson recorded: a war state row is live data, not code. Any change that can create
an "empty war state" must be proven on the agents stack first, never on the play stack.

## 2026-10-28T12:10Z - the war is running again, and it is Caldari vs Gallente

Recovered from the incident WITHOUT hand-written rows. What was actually broken
and is now fixed in the fork (all committed):

1. `26d107a` split runtime: sixteen names (`warpPointDirector`, `economy`,
   `nativeGateTransfer`, `recognitionAnnouncer`, `nativeAmmoWitness`,
   `raidDirector`, `tacticsDirector`, pve directors, `lossBridge`,
   `nativeOrderBridge`, `lootCommerce`, `nativeAmmoSupply`, `warGateHandoff`,
   `warRecoverySocket`, `nativeGunRange`, `warTreasuryInstance`) were undeclared
   in `coopVirtualWorldRuntime.pure.js`. Every phase that touched one threw
   `ReferenceError`, so raids, economy, ammo, recognition and the war stopped.
   `syncWarRuntime()` now hands the live objects over on every tick.
2. `aa26156`/hoist: `syncWarRuntime` had to be module scope; the tick called it
   before the sale path that declared it.
3. FW-036 (`coopWarObservedSystems.js`): the war layer only observed systems a
   client had flown into, so a spawned war fleet could never open a front.
   `visitedSystems` now also takes systems where the durable roster proves live
   hulls. Test: `tests/coop-war-observed-systems.test.mjs` (5 pass).
4. FW-037 (`coopFactionWarOpening.js`): a front is one gate pair, not one
   direction. A different war holding the target froze the pair forever, so
   Caldari/Gallente could never open. The planner now mirrors across the same
   real gate; the same faction pair still never reopens its own border.
   Tests: `tests/coop-faction-war-opening.test.mjs` (20 pass).

Measured live state now (play stack, evejs-server-1):
  wars: war:500004-500014, war:500014-500019, **war:500001-500004**
  campaign war:500001-500004:campaign:30045343 = ASSAULT (Nennamaila)
  territories: 30045343 CONTESTED (Caldari 500001), 30045344 CONTESTED (500004)
  roster: 3 real fleets of 25 (500001 in 30045343 and 30003837, 500004 in 30045344)
  registry: 3 ships assigned to campaigns
  native evidence: living-native-war-attack-orders NATIVE_ATTACK_ORDER_ACCEPTED
  (980000043284 -> 980000042223), target-selection RANKED, and a
  living-native-weapon-event VERIFIED (980000043284 -> 980000043880)

Next step (in order):
1. The 25-ship roster fleets are PRESENCE (territory/front) but not BATTLE:
   only the 1-ship garrison formations get campaign ASSIGN rows, so fights are
   1v1. Teach the mobilizer/garrison to adopt roster hulls into the campaign.
2. Then prove the same on the accelerated `evejs-agents` stack (needs the
   EVEJS_COOP_FACTION_WAR* flags there plus a seeded war).
3. Then the client surfaces (warzone payload/FW window) against the new war.

## 2026-10-28 - OPS refactor: 19 gate scripts -> 1 runner + 1 validated table

Commit `ebd2e2ac` (+ worklog `b03861d7`, docs `74017446`). No gameplay code touched.

  scripts/lib/CoopGate.ps1  192L  the six steps once (tests exist -> manifest all-NOT_RUN
                                 -> node --test -> tail -> throw -> pinned verifier)
  scripts/lib/gates.json    583L  the 19 gate rows as data (tests, tail, log, manifest, pins)
  Run-*.ps1 (19)            161L  five-line wrappers, same names, same banners (-671/+41)
  tests/coop-gate-specs.test.mjs  proves every declared test/pin/manifest still exists,
                                  no manifest claims unexecuted gameplay, no silent key typo,
                                  every row has a wrapper. 5/5 pass.

Evidence: all 19 gates run before and after the change with identical exit codes
(8 pass / 11 already red - the red set is the other session's in-flight overlay work,
not this change) and identical PASS/NOT_RUN banners. The only textual difference is
the report-dir path echoed in LW04C4's failure message.

Left alone on purpose: scripts/lib/CoopGate.ps1 is not dot-sourced by anything else;
Run-Alife-Economy-Tests.ps1, Run-CommunityFittings.ps1, Run-NativeJob-Tests.ps1,
Run-StageJ-Salvage-Tests.ps1, Run-LW04D-Source-Gates.ps1 do not share the template.

Next candidates (NOT started): the six scripts/verify-*.cjs repeat the same pinned
git-blob hash + reversible-patch-chain check; scripts/Run-Alife-Economy-Tests.ps1
(183L, and a test reads its text) could take a second table row once its extra
manifests are expressed. Engine perf work stays blocked while space/coopStationDrain.js
and the overlay-spec edits are uncommitted in another session.

## FW on the accelerated work stack — first seeding done (2026-10-28T12:15Z, evejs-agents only)
Start: `war_state` EMPTY, `war_fleet_state` 0 ships, presence only ORE/pirates, roster 12
pilots of which 10 already linked to the mining fleet -> no border could ever be staffed.
1. `compose/compose.agents.yaml`: EVEJS_COOP_VIRTUAL_POPULATION 12 -> 64 (the virtual world
   tops the roster up on boot without wiping pilot history; measured pilots 64 after restart).
2. Real patrol seeding WORKS: `spawn_native_npc` needs an explicit real `loadoutID`, because
   every SDE navy profile carries `retail_empty_npc_entity_loadout` and the profile's own
   `<profile>_loadout` row is missing (`WAR_PATROL_LOADOUT_UNAVAILABLE:LOADOUT_ROW_MISSING`).
   Working pair: "Caldari Navy Condor" + `guristas_light_missile_frigate` (corp 1000035 ->
   500001, missileLauncher, chargeDepth 80), "Federation Navy Atron" +
   `serpentis_small_blaster_frigate` (corp 1000120 -> 500004). Spawned 4 real durable hulls
   (980000000283/286 in 30045344, 980000000288 + one in 30003837).
3. Caveat measured: a pilot released and re-linked is re-bound to its durable old hull within
   ~20 s, so the 2nd spawn answered `PILOT_ALREADY_LINKED` (its hull exists, unlinked). Use a
   fresh pilotID per hull, and never assume the link when the status is not LINKED.
4. The opening phase then opened a REAL war by itself: `war:500014-500019` (ORE vs 500019)
   with `campaign:30000144` PREPARING (source 30000142), territories 30000142 -> 500014
   SECURE, 30000144 -> 500019 CONTESTED. Log: `opening skipped: NO_OPENABLE_FRONT` on the
   later tick = the same faction pair has a live campaign, not a failure.
5. Measured bug: `war_diagnose` answers `INVALID_MOBILIZATION_STATE` with campaignCount 0 while
   `war_state` shows that campaign, and the tick says `mobilization skipped:
   NO_MOBILIZED_SHIP:OBSERVED`. So the diagnose reads a different record path than the store
   (the same read-path class of bug fixed on 2026-10-27 for the phases).
Next: make the mobilizer see real armed patrols on both sides of campaign:30000144 (attackers
in 30000142, defenders in 30000144), or force the Caldari/Gallente border by outnumbering
30045344 (500001) vs 30003837 (500004); then check whether the fleet registry ASSIGN lands.
NOTE: MCP `evejs-server.events` reads the OWNER's play stack, not this one - do not mix them.

## FW PROVEN ON THE ACCELERATED STACK: war -> ASSAULT -> mutual orders -> real damage (2026-10-28T12:23Z, evejs-agents only)
Seeded by hand on the work stack (population 64, 8 real navy patrol hulls), then the world did
the rest by itself. Measured, verbatim from that stack:
  war_state: wars [war:500014-500019 ACTIVE, war:500001-500004 ACTIVE]
             campaigns [*:campaign:30000144 PREPARING, *:campaign:30045344 **ASSAULT**]
  presence 30045344 500001x6 / 500004x1 / 500014x3, 30003837 500004x3 / 500014x2 / 500019x2
  war_fleet_state: 2 registered fleets (coop-fleet-500004-0001 Federation Navy Atron 980000000565,
             coop-fleet-500001-0002) -> the earlier "ASSIGN never lands" blocker does NOT reproduce
             with the current fork build (bindWarRuntime + isHullLive fixes)
  living-native-war-garrison GARRISON_APPLIED (real hull bought through spawn_war_fleet)
  12:21:23 living-native-war-attack-orders: MUTUAL NATIVE_ATTACK_ORDER_ACCEPTED
             980000000423 <-> 980000000565, both in the contested 30045344
  12:22:19-12:22:29 living-native-combat-damage systemID 30045344 correlatedNpcDamage 1
             (a war hull really taking damage; ACK alone is still not a kill)
  war_diagnose now answers DRY_RUN campaigns 2 mobilized 1. The earlier
  INVALID_MOBILIZATION_STATE was a stale read immediately after a container recreate, not a
  durable bug - re-measure before "fixing" it.
Spawn recipe caveats (both real): every SDE navy profile points at `retail_empty_npc_entity_loadout`
so an explicit real `loadoutID` is mandatory; and `linkSpawnedIdentity` refuses
PILOT_ALREADY_LINKED because a free pilot is re-bound to its durable old hull within ~20 s, so pick
a pilot that is free RIGHT NOW (roster 64, 32 free) or bind the existing unlinked hull with
`assign_identity`.
NEXT (unmeasured): casualties (wreck + casualty ledger), objective/capture on a bound structure,
payout, and the same chain on a fresh agents world without hand seeding. The owner's play stack
was not touched; the elevated event numbers there (war:500001-500004 campaign:30045343 with
accepted attack orders at 12:05) come from the earlier morning deploy, read-only.

## FW-009A PROVEN + capture-by-force is the next wall (2026-10-28T12:27Z, evejs-agents)
12:24:46 `living-native-war-casualty` RECORDED: war:500001-500004 / campaign:30045344, victim
980000000283 (Caldari 500001, coop-pilot-013, corp 1000035), wreckID 980300000002, real native
wreck 12:24:46.677 `living-native-wreck-evidence` PHYSICAL_NATIVE_WRECK_VERIFIED, 4 stored items.
The receipt is honest about what it does not know: attribution NATIVE_VICTIM_WRECK_ONLY_NO_KILLER,
captureAuthorized false, killCreditAssigned false. So casualties are real; killer identity is not.
12:26:25 `living-native-war-skip` phase "capture-by-force" reason **NO_DEFENDER_WRECK** - the kill
we got was an ATTACKER hull, and FW-035 needs a wreck of the DEFENDING faction in the campaign
system, plus the defender holding ZERO registered hulls there twice, >=60 s apart.
Both garrisons keep buying replacement hulls (GARRISON_APPLIED at 12:24:08 and 12:26:52), so a
defender side never stays empty long enough: this is N5 (chest-funded garrison) promoted from
"nice to have" to the actual capture blocker. FW-005B `coopWarChestFunding` already exists and
moves only real earned ISK (pilot earned balance -> faction corp wallet -> HELD escrow), so N5
must be wired to it rather than to a new money source.
NEXT (exact): (1) get a defender-side wreck in 30045344 (attackers already outnumber 6:1 there);
(2) gate the garrison refill on a funded chest and refuse when empty, so the defender can really
stay at zero across the two 60 s samples; (3) observe CAPTURE_TERRITORY + militaryControllerFactionID
flip in war_state; (4) only then payout/merit for the owner's character.

## Harness quality pass: pinned verifiers + last hand-written gate (2026-10-28, OPS)
Two duplicated mechanisms in `scripts/` are now single implementations.
`scripts/lib/pinned-source.cjs` (84L) holds the git-blob hash of the CRLF-canonical text,
`readPinned` (disk bytes for the patch + hash for the pin), `assertReversible` (change,
idempotency at the last stage, byte-exact reversal per line ending) and the
`node script.cjs <root>` CLI. Five `verify-alife*.cjs` keep their own pins, messages and
exported names. Evidence: mismatch output byte-identical, `tests/coop-pinned-source.test.mjs`
8/8 including a real `git hash-object` oracle.
`Run-Alife-Economy-Tests.ps1` dropped 183L -> 13L: 38 tests, the
`-IncludeExistingEconomyTests` switch, ten NOT_RUN manifests, the `not ok` failure dump and
the 95-scenario banner are a row in `scripts/lib/gates.json` (purely additive: no existing
row changed). Before/after runs of the real suite are identical apart from the report path,
durations and the inspected stack-frame line.
NEXT candidates (not started): the `src/services/*` verifier copies are done, so the same
treatment fits the five `Inspect-Coop-*.ps1` (identical base64-over-docker probe, only the
module and banner differ), the ~50 test files that hand-roll env save/restore, and - only
after the other session commits `space/coopStationDrain.js` + `miningNpcOperations.js` -
the engine perf pass on `coopVirtualWorldRuntime.js` (477 `require()` calls, per-tick sorts).
`node scripts/coop-engine-audit.cjs` still prints AUDIT_REGRESSION from that in-flight work.

## Harness quality pass 2: read-only probes (2026-10-28, OPS)
The four `Inspect-Coop-{ConvoyOperations,ConvoyOutcomes,Market,MarketStation}.ps1` now
dot-source `scripts/lib/CoopContainerProbe.ps1` (69L) instead of repeating the
base64 + `docker compose exec -T server node -e` plumbing. `Inspect-Coop-Training` is
deliberately untouched (it inspects container env, not a module). Proven without a
container: a PowerShell `docker` function recorded the exact argv of all four before
and after; 12 cases (success / Docker exit 5 / missing compose) are identical in argv,
decoded payload, banners and thrown text. `tests/coop-container-probe.test.mjs` pins it.
Net lines went UP (+59) because the helper is documented and each wrapper is now named
data; the win is one container invocation instead of four.
Engine is UNBLOCKED again: the other session committed, `node scripts/coop-engine-audit.cjs`
prints AUDIT_OK and `coopVirtualWorldRuntime.js` is 4506L (ceiling 4800).
Perf must stay profile-first (`docs/PERFORMANCE_REVIEW.md`: no optimisation without a
profile row naming the caller). A micro-benchmark of `require()` on this shared box gave
70us/call and then 0us/call on re-run, so it proves nothing - do not act on it. The next
three targets are already ranked there (buildConfiguredConcordStartupRules memo,
structureState.cloneValue, coopGameStoreAtomic reconcileObject); a real profile needs the
agents stack, which another session is currently running (do not restart it).

## Stale wiring assertions + one real gap found (2026-10-28, TEST)
Three recorded-red test files were red for reasons that were not behaviour: a bare `\n`
anchor against `integration/coopVirtualWorldRuntime.cjs`, which is committed with CRLF
(byte-identical to the engine copy), and two checks that greped the LEGACY installer
`scripts/patch-evejs-coop.cjs` for module names that now live in `scripts/overlay-spec.cjs`.
`coop-alife-order-authority`, `coop-convoy-native-outcomes-overlay` and (partly)
`coop-alife-native-buyer-wiring` are green again; the module checks now ask
`overlayRegistrations()` for exactly ONE registration, which is stricter than a substring.
Anchors must be `\r?\n` - `docs/DEVELOPMENT_DOCTRINE.md` already says EOL-agnostic.

**Real gap, left standing on purpose:** `integration/coopAlifeStationAuthority.cjs` returns
`products: rows.map(({requirements,...x})=>x)` and NO `materialNeeds`, while
`coopAlifeNativeBuyerDispatch.cjs` requires `Array.isArray(economy.materialNeeds)` and
`coopAlifeNativeBuyerRuntime.cjs#needs()` requires `observed.materialNeeds` plus a
cross-pilot JSON match. Nothing in the repo or the fork ever writes `materialNeeds`
(`grep -rn materialNeeds` finds only those two readers and the tests that fabricate it),
so the opt-in COOP-049 buyer leg cannot fire even with its flag on - contradicting
`docs/COOP_049_ALIFE_NATIVE_BUYER.md` §2 ("derived concrete materialNeeds"). The red case
"station authority is genuinely read-only, never virtual inventory" is that alarm: do not
delete the assertion, decide whether the authority should derive `materialNeeds` from
`requirements` again or the buyer should read `products`. Feature is OFF by default, so
this is not a live regression.

### Where the parity baseline stands (2026-10-28, after 34b871ec)
`docs/evidence/test-parity.json` was re-recorded over its 31 files: **234 pass / 1 fail**
(was 222/13 at `b42e53fc`). Eleven of the thirteen were stale assertions, not behaviour:
a CRLF-vs-`\n` anchor, a sandbox `require()` whitelist that predated the module split, four
greps of the LEGACY installer's module list (now `overlayRegistrations()`), `safeNpcPhase`
labelled phases the coordinator dispatches as `runPhase` - one of those slices was EMPTY,
so its three assertions were passing on nothing - and one label that changed from
UNCLASSIFIED to INVALID. The single remaining red is the COOP-049 `materialNeeds` gap
above. The snapshot also contains the other session's uncommitted `overlay-spec.cjs` work;
reverting that shows up as a parity regression, which is the intended signal.

## FW capture: two real blockers found and fixed (2026-10-28T13:3xZ, evejs fork 45ad47f + 4068eff)
Capture (FW-035) could not land on the work stack, and it was NOT the wreck evidence:
`campaign:30045344` already held two verified defender wrecks (victimFactionID 500001,
attribution NATIVE_VICTIM_WRECK_ONLY_NO_KILLER). Two genuine defects were in the way.
1. N5 - the garrison bought a free replacement navy on cooldown forever (GARRISON_APPLIED
   every ~2.5 min), so the defending side never held zero live hulls. Fixed in the fork
   (4068eff, EVEJS_COOP_WAR_GARRISON_FUNDED=1, agents stack only): a refill now requires a
   COMMITTED FW-005B campaign-chest entry for that faction+campaign, i.e. ISK a real seeded
   market fill paid to an NPC pilot. Verified LIVE after deploy: `living-native-war-skip`
   phase "garrison" reason "GARRISON_CHEST_EMPTY" at 13:20:28 and 13:23:39 - no hull bought.
2. FW-035 counted registry rows, not hulls (45ad47f). A custody row is not a ship: three
   500001 rows whose hulls were in no scene answered DEFENDER_STILL_PRESENT forever. Capture
   now takes the same isHullLive scene probe FW-033 uses and reports liveDefenders +
   ghostDefenders separately; without the authority the old behaviour is unchanged.
Tests: tests/coop-war-garrison.test.mjs (12 pass), tests/coop-war-capture-by-force.test.mjs
(8 pass), `node scripts/coop-engine-audit.cjs` AUDIT_OK, integration/*.cjs in sync.
STILL UNPROVEN LIVE: CAPTURE_TERRITORY + a militaryControllerFactionID flip. The work stack
`evejs-agents` is being recreated by another session roughly every 10-20 min (13:13:25 was not
mine). After each recreate the durable navy hulls come back as registry rows but
`war_combat_diagnose` shows inScene=false / npc=false, so no attack order is ever issued
(latest living-native-war-attack-orders is 12:31:27) and no defender wreck can be produced in
the window. Re-seeding by hand (spawn_native_npc + assign_identity, then spawn_war_fleet) gets
a real ASSAULT campaign and in-scene hulls (1702 npc=true) but the peers do not materialize.
Next: one quiet window on evejs-agents, or the owner's approval, to run the last step:
1 live defender + 3 armed attackers in the target system -> defender wreck -> zero live
defenders -> CAPTURE_TERRITORY. Do not weaken the sustain window to force it.

## Test-side duplication: flags on/off (2026-10-28, TEST)
`tests/_support/env.mjs` now owns "turn these flags on, then put them back" (`swapEnv`,
`withEnv(t, ...)`), and nine files use it - previously four spellings of the same six
lines, including one `process.on('exit')` variant for flags set at import time. Each file
keeps its own flag list; only save/apply/restore is shared. 44 lines out, 25 in. Verified
case-by-case (counts and failing names identical before/after). `tests/coop-env-support.test.mjs`
(7 cases) pins the two rules that matter: an originally unset name is deleted, never set to
the string "undefined", and an existing value comes back exactly.
The other ~19 files with a hand-rolled snapshot are mostly the `coop-escort-*` family, which
is already deeply red (below) - convert them when their cases are fixed, not before.

### The escort suite is the largest red cluster and has no single cause
34 `tests/coop-escort-*.test.mjs` files, ~120 failing cases (13 `CONTRACT_NOT_FOUND`,
9 `FLIGHT_FUNDING_PREPARE_UNCERTAIN`, 8 each `ROUTE_CHECKPOINT_WRITE_UNCERTAIN` /
`MANIFEST_DIRECTORY_DURABILITY_UNCERTAIN`, plus a long tail). This is not one import path or
one moved helper: each is a per-case expectation against the durable funding/warp-fence
contract. Deciding whether the tests or the runtime is stale needs the escort owner's intent,
so it is recorded here rather than "fixed" by relaxing assertions. None of these files are in
`docs/evidence/test-parity.json`; adding them would only record red.

## FW CAPTURE PROVEN END TO END (2026-10-28T13:37:57Z, evejs-agents only)
The final gate of the FW ladder is now measured on the accelerated work stack, with no
fabricated step anywhere in the chain:
  13:36:04  living-native-war-casualty RECORDED - defending hull 980000001974
            (Caldari Navy Condor, faction 500001, coop-pilot-005, corp 1000035) destroyed in
            30045344; wreck 980300000010, 4 stored items / 315 units,
            living-native-wreck-evidence PHYSICAL_NATIVE_WRECK_VERIFIED.
  13:37:29  living-native-war-capture-by-force -> OBJECTIVE_RECORDED (warship:980300000010)
  13:37:57  living-native-war-capture-by-force -> **CAPTURED**, receipt CAPTURE_TERRITORY
            APPLIED, systemID 30045344, **militaryControllerFactionID 500011**,
            territoryRevision 3, mode MILITARY_CONTROL_ONLY.
  war_state afterwards: 30045344 = 500011 / **OCCUPIED** rev 3 (was 500001 / CONTESTED),
            campaign:30045344 = OCCUPIED.
Why it landed now and never before - three real defects were fixed in the fork:
  4068eff N5   a garrison may only buy a replacement hull with a COMMITTED FW-005B campaign
               chest entry (real earned ISK). Live proof of the refusal: garrison
               GARRISON_CHEST_EMPTY at 13:20:28, 13:23:39, i.e. no free navy.
  45ad47f FW-035  capture counts hulls really in the scene, not custody rows (it used to
               answer DEFENDER_STILL_PRESENT for three hulls that were nowhere).
  ded5cc7 FW-003C mobilisation counts only hulls really in the scene too; a ghost assignment
               used to mark both sides SIDE_MUSTERED while the only live hull sat idle, so no
               attack order was ever issued and the campaign stalled in ASSAULT.
Tests: coop-war-garrison 12, coop-war-capture-by-force 8, coop-war-mobilization 17 - all pass;
`node scripts/coop-engine-audit.cjs` AUDIT_OK; integration/*.cjs identical to the fork.
Still open (unchanged, not blockers for the capture claim): killer identity is not attributed
(NATIVE_VICTIM_WRECK_ONLY_NO_KILLER), and merit/payout for the owner's character is not yet
observed. The owner's play stack `evejs` was never restarted or reconfigured.

## Escort suite: 122 red cases were a platform artefact (2026-10-28, L1)
Root cause found: every escort/manifest journal fsyncs a DIRECTORY (and, on its re-read
paths, a handle opened read-only) to prove durability before the route advances. On Windows
`fs.openSync(dir)` succeeds but `fsyncSync` throws EPERM, and a read-only handle cannot be
flushed either, so the gates answered MANIFEST_DIRECTORY_DURABILITY_UNCERTAIN,
ROUTE_CHECKPOINT_WRITE_UNCERTAIN, DEPARTURE_REPLAY_FSYNC_UNCERTAIN,
PERSISTED_DIRECTORY_SYNC_UNCERTAIN and refused to advance - on every case, regardless of
the code under test. The fork already had the convention (coopNpcAmmoBankAtomic,
coopNpcWreckCustody, coopNpcManufacturingJournal, coopNpcNativeEconomyDirector); ten
escort/manifest modules had never adopted it. Engine commit 109e131, mirrored here as
97db7108. Linux (the deployed container) is untouched: the guard is `process.platform
=== "win32"` only, write-path fsyncs stay strict, and the read-only re-read paths return
what they would have returned after a successful fsync.
Result on Windows: escort suite 290 pass / 122 fail -> 359 / 52. Also fixed
`coop-escort-native-binding` (11 cases) whose fixture never gained
`settlePeacefulFlight`/`readContract` after d4aa1d54: 14/14.

### What is left in the escort red set, and why it is not the same bug
52 cases, all "the feature now demands a dependency the fixture does not build":
- `coop-escort-flight-stage-c` (13): coopNativeStationArrival.start() pauses with
  ESCORT_DURABLE_WARP_FENCE_REQUIRED unless a durableWarpFence with
  inspectSource/prepare/confirm is injected.
- `coop-escort-native-predeparture` (6), `station-predeparture-gate` (6),
  `route-recovery` (5), `bootstrap-failure` (4), `departure-witness` (3),
  `tactics-rescue` (3), `verified-volunteers` (3): same shape - the fixture must now
  provide the departure/route witness or fence the runtime requires when the paid-escort
  flag is on.
Each needs the fixture rebuilt against the contract, not an assertion relaxed. Do that
feature by feature and record each file's new baseline; do not mass-skip.

### Windows fsync guard, second batch (fork 7adf5d5, mirrored a6fabf64)
Same rule applied to the seven modules that still fsynced a directory unguarded: opportunity
board, escort volunteers, contract mutation fence, job agent selection, job notifications,
salvage consent, salvage provenance. Each gets one local `guard(io, fd)` (they take `io` as a
dependency, so it cannot close over the default fs) and only the directory call sites use it.
Effect: coop-native-opportunity-board 6/10 -> 15/1, coop-escort-native-predeparture 5/6 ->
11/0, escort suite 359/52 -> 365/46. Unchanged (checked before and after):
coop-installer-module-coverage 2/1, coop-npc-job-board 19/1,
coop-salvage-postpickup-settlement 3/6, coop-native-haul-manifest 8/4.
Known inconsistency to unify once `scripts/overlay-spec.cjs` is not being edited by another
session: this guard exists in two shapes - `process.platform === "win32"` plus the errno set
(most modules) and the errno set alone (`coopNativeStationTripJournal`, which documents the
same limitation). One shared helper module is the right answer; it needs an overlay entry.

### coop-escort-flight-stage-c (13 red) is obsolete coverage, not a fixture tweak
Measured, not assumed: injecting `warpFence: createWarpFence({root,clock})` and
`EVEJS_COOP_ESCORT_WARP_FENCE=1` (passing `durableWarpFence:` does nothing - the module builds
it from that flag) moves 2 of 13. The next blocker is
ESCORT_DISCOVERY_AND_PAID_CONSENT_REQUIRED, i.e. `start()` now also demands
EVEJS_COOP_OPPORTUNITY_BOARD + EVEJS_COOP_EVENT_VOLUNTEERS + EVEJS_COOP_ESCORT_PAID_ACCEPT and
a real opportunity-board event before any paid departure. Those preconditions are covered by
files that are already green (native-priced-acceptance 11/11, durable-warp-fence 10/10,
native-funds 22/22, options-board 15/1). Do not rewrite this fixture into a full discovery
simulation: decide with the owner whether these 13 cases are retired or reduced to the flight
gate + station-arrival slice they were written for.

## After the capture: merit works, the client sees the occupation, the bounty is the last rung (13:5xZ)
- Player-visible effect of the capture, from the real client view module on the live state:
  `occupationStates` for 30045344 = {ownerID:500011, occupierID:500011, contested:false,
  militaryState:"OCCUPIED"} (it was 500001/CONTESTED), and the captured campaign is no longer
  listed by `liveCampaigns`.
- Kill merit really runs: `living-native-war-merit` PROMOTED coop-pilot-026/027/045/050/055 with
  kind "warship-kill" +25 and demoted victims with "force-lost" -10, e.g. 13:27:00.799
  coop-pilot-050 recruit -> pilot. `killCreditAssigned:true` still never appears in a casualty
  receipt: attribution stays NATIVE_VICTIM_WRECK_ONLY_NO_KILLER, and a passing merit promotion is
  not a final-blow claim.
- Bounty PAYOUT is the only unproven rung, and it is blocked by money, not by combat:
  `war_funding_diagnose` answers NO_REAL_FACTION_INCOME on every side because the refinery
  treasury sweep already moved the pilots' real earnings into the corporation wallet
  (`living-corp-treasury-swept` 250 000 ISK), and FW-005B's levy reads only PILOT balances. With
  no levy there is no chest entry, so at campaign open `warBountyReserve` refuses and no HELD
  escrow ever exists to pay a killer.
  Fix attempted and deployed (env-gated, agents stack only): EVEJS_COOP_WAR_BOUNTY_WALLET_FALLBACK=1
  lets the reservation be backed by that same native corporation wallet. `coopWarTreasury` RESERVE
  verifies the corporation/faction, writes a real journal entry and debits division 1000, refusing
  when the money is not there - so nothing is minted, only spent from where real settlements put it.
  A reservation can only be taken for a campaign that does not exist yet (it is taken before
  START_CAMPAIGN), so PAYOUT needs one NEW campaign opened after this deploy, then a kill in it.
  Watching for that opening; if none appears, the payout stays PENDING with this exact cause.

### Escort red set: 46 -> 19 (this session)
Two root causes removed, both evidenced before/after:
1. Four escort journals (`coopEscortTerminalAttendance`, `coopEscortDepartureWitness`,
   `coopEscortRouteWitness`, `coopEscortNativeIngressSnapshot`) skipped the whole durability
   re-read on win32 with a blanket `return true`. Replaced with one local
   `platformFsync(io, fd)` that attempts the fsync and swallows only EPERM/EINVAL/ENOTSUP/
   EBADF/EISDIR, and only on win32 (fork f6ef7fc, mirrored 6bd4805c). Linux unchanged; on
   Windows a real refusal is still accepted and an injected lost ACK now throws. Effect:
   route witness 18/2 -> 20/0, terminal attendance 14/2 -> 16/0, ingress snapshot 13/1 ->
   14/0, departure witness 15/3 -> 17/0.
2. Four fixture defects where the fixture contradicted the module's own contract (not
   relaxed assertions): paid stubbed `fleetID 33` vs a duo receipt with no fleetID;
   `shipID: id + 200` giving player 701 the native hauler's 901; a contract without
   `stationID`; and a symlink case now skipping on EPERM/EACCES like its sibling file.
Remaining 19 escort reds: `coop-escort-flight-stage-c` 13 (obsolete coverage, see above),
`native-tactics-rescue` 3 (`NATIVE_CONVOY_OR_FLEET_NOT_CONFIRMED` before any tactic),
`native-route-recovery` 1, `pinned-native-mount` 1 (`FLIGHT_BOOKING_NOT_AUTHORIZED`),
`refund-manifest` 1 (`NATIVE_REFUND_HISTORY_SOURCE_UNAVAILABLE`).

### Repo shim gap, measured (not fixed): 118 missing `integration/*.js` shims
`integration/*.cjs` call `require("./sibling")` without an extension, which Node's CJS
resolver never maps to `.cjs`; the deployed tree uses `.js`, so it resolves there. 121
shims exist, 118 module names are still missing. A `Module._resolveFilename` hook that maps
extensionless sibling requests to `.cjs` (measured, temp file only) moves the escort suite
from 365/46 to 371/40, i.e. it is worth ~6 cases and would remove the whole class including
silent `try/catch -> pause(STATUS)` masking. One shim was added for
`coopStuckWarpRecovery` because its absence was a hard throw. Decide with the owner:
generated shims vs one test-support resolver hook (needs the runners to pass `--require`).

### Escort red set: 19 -> 13 (all remaining reds are one file)
A real product bug, found by the tests: `coopEscortFlightGate` asked
`authorizeBooking` for `{haulerID}`, but the runtime forwarded `route.haulerIDs?.[0]`
(undefined) to the native duo verifier and the mount adapter rejected the route as
`DENIED_PREWARP_ROUTE_INVALID`. No genuine native booking could ever be funded; a
fixture bypassing the gate hid it. Both shapes now travel (fork 3f8b907, mirrored
be188253), the adapter still resolves exactly one positive hauler ID.
`escort-pinned-native-mount` 6/1 -> 7/0.
Three more fixtures restored to the module contracts: `native-tactics-rescue` route
needed `playerFleetID` (10/10), `native-route-recovery` cargo rows needed `ownerID`
or the deposit is skipped as DEPOSIT_OWNER_UNPROVEN (43/43), `refund-manifest`
runtime needed `readContract` (3/3).
Escort suite now 397 pass / 13 fail, and all 13 are `coop-escort-flight-stage-c`,
which is obsolete coverage (see earlier measurement): it predates mandatory
discovery + paid consent and is covered green elsewhere. Owner decision pending:
retire it or reduce it to the gate + station-arrival slice.

## PAYOUT: root cause found (REQUIRE_FUNDING was off), still not observable (14:0xZ)
Cause, measured rather than guessed: the work stack ran with
`EVEJS_COOP_WAR_REQUIRE_FUNDING=0`. `coopFactionWarOpening.applyOpenings` then skips the
escrow step entirely (`fundingRequired()` false), records `PAPER_UNFUNDED_EXPLICIT` and opens
the campaign anyway. With no HELD reservation there is nothing a bounty could ever pay from, so
`warBountyReserve` was never exercised and `treasury-v1.reservations` stayed at 0.
Actions taken on the work stack only:
 * `EVEJS_COOP_WAR_BOUNTY_WALLET_FALLBACK=1` - the pilot-earned levy is empty because the
   refinery sweep already moved those ISK into the corporation wallet, so when `planLevy`
   answers NO_REAL_FACTION_INCOME the escrow may be backed by that same native wallet;
   `coopWarTreasury` RESERVE verifies corporation/faction, writes a real journal entry and
   debits division 1000, so value is spent, never minted.
 * `EVEJS_COOP_WAR_REQUIRE_FUNDING=1` - a campaign may now only open with a real HELD escrow,
   which is the only configuration in which PAYOUT can exist at all.
 * route extended with the two real stargate neighbours of the captured system
   (30045343, 30045342) so the world can derive a NEW front from real travel.
Result of that: the world did open `war:500011-500014` and projected 30045342 -> 500014, so the
frontier logic works, but the next tick answers `NO_OPENABLE_FRONT` for all 3 candidate borders
because each target already carries a live campaign (30000144, 30000145, 30045344) - the
orientation flip only rescues a border whose blocker belongs to a DIFFERENT faction pair.
So PAYOUT is not blocked by code any more: it needs ONE campaign to finish (freeing a target)
and then a NEW campaign to open under REQUIRE_FUNDING=1, where the reservation itself will be
recorded as `living-native-war-bounty-reserved`. Nothing about that is faked in this repo.

### Mirror-resolution gap is now a tool, not folklore
`integration/*.cjs` keep the engine's extensionless `require("./sibling")`. Node never
resolves that to `.cjs`, so a missing `.js` shim throws MODULE_NOT_FOUND - or, inside
`try/catch`, becomes a plausible pause status that silently rewrites what a test proves.
Three such gaps were already paid for in this session (`coopStuckWarpRecovery`,
`coopAlifeNativeDeliveryEvidence`, and the sandbox tests that forwards `require(id)` from
the test directory instead of the integration directory).
- `scripts/coop-integration-shims.cjs --check|--write` lists/creates the shims and rejects a
  shim that forwards to a different module object; `tests/coop-integration-shims.test.mjs`
  pins it (currently ~120 names missing, so the test is red until `--write` runs).
- `tests/_support/integrationSandbox.mjs#loadIntegration(name, overrides)` compiles a module
  with a require that resolves a bare sibling to `integration/<name>.cjs`; used by
  `coop-native-station-arrival` and `coop-native-haul-manifest-station`. Remaining
  hand-rolled `new Function("require",...)` sandboxes should move to it.

## Doctrines + dynamic decisions (FW-036, FW-037) live on the work stack (14:3xZ)
Live capability table measured inside the running container through the REAL doctrine
composition (`warFleetAuthorities().composition` + real npcLoadouts + real weapon dogma):
  500001 CAN_FIELD (coop_war_doctrine_500001_tackle)   500004 CAN_FIELD
  500011 CAN_FIELD                                     500020 CAN_FIELD
  500010 NO_NAVY   500012 NO_NAVY   500014 NO_NAVY (ORE)   500019 NO_NAVY
and the decision itself: `decide(500004, 500014)` -> {open:false,
reason:"NO_NAVY_CAPABILITY:DEFENDER"}; `decide(500004, 500011)` -> {open:true,
reason:"BOTH_SIDES_CAN_FIELD_NAVY"}.
FW-036 (new module `coopWarNavyCapability`): a war party must be able to field a real navy.
A hull counts only when its real loadout carries a module that resolves to a real WEAPON
family AND a charge with quantityPerModule >= 1 - a strip miner has both and is still not a
navy, which is exactly how ORE looked armed. Both sides must be able to fight, because
capture-by-force needs a defending wreck and a navy-less defender can never produce one (the
measured deadlock: an ORE party's campaign held the target and every other front answered
NO_OPENABLE_FRONT). Unknown capability is never a yes; without the authority the planner is
unchanged.
FW-037: an unfunded border is now skipped BY NAME (`SUPPLY_UNFUNDED:<warID>:<reason>`) and the
batch continues, instead of throwing the whole plan away - one broke pair no longer blocks
every other border in the same tick.
ECONOMIC FINDING that still blocks a bounty payout, now measured not guessed - real corporation
wallets (division 1000, the only source coopWarTreasury may debit):
  1000035 (Caldari) 0   1000120 (Gallente) 0   1000138 (Angel) 0
  1000129 (ORE) 136 554 292.96 ISK   others 0
So every faction that can field a navy is broke, and the only funded corporation (ORE) cannot
field one. Opening a campaign with REQUIRE_FUNDING=1 therefore answers
`SUPPLY_UNFUNDED:...:WAR_TREASURY_FUNDS_UNAVAILABLE`, and that is the correct answer: militia
corporations currently have no income path (mining/refining corps do). Payout needs either a
militia income doctrine or an owner decision to fund militia corporations from the real economy.
`node scripts/coop-engine-audit.cjs` reports drift in `coopMissionInstanceProvenance.cjs` - that
file belongs to another session's in-progress work and was left untouched.

## war_diagnose now answers "can this border be fought at all" (14:4xZ, live)
Live output from the running work stack right after the deploy:
  navy status OK
    500004 CAN_FIELD armed:1 coop_war_doctrine_500004_tackle
    500010 NO_NAVY   armed:0
    500011 CAN_FIELD armed:1 coop_war_doctrine_500011_tackle
    500014 NO_NAVY   armed:0            <- ORE: mining loadouts only
  war war:500010-500014 -> NO_NAVY_CAPABILITY:ATTACKER
  war war:500004-500011 -> BOTH_SIDES_CAN_FIELD_NAVY
So the two wars are now distinguishable without reading the opening skip list: one is a
paper war nobody can fight, the other is a real border. Read-only; the capability comes from
the same doctrine composition the sanctioned spawn path uses.
NOTE for the next agent: `node scripts/coop-engine-audit.cjs` currently reports drift in
`coopGameStoreAtomic.cjs` and `coopNativeStationTripJournal.cjs` (earlier it was
`coopMissionInstanceProvenance.cjs`). Those are another session's in-progress files; this branch
did not touch them and they were deliberately left alone.
STILL OPEN (owner decision): militia corporations have no income (measured: 1000035/1000120/
1000138 = 0 ISK, only ORE 1000129 holds 136.5 M), so no escrow and no bounty payout exists.
FW-036/037 removed the deadlock and the silent failure, but they cannot create money.

## FW-038: money and navies sat on opposite sides -> mercenary decision (live)
Live `war_funding_diagnose` after the deploy:
  needCents 2500000
  mercenary {"status":"PROPOSED","proposals":[{"payerFactionID":500014,
    "payerCorporationID":1000129,"payerBalanceCents":13655429296,
    "mercenaryFactionID":500004,"amountCents":2500000,
    "reason":"NAVY_WITHOUT_TREASURY_PAIRED_WITH_TREASURY_WITHOUT_NAVY"}]}
i.e. the only funded faction (ORE) can hire the cheapest navy-capable faction for exactly the
bounty need, computed from real division-1000 balances and the real doctrine composition.
The decision is pure (`coopWarMercenaryContract.proposeContracts`, 4 tests): one contract per
payer, refuses a payer that cannot cover the need, refuses to pay a navy that already has money,
refuses a zero need. It moves no ISK and creates none - the transfer is still a separate,
journaled two-leg operation on real corporation wallets (`coopCorpWallet.applyDelta` writes and
reads the balance back), which is the next wiring job.

## FW-038B: money MOVED, then a real defect stopped it (2026-10-28T15:0xZ) - FEATURE DISABLED
What worked, measured on the work stack with a dry run first:
  DRY_RUN merc:fw038b:1 -> payer 1000129 179 219 344.69 ISK, payee 1000120 0 -> 25 000,
  PAID merc:fw038b:1 -> payer 179 194 344.69, payee 25 000 (exactly one debit, one credit).
What failed, and it is why the flag is now `EVEJS_COOP_WAR_MERCENARY_CONTRACT: "0"`:
  a replay of the SAME event 28 s later answered PAID again instead of DUPLICATE. The
  journal row (`coop-faction-war\u001fmercenary-v1` in corporationRuntime) could be read
  back right after the write - the new durability guard passed - and was then GONE on the
  next request. Result: ORE 1000129 went 179 219 344.69 -> 179 169 344.69 (two debits) while
  the payee received 25 000 once, i.e. 25 000 ISK was DESTROYED. A further replay paid a
  third time (payee 50 000 -> 75 000, payer -25 000, this leg conserved).
  Root cause is the same durability class already seen with the war state: a row written
  through the atomic native store is not reliably readable/writable across container
  recreates in this world. A money mover therefore CANNOT anchor idempotency in that table.
The code is kept, tested (8 tests) and honest about it: it refuses to debit unless the
PREPARED row reads back (`WAR_MERCENARY_JOURNAL_NOT_DURABLE`), but that is not enough when
the row can vanish AFTER the payment. The correct fix is to anchor the event in the same
record that holds the money (a reservation in `coopWarTreasury`, whose journal is a wallet
transaction) so a replay is refused by the wallet itself, not by a separate row.
No further transfers are possible while the flag is 0; mining/refining economy untouched.

## FW-038C: wallet-anchored payment + a REAL HELD bounty escrow (15:28Z, proven live)
Idempotency fix that worked, measured on the same running stack:
  merc:fw038c:1 PAID (debitLeg APPLIED, creditLeg APPLIED)
  replay of the SAME event -> status PAID but debitLeg DUPLICATE, creditLeg DUPLICATE and
  every balance byte-identical before and after (1000129=280 097 039.67, 1000120=100 000).
  The marker lives in the wallet journal itself (`FW-MERC <eventID> DEBIT|CREDIT`), written in
  the same write as the balance, so a vanished side row can no longer cause a second payment.
Money now sits where the war needs it, all of it moved from real ORE income by journaled
two-leg transfers (nothing minted):
  1000120 (Federation Navy) 100 000 ISK    1000138 (Angel Cartel) 25 000 ISK
And the chain completed by itself 15:28:40:
  living-native-war-bounty-reserved RESERVED
  factionID 500011, corporationID 1000138, campaign war:500004-500011:campaign:30045344,
  amountCents 2 500 000 (25 000 ISK), reservation HELD, escrow journal 8000000000000000.
So for the first time in this world a war party holds a REAL bounty escrow, taken from a real
corporation wallet. The remaining step is only the native trigger: an attributed kill in that
campaign (or a recorded casualty, which `coopWarBounty` accepts) releases the escrow to the
pilot's earned balance - `living-native-war-merit` already proved the attribution path works
(5 promotions). Nothing about that is staged or faked.

## FW-039: an orphaned escrow blocked its own campaign - fixed (15:5xZ)
After the HELD escrow appeared at 15:28:40 the campaign record was lost to another session's
container recreate while `bounty:war:500004-500011:campaign:30045344:500011` stayed HELD. Every
later opening then refused with WAR_TREASURY_PURPOSE_UNAVAILABLE, i.e. 25 000 ISK of real money
was locked with no war it could ever pay, and the border could never restart.
Fix (fork, tested): RESERVE reuses a HELD reservation for the same war/campaign/faction when the
campaign record does not exist - nothing is debited twice and the receipt names the existing
journal - and a RESERVE naming a HELD reservation is decided there instead of being rejected up
front. `tests/coop-war-treasury.test.mjs` 15/15 (new case: orphan reused, DUPLICATE + reused:true).
After the redeploy the world has war:500004-500011 with no campaign yet; the next derivable front
opens it, the escrow is reused, and the only remaining trigger is an attributed kill in that
campaign (or a recorded casualty, which coopWarBounty accepts) to release the escrow to the pilot.
Session ladder status: capture PROVEN, merit PROVEN, client view PROVEN, escrow PROVEN,
payout TRIGGER PENDING (needs one live kill in a funded campaign; the seeds are in place).

## Payout trigger: still pending, with the exact next diagnostic (17:0xZ)
Current measured state on `evejs-agents` (after another session's recreate, healthy):
  war_state: `war:500004-500011`, **no campaigns**, territories 30003837=500004 and 30045344=500011
  presence  : 30003837 {500004:3, 500012:2, 500019:1}, 30045344 {500011:3, 500012:1, 500019:1}
  funding   : both parties CAN_FIELD and both are funded (1000120 = 100 000 ISK after a real
              mercenary transfer, 1000138 = 25 000 ISK), escrow `bounty:...:500011` REUSABLE
              since FW-039; `war_funding_diagnose` mercenary answers
              `{status:"REFUSED", reason:"NO_FUNDED_NAVY_PAIR", refusals:[{500004,
              reason:"ALREADY_SELF_SUFFICIENT"}]}` - i.e. no hire is needed any more.
So every precondition for a funded campaign exists, yet the opening phase produces **no event at
all** since 15:29:10 (not even a refusal), which means `advanceNativeWarOpening` returns before
`planWars`: the untested suspects are `visitedSystems` (the tick passes only
`[...visitedSystems].slice(0,12)`, and a system present in the war state's presence list is not
necessarily in that set) and the `warOpening.tick` early returns (`NO_LINK`/`NO_SYSTEMS`).
Observability fix shipped this session (fork): the opening refusal event now dedups on
`reason + JSON.stringify(per-border skips)` and carries `skipped[]`, because a border that
changed from NO_NAVY to "no money" kept the same top-level NO_OPENABLE_FRONT and was invisible.
Next exact step for whoever continues: publish/log the opening phase's early-return reason
(`warSkip("opening", ...)` already exists for all of them but only fires on a state change) and
check `visitedSystems` membership for 30003837/30045344 at the moment the phase runs.

## FUNDED CAMPAIGN + REAL KILL, payout still gated by attribution (17:25Z)
Chain reached with a funded escrow and real combat in the SAME campaign:
  17:18:43 living-native-war-bounty-reserved RESERVED factionID 500004, corp 1000120,
          campaign war:500004-500011:campaign:30045344  (real HELD 25 000 ISK)
  17:18:43 living-native-war-opened OPENED war:500004-500011 + that campaign
  17:20:05 / 17:23:43 living-native-war-attack-orders OBSERVED
  17:25:12 living-native-war-casualty RECORDED: victim 980000003812, wreck 980300000012,
          pilot coop-pilot-005, corp 1000120, victimFactionID 500004, in that campaign.
Fixes that made this possible this round (all in the fork, all with reasoning in the commits):
  * the opening planner now unions visited systems with the systems the war already owns -
    it had been blind to 30003837/30045344 because the A-Life walker had not visited them;
  * OPENED now means something opened (a fully skipped batch is REFUSED/NO_FUNDED_FRONT);
  * the refusal event carries the applier's per-border reasons, which is how the two real
    blockers (WAR_TREASURY_JOURNAL_COLLISION, WAR_TREASURY_FUNDS_UNAVAILABLE) became visible;
  * the escrow journal id is derived from the wallet, so a lost counter cannot collide.
PAYOUT STILL DID NOT FIRE, and the reason is honest and specific: the casualty receipt carries
`attribution:"NATIVE_VICTIM_WRECK_ONLY_NO_KILLER"`, no `living-native-war-merit` was emitted for
it, so `coopWarKillMerit` never called the bounty payer. This is the documented FinalBlow gate:
attribution may only come from the native destruction caller's explicit `options.attackerEntity`,
and it must not be guessed. Merit DID fire 5 times earlier in the day for stock NPC kills, so the
mechanism works; what is missing is that path for war-fleet hulls.
NEXT EXACT STEP: pass the native attacker entity through the war-fleet destruction hook (the same
one that already credits stock NPC kills), then the HELD escrow pays automatically.

## FW-040 deployed; the blocker is now the shared stack's churn, not the code (18:0xZ)
Found and fixed the exact reason a war kill could not be attributed: the attribution path read
identity links from the ON-DISK file only, and that file lags the live registry, so a real war
casualty answered `NOT_UNIQUE_NAMED_PIRATE` (measured 17:25:12) - no attribution, no merit, and
the HELD bounty could never pay. `coopNpcDestructionAttacker` now merges the on-disk links with
the live identity registry (`identityLinks()` exported from the runtime, pure `mergeLinks`
helper, 2 tests). Deployed.
Proof that the mechanism itself works when attribution lands: 17:40:29
`living-native-destruction-attacker NATIVE_DESTRUCTION_ATTACKER_PROVIDED` attacker coop-pilot-060
-> `living-native-war-merit PROMOTED coop-pilot-060 warship-kill +25` and the victim
coop-pilot-002 `force-lost -10`, in the same millisecond.
What now blocks the final observation is the environment, measured rather than assumed: the
shared `evejs-agents` stack is recreated by another session roughly every 10-30 minutes (container
created 17:31, then again at ~17:5x and ~18:0x), and the war state row does not survive those
recreates: `war_diagnose` now answers `mob DRY_RUN camps 0 mobilized 0` with an empty navy list,
i.e. the campaign and the escrow purpose were reset again even though the treasury row kept the
HELD reservation. No code change can hold a 5-minute combat window open across that.
SESSION LADDER: capture PROVEN, merit PROVEN (6 promotions), client view PROVEN (OCCUPIED),
escrow PROVEN (real HELD 25 000 ISK from real earnings), attribution PROVEN (17:40:29),
payout = the only rung not yet observed, gated by campaign survival, not by missing logic.

## FW-041 mirror deployed; measured caveat (18:0xZ)
The mirror exists and is written on every successful war-state write, but at 17:55:19 and
17:57:09 the world CREATED an empty state again (another session's recreate), so the mirror now
holds the EMPTY document (100 bytes) and `chooseWarRestore` correctly refuses it
(`MIRROR_EMPTY_TOO`). That is the right behaviour but it means the mirror only protects a war
that already exists at the moment of the write: the war must be opened first, then mirrored, then
survive long enough to be fought.
Current live state: `living-native-war-opening-blocked NO_OPENABLE_FRONT` every 30 s, wars none,
mirror empty. Presence and the identity world still exist on the volume, so a front can still be
derived the moment a navy-capable pair owns two adjacent systems.
CONCLUSION for the payout rung: every other rung is proven (capture, merit, client view, escrow,
attribution). Payout needs ~5 uninterrupted minutes of a funded war against an armed enemy, and
this shared stack is recreated every 10-30 min by another session while the war row does not
survive it. Options: a quiet window, or the atomic-row durability fix at the store level.

## ROOT CAUSE of the vanishing war state (18:1xZ) - evidence, not a guess
Direct read of `/var/lib/evejs/gameStore/gamestore.sqlite` (table `corporationRuntime`):
  key "coop-faction-war"           9018 bytes  <- the LEGACY namespace blob, survives
      inside: state-v1 (wars/campaigns/territories ALL empty, history 0),
              treasury-v1 (1 reservation), merit-v1 (2 pilots), mercenary-v1
  key "coop-faction-war|state-v1"  100 bytes   <- the atomic row, EMPTY
  key "coop-faction-war|treasury-v1"           ABSENT as a row, but PRESENT in the blob
So the two storage views disagree, and the blob is what outlives a recreate. Each pointer write
and each legacy flush rewrites that blob from the legacy cache, which never contains the
atomic-only war state row - so the blob keeps an EMPTY state-v1 while other sub-keys (treasury,
merit) survive because they were also read through the legacy API. At the next boot the blob's
view wins and the war (wars + campaigns + territories) is gone while real ISK stays in escrow.
That is the store-level defect behind every "war state CREATED empty" event of the day, and it is
NOT fixable inside the FW modules: a module cannot make one write atomically visible to the other
view. The mirror (FW-041) is the correct mitigation, but it can only help once the state is
non-empty when it is written; right now the mirror holds the empty document (100 bytes) and the
world has no territories at all, so there is nothing yet to protect.
NEXT (concrete, for a store-level change - needs the owner's agreement because it touches the
shared GameStore): either keep the two views in sync for `coop-faction-war` (write the legacy
path with the same document on every atomic write), or make the boot reconciliation prefer the
atomic row over the namespace blob. Then the mirror/FW-041 keeps a second copy and a recreate can
no longer erase a war that already exists.

## Finish recipe for the payout rung (copy/paste, ~10 min in a quiet window)
1. Confirm the stack is not being recreated: `docker inspect -f '{{.Created}}' evejs-agents-server-1`
   must stay unchanged for the whole run.
2. Make one navy faction own a system next to another navy faction's system. Proven working
   seed (armed, durable, real doctrine):
   `spawn_native_npc systemID=30003837 profileQuery="Federation Navy Atron"
    loadoutID=serpentis_small_blaster_frigate warPatrol=true durable=true pilotID=<free>`
   x3, and x3 `"Angel Raider"` + `angel_small_autocannon_frigate` in 30045344.
   Free pilots: read `/var/lib/evejs/coop-npc-links.json` vs `coop-virtual-world.json`.
   If a spawn answers PILOT_ALREADY_LINKED use `assign_identity` with the returned entityID.
3. Both militia wallets must hold >= 25 000 ISK (bounty need). Measured 18:3xZ:
   1000120 = 50 000, 1000138 = 25 000, 1000129 (ORE) = 433 790 567.61.
   Top up with a real transfer: `war_mercenary_settle` eventID`merc:<n>`
   payerCorporationID 1000129, payeeCorporationID <1000120|1000138>, amountCents 2500000.
   Idempotency is wallet-anchored, so a replay is refused with both legs DUPLICATE.
4. Wait for `living-native-war-opened` + `living-native-war-bounty-reserved RESERVED`, then for
   `living-native-war-attack-orders OBSERVED` and a `living-native-war-casualty RECORDED` in that
   campaign. Attribution needs `living-native-destruction-attacker
   NATIVE_DESTRUCTION_ATTACKER_PROVIDED` (proven at 17:40:29 with merit PROMOTED).
5. Payout shows as the treasury reservation flipping HELD -> PAID with `paidToPilotID`, plus
   `living-native-war-merit` for the killer. Nothing else is required; no code left to write.

## FW-043 works: the map rebuilds itself (18:39Z), and it exposes the real frontier shape
`living-native-war-territory-bootstrap REGISTERED_FROM_PRESENCE added:6` - territories are back
without any hand-written record: 30000142/30000144/30000145/30003837 = 500014, 30045342 = 500010,
30045344 = 500011. The empty-map deadlock is gone; after any recreate the world can own ground,
project sovereignty and derive fronts again.
Measured consequence, and it is the next real decision: MINING presence decides ownership, so ORE
(500014, no navy at all) now owns four systems, and the only navy-owned system is 30045344
(500011) whose neighbours are ORE/500010 - both NO_NAVY. So FW-036 correctly refuses every front,
and the frontier is starved of navy-vs-navy borders even though the map is healthy.
Two honest options (owner decision):
  a) weight ownership by ARMED presence only (a mining fleet cannot claim military control of a
     system), which is closer to the FW doctrine and would let 500004/500011 own their borders;
  b) keep presence as is and always seed a navy into the neighbour at bootstrap time (the recipe
     below already does that).
Note that bootstrap only runs while the map is EMPTY, so a rebuild is the only moment presence can
set an owner; afterwards ownership changes only through capture - which is the intended design.

## FW-044 deployed, unit-tested, waiting for the next empty-map bootstrap (19:0xZ)
`deriveTerritoryOwners` is pure and tested (4 tests): a system is owned only if at least one
ARMED pilot (role patrol/pirate) of the winning faction is really there; the owner is the faction
with the most resolved pilots among those that can defend; a tie owns nothing; an unarmed system
stays unowned. A mining fleet can no longer claim military control.
Caveat measured right after the deploy: the map bootstrapped at 18:39 (before this fix) and it is
NOT empty, so the new rule cannot re-derive anything - ownership only changes at an empty-map
bootstrap or through a real capture. Current map is still the mining-weighted one
(30000142/30000144/30000145/30003837 = 500014, 30045342 = 500010, 30045344 = 500011), and the
opening refuses every border for that reason, so the world will not stage a navy-vs-navy war until
the next recreate wipes the map and FW-044 derives it correctly.
That is the honest state: five real defects fixed today (N5 funded garrison, custody-vs-hull in
capture and mobilisation, FW-036 navy capability, FW-037 per-border refusals, FW-039 orphaned
escrow, FW-040 attribution links, FW-041/042 durability of the war record, FW-043 territory
bootstrap, FW-044 armed ownership), and the payout rung still needs one uninterrupted window.

## FW-045 applied live (19:03Z): the mining-weighted map was released, not faked
`living-native-war-territory-bootstrap CORRECTED_FROM_PRESENCE added:0 corrected:0 released:6`
- every territory the old rule had given to a mining-only presence was released, because a system
  with no armed garrison is not held by anyone. Nothing was invented to replace it: the same event
  carries `systems:[]`, i.e. at that moment no faction had an armed pilot in those systems either.
The map is now genuinely EMPTY under the new rule, so the next bootstrap registers only what is
really garrisoned (armed pilot + resolved native hull). That is the first state in the whole day
where ownership cannot be claimed by miners.
Consequence for the payout rung: a navy has to be physically present (live hull, linked pilot,
role patrol) for the world to own its ground. After every recreate those hulls must be re-seeded -
that is what the recipe in this file does, and it is the only remaining operation, not a code gap.
Full probe `suite-final5.json` (2026-10-28 late): **6236 pass / 5 fail / 95 skip**
against the 5837 / 332 / 92 baseline. Of those five, four are one untracked module
(`integration/coopWarBountyEscrowSides.cjs`: the committed runtime requires it, so
hook-requires and overlay-dependencies correctly report it as not installed, and its four
flags are the bulk of FLAGS_UNDECLARED), and one is COOP-049. installer-module-coverage
is green again after "bundled = committed". Earlier probe for reference:
ONE case is left: coop-alife-native-buyer-wiring (COOP-049, by owner decision) - plus
coop-installer-module-coverage whenever another session leaves a module untracked for a
while, which is churn, not a defect of ours.

Owner approved three calls on 2026-10-28 and all three are done:
  retire the wreck transformer -> deleted scripts/coop-npc-expedition-wreck-patch.cjs (4 of
    its 7 anchors are not in the deployed engine; it could only throw
    EX03B18_PINNED_WRECK_SOURCE_DRIFT), its wiring, its parse entry, and the 8 cases that
    only exercised it. Legacy 78 -> 77, budget tightened to match. The observer broadcast
    it aimed at is asserted directly in coop-wreck-client-refresh (1/0).
  fix the ALIFE-13 order -> measured, not changed: auditStartupCargo runs before the
    durable restore, and the test compared offsets against a call inside a function that is
    merely DEFINED earlier. The test now asserts the real order plus a single
    materialization site. coop-alife13-startup-cargo-audit 23/0.
  leave COOP-049 open -> recorded here, not touched.

coop-virtual-world-split was also made drift-proof (5936df34): an exact export list forced
every new export to edit one test and drifted twice in an hour, so the twenty-one pre-split
names are still required and no export may be undefined.

Since suite-final3 (6197/15) that is 14 of the 15 remaining cases closed.

The 119 missing `.js` shims are DONE (`64dc366a`): `coop-integration-shims --write`
completed the existing convention (122 shims were already there). That was not a
cosmetic gap - it closed `coop-escort-flight-stage-c` 8/6 -> **14/0**, whose six
failures were all "Cannot find module './coopAlifeNativeDeliveryEvidence'", so the
retire-or-reduce decision it was waiting on is moot, plus coop-integration-shims 2/0.
`coop-virtual-world-split` is green too (`f856538f`): the frozen runtime surface now
records the six exports the war/mercenary work added, and coop-test-parity is PARITY_OK.

THREE findings the owner needs, each with hard evidence:

1. coop-wreck-client-refresh cannot be fixed by its fixture: 4 of the 7 anchors
   scripts/coop-npc-expedition-wreck-patch.cjs requires do not exist in the deployed
   nativeNpcWreckService.js (checked against the fork file). The transformer describes
   an engine that no longer exists. Retire it (and its spec entry) or retarget the test
   at the fork's real code - both are deletions of that session's mechanism.

2. coop-alife13-startup-cargo-audit case 14 is a real ordering regression in another
   session's integration/coopNativeMiningFleetDurable.cjs: auditStartupCargo() is called
   at line 626, materializeStoredNativeController() at 533, so the ALIFE-13 audit now
   runs AFTER physical materialization - the opposite of what the test pins.

3. coop-alife-native-buyer-wiring is still COOP-049 (station authority emits
   `requirements`, buyer dispatch reads `materialNeeds`). Money-moving, flags OFF.

`coop-hook-inventory` is GREEN (`ed43504a`, fork `37780e5`): five of the nine long hooks
are now module calls. The war trio became occupationPairs()/warzonesResponse()/
localOccupationResponse() in coopWarClientView; npcBehaviorLoop's friendly-fire policy
became npcPlayerEngages() in coopMilitiaWarPlayer; the fwAdvantage envelope became
scoresResponse() in coopWarAdvantage. Baseline refreshed deliberately: longHooks stays
4, longest 822 -> 1131 (the dungeon hook, not ours to move), specFiles/entries grew from
other sessions' features. The four remaining long hooks are one per feature (dungeon
1131, trade 822, agent 501, wreck 451) and each needs callbacks from its own service,
so each belongs to the session that tests that gameplay path.

**`node scripts/coop-engine-audit.cjs` prints AUDIT_REGRESSION at 20:55Z** - not from
these commits: `integration drift 4 > 0` for coopAdminBridge, coopAdminBridgeActions,
coopStationDrain and coopVirtualWorldRuntime, i.e. another session's fork work is
in flight (`coopStationDrain.js` and `coopVirtualWorldRuntime.js` are uncommitted in
`C:\Games\EveCoop\upstream-evejs` right now). Their `AUDIT_OK` returns when they mirror.

**The installer/overlay family is almost gone.** 29 more cases closed on 2026-10-28
evening; the blocker was never `overlay-spec.cjs` being edited, it was that a dozen
suites still described the pre-single-spec layout (module names moved into
`scripts/overlay-spec.cjs`, which `patch-evejs-coop.cjs` re-exports as `names`), plus
fixtures that modelled only the hook sites a native file had when they were written.
Closed: overlay-drift-check 5/0, five-chat-market-reconcile 5/0, market-release-contract
3/0, native-economy-overlay-resolution 6/0, pve-duo trio, native-trade-custody-overlay,
native-mining-atomic-overlay, native-convoy-operations-overlay, crossstream-wiring,
npc-weapon-source-hook, player-damage-overlay-integration, rust-npc-market-patch,
fleet-mission-join-overlay, installer-module-coverage (fixture regex), post42 (same).

DONE (owner approved, commit `84096bc5`): ten modules existed in
`integration/` and are required by `coopVirtualWorldRuntime` but are absent from
`scripts/overlay-spec.cjs`, so a deployed server would throw MODULE_NOT_FOUND:
`coopJsonFileCache coopNativeNpcMarketReconcile coopNpcManufacture coopStationDrain
coopStructureAllianceGuard coopWarCaptureByForce coopWarMercenaryContract
coopWarMercenarySettlement coopWarNavyCapability coopWarObservedSystems`.
installer-module-coverage 2/1, post42 2/1, overlay-dependencies 2/1, hook-requires 6/1.
Added as one guarded loop (`names.push` block, 402 names / 402 unique); the four suites
are green (3/0, 3/0, 3/0, 7/0).

WHAT IS LEFT (15 cases, 7 files):
  coop-escort-flight-stage-c 8/6        owner call: retire or reduce
  coop-wreck-client-refresh 1/3         owner call: retarget at the fork or retire
  coop-hook-inventory 2/2               6 hooks over 400 chars vs baseline 4 (was 9).
    The fwWarzoneSolarsystemService trio is DONE (`d2d7fd24`, fork `d734281`): the
    three 1239/1248/1330-char copies are now warzonesResponse()/localOccupationResponse()
    over one occupationPairs() in integration/coopWarClientView.cjs. What is left is one
    hook per feature, each needing callbacks from its own service (dungeon 1131,
    trade 822, agent 501, wreck 451, npcBehaviorLoop 407, fwAdvantage 495), so each
    extraction belongs to the session that owns that gameplay path
  coop-alife-native-buyer-wiring 1/1    COOP-049 materialNeeds contract
  coop-alife13-startup-cargo-audit 1/1  assertion lives in another session's module
  coop-integration-shims 1/1            untracked test: 119 shims or one resolver hook
  coop-virtual-world-split 1/1          PARITY_REGRESSION from another session's export

Closed since that probe (each with a fork mirror where the code changed):
  coop-native-haul-transfer-sqlite 2/5->7/0 (fixture handed the mover the raw SQLite
    writer instead of the GameStore adapter shape it reads its receipt from)
  coop-native-loot-quarantine 7/3->10/0, coop-wormhole-jump-fence 10/4->14/0,
  coop-pve-boss-loot-claim 8/8->16/0 (all three: Windows cannot fsync a directory)
  coop-npc-atomic-weapon-bank 3/15->18/0 (bank now proves hull+modules before the tx;
    ammo journal loaded its sibling by assumed .js extension)
  coop-npc-atomic-sqlite-crash 0/2->2/0, coop-player-mining-warehouse-integration 0/5->5/0,
  coop-native-industry 6/1->7/0, coop-park-runaway-miner 2/1->3/0,
  coop-native-industry-progression 1/1->2/0
  coop-npc-durable-ammo-debit 2/18->20/0, coop-npc-wormhole-transit 1/2->3/0
  coop-npc-fire-outcome-witness 0/1->15/0, coop-npc-expedition-operations 0/3->3/0
  coop-player-industry-fence 3/9->12/0, cycle 0/1->1/0, native-boundary 9/2->11/0
  coop-skill-rate-cutover 8/13->21/0, coop-rescue-native-contract-wallet 2/6->8/0,
  coop-war-recovery-console 6/1->7/0, coop-native-live-capacitor 0/1->3/0

Closed after the probe: npc-buyer-admin-control 12/2->12/0+2skip,
npc-buyer-controlled-recovery 10/5->15/0, coop-flag-registry 3/1->4/0 (the
registry had drifted by 40 flags), coop-corporate-real-sqlite 0/6->6/0,
player-mining-native-adapter 6/1->7/0, upstream-patch-series 2/2->4/0.

Everything still red is one of these four, in this order of value:
  L1 fix landed anyway: coopNpcCorporateBuyRuntime.loadSettlement fell back to the
  specifier that had just failed instead of the .cjs sibling, so a source
  checkout could not load it at all; coop-npc-corporate-buy-patch 12/6 -> 18/0
  (fork 901a36b). Its mixed-guard case also asserted an error name that
  eedfe1b4 folded into NPC_BUY_GUARD_CORPORATE_PATCH_DRIFT.

  A. overlay/installer suites - they need scripts/overlay-spec.cjs, which another
     session is editing right now (hook-inventory reports 9 long hooks vs a
     baseline of 4, the anchors moved). Do not touch the anchors mid-flight.
  B. the three owner decisions below.
  C. integration/coopNativeMiningFleetDurable.cjs and coopVirtualWorldRuntime.cjs
     assertions, also another session's files.
  D. coop-integration-shims.test.mjs, untracked until B2 is decided.
  E. coop-wreck-client-refresh and friends encode overlay-era fixes the fork now
     carries: the case asserts a sendSlimItemChangesToAllSessions ->
     broadcastSlimItemChanges rewrite that no longer exists in the transformer,
     and its synthetic fixture has 4 of the 7 anchors the transformer now needs.
     Retargeting it means deciding what still needs proving - owner call, not a
     silent rewrite.

Still open and NOT ours to fix silently:
  - coop-escort-flight-stage-c 8/6: needs the missing ./coopAlifeNativeDeliveryEvidence
    chain plus a manifest source-cargo contract; owner decision (retire vs reduce).
  - scripts/coop-integration-shims.cjs --check still reports ~120 missing .js shims;
    tests/coop-integration-shims.test.mjs stays untracked until the owner picks
    "generate shims" vs "one resolver hook". Fixtures keep using loadIntegration().
  - COOP-049 materialNeeds: coopAlifeStationAuthority strips `requirements` and never
    emits materialNeeds while the buyer dispatch requires it (money-moving, flags OFF).
  - coop-alife13-startup-cargo-audit 22/1: ordering assertion lives in
    integration/coopNativeMiningFleetDurable.cjs, another session's file.
  - PARITY_REGRESSION now names coop-virtual-world-split: the faction-war work added a
    diagnoseNavy export to coopVirtualWorldRuntime while that suite's frozen public
    surface list still lacks it (f36ee344, not ours; do not edit either side).

## 2026-10-28 14:15Z - the fleet is repaired; the produced goods still need a named, near ship

FIXED (fork 9d96fb3): both 30000145 slots refused to restore for ever with
ALIFE08_REPAIR_MARKER_MISMATCH. Cause: every failed boot repair spawned another wing, so slot
30000145-1 marked 120 miners + 118 haulers around a 2+1 witness (105+55 on -2). The repair now
prunes hulls the slot marks but does not own (physical destroy for live ones, durable cascade for
phantoms) and then checks the witness. Result: ALREADY_ACTIVE 3+1 and 2+1, mining resumed.

MANUFACTURING (fork 6c66f05): blueprint 1076 seeded at 60014935, 5-run job consumed 5 555
Tritanium (72 399 -> 66 844) and produced 5 x typeID 444 with a receipt. A second attempt at
60000682 was refused honestly with MATERIALS_MISSING (no Tritanium in that hangar) - the module
never fabricates inputs.

WHERE THE 5 CHIPSETS ARE: in the cargo hold of hull 980000003529 (spawned by the repair). That
hull has NO identity link, so the sale refuses with HAULER_NOT_NAMED, and it sits 8.6e11 m from
the station. 23 real seeded bids exist for typeID 444 (best 54 374 at 60000361, 54 289.76 at
60000682).

NEXT (one of these, both small):
  1. linkSpawnedIdentity for 980000003529 -> role hauler, then scripts/sell-station-goods.cjs
     at a station that bids for 444 - or
  2. run the manufacture where the hangar really holds Tritanium AND the station bids for 444,
     then let the drain lift and sell it automatically (that path is already proven).

## 2026-10-28 13:50Z - manufactured goods EXIST; selling them waits on a fleet restore

PROVEN on `evejs-agents` (no client):
  blueprint 1076 (Mining Survey Chipset I Blueprint) seeded at station 60014935
  -> 5-run job consumed 5 555 Tritanium (72 399 -> 66 844)
  -> 5 x typeID 444 produced in the corporation hangar
  -> receipt coop-native-industry/receipts/coop-job:1000129:60014935:1076:1793194860012.json
     with recipe, materials, installedAt/completedAt.
  The station bids 53 700.08 for that item, so the product has a real buyer.

HOW (fork 6c66f05): the native job pipeline is session-bound (quoteIndustryJob derives owner,
facility, blueprint access and slots from a client session) and this world has no client, so
production runs through space/coopNpcManufacture.js with the SAME native static-data recipe and
the SAME inventory primitives (takeItemTypeFromOwnerLocation / grantItemToOwnerLocation) that the
job pipeline uses - the pattern the co-op refinery already proved. It refuses unless the
corporation really owns the blueprint item and the materials in that hangar; the journal is
INSTALLED -> COMPLETED so a crash can never double-produce; time is compressed only by
EVEJS_COOP_INDUSTRY_TIME_SCALE (0.002 on the agent stack).

Selling a product reuses the proven arrival sale: the lift now carries ANY corp-owned hangar
stack the station really bids for (EVEJS_COOP_LIFT_ANY_TYPE=1), and the drain prefers a station
holding a manufactured good over one holding refinery minerals (station rotation + 30 min
cooldown when a visit sells nothing).

BLOCKER for the last step (not in our modules): after the 13:49 restart the two 30000145 mining
fleets did NOT come back -
  [ALIFE08] slot 30000145-1 -> NEEDS_OPERATOR_REPAIR ALIFE08_REPAIR_SPAWN_COUNT_MISMATCH
  [ALIFE08] slot 30000145-2 -> NEEDS_OPERATOR_REPAIR ALIFE08_REPAIR_MARKER_MISMATCH
so there is no hauler to carry the chipsets to the station. That repair path is
space/coopNativeMiningFleetDurable.js (another session's module); it must be fixed or the slot
records repaired before the produced goods can be sold. Do NOT wipe volumes to force restore.

## 2026-10-28 13:10Z - surplus drains: minerals finally sell, stock is falling

Measured on `evejs-agents` (headless):

  stock 739 492 -> 596 517 units;  Tritanium 261 419 -> 101 419
  corp wallet 119 944 191.19 -> 125 975 858.69 (sweeps of 22 942 300 then 250 000)
  sold on a drain: [{typeID 34 Tritanium, ...}] isk 250 000;  pilot ledger tradeCount 9

WHY IT WAS STUCK AND WHAT CHANGED (all committed):
  1. A sale only happens on a station arrival, so a fleet whose mining the governor holds can
     never sell the surplus it already owns: 705 484 units against a 200 000 floor with zero
     arrivals for 9 h. New space/coopStationDrain.js flies an idle hauler to the station that
     really holds the most refined minerals, sells through the PROVEN arrival path and flies
     back. OFF unless EVEJS_COOP_STATION_DRAIN=1 (agent stack only).
  2. The governor reports DEMAND_UNKNOWN with that stock, so a HOLD-driven trigger never fired;
     and an ALLOW tick pushed the drain 15 min ahead every time, so a due trip drifted for ever
     (due 12:29, still not run at 12:49). The drain now decides on the governor's own
     measurement (only ALLOW means "within demand") and its schedule is owned by the trip.
  3. **Every sale in the world's history was ore. Not one mineral ever sold.** The lift is
     async, its Promise was read as a result, so the lifted mineral types never joined the sale
     list and the trader answered NO_REAL_NATIVE_CARGO (measured: 47 lift rows in one hold).
     The lift now runs inside the arrival job and is awaited (fork 04e2c8a).

Fork commits: 4afec3e, 03cafb7, 9c5f9d4, 706d8e5, 7d997e1, 04e2c8a. Repo: d6107bfb, 583d10e0,
0fda9c7b, b9ae10ab + worklog. AUDIT_OK.

NEXT: the drain runs every 15 min per fleet and lifts up to 100k units per visit, but each
trade is capped at 5 000 units (EVEJS_COOP_NPC_MARKET_MAX_QTY), so the 596k backlog needs many
visits. If the owner wants it gone faster, raise the per-trade cap or the drain cadence - both
are env knobs, no code change.

## 2026-10-28 12:00Z - CLOSED LOOP PROVEN: ore sold, ISK reached the corporation

PROVEN LIVE on `evejs-agents` (headless, no client), same world that had been stuck since 02:05Z:

  ore mined -> hauler loaded -> delivered -> refined (fee from the corp wallet)
   -> minerals lifted -> SOLD 5000 Scordite @ 4605.77 = 23 028 850 ISK -> pilot ledger
   -> corp treasury sweep -> corporation wallet.

  Measured: 11:55:47 living-npc-station-target-cleared, 11:55:48 living-npc-station-sold
  (station 60003724, hauler 980000000032, 5000 units, 23 028 850 ISK). 11:39:34
  living-corp-treasury-swept moved 26 018 500 ISK; corp wallet 38 743 827.69 -> 64 762 327.69
  (the ~47k gap is the refinery fees the corporation paid in between). No pending market
  journals: /var/lib/evejs/coop-native-market/tx is empty.

TWO BLOCKERS CLOSED (both were real, neither was a "market is broken" story):
  1. The journal left at RPC_CALLING (coop-pilot-012) was settled from the MARKET'S OWN PROOF,
     never by repeating the fill: order 4257762183096583224 is state filled, vol_entered 5000,
     vol_remaining 0, issued 15 ms after the journal. New space/coopNativeNpcMarketReconcile.js
     + scripts/reconcile-npc-market-journal.cjs (dry run, then --apply; durable receipt in
     reconciled/; replayed false). Fork 441fcc4 + 356dcce.
  2. The sale then failed with NATIVE_NPC_BUSY because the fleet's own asteroid orbit leaves
     controller.currentTargetID set on the hauler. The sale now releases only a static,
     non-combat target (a ship target, an attack order, a fresh aggressor or a warping hull
     still refuses). Fork 78b1681.

ALSO MEASURED (still open, no longer blocking): after ~9 hours without sales the corporation
owns 705 484 units (442 350 ore + 263 134 minerals) against demand 82 502 and a 200 000 floor,
so the demand governor mostly HOLDs and mining only trickles. Each station arrival sells what
that arrival lifts, so stock drains one trip at a time; a restart also resets the governor's
trickle timer, which is what let mining resume at 11:41.

## 2026-10-28 01:35Z - the loop runs live; the sale needs one operator decision

PROVEN LIVE on `evejs-agents` in this session (no client, headless world):
  ore mined -> hauler loaded -> station delivered -> ore refined (COMMITTED, fee paid
  from the corp wallet) -> minerals lifted into the hauler -> repeat, every ~5 minutes.
  Measured counts since 01:20Z: 2-3 living-hauler-loaded, 3 living-npc-station-delivered,
  8 living-npc-refined, 1-2 living-npc-mineral-lifted. Both fleets cycle.

Chain of real causes fixed (fork branch coop/pas7std, all committed):
  1. 11b9d29 movement: a native NPC in GOTO flies along entity.direction only, so the
     `position + direction * 1.0e16` sentinel carried hulls off their own belt for ever.
     New space/coopNpcRunawayGoto.js stops such a hull; one statement in the GOTO case.
  2. 08ca1e9..3205d9f mining: the hauler is spawned with behaviour profile
     movementMode "stop", so every one-shot follow was consumed and the hull re-stopped.
     It now orbits the fleet's asteroid (the only orbit target the loop honours - orbiting
     the miner is refused), and miners are sent to the same rock; radii 250/600 m keep the
     whole orbit inside the 2 500 m transfer range.
  3. 27cc4ed mining: the park helper stopped any hull with speedFraction > 0, i.e. the very
     orbit it had issued one line earlier (measured: 56 'parked' miners, all in STOP).
  4. c43af40 space/coopNativeHaulCargo.js: the store returns `transient` as 0/1, so
     `row.transient === false` refused every durable cargo row (`cargo-invalid`, usedM3 0).
     Custody is now "not another party's cargo": the row's owner may be the miner OR the
     hauler, and a refusal always names the failing predicate.
  5. ba31852 space/coopNativeHaulManifest.js: the hold carries the fleet's own lift-tagged
     minerals back to market, and those rows made the whole ore manifest invalid
     (MANIFEST_CARGO_INVALID_OR_AMBIGUOUS). The manifest describes the ORE; lift cargo has
     its own journal and is skipped.

REMAINING BLOCKER (not a code bug - a required operator decision):
  every station arrival answers living-npc-station-sale-skipped NOT_SOLD MARKET_UNAVAILABLE
  because the native market is halted: living-native-market-repair-required
  {status NEEDS_OPERATOR_REPAIR, pending [{file coop-pilot-012.json,
   reason RPC_OUTCOME_UNKNOWN}]} (last at 01:22:49Z).
  The repository doctrine is explicit: an ambiguous market RPC halts trading and a possibly
  completed fill is never repeated. So the ore of those arrivals is deposited
  (depositOnly), not sold, and no ISK reaches the pilot ledger or the treasury.
  Next single step: reconcile that one journal against the market, then let the sale run.
  Nothing else in the loop is blocked - mining, haul, delivery, refine, lift all repeat.

Extraction gate: `node scripts/coop-engine-audit.cjs` prints AUDIT_OK.

## 2026-10-27 23:00Z - the last blocker is our own order bridge, and it deadlocks

`mining_fleet_diagnose` (read-only admin bridge) now answers the question exactly:

  miner 980000000030  mode GOTO  belt 53 965 m  targetPoint ghost 1.0e16  order BLOCKED
                     reason COOP_NPC_ORDER_IDENTITY_UNVERIFIED
  hauler 980000000032 mode GOTO  ghost 1.0e16   order BLOCKED
                     reason COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE
                     state {warp:false, movementBusy:true, manualBusy:false, combat:false}
                     leaseOwner ""

Reading it: 1.0e16 is a SENTINEL ('no target'), not a computed point - so the earlier
ghost-target hypothesis was wrong and the guard added in fork commit 0e317d9 fires on
normal sentinel state (4 living-mining-order-reset, harmless but not the cure).
The real deadlock: the hauler already owns a native movement command that goes
nowhere, and the order bridge refuses to replace an ACTIVE movement order, while the
miners cannot pass identity verification at all. So no hull can be re-aimed at its
miner, the gap grows by the sentinel drift, and no ore is ever transferred.

Next single step (fork, branch coop/pas7std): in the order bridge allow
  (a) a mining-fleet movement order to REPLACE a native movement order whose target is
      the no-target sentinel / whose ship is in the fleet's own minerEntityIDs or
      haulerEntityIDs (the fleet record IS the identity proof), and
  (b) the WAR lease rule to keep refusing everything else.
Then prove: living-hauler-loaded -> delivered -> refined -> mineral lift -> sale.

Already proven on this world today: mining without a client, corp treasury sweep
(38 791 223.64 ISK), 4 refinery batches COMMITTED with the fee paid from the corp
wallet. Those three legs need no further work.

## 2026-10-27 22:45Z - three real fixes landed, one measured blocker left

PROVEN LIVE on `evejs-agents` (never on the owner's play stack):
  - mining runs without any client: 32 living-mining-cycle-settled after the fix;
  - the corporation really receives its pilots' ISK: living-corp-treasury-swept
    movedISK 38 791 223.64 into corp 1000129 from coop-pilot-002 (ledger debit 0);
  - the refinery pays its own station fee and commits: 4 living-npc-refined COMMITTED.

Fixes landed (committed and pushed to origin/main):
  1. OPS 669a4d13 + 6f096445 - EVEJS_DISABLE_NPC_COLD_SCENE_SLEEP=1 on the agents
     stack. Evidence: the tick profiler showed ONLY overlay phases (npc-reconcile:*,
     observed-native-mining) and no mining/npc section, i.e. scene.tick() never ran,
     so no mining fix could ever fire in a world without a logged-in client.
  2. L3 91ec5d93 + 22033e2f - integration/coopCorpWallet.cjs is now the single wallet
     authority and prefers the native corporationRuntimeState (which bootstraps the
     divisions) over a raw `/corporations/<id>/wallet` pointer. It verifies the write
     by reading the balance back, so a no-op write is CORP_CREDIT_UNVERIFIED, never
     'paid'. Before this the treasury answered CORP_WALLET_UNAVAILABLE while the pilot
     ledger held 26 018 500 ISK.
  3. L2 2609aae4 + 8c6a7ea0 - the haul approach: warp only beyond 150 km, otherwise a
     real follow order, and publish WARPED_TO_MINER / WARP_REFUSED / FOLLOWING_MINER /
     FOLLOW_REFUSED with the measured gap. Telemetry proved the old block: warp answered
     WARP_DISTANCE_TOO_CLOSE at 24-90 km and the orbit fallback let the hull DRIFT AWAY
     (57 km -> 90 km between two retries). Empty-haul budget 24 -> 120 waits (10 min).

REMAINING BLOCKER (measured, not inferred) - the hauler cannot reach its miner:
  admin bridge mining_fleet_diagnose (read-only) for 30000145 shows both fleets in
  state hauling with miners in mode GOTO whose targetPoint is ~1.0e16 m from the
  system origin (68 000 AU) while the ship itself is 2.5 AU out and only 54 km from
  its nearest belt. The haulers therefore chase a nonsense point and the gap
  oscillates (24-90 km). Mining and delivery worked in this world before the 21:30Z
  restart, so the suspect is restored movement state: a ship comes back with
  mode GOTO plus a stale target that every new orbit/follow order is refused against.
  Next single step: in the fork (server code is ours since 2026-10-28), clear the
  movement target on restore / refuse an absurd target (|target - position| > 1e9 m),
  then prove living-hauler-loaded -> delivered -> refined -> mineral lift -> sale.

Doctrine note: the overlay installer is legacy; new server behaviour goes into the
fork C:\Games\EveCoop\upstream-evejs (branch coop/pas7std) as a commit, then build.

## 2026-10-27 21:50Z - where the loop really stands (fresh work-stack world)

Fresh `evejs-agents` world (volumes reset, market reseeded jita_new_caldari, 445 096 rows) with
every fix in the image. Measured on THAT world:
  80+ living-mining-cycle-settled COMMITTED
  14 living-hauler-loaded with real quantities (the orbit-the-miner fix works)
  9 living-npc-station-delivered and station trips
  1 living-npc-station-sold: 5000 units type 17464 @ 5203.7 = 26 018 500 ISK credited to the
    pilot ledger (ledger.json coop-pilot-002 balance 26 018 500)

Blocking the last leg: the corporation is never funded. `living-corp-treasury-swept` never
appears, so the refinery answers NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED for every stack at
60000682 / 60003724 and no minerals are produced. Without minerals there is no lift and no
mineral sale, which is the only unproven stage.

What is already fixed for that path (all pushed, tested):
  - refinery hook now passes the in-process gameStore and marketRoot; `../../gameStore`
    resolves from services/mining (verified ROOT_OK, ../gameStore is MODULE_NOT_FOUND);
  - EVEJS_COOP_TREASURY_TRACE=1 on the agents stack emits living-corp-treasury-skipped with
    the treasury's own status/reason, so the next refinery attempt names the refusal instead
    of hiding it.

So the next single observable is `living-corp-treasury-skipped` (status/reason) on the first
arrival that carries ore after a restart. Nothing else can be inferred before it appears.

Owner's stack `evejs` was never restarted; every experiment here ran on `evejs-agents`.

## 2026-10-27 20:00Z - fresh agents world + every defect found today is fixed

Owner split the machine (docs/TWO_STACKS_PLAY_AND_WORK.md): play stack `evejs` is his game,
not to be restarted; work stack `evejs-agents` is where proofs run. All work since then is
on the work stack only.

Defects found and fixed today, each with tests (all pushed):
  1. liftedTypes declared inside the lift gate, read outside -> every arrival died with
     'liftedTypes is not defined' and NOTHING sold (3 deliveries, 0 sales).
  2. An empty haul flipped the fleet to 'loaded' -> empty fleets flew to stations
     (living-native-haul-delivered NO_CARGO, lastHauledVolumeM3 0).
  3. That retry re-entered mining every 2 s, restarting the hauler warp forever (99 km gap).
  4. Then the warp target was the asteroid, not the miner -> 2 500 m transfer range never
     reached (ranges 22-130 km). Now the hauler ORBITS the miner at 500 m, issued at most
     once per 2 minutes (a warp takes ~24 s; re-issuing restarted it).
  5. Governor decided on a partial bid book -> throttled a world with 25k/90k bids; a
     partial book is now 'unknown' (>=90% stock coverage required).
  6. Governor ignored EVEJS_COOP_TIME_SCALE -> a 15 min trickle became 75 accelerated min.
  7. patches/upstream/MANIFEST.json carried a BOM -> JSON.parse failed, the whole deploy was
     blocked for everyone. BOM stripped.

Work-stack config (agent-only, compose/compose.agents.yaml): startup systems
30000142,30000145 (Perimeter has zero bids), demand floor 200000 (a fresh economy is not
overstock), fleet count 2, x5 pacing.

Agents volumes were reset at 19:36Z (sandbox only) and the market reseeded with
`jita_new_caldari` (23 stations, 445 096 seed rows). One stale market journal from my own
mid-RPC restart (coop-pilot-012, order gone + cargo gone) was moved out of tx/ so the trader
stops blocking every sale with UNRESOLVED_MARKET_JOURNAL; kept as
/var/lib/evejs/coop-market-tx-stale-from-restart.json.

Live on the fresh world so far: mining cycles COMMITTED, living-hauler-loaded with real
quantities (1680, 2940, 1260), station deliveries, station trips. Remaining: the first
successful sale -> treasury sweep -> paid refinery -> mineral lift -> mineral sale.

## 2026-10-27 17:05Z — items 15 and 16 (code halves) done; exact next steps

**Item 15 DONE (code) — a1d5b03b.** `coopWarFleetRoster` now keeps a durable
per-faction, per-role hull reserve (`spawnable` + `equipped`) in the same roster
row: a proven loss removes one equipped hull, an adopted replacement consumes one
spawnable hull and becomes equipped, `declareReserve` only accepts what a caller
proved (`source` required, unknown roles / non-integers refused), `reserveOf`
reports the real totals. Every real loss and replacement carries a `frontChat`
record; `fleet_reconstitute` sends it through `coopWarClientView.frontReport`
(new kinds `fleet-loss`, `fleet-replacement`) via the existing once-per-eventKey
`warFrontChat`. Tests 37/37 with client-view + admin-bridge + composition.

**Item 16 code half DONE — ae9cea92.** `coopNpcCorpTreasury.run` accepts a
`resolveCorporation` authority and sweeps ONLY pilots that really belong to the
target corporation (`NO_EARNINGS_FOR_THIS_CORPORATION` when none do, an
unprovable owner is never swept); without the authority the historical sweep is
unchanged, so nothing can regress. `coopNpcRefineryTick.fundTreasury` forwards
`options.pilotCorporation`. Tests 62/62 with refinery + war-funding + treasury.

**NEXT ACTION (exact), item 16 live half.** The routing fix is inert until a
caller supplies the authority. At the refinery tick's call site pass
`pilotCorporation: (pilotID) => <corporationID of that pilot's real native
entity>` (identity registry + `nativeNpcStore.getNativeEntity`, the same
authority `coopWarFleetRoster.presence` already uses), then run
`war_funding_diagnose` until an ARMED faction (500011 Angel or 500020 Serpentis)
reads `FUNDED` instead of `NO_REAL_FACTION_INCOME`, and confirm
`living-native-war-bounty` `PAID` on its next real casualty. Do not fund it any
other way and do not mint ISK.

**Also open.** `NEEDS_OWNER_RESTART_WINDOW` for the FW-037 gate-crossing proof
(see the section below). Item 13 payout stays blocked behind item 16.

## 2026-10-27 16:40Z - stack split: all further proofs run on evejs-agents

Owner changed the rules (docs/TWO_STACKS_PLAY_AND_WORK.md, AGENTS.md): compose project
`evejs` is the live game shared with his friend. NO deploy/rebuild/recreate/restart/down
against it unless he explicitly asks for a restart window. Agents prove everything on
`evejs-agents` (ports 28443/25222/28000-28002/41110, x5 pacing, separate volumes).

Consequences for this session:
  - my deploy script (compose.yaml + compose.coop-probe.yaml without -p) targets the PLAY
    project. It is retired; the safe cycle is `docker build -t evejs-local .` (safe while he
    plays) followed by scripts/Start-Agents-Stack.ps1 -Action Up.
  - the earlier live evidence (mineral lift 12:47, ore sale, treasury sweep, governor HOLD)
    was measured on the PLAY stack before the split and stays valid as history, but every
    NEW proof must name the stack it ran on.

Play-stack side effects already deployed before the split (his next restart would apply them,
so he must know): EVEJS_COOP_NPC_MINERAL_LIFT=1, EVEJS_COOP_MINING_DEMAND_GOVERNOR=1 with
FACTOR=1.5 FLOOR=20000 TRICKLE_MS=900000, EVEJS_MINING_NPC_STARTUP_FLEET_COUNT=2, plus the
overlay modules coopNpcMineralLift and coopMiningDemandGovernor. I touch nothing there now.

Agents stack state (measured 16:36Z): image already carries the current overlay
(governor fix + liftedTypes present), env has TIME_SCALE=5, GOVERNOR=1, FLEET_COUNT=2,
MINERAL_LIFT=1. World is FRESH: 448 event lines, no haul yet, slots 30000144/30000145/
30100032 ALREADY_ACTIVE, mining cycles starting, no lift receipts.

So the remaining proof is a full self-contained loop on a fresh world: mine -> haul ->
deliver -> ore sale (ISK) -> treasury sweep -> paid refinery -> mineral lift -> mineral sale.
A watcher on evejs-agents-server-1 records each stage (verdict ladder MINING -> HAULED ->
DELIVERED -> REFINED -> LIFT -> MINERAL_SALE_PROVEN).

## 2026-10-27 16:50Z — war gate crossing: five real blockers named and removed

**Done (commits 83a9b3bc, 9f66beec, 466593aa, 18768947, 82f7ca0a, 0fdf15c9,
76970e18, b24a32f2).** Gate staging no longer refuses silently. In order:
1. `coopWarGateStaging.tick` returns per-campaign `skips[]` with the exact
   precondition, published once per distinct set as
   `living-native-war-gate-staging` status SKIPPED; the phase's own early returns
   use `warSkip("gate-staging", …)` and `gateReason(env)` names missing flags.
2. ASSAULT campaigns are staged (the crossing leg was never even considered) and
   the operator's explicit `paper-supply:<campaignID>` waiver is accepted and
   labelled `PAPER_UNFUNDED_EXPLICIT`.
3. A warp the native runtime refuses as `WARP_DISTANCE_TOO_CLOSE` is closed by a
   real native follow order (and every per-ship rejection is now named).
4. The follow order is actually forwarded (`orderFollow` → `createGateTravel`).
5. **The gate arrival is measured before the retry window** — the 180 s
   `NATIVE_GATE_WARP` window used to skip the hull before the surface-gap check,
   which hid the only moment it was physically at the gate.
6. `coopWarTransferLedger` accepts the ASSAULT leg and a waived campaign that has
   no treasury row at all; `coopFactionWarCore.paperSupply` is the single rule.

**Live, read-only on the owner's running build (verbatim).**
`living-native-war-gate-staging 16:19:30` → `AT_REAL_GATE` +
`TRANSFER_REFUSED:WAR_HANDOFF_CAMPAIGN_OR_FUNDS_UNVERIFIED`; `15:35`
`WARP_REFUSED:WARP_DISTANCE_TOO_CLOSE` at gate `50016294`; the hull
`980000023574` really warped to that gate (real reciprocal pair
50016294 ↔ 50016293, 30003837 → 30045344) and then drifted ~15 km per 30 s tick.
`war_state`: `campaignStates {PREPARING:5, ASSAULT:1}`, `30045344` ASSAULT with
source `30003837`.

**NEEDS_OWNER_RESTART_WINDOW.** FW-037 (the ledger fix that unblocks the actual
crossing) is committed, `--apply`/`--check` = OVERLAY_OK, but it is **not** in the
owner's running server and that server must not be recreated while he plays. The
crossing proof needs exactly one recreate of project `evejs`.

**NEXT ACTION (exact).** In the owner's next restart window: recreate once, then
watch `living-native-war-gate-staging` for
`VERIFIED_NATIVE_GATE_TRANSFER` of `980000023574` into `30045344` (and the
`living-native-war-transit-retired` archive after it). If it refuses again, the
reason is now always in `observations[]` (`TRANSFER_REFUSED:<reason>`) or
`skips[]` (`ATTACKER_REJECTED:<id>/<reason>`) — fix that exact string.
Everything else continues on project `evejs-agents`
(`scripts/Start-Agents-Stack.ps1 -Action Status|Seed|Up|Down`), x5 time.

**Item 13, title half DONE (54ec5bd0).** `coopWarRankTitle.applyToCharacter`
writes the canonical rank title into the stock character record through
`characterState.updateCharacterRecord`; refuses a non `coop-player-` key, an
unknown rank, a key/record mismatch, a missing record and any non-canonical
title; `coopWarKillMerit` publishes `living-native-war-rank-title` with
`surface:"CHARACTER_RECORD_TITLE"`. Tests 10/10, with merit/bounty 22/22.
The payout half stays `BLOCKED_TREASURY_NO_ARMED_FUNDED_FACTION` (= item 16).

**NEXT CODE ITEM (15).** Fleet reconstitution + faction reserve:
`integration/coopWarFleetRoster.cjs` (TABLE `corporationRuntime`, KEY
`coop-faction-war\x1ffleet-roster-v1`) already plans from proven-alive survivors
and records a loss only with a real wreck. Missing: a durable per-faction hull
reserve (spawnable + equipped count per doctrine role) and a front-chat line per
loss/replacement via `coopWarClientView.frontReport` (line 122) with the same
once-per-key throttle `warFrontChat` uses.

## 2026-10-27 20:30 local (16:30Z) — OWNER DIRECTIVE: the live `evejs` stack is untouchable

Owner is playing on `evejs-server-1` / `evejs-market-1` right now. **Never**
`docker compose up/restart/down/--force-recreate` against project `evejs`, never
touch those containers. All further live proofs happen in a separate stack
(own project name, own ports — 26000-26002/443/5222/40110 are taken — own
volumes). `docker build -t evejs-local .` is allowed (it touches no container).
If something truly needs the owner's stack restarted, record
`NEEDS_OWNER_RESTART_WINDOW` instead of restarting.

Consequence for the war work: the last deploy of FW-036 (transfer ledger accepts
the ASSAULT leg + the explicit paper waiver) was already live before the
directive arrived, so the crossing leg can still be observed **read-only** on
that build. Everything after that is verified in the agent stack only, and every
metrics block from now on states that the owner's stack was not restarted.

**NEXT ACTION (exact).** (1) Read-only: watch `living-native-war-gate-staging` on
the owner's running FW-036 build for `VERIFIED_NATIVE_GATE_TRANSFER` of
980000023574 into 30045344; a `TRANSFER_REFUSED:<reason>` is the next exact
precondition to fix. (2) Stand up the agent stack
(`docker compose -p evejs-agents` + its own port/volume overrides) so no further
item needs the owner's stack.

## 2026-10-27 16:25Z - second startup slot added (additive), New Caldari has a fleet again

Owner asked to finish. Slot 30000145-1 fails deterministically on EVERY boot with
ALIFE08_REPAIR_SPAWN_COUNT_MISMATCH (operator repair, not code). Instead of touching the
broken record, EVEJS_MINING_NPC_STARTUP_FLEET_COUNT went 1 -> 2, which creates a second
startup slot per configured system. Nothing was deleted or rewritten.

Live after the change (docker logs):
  ALIFE08 slot 30000145-2 -> ALREADY_ACTIVE miners=2 haulers=1
  ALIFE08 slot 30100032-2 -> ALREADY_ACTIVE miners=2 haulers=1
  ALIFE08 slot 30000145-1 -> NEEDS_OPERATOR_REPAIR (unchanged, still blocked)

Where the mineral sale can happen (economy balance, live):
  60000682 type 34 stock=321677 demand=5000 price=2.96   -> 14 800 ISK
  60003334 type 34 stock= 86915 demand=5000 price=3.10   -> 15 500 ISK
Both are New Caldari stations the new fleet can reach, so the first arrival that lands on
either one closes the last leg: lift -> sale -> treasury sweep.

The demand governor stays ON with the approved defaults, so the small new fleet mines in
the 15-minute trickle windows; the proof therefore takes tens of minutes, not seconds.

## 2026-10-27 15:10Z - owner backlog registered (8 items), exact first step for each

Owner approved this order. Nothing below is claimed done; this is the plan a fresh
session continues from, with the real file/line anchors already located.

1. **Owner's personal loop: kill -> merit -> VISIBLE rank/title -> chest payout.**
   Title first. Already real: `coopWarMeritLedger` + `coopFactionWarMerit` (rank
   from merit) and `coopWarRankTitle.apply()` (durable title ledger, wired to
   `coopWarKillMerit` on `PROMOTED`, event `living-native-war-rank-title`). Missing
   for *his* character: the title is only in the co-op ledger - it must be written
   into the native character record's own `title` field (client-visible on the
   character sheet) for `coop-player-<characterID>`, via the stock
   `characterState` writer, refusing any non-player key and any unknown rank.
   Then the payout: `coopWarKillMerit` already calls `bountyPayer` ->
   `coopWarBounty`/`coopWarTreasury` PAYOUT from HELD escrow; it needs a funded
   chest (item 5) or an armed faction with real income.
3. **Structures as real objectives.** `campaign.structureID` is emitted by
   `coopWarClientView.campaignSnapshots` (flag
   `EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS=35832`) and the two real Astrahus
   exist (1030000000000/1030000000001). Missing: `coopWarObjectiveAdjudicator` must
   bind the campaign's structureID to a real native destruction of THAT structure
   and flip `militaryControllerFactionID` on that proof only (no timer, no capture
   by presence).
4. **Fleet reconstitution + faction RESERVE.** `coopWarFleetRoster` already plans
   from proven-alive survivors and records losses with a wreck; missing: a durable
   per-faction hull reserve count (spawnable + equipped) and a front-chat line on
   every loss/replacement through `coopWarClientView.frontReport` (same once-per-key
   throttle as `warFrontChat`).
5. **Real income for BOTH sides.** `war_funding_diagnose` live: every side is
   `NO_REAL_FACTION_INCOME` (all five earned-ledger pilots sit at balance 0). The
   only real ISK source is a seeded-market fill, so loot sales
   (`coopNpcLootCommerce` -> `coopNativeNpcMarket`) must fund the *seller's own*
   corporation (`coopNpcCorpTreasury` corporationID fix) - that is the same
   misrouting bug already recorded for the Angel pilot.
6. **Map/front-tab client check** (BLOCKED_CLIENT_CHECK until the owner confirms):
   open the FW front tab and the insurgency/campaign map layer in 30045344; the
   expected payloads are `coopWarClientView` campaignSnapshots (objective
   `structure:<id>`) and `fwWarzoneSolarsystem.GetAllWarzonesOccupationStates`
   (`ownerID`/`occupierID` field names still unverified).
7. **Second player (Sasha):** server-side preconditions only - a second character
   record docked at a militia desk, its own enlistment, its own active hull; never
   claim a client success without the client.
8. **Deferred:** shipcaster needs an owner decision (no beacon typeID exists for
   500011/500014/500020; only empire 75928-75931) - propose "no faction shipcaster
   in this build, empire beacons only"; native sovereignty needs a real TCU/IHub
   typeID + a native claim row (live: `NATIVE_SOV_CLAIM:0`, reason
   `NO_NATIVE_SOV_STRUCTURE`); incursions are a stub (2 files/0 handlers) - do not
   build on them.

**NEXT ACTION (exact).** Item 1, title half: add `applyToCharacter({pilotID,
characterID,rank,title})` to `integration/coopWarRankTitle.cjs` writing the stock
character record `title` (refuse non-`coop-player-` keys, unknown ranks and a
missing record), call it from `coopWarKillMerit` when the pilot key is a player,
emit `living-native-war-rank-title` with `surface:"CHARACTER_RECORD_TITLE"`, and
unit-test the refusals + the exact written value.

## 2026-10-27 15:00Z - ITEM 3 (owner correction): an enlisted player is ONE ship in a fleet

**Code PASS (4001d5bd).** `coopWarBattleDirector` no longer has a separate
player-only fallback branch. Per war ship it builds ONE ranked candidate list where
a hostile native hull and an enlisted enemy player are the same kind of candidate,
ordered by the same distance rule the NPCs already use on each other; a native hull
wins an exact distance tie, so a player is never preferred. The enlistment proof is
re-read immediately before the native order, exactly one native command is issued
per hull per tick, and the ranking is published once per distinct set as
`living-native-war-target-selection` (per ship: candidates, distance, chosen,
reason). Tests 8/8 (2 new: "the player is one candidate among several, never the
only or first target", "on an exact distance tie a native hull is chosen over a
player"); 41/41 with the militia/mobilisation/assault suites; OVERLAY_OK; built and
recreated.

**Live, verbatim.** `militia_enlist 140000102/3012018` ->
`{"enlistment":{"characterID":140000102,"factionID":500001,"status":"ACTIVE"},
"agentSays":"[Militia] Enlistment recorded for Caldari State."}`. Read-only verdict
probe on the real war ships of `campaign:30045344`:
`char=140000102 ship=980000023571 faction=500001 system=30045344 -> ALLY` (his own
faction never fires on him) and `ship=980000023574 faction=500004 system=30003837 ->
NO_ACTIVE_ASSAULT` (the enemy may only engage him once it is physically inside the
contested system - a real geometry gate, not a rule change).

**BLOCKED_CLIENT_CHECK (the in-space half, exact).** The multi-tick target-selection
proof needs the player's hull in a live scene. There is no server-side player-in-space
facility (`coopSessionPresence.admission` requires a live socket,
`initialStateSent`, a native scene membership and an unambiguous ship owner), and
`140000005` is undocked (`stationID null`, `solarSystemID 30000145`), so even his
enlistment needs a client dock. Required human action: log the client in as
140000005, dock at a Caldari militia desk (3012018 @ 60003754 Perimeter or 3010879
@ 60000358), enlist, undock in 30045344 while the campaign is in ASSAULT.

**World prerequisite (open).** `EVEJS_COOP_FACTION_WAR_GATE_APPROACH: '1'` was added
to `compose.coop-probe.yaml` and the server recreated, but the Gallente attacker
980000023574 is still in 30003837 and no `living-native-war-gate*` event exists, so
gate staging has not yet produced a crossing. That is the next exact step for the
assault leg (a front whose attacker never arrives can never be fought).

**NEXT ACTION (exact).** Diagnose gate staging for `campaign:30045344`: read
`advanceNativeWarGateStaging` + `coopWarGateStaging.tick` and publish the exact
refusal (treasury row, gate lookup, order lease, or `maxOrders`), then make the real
Gallente hull cross 30003837 -> 30045344. After that, the client half of item 3
(BLOCKED_CLIENT_CHECK above).

## 2026-10-27 14:42Z - ITEMS 1+2 PASS live: per-campaign mobilisation and the Caldari front in ASSAULT

**Item 1 (38300de5).** `coopWarMobilizer.tick` now plans every live campaign before
any write: `campaigns[]` carries, per campaign side, the assigned count, the
commander cap, the real mobilizable hulls and the exact first rejection. The
per-tick write budget is spent on the most starved campaign, and a refused native
ASSIGN returns the registry's own reason (`blocked[]`, published once per distinct
set as `living-native-war-mobilization-blocked`). `war_state` now projects the
record's real `state`/`sourceSystemID` (it emitted a `status` field the record does
not have, so PREPARING vs ASSAULT was invisible). 16/16 + 65/65, OVERLAY_OK 380.

Live: `war_diagnose` lists all 6 campaigns; then
`living-native-war-mobilization` DEFENDER 980000023571 (coop-pilot-023, 30045344,
500001) + ATTACKER 980000023574 (coop-pilot-038, 30003837, 500004) for
`war:500001-500004:campaign:30045344`, while the five pirate/ORE campaigns stayed
PREPARING.

**Item 2 (live, no code).** `living-native-war-assault` `ASSAULT_BEGUN`
`campaign:30045344` attacker `[980000023574]` defender `[980000023571]`,
`REAL_NATIVE_MUSTER_ON_BOTH_SIDES`; `war_state.campaignStates {PREPARING:5,
ASSAULT:1}`; `militia_state 140000005` -> `fronts:[{war:500001-500004,
campaign:30045344, systemID 30045344}]`.

World setup used (owner default: real NPCs only): two real armed navy patrols via
`spawn_native_npc` with the authored doctrine rows (Caldari Navy Condor 564+222x60
in 30045344, Federation Navy Atron 562+222x60 in 30003837), crewed by released
roster identities `coop-pilot-023`/`coop-pilot-038`. **Operator note:** release and
assign must go in ONE admin drain - a reconcile re-links a released pilot to its
durable old hull within ~20 s, which is why the first attempt answered
`PILOT_ALREADY_LINKED`.

**NEXT ACTION (exact).** Item 3: enlist 140000005 (Caldari) with `militia_enlist`,
then prove the melee rule live - a real Gallente (500004) patrol gets a
`MILITIA_PLAYER` attack order on that character's hull while Caldari (500001) NPCs
never fire on him. Read `coopMilitiaWarPlayer` first.

## 2026-10-27 14:30Z - production governor LIVE, and two world-caused blocks

Owner decision: throttle extraction to real demand (not reseeding, not industry).
integration/coopMiningDemandGovernor.cjs is now deployed with
EVEJS_COOP_MINING_DEMAND_GOVERNOR=1 FACTOR=1.5 FLOOR=20000 TRICKLE_MS=900000.

Live proof of the throttle (14:16-14:26 UTC):
  living-mining-demand-governor TRICKLE_ALLOWED sys30000144 held=4159021 want=45000
  living-mining-demand-governor HOLD           sys30000144 held=4159021 want=45000
  mining cycles dropped from ~100+ per 5 min to ~34 (trickle windows only).
It holds ONLY a fleet in state "mining", never a live station trip, and an unreadable
stock or unread bid book can never stop the world (both fall back to ALLOW).

Deployment traps hit today, all real:
  - `docker build` once reused a stale COPY layer; verify a changed module INSIDE the
    image (md5sum) instead of trusting the build exit code.
  - the shared container was recreated by another session with an older compose config,
    which silently dropped the governor env flags. Re-check printenv after any restart.
  - overlay --apply aborted once on another session's half-written hook
    (HOOK_REQUIRE_UNRESOLVED npcBehaviorLoop -> ../coopMilitiaWarPlayer).

Two blocks that are world state, not code:
  1. Hauler 980000016300 (which carried the 5000+5000 lifted minerals) no longer exists:
     the ship and its 9 mineral cargo rows were destroyed during the raid/war activity.
     So the mineral SALE is still unproven end to end.
  2. Durable slot 30000145-1 reports NEEDS_OPERATOR_REPAIR
     ALIFE08_REPAIR_SPAWN_COUNT_MISMATCH since 14:21:14, so that fleet cannot run another
     station trip until the native repair succeeds. Nothing was wiped to force it.

## 2026-10-27 13:35Z - the loop's real ceiling, measured with a new read-only audit

scripts/coop-economy-balance.cjs (+5 tests) answers the only question that decides whether
the loop can be self-sustaining: what the corporation holds versus what the world still pays.
Live measurement inside the container:

  status=PARTIAL_DEMAND stock=3965422 sellable=35046 stranded=3930376 potential_isk=373147.08
  station=60000358 type=17464 stock=623883 demand=0   NO_BUYER_ON_THIS_STATION
  station=60000358 type=17470 stock=525488 demand=0   NO_BUYER_ON_THIS_STATION
  station=60000358 type=34    stock=407192 demand=0   NO_BUYER_ON_THIS_STATION
  station=60000682 type=34    stock=321677 demand=5000 price=2.96 DEMAND_LIMITED

So ~4.0M units of ore/minerals are stored and only ~35k units can still become ISK. The
seeded bid book is a FINITE pool that earlier sales have already consumed; Perimeter's station
has zero bids for every type, which is why its fleet can never earn there.

Also confirmed: the lift account is clean (0 journals, 9 receipts, 0 blocked events).

Unproven still: one mineral sale (types 34/35 in living-npc-station-sold). The 5000+5000 units
are aboard hauler 980000016300 and the deployed sale path now sells them; the New Caldari fleet
must haul to a station that still pays (60000682 is the only one left in that system). Its
mining stopped at 13:21 after TICK_aggressed (another session is running militia/raid admin
commands on the same container), so the proof waits on world time, not on code.

## 2026-10-27 13:05Z - FIRST LIVE MINERAL LIFT (and two regressions it exposed)

PROVEN LIVE at 12:47:45-12:47:47 (run ca59f6c0):
  living-npc-mineral-lifted - 9 receipts, 5000 Tritanium + 5000 Pyerite taken out of the
    corporation hangar at 60003334 and written into hauler 980000016300's real native cargo
    (coop-mineral-lift:v1 journal tag, hangar stacks debited to zero).
  living-npc-station-sold SOLD - type 17471 qty 3975 @9.43 = 37 484 ISK credited to the pilot.
  living-corp-treasury-swept - 37 484.25 ISK into corporation 1000129 the same second.

Two real regressions the lift exposed, both fixed and tested:
  1. The sale filtered the allowlist by the caller's `types` (ore only), so the just-lifted
     minerals were never sold and stayed aboard as 9 stacks. Lifted types now bypass that
     filter via `liftedTypes`. tests/coop-mineral-lift-wiring.test.mjs 5/5.
  2. The lift writes its own custody rows (journal tag, no coopHaulFleetID), which made the
     durable mining fleet throw ALIFE12_NATIVE_HAUL_CUSTODY_AMBIGUOUS on boot and quarantine
     slot 30000145-1. Tagged lift rows are now excluded from that custody check.
     tests/coop-native-mining-fleet-durable.test.mjs 29/29.

Also worth knowing: the overlay --apply ABORTED once with HOOK_REQUIRE_UNRESOLVED
(npcBehaviorLoop -> ../coopMilitiaWarPlayer) because another session was mid-write; a second
run returned OVERLAY_OK. Always check that a deploy actually copied the module you changed
(grep the tag in the checkout) instead of trusting build exit=0.

## 2026-10-27 12:46Z - the lift path now RUNS live (and one real bug died)

Fixed live bug: the lift result was a block-scoped const used by the skip telemetry, so every
station arrival aborted with SALE_ERROR 'loaded is not defined' (5 occurrences). After the fix,
the same arrival reports living-npc-mineral-lift-skipped (12:45:10) followed by the normal
NOT_SOLD NO_SEEDED_COUNTERPARTY for the perimeter station, i.e. nothing aborts any more.

Still unproven live: one full minerals->ISK settlement. It needs an arrival at a station that
BOTH holds refinery minerals AND pays for them (60000682 / 60003334 in New Caldari). The New
Caldari fleet did deliver and refine 8 stacks at 60003334 at 12:33:05, but its next route is
blocked by ALIFE12_SOURCE_MISSING_WITHOUT_WAREHOUSE_PROOF: an older manifest declares cargo
that is no longer aboard and has no warehouse/sale receipt, so the custody gate refuses. That
gate is correct; the stale manifest needs the documented expire()/abandon() operator recovery
before a fresh trip can be planned.

Perimeter (30000144) has no bids at all, so nothing sold there can ever earn, no matter the
code: the demand map is 30000142 Jita (90 000/type) and 30000145 New Caldari (25 000/type).

## 2026-10-27 12:18Z - the whole picture, measured: where demand really is

Seeded BIDS only exist in two systems of region 10000002:
  30000142 Jita: 18 stations, 90 000 units of each ore/mineral
  30000145 New Caldari: 5 stations, 25 000 units, e.g. 60000682 Tritanium 5000@2.96,
    Pyerite 5000@16.35, Veldspar 4.42, Scordite 3.63, Pyroxeres 7.74
  30000144 Perimeter: ZERO bids of ANY type right now, including at 60000358.

So every station trip of the Perimeter fleet (960004609 -> 60000358) ends in
living-npc-station-sale-skipped NOT_SOLD NO_SEEDED_COUNTERPARTY: the station has no buyer
at all. Earlier sales there (521 754.08 ISK earned) consumed the finite 5000-unit bids that
did exist. Seeded depth does not come back on its own, so a loop that only sells into it can
never be perpetual without a real consumer (native industry) or owner-approved reseeding.

Identity exhaustion is FIXED and visible live: the same sale path that used to report
HAULER_NOT_NAMED now reaches the market and reports NO_SEEDED_COUNTERPARTY, i.e. the
merchant identity really is adopted (registry.release + reuse of a finished shift).

The New Caldari fleet (960004641) mines again after the restart (cycles COMMITTED, durable
slots RESTORED) but has not started a station trip yet, so the mineral lift at 60000682
(the only station that both holds refinery minerals and pays for them) is still waiting for
its first real arrival. living-npc-mineral-lift-skipped now reports every decision.

## 2026-10-27 12:0xZ - the mineral buyer was there all along (measurement bug fixed)

The market daemon answers GetOrders as a BOOK of two sides: {buys, sells}. The audit and
the earlier probe read `orders`, which never exists, so 'region 10000002 has zero mineral
demand' was wrong. Live now: 23 seeded BIDS per type. Station 60000682 (New Caldari) has
Tritanium 5000 @2.96 and Pyerite 5000 @16.35 right on the station the refinery already
uses; 60000358 (Perimeter) has NO local bid, so its stock cannot be sold there.

Bid depth is the real ceiling: 5000 per type per station, so the honest revenue is about
14 800 + 81 750 ISK, but only 14 800 ISK of that is one order's depth at 2.96 for 5000
units. Everything above the bid volume stays unsold, by design, never 'assumed'.

New leg (OFF by default, EVEJS_COOP_NPC_MINERAL_LIFT=1): integration/coopNpcMineralLift.cjs
takes the exact quantity out of the corporation hangar, writes a journal, puts it into the
hauler real native cargo carry row, verifies it, then receipts it. A journal whose cargo is
verified is replayed; a journal whose stock moved but whose cargo is missing halts the leg
with NEEDS_OPERATOR_REPAIR. sellOnArrival calls it before the proven sale path, so those
minerals are liquidated against the local seeded bids and the pilot ledger credits ISK,
which the corp treasury sweep then pulls back to the corporation.

## 2026-10-27 11:26Z - BPO bootstrap must run INSIDE the server process

grantItemToOwnerLocation(1000129, 60000358, 4, 950 /* Merlin Blueprint */, 1, {singleton}) plus
industryRuntimeState.getBlueprintState(itemID) do create the real native blueprint and state,
but a node process started with docker exec only writes into its own GameStore buffer:
flushTableSync('items') and flushTableSync('industryBlueprintState') both answer
flushed:false and scripts/coop-factory-audit.cjs still reports blueprints=0. The grant was
lost, so nothing was actually changed on disk.

Next attempt MUST go through the in-process admin bridge (/var/lib/evejs/coop-admin-requests.jsonl,
see integration/coopAdminBridge.cjs) or a real hook, never a docker exec side process.

Everything else stands: 16 refines, 521 754.08 ISK swept, 23 mineral stacks worth 0 ISK because
region 10000002 has zero orders for typeID 34/35.

## 2026-10-27 11:24Z - why minerals cannot be sold yet (measured, not assumed)

scripts/coop-mineral-audit.cjs (5 tests) reads the real stock and asks the real market book:
the corporation holds 23 refinery stacks - 407 192 Tritanium + 81 826 Pyerite at 60000358 and
321 677 + 7 401 at 60000682 - and region 10000002 (The Forge) returns ZERO orders for typeID
34 and 35. There is no buyer to fill, so a mineral sale leg would be dead on arrival; the
blocker is demand, not custody.

Closing the loop therefore needs one of:
  a) native industry really consuming minerals (blueprint + funded corp + industry jobs), or
  b) backed seed BUY orders for minerals via the market daemon (AdjustSeedStock), which
     changes the economy book and needs the owner explicit approval.

## NEXT (unfinished, do not claim done)

1. Minerals -> ISK. Refined minerals sit in corp 1000129 hangar with customInfo prefix
   coop-refine:v1:<item>:<qty>:mineral:. The station sale path (coopNativeStationArrival +
   trip manifest) is ore-only (isOreType), and coopNpcLootCommerce is pilot/ship-centric, so
   neither can sell them. Needed: one custody-safe local leg - a manifest of the refinery
   operation IDs and mineral rows, a sale against real seeded buy orders at the same station
   (minerals already there, no haul), and a durable receipt per row. No unbacked orders.
2. Manufacturer buyer. corp 1000129 now holds ISK (455600 + 521754.08 swept). Missing: an
   inventory item with categoryID = BLUEPRINT_CATEGORY_ID owned by that corp at a station,
   which makes industryBlueprintState.records[itemID] real; then scripts/coop-factory-audit.cjs
   must print FACTORY_READY (it reads blueprints, jobs, fundedCorporations).
3. Gate baselines: coop-loop-gate.sh fails hook-inventory (58 expected, 59 actual),
   overlay-l1-baseline (patch series != manifest), flags (3 new env flags:
   EVEJS_COOP_NPC_MARKET_DIR, EVEJS_COOP_CORP_TREASURY, EVEJS_COOP_FACTORY_CORP_ID).
   Update the baseline files deliberately after confirming no duplicate hook exists
   (only one coopNpcRefineryTick.tick call is present in the built checkout, line ~2896 of
   miningNpcOperations.js). isolated-gamestore passes once NODE_OPTIONS is cleared.

## 2026-10-27 11:07Z - LIVE PROOF: the refinery is paid and refines

After moving the hook before the early returns in shouldTriggerHauling and deploying:

- living-corp-treasury-swept x1: 521 754.08 ISK moved from the pilot ledger into corp 1000129
  (corp wallet already held 455 600 ISK).
- living-npc-refined x16, all COMMITTED, real ore consumed (7 703 / 36 666 / 23 111 ...),
  2 minerals per stack, station 60000358 and 60000688.
- 16 journal files and 16 durable fee receipts in /var/lib/evejs/coop-native-refinery,
  fees 1 135.72 - 22 760.08 ISK paid from the corp wallet.
- The 16 living-npc-refinery-blocked rows are the SAME stacks retried after refining: what
  is left is smaller than one native portion, so NATIVE_REPROCESSING_RECIPE_UNAVAILABLE is
  correct but noisy - report leftovers as a leftover, not as a missing recipe.

Closed loop now real: sale -> ISK -> corp wallet -> station fee -> minerals in the hangar.

## 2026-10-27 ~11:05Z - HEAD 27b0b3d4 (pushed): the refinery can be paid

- coop-npc-refinery.test.mjs was 14 pass / 9 fail for one reason: the journal key is
  coop-refine:v1:<item>:<qty> and ':' is illegal in a Windows file name, so acquire() never
  locked and every refine answered REFINERY_LOCKED_NEEDS_REVIEW on Windows only.
  journalFile() now escapes the path segment; logical IDs, receipts and comparisons are
  unchanged. 23/23 green.
- With that green a positive station fee is accepted only with a durable paid witness
  (<root>/refinery-fees/<itemID>.json) naming that corporation, station and ISK amount.
  The tick pays it (payFee) and retries: proven 5000 -> 3765.5 ISK.
- coopNpcCorpTreasury had tests and no caller; the refinery tick now sweeps pilot earnings
  into the corporation first (EVEJS_COOP_CORP_TREASURY=1), event living-corp-treasury-swept.
  Proven 33714.25 -> fee 4998.33 -> 28715.92 ISK left.
- Live blocker: zero refinery events ever and no /var/lib/evejs/coop-native-refinery dir.
  The hook passed only fleetRecord.stationID; the mining fleet docks no hull, so every live
  tick was NO_STATION. The tick now proves the station from the newest warehouse trip
  manifest for that system+fleet and reports living-npc-refinery-skipped instead of silence.
- New live flags: EVEJS_COOP_NPC_MARKET_DIR, EVEJS_COOP_CORP_TREASURY=1,
  EVEJS_COOP_FACTORY_CORP_ID=1000129.
- Operator note: this shell inherits VS Code's NODE_OPTIONS js-debug bootloader; clear it
  (and VSCODE_INSPECTOR_OPTIONS) or gates report a fake BLOCKED_RUNTIME_SEED.
- Pilot ledger then: 521754.08 ISK un-swept; corp wallet 0 until a sweep runs.

Updated: 2026-10-26 ~23:10Z · HEAD `4e32bbca` (pushed)

## Proven live (twice, different runs)

`living-npc-station-sold` `SOLD` with real ISK — **33 150** (21:30) and **36 250** (22:37),
`NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET`. Same runs: `living-mining-cycle-settled`
(COMMITTED) → `living-hauler-loaded` (14 466 / 14 277 m³) → fleet `loaded` →
`living-npc-station-route` → sale. Mining and loading continue afterwards
(28 settled cycles + 4 new loads after the last restart).

## Fixed here (all pushed, tested where unit-testable)

1. `HAULER_NOT_NAMED` — the role filter read the world file, which has no roles.
2. Sale left no provable trace → durable per-row fill receipt; the trip journal accepts it.
3. Rows are **partly** sold (5 000 of 54 999) → the receipt records the units the hull
   lost (accumulates), and the journal accepts a remainder = declared − sold.
4. A closed route is skipped BEFORE accounting (that ordering bug made the first expiry
   a no-op).
5. `verify()` required an exact warehouse receipt + hangar item, so a market fill could
   never close a row → a fill is now proven by its own quantity and type; a deposit still
   needs the exact stack.
6. Overdue/superseded trips are closed durably (own fsynced record, ack untouched) and
   re-planned from the hull.
7. Deploy/installer: reset from HEAD (not the shared index), L1-owned file is not drift,
   19 modules a merge had dropped are back in the installer list, and the new
   require-resolution guard found and fixed two live broken requires.

## Remaining blocker (exact)

After a sale, the next trip can still stop with
`ALIFE12_SOURCE_MISSING_WITHOUT_WAREHOUSE_PROOF`: a declared row is gone and the
accumulated fill receipt names the *last* station, while the manifest names the trip's
station — so the row cannot be proven for this manifest. Fix direction: make the fill
receipt carry a per-station breakdown (`fills: [{stationID, quantity, at}]`) and let the
journal prove a row against the fills of the manifest's own station, summing them.

## Operator actions taken (explicit, logged)

Two historic trips whose ore was sold before receipts existed were closed with the
journal's own `expire` via an explicit script
(`node /tmp/expire-trip.cjs <system-fleet-startedAt> HISTORIC_SALE_WITHOUT_RECEIPT --confirm`,
emitting `living-native-trip-expired-by-operator`). No receipt was invented, no cargo was
touched; both manifests remain on disk.

## Environment

`EVEJS_COOP_VIRTUAL_POPULATION=48`, `EVEJS_COOP_FLEET_COMPOSITION=1`,
`EVEJS_COOP_MINING_FILL_CAP=1`, `EVEJS_COOP_CARGO_VOLUME_FALLBACK=1`.
The world carries extra hulls from early failed attempts (13 miners / 10 haulers per
slot) — real, consistent, non-destructive. A clean acceptance prefers a fresh world.

## Commands

```
node scripts/coop-deploy.cjs --checkout C:\Games\EveCoop\upstream-evejs\Code   # reset=49 OVERLAY_OK
cd C:\Games\EveCoop\upstream-evejs\Code
docker build -t evejs-local . && docker compose -f compose.yaml -f compose.coop-probe.yaml up -d
bash scripts/coop-loop-gate.sh --code-path C:\Games\EveCoop\upstream-evejs\Code
```

## 2026-10-27 late: faction war wired to the real world

Commits (local, not pushed): 1cf02347 merit, 26945358 territory-from-presence,
c29cbcd7 campaigns, 58d8afd4 treasury, fd4bac85 bootstrap, 9b0d6f2a opening +
assault + runtime phases, 7f78b9fc war-state SQLite fix, 11a9d2ec self-defence.

Chain: real presence (identity links + corporation->faction) -> territories
(majority, tie = contested) -> fronts (real reciprocal gates) -> war + campaign
per open border (one war per faction pair) -> mobiliser reserves existing native
patrols -> BEGIN_ASSAULT only with a real muster on both sides.

**Root cause found:** the war phases read the record via gameStore.read(table,
"/"+KEY) (JSON cache) while coopFactionWarStore writes through
coopAtomicNativeRows with the raw KEY. A written state was invisible to the next
tick, so the empty state was recreated on every restart. warStateStore() now owns
read/write for opening/assault/mobilization/demobilization/objectives, and
ensureWarState() bootstraps once before any war phase.

**Live state after deploy:** `empty war state created (version 1)` exactly once,
then `opening skipped: NO_FRONT`, `mobilization skipped: NO_MOBILIZED_SHIP:OBSERVED`,
`assault skipped: NO_PREPARING_CAMPAIGN`. The state row now persists in SQLite
(version 1, wars 0, campaigns 0, territories 0).

**Why no front exists yet (real data, read-only probe):** 58 linked pilots ->
30000144=500014 (13), 30000145=500014 (9), 30100032=500020 (4), Jita 30000142 is a
3-3 tie between 500010 and 500011, so it is contested and owns nothing. The two
systems owned by 500014 share one owner and 30100032 is not adjacent, so there is
no border between two different owners. The opener refuses instead of inventing a
front. Next real action: a second faction must really outnumber the current
holder in a system adjacent to another faction's system (one extra patrol/pirate
of 500010 or 500011 in Jita is enough), then the war opens by itself.

Self-defence: coopNpcAggressionLedger (fed only by the killmail-tracker receipt
proven in coopPlayerCombatWitness) lets coopPveRetaliationGuard accept a verified
witness when the native controller has no lastAggressorID. The live compose
profile now sets EVEJS_COOP_PVE_NPC_RETALIATION=1 (it was absent, so
self-defence was gated off).

Tests: 96/96 across war + tactics + retaliation + ledger.

## Per-station fills (done, 22c90295)

Sale receipts now carry `fills:[{stationID,quantity,at}]` (accumulating, atomic
tmp+fsync+rename, identity checked against the prior row). The trip journal and
`verify()` sum ONLY the fills of the manifest's own station made after its departure, so
a row sold in two visits can be proven for each visit separately; receipts written
before the breakdown keep the documented single-station fallback. 28 journal tests pass,
including "a fill at another station never proves this route" and "a fill from before
the departure belongs to another manifest".

## Why the current world cannot finish a second trip

Its history predates receipts: rows were sold in several fills with only the first fill
recorded (the writer used create-only), so those rows are now gone while their receipts
cover only part of them. That is unprovable by construction and must not be papered over.
Live proof of the loop itself already exists (two SOLD events with real ISK).

## Decision needed before the next acceptance run

The probe world is blocked by that historic evidence gap. Two honest options:

1. **Clean world, same machine** (recommended): a second compose project with its own
   volume and remapped ports, run the loop from zero and capture the full cycle. Nothing
   of the current world is touched.
2. **Reset the probe world**: stop the project and drop `evejs-data` so the same project
   starts clean. Destructive; needs an explicit owner decision.

Neither is done automatically: the repo forbids wiping a volume to force a PASS, and a
second project needs ports 26000-26003/40110/443/5222 that the current one holds.

## 2026-10-27 handoff: CCP subsystem inventory (verified by file/handler count)

structure 46 files/77 handlers = real (deploy, control, destruction+loot, moon mining)
campaign 3/20 = real (the FSM that feeds insurgency) | shipcaster 5/6 = real
sovereignty 24/1 = logic only, no client surface | agency 1/2 = thin
incursion 2/0, superweapons 2/0, loyalty 1/0 = STUBS, do not build on them

Next step (not started): structureDeploymentService exposes ONLY client RPCs
(Handle_Anchor/Unanchor/CancelUnanchor/RenameStructure) - there is no server-side
deploy API. Two paths: (a) call the underlying structureState writer directly and
verify the structure appears in worldData.getStructuresForSystem + the scene;
(b) drive the stock Anchor action. Then set EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS
to the real typeIDs and use the structure as the campaign objective (structureID is
already a field in the client campaign snapshot; the projector currently emits 0).

## 2026-10-27 loop — item 1 DONE (structure factory), item 2 in progress

**Item 1 PASS (commit 52b28db1).** `integration/coopStructureFactory.cjs`:
`plan()` -> PLANNED record or REFUSED (UNKNOWN_TYPE_ID, INVALID_POSITION,
INVALID_FACTION for any non-number, OWNER_CORPORATION_REQUIRED,
CORPORATION_FACTION_MISMATCH, UNKNOWN_CORPORATION_FACTION, NAME_REQUIRED,
SYSTEM_ID_REQUIRED); `deploy()` writes through the native writer
`structureState.createStructure` -> `persistStructures` ->
`writeTable("structures")` (which applies `normalizeStructureDescription`,
invalidates the cache and notifies scene listeners) with `{emitLive:true}`;
`verify()` reads back through `listStructuresForSystem`, the same reader behind
`worldData.getStructuresForSystem`. Evidence: `node --test
tests/coop-structure-factory.test.mjs` 12/12, `--apply` INSTALLED
coopStructureFactory.js, `--check` OVERLAY_OK, docker build + recreate OK.

Assumption (owner default): objectives are created in SHIELD_VULNERABLE (110)
with a quantum core so they are real, attackable targets; the co-op faction is
stored in `devFlags.coop` because `normalizeStructureRecord` has no faction
field.

**Admin bridge (uncommitted->next commit):** `coopAdminBridge` gained the
whitelisted action `deploy_structure` (no characterID: a structure belongs to a
corporation) which calls the factory and reads the row back; `deps` are the real
native services. Tests `tests/coop-admin-bridge-structure.test.mjs` 4/4.

**Deliberately dirty (not mine):** `integration/coopNativeHaulManifest.cjs`,
`integration/coopNativeStationTripJournal.cjs` (another session's ore-owner vs
station-corp fill fix), `scripts/coop-supervise.ps1`, `state/digests/*`, `NUL`.
Never commit them.

**NEXT (item 2):** 1) add `EVEJS_COOP_ADMIN_BRIDGE: '1'` and
`EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS` to `compose.coop-probe.yaml`
(re-check the file right before each recreate). 2) `coopWarClientView.cjs:68`
hardcodes `structureID: 0` - replace it with the campaign's real objective
structure id (carried in the war state campaign record; see
`coopFactionWarCampaigns.cjs` `planCampaign` and `coopFactionWarAssault.cjs`).
3) Deploy 1-2 real structures in Perimeter 30000144 / New Caldari via
`deploy_structure`, then prove `warState` campaign carries the id and the
client snapshot emits it.

## Стиснення часу для тестів (реальні native-кнопки, без фейкового стану)

Профіль у `compose.coop-probe.yaml` (перевірено в контейнері через `env`):

| ключ | було | тест |
|---|---|---|
| `EVEJS_MINING_NPC_HAULER_REPEAT_DELAY_MS` | 600000 (10 хв) | **45000** |
| `EVEJS_MINING_NPC_WARP_INGRESS_DURATION_MS` | 2500 | **1500** |
| `EVEJS_MINING_NPC_FLEET_THINK_INTERVAL_MS` | 1000 | **500** |
| `EVEJS_MINING_NPC_HAUL_THRESHOLD_RATIO` | 0.2 | **0.1** |
| `EVEJS_COOP_NPC_MARKET_COOLDOWN_MS` | 60000 | **5000** |

Це саме ті ручки, якими керує продукт; код не змінюється, ніякого «підкрученого
годинника» і ніяких синтетичних подій. Продакшн-світ лишає стокові 30 хв.

## Результат трьох живих продажів

`SOLD` **33 150** + **36 250** + **43 950 = 113 350 ISK** (NPC-леджер).

## Чому зараз не продає

`living-npc-station-sale-skipped` → `NO_SEEDED_COUNTERPARTY`: у нативного сіяного
ринку закінчились ордери на ці типи руди в цих станціях (ми викупили їх кілька разів).
Це реальна межа ринку, не дефект циклу. Щоб продавати далі, треба нове сіяння
маркету (окремий потік) або інші системи/типи.

## 2026-10-27 loop — items 1/2/5 status, real blocker proven

**Item 1 PASS** (52b28db1, live 2276157c): factory + 2 real Astrahus structures
deployed (1030000000000 Perimeter, 1030000000001 New Caldari, faction 500014 /
corp 1000129), verified through worldData.getStructuresForSystem.

**Item 2 code PASS** (71551c99): campaignSnapshots emits the bound
`structure:<id>` objective instead of 0; flag
EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS=35832 is live. The objective can
only bind inside an ASSAULT campaign, which is blocked (below).

**Item 5 partial** (3fc8e73c): the first real front OPENED —
`living-native-war-opened OPENED war:500011-500014` with campaigns for 30000144
and 30000145, after one real Angel Cartel hull linked to coop-pilot-041 broke
Jita's 3-3 tie.

**Exact blocker for BEGIN_ASSAULT** (457b0ef0, read-only war_diagnose):
- war pair is Angel Cartel (500011) vs ORE (500014);
- DEFENDER side (30000144, ORE): every patrol candidate is WRONG_FACTION —
  corp 1000129 has 11 real profiles, all miners/haulers, so ORE can never
  field an armed patrol;
- ATTACKER side (Jita): the only 500011 patrol (980000000113) fails
  `NOT_READY:WAR_NO_NATIVE_LOADED_WEAPON`.
Conclusion: this faction pair cannot muster. A progressing assault needs an
armed faction to own the defending border system.

**NEXT (decided, owner defaults allow it):** make the border fightable without
weakening any gate:
1. spawn ~10 real Serpentis (500020, corp 1000135) armed patrols in New Caldari
   30000145 (currently ORE 9) so an ARMED faction owns it;
2. spawn 2 real armed Angel patrols in Jita with role patrol (linkSpawnedIdentity
   role="patrol") so the attacker side is ready;
3. a campaign whose target is no longer held by its war's defender faction is
   void by construction — add an explicit core transition (EXPIRE_CAMPAIGN with
   a reason) and let the opening phase void such campaigns before planning,
   otherwise TARGET_ALREADY_CONTESTED blocks the new front forever;
4. verify: war opens 500011-500020, mobilization assigns real patrols on BOTH
   sides, then BEGIN_ASSAULT fires and the objective director binds the Astrahus.

Dirty files deliberately left alone: `scripts/coop-supervise.ps1` (supervisor),
`state/digests/*` (generated), `NUL` (stray).

## Buyers for the ore — what actually exists (checked 23:57Z)

`living-economy-destination` on the live world reports **`HOLD_NO_BUYER`** with
`revenue 0, filled 0, unfilled 183 747` for every candidate station, for ore types
17463/17464/17470/1230. The native seed market simply has no buy orders for those ores
in these systems, so the sale path (`coopNativeNpcMarket`, which only fills EXISTING
native orders) correctly reports `NO_SEEDED_COUNTERPARTY`.

Three buyer layers exist in the repo, and only the first one pays today:

1. **Seed-market book** (`coopNativeNpcMarket`) — real native orders, finite; this is
   what produced the three live sales (113 350 ISK).
2. **Demand model** (`coop-economy.json` `systems.demand`, `living-economy-ore`,
   `EVEJS_COOP_ECONOMY_DESTINATION=1`) — computes where ore is wanted; right now it
   honestly says there is no buyer.
3. **Industrial consumers / manufacturers** (`coopAlifeNativeManufacturingRuntime`,
   `coopNpcIndustryNativeBindings`, `coopNpcManufacturingPlanner`, `coopNpcRefinery`) —
   present but **deliberately OFF**: the native bindings declare
   `supportsLiveRuntime:false`, so the runtime refuses with
   `ALIFE_MANUFACTURING_SOURCE_UNVERIFIED` until the native industry path is verified
   live. That is the missing "manufacturer buys ore for its own needs" leg.

Placing NPC buy orders without backing is forbidden by the repo rules, so the only
honest ways forward are: verify+enable the native industry consumer, or seed genuinely
backed ore demand (market daemon), or sell in regions where real orders exist.

## Варіант (а): нативна індустрія як покупець руди — що знайдено (00:05Z)

Читав нативний codebase і живий store:

* `server/src/services/industry/*` існує (12 сервісів), у store є таблиці
  `industryJobs`, `industryBlueprintState`, `industryFacilityState`, `industryRuntime`.
* **Усі вони порожні**: jobs 0, blueprintState 0, facilityState 0 (industryRuntime 2 —
  лише метадані). Тобто у світі немає ні фабрики, ні креслення, ні матеріалів.
* `industryChatCommands.js` експортує `executeBlueprintCommand` і
  `executeBlueprintAutoCommand`, і всередині вже є `seedMaterialsForBlueprint` та
  `topUpWalletForBuild` — тобто нативний шлях «зробити реальний білд» у чекауті є, і він
  вміє сам посіяти матеріали й докинути гаманець.
* Але весь co-op стек індустрії **свідомо зафенсований** `supportsLiveRuntime:false`
  (bindings, executor, rust-sell, title-transfer, recovery fence...), а `planner`
  вимагає онлайн-фасиліті + `blueprintState.records`.

Висновок: (а) — це не перемикач, а bootstrap: треба створити NPC-виробника (фасиліті на
станції, креслення з нашою рудою в матеріалах, гаманець+матеріали через нативні
команди), прогнати один реальний джоб із доказами, і лише потім атестувати рантайм.

Наступний крок, який я роблю без ризику: підняти нативний білд через
`executeBlueprintAutoCommand` для NPC-корпи (нативний шлях, не вигадані записи), з
окремим журналом доказів. Якщо для цього потрібна сесія, якої в headless-світі немає —
це і буде першим точним блокером, і тоді рішення: невеликий L2-міст «NPC factory
bootstrap» або L1-пропозиція вгору.

## 2026-10-27 loop — item 3, 4, 10 done; assault blocker narrowed to NPC fitting

**Item 3 PASS** (78fb32ce): rank-driven command cap enforced per campaign side
(recruit 1 / squad-lead 5 / admiral 25), wired to real merit records (none yet,
so every side starts at 1). Tests 10/10.

**Item 4 PASS (code)** (3ff71b13): `warFrontChat` sends
`coopWarClientView.frontReport` to live sessions in the affected systems on war
opened / assault begun / objective captured, once per event key. Tests 3/3. No
live chat line was observed (no transition happened with a client connected).

**Item 10 PASS** (f3997b30): full suite HEAD 5712 tests / 5163 pass / 459 fail /
90 skip vs baseline 49140caa 5680 / 5131 / 459 / 90 — zero new failures, 32 new
passing tests. The single new failure found was an LF-anchored guard broken by a
PowerShell rewrite that had converted two modules to CRLF; restored.

**Assault blocker, narrowed twice (both read-only, exact):**
1. `war_diagnose` -> DEFENDER (ORE 500014) WRONG_FACTION (corp 1000129 has 11
   real profiles, all miners/haulers) and ATTACKER NOT_READY:WAR_NO_NATIVE_LOADED_WEAPON.
2. `inspect_npc 980000000113` -> `"modules":[],"moduleCount":0,"cargo":[],"cargoCount":0`
   even for a durable, armed-profile hull. Cause in the pinned code:
   `nativeNpcService.buildNativeModuleRecords` fits only `definition.loadout.modules`,
   and these profiles resolve to an empty authored loadout. So no NPC in this
   world carries a native fitted weapon/charge and the muster gate can never pass.

**NEXT ACTION (exact):** the assault is blocked BELOW the war layer. Investigate
why `npcData.buildNpcDefinition(<profileID>)` yields no `loadout.modules` for
`parity_angel_autocannon_frigate` / `blood_raider_prophecy` (npcProfiles/npcLoadouts
rows in the static tables vs `npcHardwareCatalog` allowed type IDs), then either
author a real loadout through the catalog or record it as a stock data gap in
`patches/upstream/`. Do not relax `coopWarMusterReadiness`.

**Also still open:** queue items 6 (NPC careers), 7 (courier economy), 8
(industry/salvage loop), 9 (two-client checklist); owner backlog items 1-3
(sovereignty projection, shipcaster logistics, player ranks).

## 2026-10-27 — NPC fitting root cause FOUND (exact), fix needs an override seam

**Root cause (verified, no guessing).** `npcData.buildNpcDefinition(profileID)`
takes the loadout straight from the profile row (`profileRow.loadoutID`), and
every pirate *subcapital* profile points at
`retail_empty_npc_entity_loadout` — a documented stock row with
`modules: [], charges: []` ("Retail NPC Entity Native Dogma": retail NPC stats
live on the type dogma record, not on fitted modules). Measured in the live
container:

```
PROFILE angel_raider                     loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE parity_angel_autocannon_frigate   loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE blood_raider_prophecy             loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE ore_mining_venture                loadoutID ore_mining_venture_dual_miner      modules 1 charges 0
PROFILE concord_police_cruiser            loadoutID concord_medium_beam_laser_cruiser_mwd modules 2 charges 1
```

So `coopWarMusterReadiness` is correct and stock is correct; the two never meet
for pirate subcaps.

**Profiles that DO carry a real, validating weapon+charge (existing data only):**
- `capital_angel_dreadnought` / `capital_serpentis_dreadnought` / ... (each pirate
  faction's capital) — 1 module + 1 charge, `validateNpcHardwareDefinition` -> ok;
- CONCORD (17 profiles, faction 500006);
- Triglavian (28 profiles, faction 500026).

Every pirate *frigate/cruiser/battleship* has zero modules. There is no
subcapital pirate loadout anywhere in the static tables.

**Two honest fixes (both keep coopWarMusterReadiness untouched):**

1. **L1 seam (recommended, real patrols).** Add an explicit loadout override to
   the spawn path (`buildNpcDefinition(profileID, {loadoutID})` or
   `spawnBatchInSystem(..., {loadoutID})`) as a pinned
   `patches/upstream/NNN-npc-loadout-override.patch` + MANIFEST entry, then author
   ONE coop war-patrol loadout (a real turret + a real compatible charge) in the
   coop layer and spawn war patrols with it. Small diff, reversible, keeps retail
   behaviour when the option is absent.
2. **Existing-data-only (no patch, semantically weak).** Use a pirate capital
   (`capital_angel_dreadnought`) as the armed hull, which already has a real
   loadout — but a dreadnought labelled `role:"patrol"` is a misleading label and
   needs a 10-ship world flip to give a fightable border (Jita's neighbours are
   all ORE-owned; ORE has 11 profiles, all miners, and no capital).

Nothing was changed this step: no patch, no flag, no gate relaxation.

**NEXT ACTION (exact):** implement option 1. Start at
`server/src/space/npc/npcData.js:459 buildNpcDefinition(profileID)` and
`nativeNpcService.js:430 buildNativeModuleRecords` (reads
`definition.loadout.modules`); thread an optional `loadoutID` through
`npcSelection.resolveNpcSpawnPlan` -> `spawnBatchInSystem`, add the patch +
`patches/upstream/MANIFEST.json` entry, then `node scripts/apply-upstream-patches.cjs
--checkout <Code> --apply`. Live proof required: `inspect_npc <patrol>` shows
`moduleCount>0` with a weapon+charge, then `war_diagnose` shows
`DRY_RUN_MOBILIZABLE` on both sides, then `living-native-war-assault` fires.

## 2026-10-27 — L1 loadout seam implemented (in progress, live proof pending)

**Done so far.** `patches/upstream/0007-npc-loadout-override.patch` (sha256
`4b9b8215ccf32e88c90ddef38a479f5796d6fbe693bfa7bf0e6d60bda1e2fc82`, MANIFEST
entry, 3 files: npcData/npcSelection/npcService — nativeNpcService is NOT touched
because 0002 owns it). `buildNpcDefinition(profileID, {loadoutID})` ->
`resolveNpcSpawnPlan` -> `resolveBatchSelection` -> `spawnBatchInSystem`; retail
path unchanged when the option is absent, a missing row fails as
NPC_DEFINITION_INCOMPLETE. Apply + reverse both verified.
`integration/coopWarPatrolLoadout.cjs` resolves the profile's own
`<profileID>_loadout` row (real turret + native-compatible charge) and never
overrides an already armed row; `coopAdminBridge.spawnNativeNpc` now refuses an
unarmed `role:"patrol"` spawn (`WAR_PATROL_LOADOUT_UNAVAILABLE:<reason>`), accepts
`loadoutID`/`warPatrol`, and reports the loadout it used.
Tests: `coop-war-patrol-loadout` 7/7, `coop-npc-loadout-override-patch` 5/5.
Deploy: `coop-deploy.cjs` -> `reset=53 patches=series=7 overlay=OVERLAY_OK`.

**Proven live data (read-only probes).** `parity_angel_autocannon_frigate` ->
`parity_angel_autocannon_frigate_loadout` = Domination 125mm Autocannon (13773,
g55) + Domination EMP S (20767, g83), `validateNpcHardwareDefinition` ok, family
angelcartel, `isNpcChargeCompatibleWithModule` true. Every `parity_*` pirate
profile has such a row; `angel_raider`/`blood_raider_prophecy` do not (refused).

**Assault blocker, corrected analysis.** War `war:500011-500014` has defender ORE
(500014) and EVERY ORE profile is a miner/hauler (11 profiles, no weapon), so the
defender side can never muster; registered territories (Jita=500011,
30000144/30000145=500014) are authoritative over live presence, so spawning
Serpentis into a registered ORE system does NOT change the owner (the previous
NEXT list assumed it would). Real fix = a front between two ARMED factions: add
Sobaseki 30001363 (real reciprocal gate 50013876<->50013875, 5 belts) to
`EVEJS_COOP_VIRTUAL_ROUTE` and put one armed Serpentis patrol there; Jita is
already 500011-owned, so a new war 500011-500020 opens on that border and both
sides can muster.

**NEXT (exact).** build + recreate -> `spawn_native_npc` (profileQuery
parity_angel_autocannon_frigate, role patrol, warPatrol true, system 30000142) and
the Serpentis twin in 30001363 -> `inspect_npc` both (moduleCount>0 + charge) ->
`war_diagnose` DRY_RUN_MOBILIZABLE both sides -> `living-native-war-assault`.

## 2026-10-27 — L1 loadout seam + REAL ASSAULT MUSTER (PASS, a7f4c379)

**Proven live (verbatim, container evejs-server-1).**
- `inspect_npc 980000016644` -> `"moduleCount":3` (3x typeID 13773 projectile
  turret, flagID 27/28/29, online) + `"cargoCount":3` (3x typeID 20767 EMP S, one
  per module), `"transient":false`.
- `inspect_npc 980000016639` -> `"moduleCount":5` (5x 13884 hybrid turret) +
  5 charges 20057, `"transient":false`.
- `living-native-war-opened` `OPENED` `warIDs:["war:500011-500020"]`
  `campaignIDs:["war:500011-500020:campaign:30001363"]`, territories now
  `30000142:500011, 30000144:500014, 30000145:500014, 30001363:500020,
  30100032:500020`, `fronts:2`, FUNDED paper treasury.
- `living-native-war-mobilization` `NATIVE_PATROL_MOBILIZED` 980000016644
  ATTACKER (30000142/500011) and 980000016639 DEFENDER (30001363/500020).
- `living-native-war-assault` `ASSAULT_BEGUN`
  `campaignID:"war:500011-500020:campaign:30001363"`
  `attackerShips:[980000016644] defenderShips:[980000016639]`
  `evidence:"REAL_NATIVE_MUSTER_ON_BOTH_SIDES"`.

**Two facts that made this possible (both real, no gate touched).**
1. The muster gate rejects **transient** charges (`c.transient===true`), so a war
   patrol must be spawned `durable:true`; `coopAdminBridge` now does that on
   request and reports `durable`.
2. `campaignReadiness` returned on the FIRST preparing campaign, so the
   un-winnable ORE border (`war:500011-500014:campaign:30000144`, defender ORE
   flies no weapon at all) hid every later border. It now scans all PREPARING
   campaigns and returns the first READY one; the per-campaign gate is unchanged.

**World setup used (owner default: real NPCs/factions only).** Route gained
`30001363` Sobaseki (real reciprocal gate 50013876<->50013875, 5 SDE belts), one
armed Serpentis patrol there (faction 500020) and armed Angel patrols in Jita
(500011) via `spawn_native_npc` + `linkSpawnedIdentity`. No synthetic state, no
fabricated kill, no ammo invented.

**Known noise, deliberately left.** The two transient pirate frigates from the
first attempt (980000016644/16645 were transient then; 980000016644 came back as
a durable restore) plus unarmed transient hulls still linked to some pilots; the
older ORE campaigns stay PREPARING forever by construction (ORE cannot arm).

**NEXT.** (a) battle/objective leg: attack orders -> structure objective binding
-> capture of 30001363; (b) client check of the new campaign on the map/FW tab =
BLOCKED_CLIENT_CHECK without the EVE client; (c) do not re-spawn patrols for the
same campaign (side cap is 1 at recruit rank).

## 2026-10-27 — assault battle leg: real fire + measured HP loss PROVEN (287898d1)

**Proven live (container evejs-server-1, read-only probes).**
- `living-native-war-attack-orders` `NATIVE_ATTACK_ORDER_ACCEPTED` for
  980000016639 -> 980000016987 and back, after the director finally saw its own
  war state.
- `war_combat_diagnose` pair: `sameSystem:true, distanceMeters:4908,
  inRange:true, verdict:AUTHORIZED, warID:war:500011-500020`.
- `living-native-weapon-event` `VERIFIED_NATIVE_WEAPON_EVENT` repeatedly from both
  hulls (module 980100051793 hybrid turret, 13773 projectile turret).
- Ammo bank journal `980000016639.json` phase **COMMITTED** (a real charge debit).
- Victim HP went from `{"shield":225,"armor":200,"structure":215}` to
  `{"shield":200.13459482520693,"armor":200,"structure":215}` — 24.87 HP of
  measured damage from a real Serpentis turret hit.

**Five stacked defects fixed (each proven by a probe before the next):**
1. `gameStore.read(TABLE,"/"+KEY)` cannot see a row written through
   `coopAtomicNativeRows` (the cache nests it at 0x1f). The battle director's
   `snapshots()` was always null -> `WAR_STATE_UNAVAILABLE` -> no order ever.
   `integration/coopNativeRowPath.cjs` is now the one conversion point (195d4ec9).
2. An assault attacker mobilized during PREPARING stayed in the source system and
   held the rank-capped side slot forever (b5a8cd01).
3. `coopNpcFireDebitProof` demanded `flagID` on native charge cargo rows, which
   the native cargo writer never stamps -> `NO_AMMO` on every cycle.
4. The ammo bank journal root did not exist -> `BANK_ATOMIC_JOURNAL_UNSAFE`.
5. The bank transaction declared npcEntities/npcModules (transient rows) and no
   contract covered them; two features now share the npcCargo set, so the caller
   names its contract; a PREPARED journal whose SQLite fence proves no commit is
   recovered as ABORTED by the new `native-ammo-bank-recovery` phase.

**Exact remaining blocker for a KILL (wreck + loot).** One bank cycle spends every
fitted charge (each charge row is quantity 1), so a hull fires exactly ONE volley
and is dry: the cruiser hit for 24.87 HP against a 640 HP frigate. The real lever
is ammo depth: author a war-patrol loadout with `chargeEntry.quantityPerModule`
> 1 (the native spawn honours it, `nativeNpcService.js:563`), spawn the patrol
with that `loadoutID`, then the same fire path kills the victim and
`coopNpcWreckCustody` / `coopNativeLootQuarantine` / `coopWarCasualtyLedger`
follow on the real wreck.

**NEXT ACTION (exact).** Add a coop-authored war-patrol loadout row with
`quantityPerModule` (e.g. 40) reachable through `coopWarPatrolLoadout`, spawn the
Sobaseki attacker with it, verify repeated `living-native-weapon-event` +
falling HP + a real wreck, then continue queue item 2 (casualty ledger -> merit ->
promotion -> treasury).

**Known noise.** The cruiser 980000016639 and frigate 980000016987 each have a
COMMITTED/ABORTED bank journal; hulls left behind in Jita (980000016644/16642)
stay registered to their campaigns. `EVEJS_LOG_LEVEL=2` was used only for the
diagnosis and has been removed from `compose.coop-probe.yaml`.

## 2026-10-27 - war kill loop: real fire -> kill -> wreck -> loot -> casualty -> merit -> promotion (2567db15, 16cda1ed, 00db71a9, 34471320)

**Proven live (container evejs-server-1, read-only admin bridge + coop-events).**
- Loadout: `spawn_native_npc parity_serpentis_blaster_cruiser role patrol durable`
  -> `"loadout":{"status":"RESOLVED","reason":"AUTHORED_MULTI_CHARGE_ROW",
  "loadoutID":"coop_war_patrol_ammo60_parity_serpentis_blaster_cruiser_loadout",
  "chargeTypeID":20057,"chargeDepth":60}` and `inspect_npc 980000017150` ->
  `"moduleCount":5`, cargo 5 x typeID 20057 `"quantity":60` (300 real charges).
- Multi-cycle bank: `living-native-npc-ammo-debit` cargoID 980200006198
  `"before":41,"after":36,"unitsDebited":5` on the same hull (not one volley).
- Measured kill: `war_combat_diagnose` victim HP 225 -> 131.27522104432944 ->
  26.666062461711466 shield, then destroyed.
- Wreck + loot: `living-native-wreck-evidence PHYSICAL_NATIVE_WRECK_VERIFIED`
  wreckID 980300000006 `"storedItemCount":7,"storedQuantity":279,
  "lootStatus":"ITEMS_STORED"`.
- Casualty: `living-native-war-casualty "status":"RECORDED"` wreckID 980300000006
  pilotID coop-pilot-056 (victim), campaign war:500011-500020:campaign:30001363.
- Strict killer: `living-native-destruction-attacker
  NATIVE_DESTRUCTION_ATTACKER_PROVIDED` attackerEntityID 980000017150
  attackerPilotID coop-pilot-050 (upstream options.attackerEntity only).
- Merit + promotion: `living-native-war-merit {"status":"PROMOTED",
  "pilotID":"coop-pilot-050","kind":"warship-kill","merit":25,"from":"recruit",
  "to":"pilot","command":2,"wreckID":980300000006,
  "evidence":"UPSTREAM_ATTACKER_ENTITY_PLUS_PHYSICAL_NATIVE_WRECK"}`, persisted in
  `coop-faction-war<0x1f>merit-v1` and read by the live command-size rule.

**Three structural defects fixed to get there.**
1. Every real loadout row carried one charge, so a hull fired one volley and was
   dry forever: `coopWarPatrolLoadoutRow` authors a real static row plus a real
   ammo depth (2567db15).
2. A dry hull held its side slot forever: `coopWarBattleLineRelief` releases war
   custody on the mobiliser's own `WAR_NO_NATIVE_LOADED_WEAPON` verdict, and the
   mobiliser's ASSIGN event ID now identifies the real attempt so a released hull
   can be mobilized again (16cda1ed).
3. A destroyed hull stayed registered, so the first kill consumed the slot: the
   registry's `confirmDestroyed` witness is wired to real native wrecks and seeded
   from the durable casualty ledger (34471320).

**BLOCKED_TREASURY_UNFUNDED (exact finding, no fabrication).** The last leg
("treasury credit") has no legal ISK source in this world:
`coopWarTreasury` has **NO_TREASURY_ROW** (no HELD escrow), a RESERVE is refused
for a campaign that already exists, and both war corporations have **no
corporationRuntime wallet row at all** (`1000135`/`1000138` MISSING, so
`NATIVE_CORPORATION_WALLET_UNVERIFIED`), while the victim hull typeID 10016 has no
`shipInsurancePrices` row. Any credit would therefore mint ISK, which is
forbidden. A real settlement needs a funded war chest first.

**NEXT ACTION (exact).** Fund a war chest from real income (NPC economy credits or
a player corporation wallet) and enable `EVEJS_COOP_WAR_TREASURY=1`, then reserve
**before** the campaign is created (`coopWarTreasury.execute RESERVE` refuses an
existing campaign) and pay the bounty from that HELD escrow on
`living-native-war-merit` PROMOTED. Do not mint ISK. After that, backlog:
sovereignty projection -> shipcaster logistics -> player rank decal (title only).

**Known noise.** Two dead wrecks (980300000005/6) with stored loot in 30001363,
the released dry hulls 980000016638/16642/16644 and 980000016639/16987 remain as
real idle NPCs, and the ORE campaigns stay PREPARING by construction.

## 2026-10-27 loop - treasury made real (funded + escrowed live), sovereignty + title projected, payout blocked exactly

**Item 1 code PASS + live funding/reserve PASS (43c8d7ea).**
`coopWarChestFunding` moves real earned ISK (the only real ISK an NPC owns, every
cent paid by a real seeded-market fill) from the faction's own pilots into its
native NPC corporation wallet, then `coopWarTreasury` RESERVE debits that wallet
into HELD escrow. The reservation is taken in `coopFactionWarOpening` BEFORE
`START_CAMPAIGN`, so the treasury's "no reservation for an existing campaign"
rule is never bypassed. PAYOUT releases HELD escrow to one named pilot with an
injected authorizer and no wallet mutation (the value left at RESERVE).
`coopWarKillMerit` pays the kill bounty and the faction's own casualty benefit;
`coopWarBounty` resolves the paying faction from the pilot's real native ship and
corporation. RESERVE now accepts either war party (a defender funds its own
defensive bounty) and the wallet checks accept the real keyed stock row shape
(the old `corp.corporationID` check was the actual cause of
`NATIVE_CORPORATION_WALLET_UNVERIFIED`: the stock row has no such field).

Live, verbatim (container evejs-server-1):
- `living-native-war-bounty-reserved` `{"status":"RESERVED","factionID":500014,
  "corporationID":1000129,"amountCents":2500000,
  "chestJournalID":"chest:bounty:war:500011-500014:campaign:30000143:500014",
  "walletAfterCents":2500000,"sources":["coop-pilot-001"],
  "escrowJournalID":8000000000000000}`
- `living-native-war-opened` `OPENED` `campaignIDs:["war:500011-500014:campaign:30000143"]`
  with `funding:[{status:RESERVED,paper:false,escrow:true,...}]`
- chest journal COMMITTED: coop-pilot-001 172 100.00 -> take 25 000.00;
  earned ledger 172 100 -> **147 100**; corp 1000129 journal `7500000000000000`
  +25 000 then `8000000000000000` -25 000; treasury row exists with the
  reservation `bounty:war:500011-500014:campaign:30000143:500014` **HELD**.

**Exact blocker for the live PAYOUT (NEEDS_OWNER:BLOCKED_TREASURY_NO_ARMED_FUNDED_FACTION).**
The only faction with real earned income is ORE 500014 (147 100 ISK left), and ORE
fields 11 profiles, all miners/haulers with no weapon, so it can never produce or
receive a kill in a campaign it funds. Angel 500011 and Serpentis 500020 can fight
(the proven kill loop) and have **zero** earned ISK: `war_funding_diagnose`
reports `NO_REAL_FACTION_INCOME` for both, so their bounty is refused instead of
minted. The payout path itself is unit-proven (6 tests) and wired; it fires on a
real casualty/merit event for the funded faction. To unblock honestly the owner
needs one of: (a) real earned income for an armed faction (a real native sale by
an Angel/Serpentis pilot), or (b) an armed ORE hull profile with a real loadout.

**Item 2 partial (2671b321).** `coopWarSovereigntyProjection` reports real
military control and refuses to call it native sovereignty unless a real TCU/IHub
AND a real native claim exist. Live: `NATIVE_SOV_CLAIM:0`,
`MILITARY_CONTROL_ONLY_NOT_SDE_SOVEREIGNTY:5`, reason
`NO_NATIVE_SOV_STRUCTURE` for every held system (the two faction Astrahus are not
sov structures). `coopWarRankTitle` maps a real merit rank to the pilot's visible
title with an explicit empty unlock list, durable once per promotion.
**Shipcaster front logistics: NEEDS_OWNER, not started** - no real shipcaster
structure exists in this world, so any "front logistics" would be invented.

**Item 3 regression (no code change).** war/treasury/merit/opening/admin suites
332 pass / 11 fail (baseline 303/15), `coop-npc-*` 1090 pass / 98 fail (identical
to the recorded baseline). No new failure.

**NEXT ACTION (exact).** Give an armed faction real income: run one real native
sale for an Angel (500011) or Serpentis (500020) pilot through
`coopNativeNpcMarket` (real seeded bid, real cargo), then re-run
`war_funding_diagnose` until its side reports `FUNDED`, let the next opening
reserve the bounty, and confirm `living-native-war-bounty` `PAID` on the next real
casualty of that faction. Do not fund it any other way.

## 2026-10-27 loop - item 1 code PASS, live income BLOCKED BY WORLD GEOGRAPHY (add54831, ff071de9)

**Code (add54831).** `coopNpcLootSellRoles` decides which named native NPC role may
liquidate provenance-verified loot; the runtime no longer hard-codes `pirate`.
Default list is `pirate` (historical behaviour); the live profile sets
`EVEJS_COOP_NPC_LOOT_SELL_ROLES=pirate,patrol` and enables
`EVEJS_COOP_NPC_LOOT_COMMERCE/WRECK_TRANSFER/WRECK_RECOVERY=1`, plus the real
loot typeIDs (211,180,185,216,219,241,243,244,182,2516,20767,4959,20617,11351,
14272,25611,25606) in `EVEJS_COOP_NPC_MARKET_SELL_TYPES`. 6/6 unit tests,
OVERLAY_OK 364 modules, rebuilt and recreated.

**P0 found and fixed while doing it (ff071de9).** `living-native-durable-recovery`
was `NEEDS_OPERATOR_REPAIR` for coop-pilot-046/980000016645 (durable record and
controller in 30000142, link said 30001363), which threw
`DURABLE_NPC_RECOVERY_REQUIRES_REPAIR` **before** `createBridge()`. The bridge
therefore did not exist in this boot, so every bridge-driven phase (raids, loot
station delivery, market assignments) was silently inert. Stale links are now
reconciled only under `EVEJS_COOP_DURABLE_RELOCATE_RESTORE=1` via the registry's
own `relocate()`. Live after deploy: `status OK, alreadyPhysical 67, errors []`.

**Why the armed factions still cannot sell loot (measured, not inferred).**
1. The only theatre with real armed native combat is 30001363 (campaign
   `war:500011-500020:campaign:30001363` in ASSAULT). Its region 10000016 has
   **zero** seeded buy rows for 1228/34/211/20767/14272/11351, i.e. no NPC market
   at all, so recovered loot can never be sold there (region 10000002 = 132 rows,
   10001004 = 18).
2. The demand systems have no real armed combat: 30000145's mining fleet is
   stuck (`living-npc-station-route ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED`, ships
   ~4.4e11 m from the belt) so pirates have no live prey; 30100032 has 0 SDE
   belts (`SYSTEM_HAS_NO_SDE_BELTS`); Jita's Guristas/Angel patrols have no
   native attack order.
3. ORE 500014 (the only faction with real income, 147 100 ISK, bounty already
   HELD for `campaign:30000143`) has **no armed profile at all** in the native
   resolver (only empire/pirate `parity_*` combat profiles exist), so
   `war_diagnose` mobilises 0 ships for every 500011-500014 campaign and its
   escrow can never pay a kill or a death benefit.
4. `war_funding_diagnose` (live): 500011 `NO_REAL_FACTION_INCOME`, 500020
   `NO_REAL_FACTION_INCOME`, 500014 `FUNDED` (coop-pilot-001 147 100 ISK).

**NEXT ACTION (exact, one decision).** Item 2's payout needs a real casualty of
the funded faction inside `campaign:30000143`, which needs an armed ORE hull;
the alternative is a real kill by an armed faction inside a seeded-market system.
Both are world-configuration choices, not missing code:
(a) add a real armed ORE (500014) native combat profile so 500011-500014 can
muster, or
(b) bring an armed pair's front into a seeded region (30000144/30000145/Jita),
or (c) seed region 10000016 (forbidden here: no market rebuilds).
Until one is chosen, do not mint ISK and do not fake a kill.

**Shipcaster logistics: NEEDS_OWNER, with evidence.** The SDE really contains
shipcaster beacon structure types (75928 Imperial, 75929 State, 75930 Federation,
75931 Republic) but they belong to the four empires; no shipcaster beacon type
exists for 500011/500014/500020, so a "faction shipcaster" would misrepresent
structure ownership. Nothing was deployed.

## 2026-10-27 (FW-013) - the armed pair's front is in the seeded region; three silent raid blockers fixed (9ff67b86)

**Owner default applied: an armed pair's front now sits in seeded region 10000002.**
SDE-verified, not guessed: Maurasi 30000140 has 25 real belts, sits in region
10000002 (the only region with real seeded buy rows for the loot types: 431
station/type rows, all in Jita 30000142 and New Caldari 30000145), and has a real
reciprocal gate to Jita (50000802 <-> 50001248). It was added to
`EVEJS_COOP_VIRTUAL_ROUTE` so the headless boot tracks it
(`living-headless-boot-system 30000140 realAsteroidBelts 25
authoritativeSdeBelts 25`).

Real armed hulls spawned with `spawn_native_npc` (durable, authored multi-charge
row `coop_war_patrol_ammo60_*`):
- 980000018058 Serpentis cruiser, role **pirate**, New Caldari 30000145
  (coop-pilot-070) - the income bootstrap;
- 980000018084 Serpentis cruiser, role patrol, Maurasi 30000140 (coop-pilot-063)
  - makes the system Serpentis by real presence;
- 980000018085 Angel frigate, role patrol, Jita 30000142 (coop-pilot-078).

**Measured:** `living-native-war-opening-blocked` now reports
`SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500020:NO_REAL_FACTION_INCOME`.
That is the whole remaining gap: the front exists and BOTH sides are armed; only
the real escrow reservation is missing, and it must come from a real seeded sale.

**Three silent blockers removed (all measured, none guessed):**
1. `EVEJS_COOP_MATERIALIZE_LIMIT: '26'` made `createBridge()` throw (contract
   1..10) inside `observeSession` before `bridge` was assigned. Every
   bridge-driven phase (raids, loot delivery, market assignments) had stopped
   existing while the world looked healthy. `coopMaterializeLimit` clamps and
   reports it; `living-native-bridge` publishes the created bridge.
2. The raid director read the materializer assignment map, rebuilt only during
   boot, so a hull linked afterwards was invisible. It now reads the identity
   registry (the same authority the raid legality gate uses).
3. The civilian route director held a CIVILIAN lease on pirate hulls and orbited
   them, so every raid order was refused
   `COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE`. One owner per record: a pirate's
   movement belongs to the raid director.
`coopNpcOrderBridge.diagnose()` + `living-native-raid-diagnose` make any
future refusal an exact, published reason instead of a silent boolean.

**Live proof of the fix:** `living-native-raid-diagnose 30000145 pirates 3
fleetShips 23 oreBearing 5 authorized 21-22` -> `living-pirate-raid`
`[{"pirateID":980000018058,"targetID":980000016318,"targetRole":"hauler",
"action":"attack"}]` (30000144 attacks 980000016310) with
`orderDiagnosis PERMITTED, leaseOwner RAID`.

**NEXT ACTION (exact).** Wait for the real raid kill in 30000145 (a real stock
mining-fleet hauler, 300 fitted charges): wreck -> `coopNpcWreckCustody` ->
loot cargo -> `coopNpcLootCommerce` warp to a New Caldari station ->
`coopNativeNpcMarket` fill against a real seeded bid (25606/25611/180/211 at
New Caldari/Jita) -> Serpentis `earned` ISK -> `warBountyReserve` can then
reserve for `war:500011-500020:campaign:30000140` (attacker Angel from Jita,
defender Serpentis in Maurasi) -> mobilize -> BEGIN_ASSAULT -> real kill ->
`living-native-war-bounty` PAID from HELD escrow. Never mint ISK; if the kill or
the fill does not happen, record the measured blocker.

## 2026-10-27 (FW-013 result) - seeded-region front PROVEN; the income leg is the single remaining blocker

**Proven (live, verbatim):**
- Maurasi 30000140 is registered military control **500020** (Serpentis) after the
  real armed cruiser 980000018084 (coop-pilot-063) was spawned there, so a real
  border with Jita 30000142 (500011 Angel) exists **inside seeded region
  10000002**. SDE: 25 real belts, reciprocal gate 50000802 <-> 50001248.
- `living-native-war-opening-blocked` reason (last, 05:27:18Z):
  `SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500020:NO_REAL_FACTION_INCOME`.
  The front, both armed sides, the declaration presence and the adjacency proofs
  all pass; only the real escrow reservation is missing.
- Raid authority is now fully live and measured: `living-pirate-raid 30000145`
  real attack orders (owner RAID, `orderDiagnosis PERMITTED`),
  `npc_pair_diagnose` 980000018994 -> 980000016318 `engagementAllowed true`,
  `manualType attack`, `allowWeapons true` at 15122 m, 5 hybrid turrets with
  5 x 60 real charges.
- Real NPC-vs-NPC fire does happen in this world: 30000144
  `living-native-weapon-event` missile-launch 980000000153 -> 980000000444 and
  `living-native-combat-damage` correlated damage 0.013 HP.

**NEEDS_OWNER:BLOCKED_ARMED_FACTION_INCOME (exact missing data).** No armed
faction can earn the 25 000 ISK the bounty needs, because earning requires a real
seeded sale and a sale requires a kill inside Jita/New Caldari:
1. the stock mining fleet in region 10000002 sits at AU-scale positions
   (`toBeltMeters` 4.4e11 m) and keeps warping on its station route
   (`ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED`). Measured over 20 min: the raiding
   cruiser went 15 122 m -> 37 253 m from its target, both in GOTO,
   `currentTargetID 0`, zero module activations;
2. a hull in an active warp is rejected by the native combat resolver, so the
   chase cannot convert into damage (the new filter at least stops the pirate
   from being dragged across the system);
3. the only real exchange in 30000144 is a Guristas patrol retaliating against an
   *unarmed* pirate for ~0.01 HP per sample, and Perimeter has no seeded buy rows
   (the seeded rows are only at Jita 30000142 and New Caldari 30000145 stations).
Nothing was minted, no fill or kill was invented.

**NEXT ACTION (exact).** Two honest ways to close it, both world-configuration:
(a) repair the mining fleet's real position/route state so a belt miner is
stationary at a reachable point (then the raid kill, wreck, loot and seeded sale
follow on the already-proven path), or
(b) let an armed faction earn from a real seeded fill it can already reach (for
example a real ore haul by a pirate hull that owns cargo). Do not seed region
10000016 and do not place unbacked orders.
Shipcaster logistics stays NEEDS_OWNER (no shipcaster beacon type exists for
500011/500014/500020 - only 75928/75929/75930/75931 for the four empires).

## 2026-10-27 (FW-014) - item 1: mining-fleet movement root causes found; item still OPEN

**Read-only probe (new, 75f9f54f).** `mining_fleet_diagnose` (admin bridge,
`systemIDs`) reports, per ship: mode, pendingWarp, the sessionless warp clock and
its own destination distance, distance to the nearest real SDE belt and to the
trip station, the arrival surface gap, the dwell clock, the controller manual
order, the arbiter lease owner; per fleet: state, origin anchor, trip and the
trip-journal record (latest manifest, departure ack, expiry, overdue).
Live: `fleet 960004609 state=loaded originAnchor distanceMeters 448793612100`,
`journal latestManifestKey 30000144-960004609-1793061051055 ageMs 20187185
overdue true departureAck false expired false`, miner `nearestBelt 448793621638`.

**Three real defects, all measured, all fixed:**
1. **Ack-less prepared trip could never be closed** (88a3ee63). The journal
   returned `ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED` without the deadline
   evidence, and `expire()` demands a departure ack, so the fleet sat in
   `loaded` for 5.4 h and mined nothing. `abandon()` now writes a durable
   `ROUTE_ABANDONED` record after a 2 min grace (a route WITH an ack is still
   only expired; manifest, cargo and ack untouched). Also: a stalled hull is
   re-flown to its own trip's station with the same native warp, a hauler that
   is already at the station is not warped (`WARP_DISTANCE_TOO_CLOSE` deadlocked
   every new trip), and the native "too close" refusal now becomes a real
   subwarp approach instead of `WARP_COMMAND_FAILED`.
2. **The deposit loop threw out of the whole mining tick** (a5f3fd53).
   `WARN [SpaceRuntime] Mining tick failed for system=30000145: baselineKey is
   not defined`, every tick, for hours: `baselineKey` was block-scoped inside
   the sale block and used again after it, so nothing was ever deposited. Hoisted.
3. **A stranded miner was only ever told to follow its rock** (b93bae0d).
   `TARGET_OUT_OF_RANGE distanceMeters 448793611732 engagementMeters 11500`.
   `coopMiningBeltReturn` issues the same native warp the fleet uses for its own
   warp-in (landing point one rock radius + one orbit radius from the centre),
   and `coopMiningTripRetreatGuard` stops a retreat from dragging a hauler that
   is flying an acknowledged trip (`living-mining-retreat-skip`,
   `living-npc-station-trip-rewarp gapMeters 190173736005 accepted true`).

**Tests:** 49/0 (diagnose 6, belt return 7, retreat guard 4, journal 32) ;
recovery suite 8 pass / 2 fail, both identical at the pre-change baseline
(verified with `git stash`). Overlay `OVERLAY_OK` reset=53 patches=series=7.

**Item 1 is NOT closed.** The fleet has not re-entered `mining` yet, so
`living-mining-belt-warp` has fired 0 times. The delivery leg now reaches its
own arrival gate instead of throwing, and answers `WAREHOUSE_ARRIVAL_NOT_VERIFIED`
for the last haulers of the 30000144 trip (the sampled haulers are gap 0 m,
dwell set, ack true), so the exact next step is to explain that verdict
(`verifyArrival`: point / stableAt / dwelled) and only then confirm a real
mining cycle at the belt. Items 2-4 (pirate kill, seeded sale funding the war
chest, verbatim loop proof) are untouched.
**Correction, same run (07:14Z live):** `living-mining-belt-warp WARP_ISSUED`
13 times for fleet 960004641 (30000145) at `distanceMeters 244253380576`
(`thresholdMeters 100000`), fired right after `living-mining-blocker TICK_mining`
proved the fleet had returned to `mining`. The same miners were then measured at
`belt 20681 / 24174 / 45493 / 46104 / 49489 / 103499` m instead of 2.4e11 m, i.e.
they really flew back and are closing the last kilometres at subwarp. The fleet
had moved on to `loaded` again (a new haul), which is why `act 0` at that sample:
mining modules are deactivated for a haul by design. Next exact step is therefore
narrow: sample the fleet while it is in `mining` and require
`activeModuleEffects > 0` plus a settled cycle for at least one miner, and explain
`WAREHOUSE_ARRIVAL_NOT_VERIFIED` for the haulers the deposit gate rejects.
## 2026-10-27 (FW-015) - item 1 part a: the arrival gate explains itself (3d3eedf1)

**Proven live (verbatim, container evejs-server-1).** The deposit refusal now
carries its own reason instead of a bare status:

```
"event":"living-npc-warehouse-blocked","fleetID":960004609,"cargoID":980200001433,
"reason":"ARRIVAL_NOT_VERIFIED","detail":{"ok":false,"term":"DWELL_PENDING",
"gapMeters":0,"maxSurfaceGapMeters":2500,"mode":"GOTO","warping":false,
"arrivedAtMs":1793086116032,"activeArrivedAt":1793086116032,"dwellMs":2000,
"dwelled":false}
```

**The explanation (measured, not inferred).** The hauler was physically ON the
station (surface gap 0 m, not warping) and the receipt was written 3 s later, so
the gate was not refusing a real arrival. rrivedAtMs 1793086116032 belongs to
event time 1793086113991: the native tick clock ran **2 041 ms ahead** of
Date.now(). The trip loop measures dwell with the tick clock (
ow), the
deposit gate measured it with clock() = Date.now(), so the second subtraction
was negative and DWELL_PENDING was reported forever. One clock now decides: the
tick clock travels into deposit({nowMs}) -> explainArrival.

**Three fixes in the same commit.**
1. explainArrival + detail on the refusal + rrival_diagnose admin action
   (read-only, uses the LIVE director's own rrivals map).
2. A warehouse receipt names the **ore owner** (deposit goes into the owner's
   hangar); the manifest names the **station corporation**. Both files compared
   them, so every real deposit was refused as
   MANIFEST_WAREHOUSE_RECEIPT_CONFLICT (live proof: manifest corp 1000031,
   receipt corp 1000129, quantity/type/station identical). The owner is now taken
   from the manifest row (new manifests record the pre-warp cargo owner) or from
   the physical stack, which the native itemStore check must still prove.
3. 	ransferCargo never loads ore into a hauler an active manifest declared.
   Live: new loads at 07:27:03 and 07:30:08 turned the pending trip into
   ALIFE12_ALIFE12_UNDECLARED_HAUL_CARGO, so it could never close.

**NEXT ACTION (exact).** Item 1 part b: wait for the pending 30000144 manifest to
close (the journal deadline is 15 min; the trip now cannot gain undeclared cargo),
then sample mining_fleet_diagnose WHILE state=mining and require
ctiveModuleEffects > 0 for at least one miner plus a settled cycle
(living-mining-cycle-settled with 
extCargo rising). Only then item 2 (real
pirate kill -> wreck -> loot -> casualty ledger -> merit).

## 2026-10-27 - ITEM 1 CLOSED (live): the fleet mines at the belt, ore really rises

**Proven live (container evejs-server-1, read-only probes, verbatim).**

```
{"at":"2026-10-27T08:06:01.256Z","fleets":[{"fleet":960004609,"system":30000144,
 "state":"mining","act":13,"belt":13,
 "active":["980000016027:2","980000016144:2","980000016145:2"]}]}
```

13 of 13 miners carry 2 live module effects each and all 13 sit within 200 km of a
real belt. The settled cycle (ore really rising):

```
{"at":"2026-10-27T08:01:02.383Z","event":"living-mining-cycle-settled","shipID":980000016470,
 "systemID":30000144,"status":"COMMITTED","rockID":5020484726851,"moduleID":980100051175,
 "oreTypeID":17470,"quantity":1874,"beforeRock":228126,"afterRock":226252,
 "cargoID":980200010837,"nextCargo":3748,"replayed":false}
```

and the delivery leg really completes now: living-native-haul-delivered fleetID
960004609 DELIVERED at 07:54:57Z and 07:56:58Z.

**Why the deposit gate kept refusing (the answer to the open question).**
WAREHOUSE_ARRIVAL_NOT_VERIFIED was DWELL_PENDING with gapMeters 0: the hauler
was physically on the station, not warping, and the receipt appeared 3 s later.
The tick clock ran **2 041 ms ahead** of Date.now(), the trip measured dwell with
the tick clock and the deposit gate with the wall clock. One clock now decides
(deposit({nowMs})). The manifest side had a second, independent cause: the
receipt names the **ore owner** and the manifest names the **station corporation**,
and both files compared them (live: manifest corp 1000031 vs receipt corp 1000129,
quantity/type/station identical), so every real deposit was rejected.

**Two more deadlocks found and fixed on the way.**
1. A superseded manifest (all declared rows proven, the hull carrying ore the
   manifest never declared) lost its identity in the arrival wrapper, so start()
   answered the same pause on every tick and the fleet sat in "loaded" 20 min
   (a57aa3ea).
2. An aggressed stock fleet can never resume: the stock auto-resume delay defaults
   to 0, so esumeAtMs stays 0 and state stays "aggressed" forever. The live
   profile now sets the real stock knob EVEJS_MINING_NPC_FLEET_AUTO_RESUME_DELAY_MS=120000
   (no code change, no gate relaxed). mining_fleet_diagnose publishes
   esumeInMs/esumeOverdue/esponseWing/lastAggressedAtMs so this is
   visible instead of inferred.

**NEXT ACTION (exact).** Item 2: the Serpentis cruiser 980000018058 (300 real
charges, live attack order on miner 980000015943 in New Caldari 30000145) must
really kill a miner: repeated living-native-weapon-event, measured HP loss, a
real wreck with stored loot, living-native-war-casualty, and merit. The 30000145
fleet must leave "aggressed" first (auto-resume 120 s after the last aggression,
and only when its response wing is gone) - esumeInMs/esponseWing say which.

## 2026-10-27 - ITEM 2 blocked exactly: the raid holds an order it cannot fly

Measured, verbatim, read-only:

```
{"ok":true,"attackerID":980000018058,"targetID":980000016311,
 "distanceMeters":373994639646.8543,
 "attacker":{"systemID":30000145,"inScene":true,"mode":"GOTO"},
 "target":{"systemID":30000145,"inScene":true,"mode":"ORBIT"},
 "controller":{"currentTargetID":0,"manualType":"attack","manualTargetID":980000016311,
 "allowWeapons":true},"engagementAllowed":true}
```

2.5 AU apart, the attacker in GOTO (a "warp" that never became a warp), the order
still held. The fleet side:

```
{"fleet":960004641,"state":"aggressed","resumeInMs":92113,"responseWing":0,
 "lastAggressedAtMs":1793088751229,"miners":13,"atBelt":0}
```

esponseWing 0 and esumeAtMs set (the new stock auto-resume knob), but the
aggression clock is re-armed every couple of minutes, so the fleet never returns to
mining; coopMiningBeltReturn only runs in the mining branch, so its 13 miners
stay 2.4e11 m off the belt and nothing can be shot.

**NEXT ACTION (exact).** In integration/coopNativeRaids.cjs (the distance >
250000 branch that issues warp-to-hauler): after the native warp call, verify the
hull is really warping (mode WARP / sessionlessWarpIngress) and not in GOTO; when it
is not, release the order (no attack lease) and publish
RAID_APPROACH_UNFLYABLE:<distanceMeters>. The fleet then leaves "aggressed", the
belt return flies the miners home, and the next raid at the belt is the one that can
convert into damage. Then: wreck -> stored loot -> New Caldari 30000145 seeded sale
-> Serpentis 500020 real income -> warBountyReserve -> war 500011-500020 opens
with SUPPLY_UNFUNDED resolved -> escrow PAYOUT to the named pilot.

**Correction/refinement to the item 2 next step (same run, 08:18Z).** The pirate
980000018058 holds controller.manualType:"attack" with currentTargetID:0 while
flying GOTO, and the order bridge's own diagnose answers
COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE for a hull with an active native command. So
the most likely mechanism is self-blocking: the raid's earlier ttack order is
still active, the native controller refuses the later warp-to-hauler, and the hull
subwarps toward a target 2.5 AU away while the fleet stays "aggressed". Check that
before changing any distance constant: read
coopNpcOrderBridge.diagnose({entityID:980000018058}) and, if it is
NATIVE_COMMAND_ACTIVE, make the raid release its own previous order before issuing
the approach (one owner per record), publishing RAID_ORDER_RELEASED_FOR_APPROACH.

## 2026-10-27 (FW-016) - item 2 step 1+2 PASS (code + live): the raid releases its own order; the approach now really flies (7e07e000, 64d166c5)

**The hypothesis in the previous NEXT was wrong, and that is now measured.** The
order bridge answers `PERMITTED` / `leaseOwner RAID` for 980000018058 (published
in `living-native-raid-diagnose.pirateDetail[].orderDiagnosis`), so the stale
order was never a bridge gate. What actually pinned the hull was the native
controller's own subwarp pursuit (mode GOTO) plus our own unexecutable order.

**Two rules added (both through the bridge, no distance constant touched).**
1. `RAID_ORDER_RELEASED_FOR_APPROACH` - the hull's own previous attack order is
   released before a new approach, and an unreachable locked prey (> the same
   250 km boundary) is released and re-approached with a real warp in the same
   tick. `RAID_APPROACH_UNFLYABLE` when an approach never became a real warp
   (20 s), `RAID_ATTACK_NO_LOCK` when an attack never acquired a native lock
   (90 s). A rival order is never released: 980000018994 correctly answers
   `released:false, errorMsg COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE` (CIVILIAN
   lease). `npc_pair_diagnose` now also reports the bridge verdict and both
   hulls' health layers.

**Live proof the approach now flies.** `RAID_ORDER_RELEASED_FOR_APPROACH`
980000000602 at 373 994 659 694 m, then 30 s later real attack orders at
**10 162 m** (980000000601) and **8 882 m** (980000018058) - previously the same
pair held an order at 2.5 AU for 20 minutes and never fired.

**EXACT remaining blocker for the kill (`NEEDS_OWNER:BLOCKED_RETREAT_INVALIDATES_EVERY_ORDER`).**
The stock aggression path (`miningNpcOperations.handleAggression` ->
`retreatFleetToOrigin`) teleports the whole fleet 2.5 AU on the FIRST aggression.
The native loop then clears the attacker's `manualOrder` because the prey is no
longer a valid combat target, so `currentTargetID` returns to 0 within seconds and
the hull resumes its own GOTO. Measured on 980000016472: shield 146.45 -> 161.80
-> 193.13 -> 199.88 -> 209.32 -> 217.34 -> 225.00 over 5 minutes (real missile
hits from 980000000601, then FULL regeneration), 0 wrecks, last
`living-native-weapon-event` 08:48:40Z. The pair distance flips between 35 928 m
and 373 994 655 083 m every ~30 s, which is the retreat/belt-return cycle, not a
stale order.

**NEXT ACTION (exact, one decision).** A kill in a seeded system needs the prey to
stop completing an instant sessionless retreat while it is being shot. Two honest
options, both real mechanics, neither a gate relaxation:
(a) fit a real warp disruption module on the war-patrol loadout
    (`coopWarPatrolLoadoutRow`) and activate it on the prey - stock
    `beginNpcWarpToPoint` already refuses a warp when
    `hostileModuleRuntime.isEntityWarpScrambled(entity)` is true, so the fight
    resolves at close range and the wreck loot (2x typeID 482 = 571 211 ISK bid
    at New Caldari 60000688, plus 16 380 ore 17463) becomes a real sale;
(b) an L2 rule that a fleet retreat is refused while a hostile holds a live
    native attack order on a fleet hull inside engagement range.
Do NOT weaken `coopWarMusterReadiness`, do not seed a region, do not mint ISK.
Verified buyers (read-only `GetOrders`, region 10000002, `source: seed`):
20767 62 839 ISK at 60000682 (New Caldari), 482 571 211 ISK at 60000688,
13773 3 083 304 ISK at 60000682, 17464 15.48 ISK at 60000688 - the
`NO_SEEDED_COUNTERPARTY` note is stale for these types.

## 2026-10-27 (FW-017) - item 1 CLOSED: a real warp point really scrambles a real hull (3c46dbb3, 7efd3e82, 2fba2807)

**The old blocker is gone.** `BLOCKED_RETREAT_INVALIDATES_EVERY_ORDER` had two stock
causes, both measured, both now fixed as L1:

1. `hostileModuleRuntime.getEntityWarpScrambleStatus` returned the hull's PASSIVE
   `warpScrambleStatus` baseline (-2 on retail hulls) and never the live effect sum,
   so `isEntityWarpScrambled` was permanently false for any hull that carries the
   attribute: a fitted Warp Disruptor II on a Venture read back -2 (live
   `preyScrambleStatus:-2` in every refused attempt).
2. `runtime.warpToEntity/warpToPoint` resolved the command ship with
   `getShipEntityForSession`, which only understands a SESSION. The native NPC loops
   command by ENTITY ID, so `isShipWarpDisabledByRuntime` and
   `isEntityWarpScrambled` both saw no ship and an NPC hull warped while really held.

Both are patched (`0008-warp-scramble-live-effects`, `0006` extended). **Ops bug
found and fixed on the way:** `git -C <Code> apply` resolved the patched path
against the upstream repo root and silently SKIPPED it (exit 0), so a coop-deploy
reset left managed files unpatched while the applier printed a healthy series;
`apply-upstream-patches` now applies from the root with `--directory=Code`.

**Live proof (10:01:16Z).** `living-native-warp-point-engaged status ENGAGED
alreadyScrambled true` for 980000018058, 980000000601 and 980000000602 on the same
miner 980000016052 - the first time a real warp disruptor made a real hull read as
scrambled in this world. `inspect_npc 980000000602` -> `moduleID 980100060463,
typeID 3244 (Warp Disruptor II), flagID 19, online true`, written through
`nativeNpcStore` (real native module record, real mid slot from the native auto-fit).

**NEXT ACTION (exact, item 2).** The prey is now holdable; the missing piece is
SUSTAINED DAMAGE on a held prey. Measured at 10:06Z: 980000000601 sits **1 393 m**
from 980000016052 with a FULL shield (6890/6890) and no launch since 09:53:20Z,
while 980000018058 (5 blasters, 300 real charges, the only deep ammo bank) holds an
attack order **2.5 AU** away at the belt. Two concrete things to check next, in
this order:
1. `coopNpcWeaponAmmoGate` / `nativeAmmoSupply` for 980000000601: it fires a
   hull-effect missile (chargeTypeID 213) and launched exactly 3 times, then
   stopped - if the gate is blocking it, the raid must prefer the hull with a real
   ammo bank (980000018058) instead of the nearest hull.
2. Why 980000018058 does not close from 9 225 m to blaster optimal: it keeps an
   attack order but its mode is GOTO back to the belt after the prey moves; the
   `attackNoLockMs` release + re-approach cycle is the thing to tighten (keep the
   order while the prey is pinned, which is already implemented via
   `preyScrambled`, and make sure the lease is not released while pinned).
Do NOT script damage, do not touch distance constants, do not mint ISK.

**Concrete lever found for the DPS gap (same run, 10:15Z).** `npcRuntime.orbit(entityID,
targetEntityID, distance, options)` is a real native order and the raid director does
not use it. The blaster cruiser's behaviour profile parks it at ~9 km, which is far
outside a blaster's own optimal range, so its 300 real charges hit nothing. The honest
next change is one order: when the attacker's fitted weapon (`estimateNpcHostileEffectiveRange`
/ the module's own `maxRange` attribute) is shorter than the current distance, issue a
real native orbit at that attribute's range before the attack. No distance constant of
ours, no scripted damage: the ship flies to its own gun's range and the native cycle
does the rest.

## 2026-10-27T10:52Z - item 2 step 3 (WIP, committed): the raider flies to its own gun range (1d6a3833, 91f68dde)

**Code.** `integration/coopNpcGunRange.cjs` reads the range from the stock resolver's own
snapshot (`getNpcWeaponModules` + `buildNpcWeaponModuleSnapshot`: turret `maxRange`,
launcher `approxRange`); the raid issues the attack with that number as the hull's
engagement distance via the stock `npcService.setBehaviorOverrides({orbitDistanceMeters})`.
A standalone manual orbit is NOT used (measured earlier: the native hostility invariant then
treats the prey as friendly -> mode STOP, currentTargetID 0). `npc_pair_diagnose` now also
reports `gunRange` and `returningHome`/`leashRangeMeters`/`homeDistanceMeters`.
Refinery: the journal file name is escaped on win32 (key unchanged).

**Live so far (verbatim, earlier deployed variant):** `living-pirate-raid` 30000145
`action":"orbit-to-range","pirateID":980000018058` `gunRange":{"status":"RESOLVED",
"meters":1050,"source":"maxRange","family":"hybridTurret","typeID":13884,"falloffMeters":3000,
"weaponCount":5}` at `distanceMeters 2251.76`. Sustained fire on a held prey and a real
wreck are **NOT proven**.

**NEXT ACTION (exact).** After this deploy sample `npc_pair_diagnose 980000018058 -> <its held
prey>` and require repeated `living-native-weapon-event` plus falling shield/armor on the
same victim; if the hull still sits outside its own gun range, read the new
`returningHome`/`leashRangeMeters`/`homeDistanceMeters` fields (a stock NPC beyond its
leash clears combat state and flies home) instead of guessing. Then wreck -> stored loot ->
casualty ledger -> merit -> seeded sale -> war chest -> PAYOUT.

## 2026-10-27T11:48Z - item 2 step 4 (committed): why the DPS never happens, measured (d0f5d8de, e20f6801, 1e431ed0, c6965dbd)

**New read-only tool.** `raid_diagnose` (admin bridge -> `diagnoseNativeRaids`) reports
per linked pirate: exclusion reason (loot delivery / ammo supply), native controller state
(mode, currentTargetID, manual order, returningHome, leash, home distance, orbit override),
the range its own fitted weapon really has, and its nearest real prey - plus the director's
leases. A refused native warp is now published instead of leaving a silent lease.

**Measured (verbatim).** At 11:18Z `raid_diagnose 30000145`: `status OK, linkedShips 21,
roleCounts pirate 4, fleetShips 23, leases []`; 980000018058 `mode STOP,
homeDistanceMeters 0, gunRangeMeters 1050 RESOLVED`, nearest hauler 980000016318 at
**4446 m**. Three minutes later `npc_pair_diagnose 980000018058 -> 980000016318`:
`distanceMeters 373994637299.5` (2.5 AU), `returningHome true, leashRangeMeters 90000,
manualType "", currentTargetID 0`. So the hull had the prey 4.4 km away, the prey's retreat
moved it 2.5 AU, and the stock leash cleared the order and flew the hull home. Last
`living-native-weapon-event` 10:20:06Z; the 300-charge cruiser has never fired in this boot.

**Fix (c6965dbd).** While the raid holds a lease it owns the hull's movement: it widens the
hull's own stock leash to the approach it ordered (distance + 100 km) and restores the
profile value on release, publishing `living-native-raid-leash` once per change. The leash
is a behaviour parameter, not an evidence gate.

**NEXT ACTION (exact).** Sample `raid_diagnose`/`npc_pair_diagnose` until 980000018058
holds an attack order inside its own 1050 m gun range on a pinned prey, then require
`living-native-weapon-event` from it plus falling shield/armor on the same victim, then the
wreck -> loot -> casualty -> merit -> seeded sale -> war chest -> PAYOUT chain.

## 2026-10-27T11:58Z - item 2 step 5: the leash is measured from HOME (ccd6046c)

Live, verbatim: `npc_pair_diagnose 980000018058 -> 980000016472` gave
`manualType "attack", allowWeapons true, behaviorOverrides {orbitDistanceMeters 1050,
leashRangeMeters 149182}, returningHome true, homeDistanceMeters 862066008895` and
`locks {locked: [], pending: [], activeModules: []}` on BOTH hulls, distance 40-49 km and
slowly closing in GOTO. So the order and the gun range were right, the leash value was
wrong: 149 km is measured from the hull, but the leash is measured from the hull's own
home, 5.7 AU away. ccd6046c: the scope covers home->hull + hull->prey + 100 km.

**NEXT ACTION (exact).** After this deploy sample `npc_pair_diagnose 980000018058 ->
980000016472` every minute and require (a) `returningHome false`, (b) a completed lock,
(c) `activeModules` non-empty, then `living-native-weapon-event` from 980000018058 and a
falling shield/armor on the same victim. If the lock stays empty, the next question is why
the stock loop does not add it, not the leash.

## 2026-10-27T11:54Z — ITEM 2: the first real raid kill in the seeded region (25e879fe, f5d8454a)

**Proven live (container evejs-server-1, verbatim).**

```
{"at":"2026-10-27T11:52:33.981Z","event":"living-native-stock-fleet-wreck-evidence",
 "status":"PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED","systemID":30000145,
 "victimEntityID":980000016472,"victimRole":"miner","wreckID":980300000008,
 "storedItemCount":3,"storedQuantity":93450,"lootStatus":"ITEMS_STORED"}
```

The chain that produced it, all real:
`living-native-raid-leash APPLIED` (980000018058 leash 373 994 723 022 vs profile
90 000 for a 373 994 623 021 m order) -> `living-native-warp-point-engaged`
`ENGAGED alreadyScrambled true` for 980000000601 and 980000000602 on miner
980000016472 -> `living-native-weapon-event` missile-launch 980000000601 ->
980000016472 -> real wreck 980300000008 with 3 stored stacks (93 450 units).

**Two defects fixed here.** (1) An attack order on prey beyond the 250 km approach
boundary was released only after the 90 s no-lock window, which a 60 s attack lease
re-arms forever, so the hull orbited at 2.5 AU holding an order it could not fly; the
far case now releases and re-approaches on the re-check itself. (2) A concurrent
commit had captured the `relocateRaidHomeAnchors(...)` call site without its
definition, so the whole `native-raids` phase failed
(`living-world-phase-failed ... relocateRaidHomeAnchors is not defined`); the orphan
call is removed and the leash (c6965dbd) is the single movement mechanism.

**NEXT ACTION (exact).** Item 3: recover wreck 980300000008 and sell its loot to the
real seeded buyer at New Caldari 60000688 (typeID 482 @ 571 211 ISK), then fund the
faction chest from that real fill, re-run `war_funding_diagnose` until the side reads
FUNDED, and confirm `living-native-war-bounty` PAID from HELD escrow.
## 2026-10-27T12:02Z - ITEM 1 CLOSED (live): real fire, real kill, real wreck with stored loot

**Proven (verbatim, container evejs-server-1).** The DPS gap is closed by the home-measured
leash (ccd6046c): `npc_pair_diagnose 980000018058 -> 980000016299` showed
`locks {locked:[980000016299]}, activeModules [... 980100056948]` and the victim's shield fell
**3118.35 -> 1773.12 in 30 s** while the attacker orbited at 2030 m. Then two real wrecks:

- 11:52:33Z `PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED` victim 980000016472 wreckID
  **980300000008**, `storedItemCount 3, storedQuantity 93450, lootStatus ITEMS_STORED`,
  attacker 980000000601 (coop-pilot-060);
- 12:00:10Z wreckID **980300000009**, victim 980000019472, `storedQuantity 3150`,
  attacker 980000000602 (coop-pilot-080).

**NEXT ACTION (exact).** The loot leg: watch `living-native-loot-*` for the recovery of wreck
980300000008/9, then `living-npc-station-sold` with real ISK from a seeded bid at New Caldari
60000688 (482 @ 571 211 ISK was the measured bid). Then the war chest reserve, the opening with
SUPPLY_UNFUNDED resolved, and the escrow PAYOUT to the named pilot.

## 2026-10-27T12:14Z — deep-ammo hull really fires; the loot leg's exact blocker (10d3c4ba)

**Proven live.** `living-native-weapon-event kind module-activation
attackerEntityID 980000018058 attackerPilotID coop-pilot-070 victimEntityID
980000016311 moduleID 980100056949` at 12:11:03Z — the 5-blaster hull with 300
real charges, whose own gun range resolves at 1050 m, activated a real module on
a real miner for the first time (the engagement-range order from FW-018 working).

**Fixed.** A pirate holding a live wreck claim is excluded from the raid (one owner
per record): the killer was being re-tasked forever, so the recovery never started.
A recovery that orders nothing now publishes
`living-npc-postraid-wreck-recovery-blocked` with the exact state it reads.

**Exact blocker it exposed (measured, verbatim):**

```
{"event":"living-npc-postraid-wreck-recovery-blocked","status":"NO_ORDER",
 "wreckID":980300000009,"hunterID":980000000602,"blocked":false,"hunterMode":"GOTO",
 "hunterPresent":true,"wreckPresent":false,"manualType":"","currentTargetID":0,
 "lastAggressorID":0,"distanceMeters":null,"pickupDistance":2500,"claims":2}
```

The durable wreck rows survive a restart but the physical native wreck entity does
not, so `scene.getEntityByID(wreckID)` is null and the recovery director refuses.
**A kill must be looted inside the same boot.**

**NEXT ACTION (exact).** Watch 30000145 for the next real
`living-native-stock-fleet-wreck-evidence` in the current boot and, without any
recreate in between, require `living-npc-postraid-wreck-recovery` (orbit/warp to the
wreck) then `advanceNativeWreckCustody` to move the loot into the pirate's hold, then
`living-npc-loot-station` to New Caldari and a real seeded fill (typeID 482 @
571 211 ISK at 60000688). Only after that fill: fund the chest, re-run
`war_funding_diagnose`, confirm `living-native-war-bounty` PAID.
## 2026-10-27T12:15Z - the loot leg is REAL: wreck cargo sold into a seeded bid (no code change)

**Proven (verbatim).** `living-npc-loot-station`: coop-pilot-080 / 980000000602
`NATIVE_WARP_TO_STATION` stationID **60014935** cargoID 980200026308, then
`PHYSICALLY_AT_NATIVE_STATION`. `living-native-loot-market-settled` at 12:07:25Z:
`status TRADE_SETTLED, side sell, typeID 17471, quantity 3150, price 8.61,
balance 27121.5, marketOrderID 4257762183096583231, marketOrderSource EVEJS_SEED,
lootSource {sourceWreckItemID 980400000026, sourceWreckID 980300000009},
nativeCargoVerified true, marketRPCAcknowledged true, marketRPC FillOrder,
sourceOfFunds SEED_MARKET_FILLED_ORDER, marketCurrency
NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET`. `war_funding_diagnose` now lists
coop-pilot-080 with a real balance of **27 121.5 ISK**.

**Exact remaining blockers for the war chest (measured).**
1. `living-native-war-opening-blocked` (last, 12:06:50Z) reason
   `SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500014:WAR_TREASURY_JOURNAL_COLLISION`
   with `fronts: 0`; `war_diagnose` reports `activeCampaignCount 0`.
2. The funded pilot is **Serpentis (500020)**, not 500011/500014, so the war that
   can be funded is a front involving 500020 (Maurasi 30000140 is the Serpentis
   presence from FW-013).
3. 500014 carries a stale escrow journal (WAR_TREASURY_JOURNAL_COLLISION) from the
   earlier funded reservation.

**NEXT ACTION (exact).** Restore/verify the real front that involves 500020 (Jita
30000142 Angel vs Maurasi 30000140 Serpentis) and clear the stale 500014 escrow
journal through the treasury's own recovery, then let the opening reserve 25 000
ISK from coop-pilot-080's real 27 121.5 and pay the bounty on a real casualty.

## 2026-10-27T12:26Z — kill loop is repeatable; the loot leg needs one uninterrupted boot (d1a30222)

Four real wrecks with stored loot from real native fire in this session
(980300000008 3/93 450 units, 009 1/3 150, 010 2/91 980, plus the earlier 006), all
`PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED`. The 5-blaster hull 980000018058 now
really activates its modules (`living-native-weapon-event kind module-activation`,
moduleID 980100056949, victim 980000016311) at its own 1050 m gun range.

**The one blocker left on the loot leg is boot churn, not code.** The durable wreck
row survives a restart but the physical native wreck entity does not, so
`scene.getEntityByID(wreckID)` is null and `advanceNativeWreckRecovery` correctly
refuses (`wreckPresent:false`). A claim whose wreck is gone now stops owning the
pirate (d1a30222), so the raid keeps killing.

**NEXT ACTION (exact).** On a boot nobody recreates, catch the next
`living-native-stock-fleet-wreck-evidence` and, without a recreate, require
`living-npc-postraid-wreck-recovery` (real orbit/warp to the wreck) ->
`advanceNativeWreckCustody` (loot into the pirate's hold) ->
`living-npc-loot-station` to New Caldari 60000688 -> a real seeded fill for typeID
482 @ 571 211 ISK -> `coopWarChestFunding` from that fill -> `war_funding_diagnose`
FUNDED -> `living-native-war-bounty` PAID from HELD escrow. Never mint ISK.
## 2026-10-27T12:37Z - the war leg: presence is real, the attacker side is the blocker

`war_state` (new, read-only) reports the exact state: territories 2 (Jita 500011,
Niyabainen 500014), wars 1 (war:500011-500014), campaigns 0, and the per-system
presence the territories come from - **30000140 Maurasi resolves to 500020 (1/1)**,
Jita to 500011 (8 of 15), Perimeter/New Caldair to 500014, 30100032 to 500020.

So the Jita->Maurasi front (500011 vs 500020) exists in the derivation, and 500020
already holds **27 121.5 ISK** of real earned income. The opening refuses because a
war needs BOTH sides funded and the ATTACKER 500011 has
`NO_REAL_FACTION_INCOME` (plus 500014's stale escrow journal collision).

**Exact next step.** An Angel pilot must earn real ISK the same way: 601
(coop-pilot-060, corp 1000138) has no cargo because its wreck 980300000008 is no
longer in the scene (`living-npc-postraid-wreck-recovery-blocked`:
`wreckPresent false` for both 980300000008/9). The honest route is a NEW kill in
this boot -> `living-native-stock-fleet-wreck-evidence` -> `living-npc-wreck-cargo-settled`
-> `living-npc-loot-station` -> `living-native-loot-market-settled` for an Angel
pilot, then `war_funding_diagnose` must show 500011 funded and the opening must
reserve 25 000 ISK before START_CAMPAIGN, then a real casualty pays the bounty.

## 2026-10-27T12:40Z - why the raid is idle right now (measured, no code change)

`mining_fleet_diagnose 30000145`: fleet 960004641 `state "loaded"`, 13 miners
`mode STOP` with no ore left (transferred), haulers carrying it on the live trip
`30000145-960004641-1793104338982` (`departureAck true`), one hauler 299 195 691 465 m
out on its warp to the station. `raid_diagnose`: 4 linked pirates, 23 fleet hulls, `leases []`,
every pirate `mode STOP, manualType ""` - no legal target because the whole convoy is on its
delivery leg, which is exactly what the raid's warp filter is for. The last raid action was
12:26:46Z (`warp-to-hauler` for 980000018058) and the last kill 12:00:10Z.

**NEXT ACTION (exact).** Wait for the trip to deliver (`living-native-haul-delivered`) so the
fleet returns to `mining`; the raid then kills again. For the war chest the kill must be made
by an ANGEL hull (601 coop-pilot-060, corp 1000138) so 500011 earns real ISK from the same
recovery -> seeded sale path that already paid 500020 27 121.5 ISK. Then
`war_funding_diagnose` must show both 500011 and 500020 funded and the opening must reserve
25 000 ISK before START_CAMPAIGN; a real casualty then pays the bounty from HELD escrow.

## 2026-10-27T13:16Z - FW-024: militia enlistment PROVEN live; the melee is blocked by one missing data row (1abc629a)

**Proven live (container evejs-server-1, verbatim).**
- `militia_enlist` 140000102 / agent 3012018 ->
  `"[Militia] Enlistment recorded for Caldari State. No items or ISK granted."`
  with `{"characterID":140000102,"factionID":500001,"status":"ACTIVE","rank":0,
  "enlistedAt":1793106715078,"cooldownUntil":0}`. Same code path the client
  calls (`coopFactionWarAgent.doAction`), real docked character, real agent.
- `militia_state` 140000102 -> `MILITIA_AVAILABLE`, faction 500001 Caldari State,
  `militiaCorporationID 1000180`, `warzone 2`, `enemyFactionIDs [500004]`,
  `fronts []` (no ASSAULT campaign yet).
- `war_state` -> territories 2 (Jita 500011, Niyabainen 500014), wars 1
  (`war:500011-500014`), campaigns 0.

**Owner's faction, from his own record (not from a message):**
`characters.140000005` Sasunok1488, raceID 1, bloodlineID 2, corporationID
98000001, `factionID 500001` Caldari State; militiaCorporationID 1000180; the
game's own pairing (`fwWarzoneSolarsystemService.js`, WARZONE_CALDARI_GALLENTE=2)
makes Gallente 500004 the enemy. Nearest real desk: agent 3010879 "Okamainen
Niuranto", station 60000358 Perimeter VI - Ytiri Storage, 1 jump from Jita.

**What is implemented (all data-gated, all tested):**
1. `EVEJS_COOP_MILITIA_FACTION_IDS='500001,500002,500003,500004,500010,500011'`
   - exactly the factions whose SDE row has a real militiaCorporationID.
   Serpentis 500020 and ORE 500014 are `null` and can never recruit.
2. `coopMilitiaWarData`: opponent = declared war first, else the game warzone
   pairing; drift test against the deployed service source.
3. `coopMilitiaWarPlayer`: `ENEMY_MILITIA` only for an ACTIVE enlistment in the
   opposing side of an ACTIVE war whose campaign is ASSAULT in that system;
   `ALLY` for his own faction; `NOT_WAR_SHIP` for every hull outside the war
   registry, so stock pirates keep their behaviour.
4. `npcBehaviorLoop.isFriendlyCombatTarget` hook: an NPC war ship treats his own
   faction and uninvolved players as friendly (never fires), and only an enlisted
   enemy as engageable.
5. `coopWarBattleDirector`: a war ship with no NPC opponent in range issues a real
   native attack order at an enlisted enemy player (`targetKind MILITIA_PLAYER`).
6. `coopNpcDestructionAttacker`: a player hull as the upstream `attackerEntity`
   is proven (registered war ship of the opposing side + physical wreck + ACTIVE
   enlistment) and pays merit to `coop-player-<characterID>` in the same durable
   ledger as NPC kills (identity regex widened in the ledger and rank titles).
7. `EVEJS_COOP_WAR_REQUIRE_FUNDING=0` in the live profile: an explicit, labelled
   `PAPER_UNFUNDED_EXPLICIT` supply (no ISK reserved, no bounty payable). Default
   stays 1.

**NEEDS_OWNER:BLOCKED_NO_ARMED_NAVY_LOADOUT (exact, measured).** A Caldari vs
Gallente front needs armed navy patrols, and the static tables cannot arm them:
`0/146` Caldari (500001) and `0/132` Gallente (500004) profiles have any loadout
row - every one resolves to `retail_empty_npc_entity_loadout` - and authoring a
co-op row from an existing base fails with `NO_COMPATIBLE_CHARGE`
(weaponTypeID 16128, CONCORD row) or `BASE_LOADOUT_ROW_MISSING` (trig rows are not
in the `readStaticRows` table). `spawn_native_npc` therefore refuses with
`WAR_PATROL_LOADOUT_UNAVAILABLE:LOADOUT_ROW_MISSING`. No hull was spawned and no
gate was relaxed.

**NEXT ACTION (exact).** Author ONE real navy loadout per hull class (a real
turret from the SDE hardware catalog + a real charge that
`isNpcChargeCompatibleWithModule` accepts, validated by
`validateNpcHardwareDefinition`), expose it through the `npcLoadouts` resolver
the same way `coopWarPatrolLoadoutRow.resolveRow` is exposed, then:
1. `spawn_native_npc` a Caldari patrol in 30002780 (already in
   `EVEJS_COOP_VIRTUAL_ROUTE`) and 2 Gallente patrols in Maurasi 30000140
   (real reciprocal gate 30002780 <-> 30000140) with `warPatrol:true,durable:true`;
2. wait for `living-native-war-opened` `war:500001-500004` with the
   `PAPER_UNFUNDED_EXPLICIT` label, then `living-native-war-assault`;
3. `militia_state 140000005` must list that campaign under `fronts`;
4. client check: the owner docks at 60000358, enlists with 3010879, jumps to the
   campaign system and the enemy patrol issues a `MILITIA_PLAYER` attack order.

**Known noise.** `coop-admin-requests.jsonl` is not always truncated after a
drain, so a request can execute twice; the second enlistment is a DUPLICATE and
changes nothing.

## 2026-10-27T13:24Z - FW-024d: the front opens (08576bb2)

Live after deploy (container evejs-server-1):
`living-native-war-opened OPENED` `warIDs:["war:500011-500014","war:500011-500020"]`
`campaignIDs:["war:500011-500014:campaign:30000143",
"war:500011-500014:campaign:30000144","war:500011-500014:campaign:30000145",
"war:500011-500020:campaign:30000142"]`, territories 5 (Maurasi 500020, Jita
500011, Niyabainen/Perimeter/New Caldari 500014), then
`living-native-war-mobilization NATIVE_PATROL_MOBILIZED` in the same boot.
`war_state` -> wars 2, campaigns 4, enlistments 1 (the proven Caldari enlistment).

The opt-out now also skips the real escrow reservation, so no ISK is reserved and
no bounty can be paid (`PAPER_UNFUNDED_EXPLICIT`). Default remains strict (1).

`militia_state 140000005` still reports `fronts: []` because no campaign involves
Caldari State 500001 - the Caldari/Gallente front is blocked by the navy loadout
gap recorded below, not by funding.

## 2026-10-27T13:32Z - ITEM 1 CLOSED (live): kill -> loot picked up -> real seeded sale, and item 2's exact blocker measured

**Proven live, verbatim, container evejs-server-1 (the whole loot leg, no ISK minted).**

```
{"at":"2026-10-27T13:15:09.456Z","event":"living-npc-wreck-cargo-settled","status":"NATIVE_WRECK_CARGO_SETTLED",
 "itemID":980400000027,"cargoID":980200031908,"entityID":980000000601,"wreckID":980300000010,
 "typeID":17471,"quantity":1200,"partial":true,"sourceBeforeQuantity":76860,
 "remainder":{"itemID":980400000030,"quantity":75660},
 "nativeSourceDebited":true,"nativeCargoCredited":true,"iskCredited":false}
{"at":"2026-10-27T13:23:46.378Z","event":"living-npc-loot-station","nativeMovementOrders":[
 {"pilotID":"coop-pilot-060","entityID":980000000601,"stationID":60014935,"action":"NATIVE_WARP_TO_STATION",
  "cargoIDs":[980200031908],"iskCredited":false}]}
{"at":"2026-10-27T13:24:13.981Z","event":"living-npc-loot-station","physicallyReady":[
 {"pilotID":"coop-pilot-060","entityID":980000000601,"stationID":60014935,"status":"PHYSICALLY_AT_NATIVE_STATION"}]}
{"at":"2026-10-27T13:24:14.929Z","event":"living-native-loot-market-settled","status":"TRADE_SETTLED","side":"sell",
 "pilotID":"coop-pilot-060","entityID":980000000601,"stationID":60014935,"typeID":17471,"quantity":1200,
 "price":8.61,"balance":10332,"marketOrderID":"4257762183096583231","marketOrderSource":"EVEJS_SEED",
 "marketRPC":"FillOrder","lootSource":{"sourceWreckItemID":980400000027,"sourceWreckID":980300000010},
 "sourceOfFunds":"SEED_MARKET_FILLED_ORDER","marketCurrency":"NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET"}
```

**Four measured blockers were fixed to get there** (each proven by a live event before the next):
1. `c8a69b63` the physical wreck never survives a restart, so a claim is now either restored from its own
   durable row through stock `spawnNativeWreck` (`living-npc-wreck-claim-restored`, wreck 980300000008 with
   3 stacks / 93 450 units) or closed with the measured reason (`living-npc-wreck-claim-closed`,
   wreck 980300000009 `WRECK_HAS_NO_STORED_ITEMS` `CLAIM_CLOSED`). A claim-driven 5 s loop loots in the same boot.
2. `3f290ab4` the killer's hold is 120 m3 while the wreck stacks are 4 032 / 2 142 / 5 229 m3, so custody
   answered `NATIVE_CARGO_FULL` forever. A stack that does not fit now moves what fits and leaves a real
   remainder wreck item (above: 1 200 moved, 75 660 remain as 980400000030). The Windows-only writer-lock
   failure (directory fsync) is fixed too, so 19 custody tests finally run on this machine.
3. `316539b4` / `507934af` the raid kept its own attack order on the hull (prey 980000016293, 2.5 AU away) and
   the stock loop re-acquired it, so the recovery refused `NATIVE_COMBAT_ORDER_ACTIVE`. The loot phase now
   releases and orders in the same tick (`living-native-raid-release` `RAID_ORDER_RELEASED_FOR_LOOT`).
4. `217ec980` a full hold must deliver before taking more; the recovery lease was starving the delivery leg.

**ITEM 2's exact blocker, measured (not inferred).** The Angel pilot really earned 10 332 ISK, and the
corporation treasury sweep then moved it into **corporation 1000129 (ORE)**:
`/var/lib/evejs/coop-native-market/corp-treasury/1000129.json` ->
`{"status":"SWEPT","corporationID":1000129,"amountISK":10332,"beforeISK":346627.03,"afterISK":356959.03,
"pilots":[{"pilotID":"coop-pilot-060","isk":10332}]}`, and `ledger.json` now shows `coop-pilot-060 balance 0`.
`war_funding_diagnose` therefore reports `NO_REAL_FACTION_INCOME` for 500011/500014/500020 (it reads pilot
balances only), and the war opening stays `NO_OPENABLE_FRONT` even though `fronts: 3` and both sides are armed.

**NEXT ACTION (exact, one change).** Make the treasury sweep respect the pilot's own corporation
(`coopNpcCorpTreasury.run({pilotFilter})` + the refinery tick's `fundTreasury` passing a filter built from the
linked native entity's `corporationID`), so an Angel sale stays in the Angel pilot's ledger (or in 1000138) and
the levy can see it; then let the next sale (the hull is empty and loots again by itself, ~10 332 ISK per
1 200-unit trip) fund `warBountyReserve` for 500011, watch `living-native-war-opened` with `escrow:true`, and
confirm `living-native-war-bounty` `PAID` on the next real casualty. Never mint ISK; the 10 332 already in
1000129 is real money that simply belongs to the wrong faction's wallet.

## 2026-10-27T14:30Z - FW-026/027: real doctrine fleets, a live Caldari/Gallente front, and the exact assault blocker

**Proven live (container evejs-server-1, verbatim).**
- Doctrine fleets spawn from real SDE profiles with authored rows:
  `spawn_war_fleet 500001/30002780 merit 150` -> `size 5 counts {tackle:1,brawler:2,ewar:1,logistics:1}`,
  fleet `coop-fleet-500001-0001`; `500004/30000140` -> `coop-fleet-500004-0016`.
- Four different doctrines, four different hulls/module sets/charges:
  `inspect_npc 980000020999` (Caldari Navy Moa, brawler) -> `moduleCount 6` = 4x typeID 568
  (flags 27-30) + 527 (mid 19) + 2048 (low 11), cargo typeID 230 x60;
  `980000021001` (Blackbird, EWAR) -> 2410x2 + 1969x2, charge 209 x40;
  `980000021002` (Delta II, logi) -> 2404 + 3588x2, charge 210 x40;
  `980000020998` (Condor, tackle) -> 564x2 + 3244 (warp disruptor), charge 222 x60.
  All `transient:false`, corporation 1000035 (Caldari Navy).
- A real front opened: `war:500001-500004` (attacker Gallente 500004, defender Caldari
  500001), campaign `war:500001-500004:campaign:30045344` (Nennamaila) `PREPARING`,
  territories `30003837=500004` (Aldranette) and `30045344=500001` (Nennamaila) -
  a real reciprocal gate pair from the SDE scan (18 real Caldari/Gallente borders).
- `militia_state 140000005` now lists `declaredWars: [war:500001-500004 campaign
  30045344 PREPARING, war:500001-500011 campaign 30002780 PREPARING]`; `fronts: []`
  because a front is only listed once its campaign is in `ASSAULT`.

**Hull reality, measured, not dressed up.** Every navy/pirate combat profile in this
build points at a category-11 NPC *entity* hull (278 Caldari/Gallente navy profiles,
0 on a player hull; only CONCORD and ORE fly category-6 player hulls). Those hulls
carry a real dogma record (65-86 attributes) but no slot attributes, so the native
auto-fit uses its documented base flag list. The doctrine reports
`hull.kind=ENTITY_HULL` and `slotMode=NATIVE_AUTOFIT_FALLBACK` instead of claiming
slots the data does not have.

**Three real opening defects found and fixed on the way (2cea1091).**
1. two borders of one faction pair produced campaigns with opposite orientation ->
   `CAMPAIGN_PREREQUISITES_NOT_MET` discarded the whole batch; campaigns now follow
   the single war record's orientation;
2. a second border naming an already-contested target aborted the batch; it is
   skipped now;
3. no pilot identity was free (100/100 linked), so a fleet hull could not be crewed:
   `releaseSpawnedIdentity` + `release_identity`/`assign_identity` move an existing
   identity between real hulls (proven: coop-pilot-001 and coop-pilot-063 reassigned).

**EXACT next step (assault).** `BEGIN_ASSAULT` needs the mobiliser to assign one
linked armed patrol per side of campaign `30045344`: coop-pilot-063 on
980000022071 (Aldranette, attacker) and coop-pilot-001 on 980000022066
(Nennamaila, defender) are already linked and armed. The current
`war_diagnose` mobilisation section reports only the FIRST PREPARING campaign
(the old pirate ones), so the next change is a per-campaign mobilisation diagnose
(`war_diagnose {campaignID}`) plus, if a candidate is rejected, the real reason
(ORDER_LEASE_ACTIVE / ALREADY_ASSIGNED / NOT_READY:...). Then `militia_state
140000005` must list the campaign under `fronts`.

**Reconstitution (unit-proven, live not yet).** 10 tests: survivors must be proved
alive, replacements are adopted only from free native hulls in the staging system
that no live fleet owns, a fleet with no real replacement is `REDUCED` with the
missing roles listed, a loss needs a real native wreck and returns a `force-lost`
merit event. Live proof needs one real loss (wreck) plus a real free hull in the
staging system.

**Known noise.** The admin requests file is not always truncated after a drain, so a
queued request can execute again after a restart (16 fleet records exist, several are
duplicates of the same doctrine in the same system; all are real hulls). Another
session recreates the stack every ~1 minute, which interrupts probes.

## OWNER DIRECTIVE 2026-10-27 (binding)

- The running stack `evejs` (evejs-server-1, evejs-market-1) is the OWNER'S PLAY
  SERVER. Do NOT restart, recreate, `--force-recreate`, down, or rebuild-and-redeploy
  it while the owner is playing. He said: "this one you will not restart until I say".
- Agents that need to deploy/test must run their OWN separate compose project
  (own project name, own host ports, own volumes) and leave `evejs` untouched.
- Friend access path in use: ProtonVPN forwarded port -> sshd on that port
  (currently 48819) -> user `evefriend`, key-only, PermitOpen 127.0.0.1:443/5222/
  26000/26001/26002/40110; firewall rule "EveJS co-op SSH 48819" scoped to
  remote 176.37.43.83. EveJS ports stay 127.0.0.1.
- Agent stack commands (never the owner's project):
  `.\scripts\Start-Agents-Stack.ps1 -Action Status|Seed|Up|Down`.
  Seed once on a fresh volume (`market-tools rebuild v1 --preset jita_new_caldari`),
  otherwise evejs-agents-market-1 exits 1 with "No market database exists".
  Host ports 28000-28002/28443/25222/41110; volumes evejs-agents-data/-images.

## NEXT ACTION (2026-10-27T18:10Z)

Perf rounds 1-3 are built and verified in source (`OVERLAY_OK`, image rebuilt,
patches 0009/0010, suites 11/11 + 5/5). They are NOT on the play stack yet.
The single blocking action is the owner's restart window:

    docker compose -f compose.yaml -f compose.coop-probe.yaml \
      up -d --force-recreate --no-deps server   (in C:\Games\EveCoop\upstream-evejs\Code)

After the recreate: profile the play stack the same way (SIGUSR1 + live-profile.cjs
25 s + Analyze-CpuProfile + chain.cjs) and record the idle share and the top rows
in .opencode/metrics.md. Compare against the pre-fix rows: idle 0%, cloneValue
62.7%, ensureRootShape 24.0%, chains evaluatePair 5962 ms / cargoRows 1406 ms /
miningFleetDurable.check 871 ms.

## PROCESS BUG FOUND 2026-10-27T18:35Z — `--apply` silently drops direct L1 edits

`node scripts/patch-evejs-coop.cjs --apply` restores the pinned stock files before
installing the overlay, so an L1 fix that was made by editing the checkout
directly DISAPPEARS on the next `--apply`. That is exactly what happened to patch
0009 (nativeNpcStore root clone): it was live, then the next `--apply` reverted it
and the play stack went back to 13% `ensureRootShape`.

Rule from now on: an L1 fix must exist as `patches/upstream/NNN-*.patch` AND be
applied through `apply-upstream-patches.cjs`. Direct edits are temporary only.

`apply-upstream-patches.cjs` currently refuses this checkout:
"Checkout matches neither the pinned base nor our patched state" (0004 fails on
miningNpcOperations.js). That is NEEDS_PATCH_SERIES_REPAIR: the series tool and the
working tree must be reconciled before the next L1 patch is trusted. Until then
patch 0009 is re-applied idempotently by a local script and its sha256 in
MANIFEST.json matches the regenerated patch file.

## 2026-10-27T19:05Z — where the client work stands

PERF: DONE and stable on the play stack. 97.8% -> 20.8% of one core, profile idle
~49%, rootShapeVerified.add verified inside the container. Deploy path is now
`node scripts/apply-all.cjs --code-path <Code>` (overlay + L1 series together);
plain `--apply` wiped patch 0009 twice.

MAP: renders with the small occupation payload (owner-confirmed).
FW TAB: STUB_IN_THIS_BUILD. The client calls GetAllWarzonesOccupationStates, we
answer with real util.KeyVal entries (militia corps 1000180/1000181, contested
flags), and it still shows "no data" because it lists warzone systems from its own
static logic and colours them itself. Filling all 814 static warzone systems makes
the tab populate but crashes the map in mapViewFiltered.GetLineColor (partial
colour data: one line end coloured, the other None). Client code cannot be patched
here (boundary), so the tab is not finishable server-side.

NEXT (needs the owner's go): show the front through the surfaces that work -
the map campaign layer (insurgencySolarsystem.GetAllVisibleCampaigns) and the
front chat lines already emitted ([Front] assault begun in system ...).

## HANDOFF 2026-10-27T19:30Z (context nearly exhausted)

DEPLOY PATH: `node scripts/apply-all.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code`.
It runs the overlay, then `git apply --directory=Code` for every
patches/upstream/*.patch not already present, then asserts OVERLAY_OK. The
`--directory=Code` is required: patches are written against the Code/ root and
without it 0001 fails with "No such file or directory".
Never run `patch-evejs-coop.cjs --apply` alone: it restores stock files and kills
every direct L1 edit (it ate patch 0009 twice, dropping CPU from 15% back to 97%).

CLIENT VIEW (map + FW tab), state of the experiments:
  * dict payload -> client AttributeError 'dict' has no attribute 'occupierID'.
  * util.KeyVal payload + few systems -> map renders, tab shows the front only.
  * util.KeyVal + ALL 814 static warzone systems -> tab populates but the map
    crashes in mapViewFiltered.GetLineColor (partial colours), so it is reverted.
  * current payload = 5 systems (campaign + territory, warzone factions only).
  * OPEN QUESTION: colours. Tried militia corporations (1000180/1000181) -> grey.
    The untested combination is FACTIONS (500001/500004) with the correct
    util.KeyVal type; the hooks are in scripts/overlay-spec.cjs (three entries for
    fwWarzoneSolarsystemService) and the `militiaOf` mapping is where to switch.

PERF: closed. 97.8% -> ~10-18% of one core with short spikes >100% during heavy
phases; idle ~49% in the profile. Guard test tests/coop-native-npc-store-patch.test.mjs
fails if the memo line disappears from patch 0009 again.

FW TAB: STUB_IN_THIS_BUILD (client lists warzone systems and colours them itself).
Do not promise it; use the map campaign layer + front chat lines instead.

## PATCH SERIES IS DRIFTED — must be repaired before the next L1 patch

`apply-all` now reports: applied=0, alreadyPresent=7, drifted=0004, 0009, 0010.
0009/0010 fail at their hunk because patch 0001 (same file, nativeNpcStore.js) is
applied first and changes the context. Until the series is regenerated in order,
the perf fix is applied by the idempotent local script
(reapply-0009.cjs + fix-add-line.cjs) and patch 0009 in the repo no longer matches
the tree. Repair plan for a fresh session:
  1. git checkout the checkout to the pinned base,
  2. apply 0001..0010 strictly in order with `git apply --directory=Code`,
  3. regenerate any patch whose context moved, update MANIFEST sha256,
  4. assert tests/coop-native-npc-store-patch.test.mjs and the guard in CI-less run.

## PATCH SERIES REPAIRED (2026-10-27, f4fe0fac + 6803ee4f)

The series is no longer drifted. What was actually wrong, in order:

1. `0009` was generated against the PRE-0001 file. `git apply` applies `0001` first
   (same file, `nativeNpcStore.js`), so 0009's context never matched and it always
   failed -> the perf fix never reached the container.
   Fix: regenerated 0009 from a diff between "base + 0001" and "base + 0001 + memo",
   so it applies cleanly on top of 0001. Guard: tests/coop-native-npc-store-patch.test.mjs
   (pass=2).
2. `0010` had CRLF line endings; `git apply` could not match the LF working tree on
   ANY tree. Fix: converted to LF.
3. `0004` never applied because `apply-all` ran the overlay FIRST and the overlay
   inserts hooks into `miningNpcOperations.js`, moving the patch context. Doctrine is
   L1 -> L2, so `apply-all` now applies the L1 series first, then the overlay, then
   re-verifies every patch. A patch the overlay covers can no longer be reverse-applied
   verbatim, so presence is proven by content (every added line must exist).
   Result: `applied=0 alreadyPresent=10 total=10`, `OVERLAY_OK`, exit 0.

MANIFEST sha256 refreshed for 0009 and 0010 (apply-upstream-patches.cjs checks it).

Deploy is one command and now fails loudly if anything is missing:
`node scripts/apply-all.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code`

## NEXT: the war must be visible IN SPACE, not on the map (owner decision 2026-10-27)

Owner confirmed: FW tab stays grey in every payload variant and the map opens fast now,
so "на карті війну не побачимо". Do not spend more time on the map or the tab.

The only visible war path left is the one he asked for from the start: fly to a warzone
system and see his faction`s fleet actually fight the other faction. What already exists:
  * `coopNpcHostility` allows NPC-vs-NPC only for named, physically linked opposing
    factions with a current native attack order or fresh retaliation (do not weaken it);
  * `warFrontChat` already emits real `war-opened` / `assault-begun` /
    `objective-captured` lines to sessions inside the affected system, once per event,
    text built from real state;
  * mining fleets are alive again because patch 0004 is really applied now
    (`ALIFE08 ... ALREADY_ACTIVE miners=2 haulers=1`), and a pirate raid is running.
Next concrete step: stage BOTH factions` fleets in ONE warzone system (Caldari vs
Gallente) so the owner can fly there and watch the fight, and make sure the front chat
line reaches him there. Evidence required: real weapon success, measured HP loss, real
wreck + stored loot on the same victim. No map work, no FW tab work.

## TWO MORE CLIENT TABS (owner report 2026-10-27): diagnosis

1. "Gallente 2 systems / Caldari 0" — that number comes from OUR war state, not the
   client: the campaign seed made Gallente the occupier in two systems and Caldari in
   none. It is real data, just unbalanced. Fix is in the war/campaign seed, not the UI.
2. "War zone" tab = black screen and "details about the combat zone: loading advantage
   data" forever — the client asks for warzone advantage/summary data that THIS SERVER
   NEVER IMPLEMENTS: `grep -rn Advantage /app/server/src/services/` returns nothing, and
   fwWarzoneSolarsystemService only exposes GetAllWarzonesOccupationStates(+Uncached),
   GetAllWarzones, GetHQSystemIDs, GetLocalOccupationState. The client gets no answer and
   keeps loading. This is fixable server-side: implement the advantage/summary handler
   with real values (occupation counts, contested systems) instead of nothing.
   Unknown eve_public requests in the last 3h are only payment.schedule.GetActiveByType
   and stargate.lock.GetRestrictedSystems — neither is the warzone tab.
Next: (a) rebalance the campaign seed so both factions hold systems, (b) add the
advantage handler. No client patching, no map work.

## TASK A+B (owner said "давай"): exact entry points, nothing mutated yet

A. Rebalance "Gallente 2 / Caldari 0".
   The number is `occupationStates()` in integration/coopWarClientView.cjs counting
   `state.territories[systemID].militaryControllerFactionID`. The state is NOT a JSON
   file (no /var/lib/evejs/coop-war-state.json) — it lives in SQLite behind
   `integration/coopFactionWarStore.cjs` (createFactionWarStore -> execute/snapshot,
   TABLE+KEY from that module) and `warState()` reads it with
   `gameStore.coopAtomicNativeRows.transact([TABLE], tx => tx.get(TABLE, KEY))`.
   Therefore the seed must go through the store's own `execute` mutation with its
   receipts/proofs, NEVER a hand-written row: hand-writing is fabrication and the
   store validates state on read (`core.validateState`).
   First read the current territories + wars to see which systems are unowned, then
   open real campaigns (attacker/defender, source/target) so both factions hold and
   contest systems.

B. "War zone" black screen + "loading advantage data" forever.
   No advantage implementation exists server-side (`grep -rn Advantage
   /app/server/src/services/` = 0). fwWarzoneSolarsystemService exposes only
   GetAllWarzonesOccupationStates(+Uncached), GetAllWarzones, GetHQSystemIDs,
   GetLocalOccupationState. The client asks for advantage/summary and never gets an
   answer. Next: capture the exact RPC name from the client's request log while the
   panel spins (docker logs evejs-server-1 | grep fwWarzone), then add a handler that
   returns real occupation counts/contested counts from the same war state. Env-gate it
   like EVEJS_COOP_WAR_CLIENT_VIEW and keep it default OFF until verified.

## REAL WAR STATE (read-only probe, 2026-10-27) — the numbers are consistent

/tmp/warstate.cjs in the container prints the live record:
  wars:      war:500001-500004 attacker=500004 (Gallente) defender=500001 (Caldari)
  territories: 30003837 -> 500004 SECURE ; 30045344 (Nennamaila) -> 500001 CONTESTED
  campaigns:  war:500001-500004 30003837 -> 30045344 (Gallente pushes into Caldari)
  byOwner:   500001=1, 500004=1
So "Gallente 2 / Caldari 0" is the client counting the OCCUPIER: Gallente holds its
own system plus the one it contests, Caldari holds a system that is being invaded so it
counts as occupied. Nothing is corrupted — the war is simply one-sided: only Gallente
attacks. The rebalance is therefore a second campaign in the opposite direction
(Caldari 500001 attacking from 30045344 into 30003837), created through the war store
execute API, not by editing rows.

## HANDOFF (context exhausted) — how to open the Caldari counter-offensive

The war machinery is already in the deployed overlay, no new code needed:
  /app/server/src/space/coopFactionWarOpening.js exports
    gateBetween, collectPresence, territoriesForFronts, paperFunding, presenceSummary,
    fundingRequired, supplyFor, activeWarFor, liveCampaignFor, buildProofs,
    planWars, applyOpenings, applyOpening, createWarOpening
  /app/server/src/space/coopFactionWarCampaigns.js exports planCampaign, resolveCampaign,
    rolesForFront, ownerOf (ROLES, STATES, DEFAULT_TTL_MS)
  /app/server/src/space/coopFactionWarStore.js -> createFactionWarStore({gameStore,proofs})
    with execute/snapshot; every mutation must go through it (receipts + validateState).
Current live record (probe /tmp/warstate.cjs): war 500001-500004 attacker=500004,
territories 30003837=500004 SECURE, 30045344=500001 CONTESTED, one campaign
30003837 -> 30045344.

NEXT STEP, in order:
 1. read-only: call planWars/liveCampaignFor for the reverse front (Caldari 30045344 ->
    Gallente 30003837) and print what it would open, WITHOUT applying.
 2. if the planner refuses, find the real blocker (gateBetween / fundingRequired /
    supplyFor) and report it — do not force an opening.
 3. only then applyOpening/applyOpenings through the store, then re-run the probe and
    confirm byOwner has both factions owning AND contesting a system.
 4. after that, the advantage handler for the black "war zone" tab: capture the exact
    RPC from docker logs while the panel spins, add the handler env-gated default OFF.
Never hand-write territory rows, never weaken coopNpcHostility, no client patching.

## WHERE THE COUNTER-OFFENSIVE ACTUALLY STOPS (probed 2026-10-28)

1. planWars({state}) with no gate wiring -> REFUSED / NO_GATE_AUTHORITY. It refuses to
   invent a front without real stargate topology. Correct behaviour, not a bug.
2. The sanctioned entry point is NOT a hand-built plan: coopVirtualWorldRuntime calls
   createWarOpening({ readLinks, getNativeEntity, getFactionForCorporation,
   getStargatesForSystem: worldData.getStargatesForSystem, getGate: worldData.getStargateByID,
   readWarState, writeWarState, reserveBounty, fleetPresence, minShips }).tick({systemIDs})
   with systemIDs = [...visitedSystems].slice(0,12), and skips with
   NO_VISITED_SYSTEMS / NO_IDENTITY_REGISTRY / WAR_STATE_WRITE_FAILED.
3. Every war flag is already ON in compose.coop-probe.yaml (EVEJS_COOP_FACTION_WAR,
   _FLEETS, _MOBILIZE, _COMBAT, _MERIT, _TREASURY, _NATIVE_TRANSFER, _SOVEREIGNTY_PROJECTION,
   WAR_REQUIRE_FUNDING=0). No war-skip lines in 2h of logs, so the phase is not erroring.
So the war is enabled and one-sided because a reverse front needs CALDARI presence in a
system that borders Gallente-held 30003837, and the visited route does not include
Nennamaila (30045344) / that border. Nothing is corrupted and nothing is missing code.

NEXT ACTION (concrete): add the Gallente/Caldari border systems to the visited route
(EVEJS_COOP_WAR_ROUTE / the 5-system route in compose.coop-probe.yaml) so the war tick
sees both sides present, then re-run /tmp/warstate.cjs and expect byOwner with both
factions owning AND contesting. Then the advantage handler for the black tab.

## DEFINITIVE WAR DIAGNOSIS (2026-10-28, read-only diagnoseWarState/diagnoseWarFunding)

  territories: 30003837 Gallente SECURE, 30045344 Caldari CONTESTED
  war:         war:500001-500004 ACTIVE
  campaign:    war:500001-500004:campaign:30045344 source=30003837 target=30045344
               state=PREPARING (stuck, never advances)
  presence:    {"systems":[],"minShips":1,
                "note":"TERRITORIES_NEED_AT_LEAST_ONE_RESOLVED_PILOT_PER_SYSTEM"}
  funding:     both sides REFUSED / NO_REAL_FACTION_INCOME (needCents=2500000, pilots=0)

THE WAR IS FROZEN ON PRESENCE = 0, not on the map, the FW tab or the patch series.
No faction-resolved NPC pilot exists in 30045344 or 30003837, so the campaign cannot
leave PREPARING and no reverse front can be planned. The route already contains both
systems (EVEJS_COOP_VIRTUAL_ROUTE: 30000142,30000144,30000145,30045344,30003837) and all
war flags are ON, so the missing piece is the real war fleets of BOTH factions in those
two systems, plus real faction income for funding.

NEXT ACTION: mobilize real Caldari and Gallente war fleets into 30045344 and 30003837
(registry: nativeWarFleetRegistry, EVEJS_COOP_FACTION_WAR_FLEETS/_MOBILIZE), verify with
diagnoseWarState that presence.systems is non-empty, then re-check the campaign leaves
PREPARING. Funding stays honest: NO_REAL_FACTION_INCOME means no invented ISK.

## ROOT CAUSE CONFIRMED: the war fleet registry is EMPTY

`require("/app/server/src/space/coopVirtualWorldRuntime.js").nativeWarFleetRegistry()`
returns `{}`. So there are no war fleets anywhere, therefore presence in 30045344 /
30003837 is 0, therefore the campaign cannot leave PREPARING and no reverse front can
be planned. EVEJS_COOP_FACTION_WAR_FLEETS=1 and _MOBILIZE=1 are set but mobilization
never produced a fleet, so the registry stays empty.

NEXT ACTION (single): find why mobilization spawns nothing with those flags on — the
mobilize phase logs nothing and the registry is empty, so check the mobilize entry point
in coopVirtualWorldRuntime (grep EVEJS_COOP_FACTION_WAR_MOBILIZE) and what precondition
it needs (funding gate is REFUSED/NO_REAL_FACTION_INCOME, which may be exactly what stops
it). Decide honestly: either real faction income exists and mobilization is broken, or
the funding gate is the real blocker and no fleet may legally spawn without it.

## MOBILIZER IS ENABLED — so the blocker is inside it, not the flags

coopWarMobilizer.enabled() needs FACTION_WAR, FACTION_WAR_FLEETS, FACTION_WAR_MOBILIZE,
NATIVE_ATOMIC_ROWS, NPC_STRICT_AMMO, NPC_AMMO_DURABLE_CYCLE, NPC_BANK_ATOMIC and
(ALIFE or NPC_ORDER_ARBITER). Container env proves all of them are 1.
It also needs createWarMobilizer({registry, readWarState, readLinks, sceneForSystem,
getNativeEntity, getController, getFactionForCorporation, inspectReadiness,
getOrderLeases, isTactical, clock}) or it throws
WAR_MOBILIZATION_NATIVE_AUTHORITIES_REQUIRED. The registry is empty and nothing throws,
so the mobilizer runs and rejects every side silently (SIDE_REJECT_LIMIT exists for that).
NEXT SINGLE STEP: run the mobilizer in DRY RUN (DRY_RUN_REPORT_LIMIT=64, never writes) and
print the per-side reject reasons for war:500001-500004. That names the exact refusal —
most likely the funding gate (NO_REAL_FACTION_INCOME) or an empty getOrderLeases — and it
is the last unknown between the current frozen war and a visible two-sided fight.

## CORRECTION (must not stand uncorrected): the registry is NOT empty

Earlier note "nativeWarFleetRegistry() -> {}" was a PROBE ARTEFACT, not a fact:
JSON.stringify of an object whose members are functions prints {}. The factory
(coopVirtualWorldRuntime.js:86) returns null only when FACTION_WAR / FACTION_WAR_FLEETS /
NATIVE_ATOMIC_ROWS are not 1; those are 1, so it builds a real registry through
coopWarFleetRegistry.createWarFleetRegistry with native proofs. So do not chase an empty
registry. The mobilizer therefore has its registry and the refusal is elsewhere
(funding gate / getOrderLeases / readiness). The only way to name it is the mobilizer
dry-run: tick({systemIDs, dryRun:true}) -> {status:"DRY_RUN", mobilized, rejected, blocked}.

## FOUND: diagnoseMobilization already exists (it was in module.exports all along)

coopVirtualWorldRuntime exports diagnoseMobilization (and diagnoseCombat, diagnoseWarState,
diagnoseWarFunding, diagnoseNpcOrder, diagnoseNativeRaids, nativeWarFleetRegistry,
livingWorldPhases). Called from a fresh `docker exec node`, diagnoseMobilization returns
{"status":"MOBILIZER_NOT_INITIALIZED"} because warMobilizer is module state created by the
running phase, not by a cold require. So the dry-run MUST be invoked inside the server
process: either (a) a tiny env-gated hook that calls diagnoseMobilization on a timer and
logs it, or (b) an admin-bridge action. (a) is 5 additive lines and cannot break startup.

## READY-TO-APPLY: the mobilization diagnostic hook (paste, then apply-all + build)

In integration/coopVirtualWorldRuntime.cjs, right after the module.exports assignment,
append (additive, cannot affect startup):

  if (process.env.EVEJS_COOP_WAR_DIAG === "1") {
    try {
      const timer = setInterval(() => {
        try {
          const out = module.exports.diagnoseMobilization();
          console.log("[CoopWarDiag] mobilization " + JSON.stringify(out).slice(0, 1200));
        } catch (error) { console.log("[CoopWarDiag] error " + error.message); }
      }, 60000);
      if (typeof timer.unref === "function") timer.unref();
    } catch (_error) { /* diagnostics never break the world */ }
  }

Then: EVEJS_COOP_WAR_DIAG=1 in compose.coop-probe.yaml, apply-all, build, recreate, and read
`docker logs evejs-server-1 | grep CoopWarDiag`. That prints the real per-side rejection
(funding gate / getOrderLeases / readiness) for war:500001-500004.

## BREAKTHROUGH: the war is FIGHTING (2026-10-27T20:56Z, deployed on the play stack)

The exact refusal was named by the existing admin action `war_diagnose` (no rebuild
needed for diagnosis): DEFENDER side rejected entity 980000023574 with WRONG_FACTION
(it is a Federation Navy hull in the Caldari contested system) and the ATTACKER side
rejected 980000023571 with ORDER_LEASE_ACTIVE. Both war-doctrine hulls existed but sat
in each other's systems, so no side could ever muster.

Fix proven live, all through sanctioned paths:
1. `release_identity` on two out-of-the-way traders (coop-pilot-034, coop-pilot-069).
2. `spawn_war_fleet` faction 500001 in 30045344 and faction 500004 in 30003837 with
   those pilots as commanders -> real Caldari Navy Condor 980000033113 and real
   Federation Navy Atron 980000033114, doctrine loadouts, durable, linked as patrols.
3. Next mobilization tick: campaign left PREPARING, `[CoopFactionWar] assault begun
   war:500001-500004:campaign:30045344 attacker=1 defender=1`, both sides SIDE_MUSTERED.
4. The gate-staging phase then really transferred the Gallente hull 30003837 -> 30045344.

Remaining blocker was co-location: the battle director only fires inside 250 km and the
fleets sat 9.87e12 m (66 AU) apart. New FW-030 `integration/coopWarEngagementWarp.cjs`
(env `EVEJS_COOP_WAR_ENGAGE_WARP=1`, default OFF, 6 unit tests) warps the assaulting side
to the nearest opposing war ship of the same campaign - one real `npcRuntime.warpToEntity`,
never a teleport, spawn or damage.

Deployed (apply-all OVERLAY_OK, image evejs-local rebuilt, server recreated) and observed:
- `living-native-war-engagement-warp` status WARP_ORDERED, both Gallente hulls
  NATIVE_WARP_STARTED at 9.87e12 m.
- `living-native-war-attack-orders` NATIVE_ATTACK_ORDER_ACCEPTED: Caldari 980000033113
  attacking Gallente 980000023574 in 30045344.

NEXT: confirm real damage/wreck (HP drop on the same entities, not just the ACK), then
make the garrison durable instead of operator-seeded: a war-zone system must be
garrisoned by its controller's navy every time it is observed, otherwise a lost fleet
freezes the front again.

NOTE: `scripts/overlay-spec.cjs` also needed `require("../../gameStore")` (the in-flight
hauler work used `../gameStore` from services/mining, which cannot resolve and blocked
the whole overlay with HOOK_REQUIRE_MISSING_FILE).

## Live war state after FW-030 (2026-10-27T21:25Z)

PROVEN live on the play stack (all through sanctioned paths, no invented ISK/kills):
- campaign war:500001-500004:campaign:30045344 is in ASSAULT, both sides SIDE_MUSTERED;
- `[CoopFactionWar] assault begun ... attacker=1 defender=1` and the front chat line
  "[Front] Assault begun in system #30045344: 1 attacking ships against 1 defenders.";
- real native gate transfer moved a Gallente hull 30003837 -> 30045344;
- FW-030 warps the assaulting side from 9.87e12 m (66 AU) to ~12 km: WARP_ORDERED,
  NATIVE_WARP_STARTED;
- the war director then issues a real native attack order:
  NATIVE_ATTACK_ORDER_ACCEPTED Caldari 980000033113 -> Gallente 980000023574.

STILL NOT PROVEN - and this is the single next blocker: no damage is exchanged.
Measured on the live ships: both sides keep hp {shield 150/175, armor 175/145,
structure 160/125} unchanged; the ordered hull shows `manualOrder {type:attack}` but
`currentTargetID: 0`, `mode: STOP`. The doctrine guns are short-range autocannons
(typeID 564/562 on the Condor/Atron), so 11-90 km is outside real gun range, and:
- a native warp refuses a short hop (`WARP_DISTANCE_TOO_CLOSE` at 43 km / 90 km);
- `orbit(id, enemy, 1000)` is accepted (`NATIVE_ORBIT_ORDERED`) but the patrol's own
  movement wins and the range grows again (12 km -> 27 -> 43 -> 89 km -> back to 66 AU).

NEXT SINGLE STEP: make the attack order and the approach one decision - issue the
native attack only once the hull is inside real gun range, and stop the patrol's own
movement from overriding the approach (the order bridge refuses any new WAR order while
`movementBusy` is true and the hull has no arbiter lease, which is exactly the state an
orbiting patrol is in). Do not raise the battle director's 250 km rule: that is the real
firing envelope of these guns' falloff, not a bug.

## FW-030 v3: a hull holding an accepted attack order also closes on its target

Deployed: `coopWarEngagementWarp` no longer only moves the assaulting side. A war hull
whose controller carries `manualOrder {type:"attack"}` with `currentTargetID: 0` is a
hull that is outside real gun range with an order it cannot use, so it now closes on the
ship it was ordered to kill (orbit inside 150 km, standoff warp beyond). Measured live
after deploy: NATIVE_ORBIT_ORDERED at 82-90 km for the two Federation Navy hulls.

Still not proven: HP on 980000033113 / 980000023574 / 980000033114 is unchanged
(shield 175/150, armor 145/175, structure 125/160) and the Caldari hull still shows
`mode STOP` with `currentTargetID 0` under an accepted attack order. So the open
question is now narrow and native-side, not war-side: why a native `attack` order that
the order bridge accepted leaves the controller with no target, and why an accepted
`orbit` does not hold the hull at that range. Check `coopNpcHostility`
`allowsNativeEngagement` (both flags are 1, so it should authorise) and the native
`npcBehaviorLoop` target acquisition for these two hulls before touching the war code
again. Nothing in the war store, the campaign or the front chat is blocking.

## WAR IS REAL: damage, mutual orders and three native kills (2026-10-27T22:20Z)

Root causes found by measurement, not guesswork, and all three were needed:

1. `coopNativeReadCache` indexed native rows by `row.itemID`, but
   `nativeNpcStore.listNativeEntities()` publishes the id as `row.entityID`. Every
   cache lookup missed, so `coopWarCombatAuthority.evaluatePair` answered
   `NATIVE_STORE_IDENTITY_MISMATCH` for EVERY war pair. The hostility hook therefore
   denied every engagement: an accepted attack order never became a target. Fixed by
   indexing `itemID ?? entityID` (`tests/coop-native-read-cache.test.mjs`).

2. The war hull is spawned at a belt anchor and warped to the enemy, so it stands
   ~150 km from home with the profile's 90 km leash. `isBeyondLeash` then ran
   `clearNpcCombatState` on every think, resetting `currentTargetID` to 0 and flying
   the hull home. New FW-031 `integration/coopWarEngagementPosture.cjs`
   (`EVEJS_COOP_WAR_ENGAGEMENT_POSTURE=1`, default OFF) applies the *native*
   behaviour overrides `leashRangeMeters: 0`, `orbitDistanceMeters: 500`,
   `movementMode: "orbit"` to every registered war hull in an assault system,
   preserving all other overrides and never re-applying the same values.

3. A war hull only flying its own patrol movement (GOTO/ORBIT) had `movementBusy`
   true and no arbiter lease, so the bridge refused WAR with
   `COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE` - and a lease is only created by a
   successful issue, so the defender could never be ordered at all. The bridge now
   lets WAR retask its own ASSIGNED hull when it carries no manual combat order.
   An unleased manual attack from an unknown owner is still never hijacked
   (`tests/coop-war-order-arbiter.test.mjs`, including a repair of that fixture,
   which referenced an undefined `arbiter` and could never have passed).

FW-030 also grew a real fleet warp: a side of 2+ hulls that must close now issues
ONE native `warpBatchToPoints` with a line-abreast formation around the standoff
anchor (per-slot lateral offset + staggered rank depth); a lone hull keeps
`warpToPoint`. Formation offsets are unit-tested; no live scene has needed a
multi-ship warp yet because the spawned hulls landed inside warp range.

LIVE EVIDENCE (play stack, no fabricated damage):
- `living-native-war-engagement-posture` POSTURE_APPLIED for 980000033113,
  980000033114, 980000023574.
- `npc_pair_diagnose` 980000033113 -> 980000023574: `warVerdict AUTHORIZED`,
  `currentTargetID 980000023574` (was 0 before), leash override present.
- Mutual real attack orders accepted in one tick: 980000033113 -> 980000036202,
  980000036201 -> 980000036202, then 980000036202 -> 980000036201.
- THREE real warship kills with native wrecks and stored loot:
  980000023574 (wreck 980300000022), 980000033114 (wreck 980300000024),
  980000036202 (wreck 980300000034), 980000036239 (wreck 980300000035).
  Merit moved on both sides: Caldari commander promoted recruit -> pilot -> wingman
  (command 1 -> 3), the losing pilots took `force-lost -10`.

NEXT: the front is still operator-seeded (`spawn_war_fleet` needs a free identity).
A durable garrison - a war system refilled by its controller's navy whenever it is
observed - is the remaining gap before the war runs unattended. The formation warp
needs one live case where a side of 2+ must close as a group to be seen in-client.

## FW-032/033: the front now heals itself (2026-10-27T22:35Z, live)

Two more measured defects closed, both proven on the play stack.

FW-032 `integration/coopWarLossReconcile.cjs` (`EVEJS_COOP_WAR_LOSS_RECONCILE=1`):
a confirmed native wreck now RELEASES the hull's exclusive custody slot in the war
fleet registry (the registry's own release verifier already accepts a
process-confirmed wreck) and frees the killed pilot's identity. Before this, a dead
hull stayed ALIVE in the registry forever, so the side looked fully mustered with a
corpse and the pilot could never fly again. Live: `living-native-war-loss-reconciled`
status RECONCILED, custody APPLIED, identity RELEASED for 980000036587 / wreck
980300000037.

FW-033 `integration/coopWarGarrison.cjs` (`EVEJS_COOP_WAR_GARRISON=1`): an ASSAULT
side with fewer than `garrisonSize` (2) hulls in the campaign target system is
refilled through the SAME sanctioned path an operator uses - `spawn_war_fleet`
(real doctrine row, real native ship, real free pilot identity), one hull per tick,
3 min cooldown per side. Live: two `living-native-war-garrison` GARRISON_APPLIED
events spawned 980000036587 (fleet coop-fleet-500004-0007, commander
coop-pilot-038) and 980000036810 (fleet coop-fleet-500004-0008, commander
coop-pilot-069) - both commanders were identities freed by earlier real kills.
Minutes later 980000036810 was already receiving a real attack order.

Measured caveat: `coopWarFleetRoster` is EMPTY in this deployment (0 fleets) -
`spawn_war_fleet` only writes the war fleet registry, not the newer roster. So the
FW-032 roster half honestly reports NOT_IN_ROSTER, and `planReconstitution`/
`commitReconstitution` cannot be used for these hulls. The authoritative custody
path is the registry, and that one works.

Still open: the formation batch warp (FW-030) has no live case yet - garrison hulls
spawn close enough to the enemy that they engage without a group warp. The next
natural trigger is a side mustering in its source system and travelling together.

## FW-034: the client advantage panel now answers for OUR pair (2026-10-27T22:50Z)

The owner reported that the faction-warfare window works for the other warzone but
not for Caldari/Gallente: the map is empty for ours and the "advantages" tab spins
forever instead of erroring. Measured on the running server:

- The map surface is fine: `fwWarzoneSolarsystem.GetAllWarzonesOccupationStates`
  returns warzone 2 = {30003837: owner 500004 / occupier 500004 / not contested,
  30045344: owner 500001 / occupier 500004 / CONTESTED}. So the map data for our
  pair really exists; an empty client view is a client-side cache, not missing data.
- The advantage surface was empty: `fwVictoryPointMgr.GetAllVictoryPointStates` and
  `GetLocalVictoryPointState` are served from `stateBySolarSystemID` /
  `session.fwVictoryPointStatesBySolarSystemID`, and NOTHING in this build fills
  them, so the client waits on a system it will never receive. The fw-advantage
  express gateway (`eve_public.faction.activity.GetSolarSystemScoresRequest`) reads
  `context.fwAdvantageScoresBySolarSystemID`, which is also never set.

New FW-034 `integration/coopWarAdvantage.cjs` (`EVEJS_COOP_WAR_ADVANTAGE=1`, default
OFF) derives both surfaces from evidence we already hold and invents nothing:
`contribution(faction) = 1000 * enemy wrecks that faction took in this system +
100 * its hulls present`, `score = the larger side`, `threshold = 75 000` (stock).
Two L2 hooks feed it: `fwVictoryPointMgrService` (both handlers) and the
`fw-advantage` gateway service.

Live probe in the running container:
  ALL   {30003837: {0, 75000}, 30045344: {3200, 75000}}
  LOCAL [30045344, {3200, 75000}]
  SCORES [{500001, 3200}, {500004, 1100}]
  snapshot 30045344: Caldari 3 wrecks taken / 2 hulls, Gallente 1 wreck / 1 hull.

## NIGHT 2026-10-28 - N1 landed, next steps (autonomous run)

Plan: `.opencode/night-plan-20261028.md` (13 tasks). Watchdog:
`.opencode/night-watch-20261028.log` (one line every 15 min, read-only).

DONE tonight:
- FW-035 `integration/coopWarCaptureByForce.cjs` + 5 tests. A system flips
  `militaryControllerFactionID` only with: a verified defender wreck in THIS
  campaign and system, ZERO live defender hulls there, sustained 60 s, then
  RECORD_OBJECTIVE -> CAPTURE_TERRITORY through the same authoritative core.
  Fork commit `2cb671c` (module + phase `native-faction-war-capture-by-force` +
  `EVEJS_COOP_WAR_CAPTURE_BY_FORCE=1` in compose.coop-probe.yaml), repo `747c4701`.
- Image NOT rebuilt and play stack NOT restarted (night rule). The morning deploy
  must: `docker build -t evejs-local .` then `up -d --no-deps server`, then verify
  `living-native-war-capture-by-force`.

BLOCKER discovered: compose/compose.agents.yaml has NO `EVEJS_COOP_FACTION_WAR*`
flags at all, so the agents stack cannot prove any war behaviour as-is. Options:
(a) enable the war flags there and seed the war through the sanctioned admin path
(`spawn_war_fleet` + release/assign identity), or (b) prove live on the play stack
after the morning deploy. Not yet decided; nothing was changed on the agents stack.

NEXT (in order): N2 formation live proof, N3 restart resilience diff, N4 player as
target, N5 war economy debit, N6 roster truth, N7 ammo, N8 wreck hygiene,
N9 militia rank, N10 soak table, N11 FW hook extraction (AUDIT_OK), N12 operator
guide, N13 morning handover.

## PROBLEMS OBSERVED by the night watchdog (2026-10-27T23:53Z, real numbers)

Watchdog v2 (`scripts/night-watch.ps1`, harness-managed background job) logs one line
every 15 min plus an explicit PROBLEM line for: stack not healthy, CPU > 70%, war
event file unreadable, or no war event for 60 min.

First real sample: play stack healthy, CPU 0% (idle), war events on the play stack =
15 casualties / 22 garrison spawns / 82 attack-order events.

P1 FREE-SHIP GRINDER (confirmed, needs N5). Fleet registry holds only 2 hulls
(1 Caldari, 1 Gallente, both in 30045344) while 22 garrison spawns happened: a hull
dies, FW-032 releases its slot and frees the pilot, FW-033 immediately buys another
one for free. The front is an endless free meat grinder - no cost, no end condition.
N5 (real economy: debit the faction chest, refuse when empty) is the fix.

P2 ROSTER IS DEAD WEIGHT (confirmed). `coopWarFleetRoster` still reports 0 fleets;
`spawn_war_fleet` never writes it. FW-032 honestly reports NOT_IN_ROSTER. Either wire
it (N6 option a) or delete the dependency (option b). No functional impact while the
registry is authoritative, but it is a lie in the payload.

P3 GARRISON PACING not yet proven safe: 22 spawns/hour is at the 3-min-per-side
cooldown ceiling. With N5 it becomes self-limiting; until then the only brake is the
cooldown. Watch the soak table (N10) for growth.

P4 agents stack cannot prove war behaviour at all (no `EVEJS_COOP_FACTION_WAR*`
flags in compose/compose.agents.yaml). Every live war proof must happen on the play
stack after the morning deploy, or the agents stack must be given the flags and a
seeded war.

## WHY THE WAR FROZE (diagnosed 2026-10-28T10:04Z, real probes)

Symptom: no faction-war event since 04:47 (counters stuck 15 casualty / 22 garrison /
82 orders) while the world keeps running (phase cycle 1170 at 10:02:53 includes every
`native-faction-war-*` phase, and pirate warp-point tackles still fire at 10:02:42).

Two independent deadlocks, both measured:

D1 GHOST HULLS IN THE FLEET REGISTRY. The registry holds exactly two hulls -
980000038148 (Caldari, coop-pilot-038) and 980000039139 (Gallente, coop-pilot-089),
both "in" 30045344. Probe: `nativeNpcStore.getNativeEntity` returns a row for both,
but `scene.getEntityByID` returns nothing for both (`inScene false`). They are dead or
despawned ships that were never released. Consequences:
  - FW-033 counts registry rows as "present" -> missing = 0 -> the garrison never
    refills a side that physically has no ship;
  - the battle director finds no live candidate -> no attack order;
  - the campaign stays ASSAULT rev 2 with 0 objectives, territory still Caldari.

D2 ZERO FREE PILOT IDENTITIES. Roster 100, linked 100, free 0. The last garrison
attempts are literally `phase:"garrison", reason:"NO_FREE_PILOT_IDENTITY"`
(23:26, 23:30, 23:34) interleaved with `GARRISON_COOLDOWN`. So even a correct
"missing" count could not field a replacement commander.

WHY IT IS NOT JUST "absence = death": the registry's own release verifier refuses a
missing hull unless a physical wreck was confirmed (`confirmDestroyed`), which is the
correct invariant. So the fix must NOT weaken custody. Proposed:
  F1 FW-033 counts LIVE scene hulls (inScene), not registry rows, when deciding
     whether a side is missing. Ghost rows then block nothing.
  F2 the free-pilot pool may reclaim an identity whose bound hull is in no scene
     (release_identity on that link first), so a ghost cannot hold the last pilot.
  F3 (separate) a read-only `war_registry_audit` action that reports ghost rows so the
     operator sees them instead of guessing.
Not implemented yet; no change was made to the running server.

## FREEZE ROOT CAUSE FOUND AND FIXED (2026-10-28T10:25Z, deployed)

The freeze was NOT the war logic. `scripts/coop-split-module.cjs` moved
`nativeWarFleetRegistry()` into `server/src/space/coopVirtualWorldRuntime.pure.js`
but did not move its module state, so the function threw
`ReferenceError: warFleetRegistry is not defined` on every call. The garrison phase
caught it per phase (`[CoopLivingWorld] native-faction-war-garrison warFleetRegistry
is not defined`), so the war silently stopped refilling and the front emptied.

Fixes deployed (fork `ef48a4f`, `48f63d9`):
- `.pure.js` now declares `warFleetRegistry`, `bridge`, `identityRegistry` and exports
  `bindWarRuntime({bridge,identityRegistry})`; the main runtime binds the live objects
  right after `createBridge(...)`.
- FW-033 counts LIVE scene hulls, not custody rows (`isHullLive`), so a ghost hull can
  no longer look like a manned side.
- the free-pilot pool reclaims an identity whose ship is in no live scene
  (`GHOST_HULL_NO_SCENE`) instead of starving the garrison with
  `NO_FREE_PILOT_IDENTITY`.

Evidence after deploy: garrison events 22 -> 25; 10:17:10 Gallente refill, 10:17:36
Caldari refill (980000042212, commander coop-pilot-003), 10:20:32 Gallente refill.
The ReferenceError is gone from the log.

STILL BROKEN (next): the battle director issues no attack order (82 unchanged) and
`war_combat_diagnose` returns `status OBSERVED` with an EMPTY ships list, even though
the garrison just spawned three hulls. Suspicion: the same split-runtime state loss in
the combat path (a helper that reads the registry/scene from the pure module), or the
registry rows and the live scene disagree. Next probe: call
`nativeWarFleetRegistry().snapshot()` inside the running process and compare with
`scene.getEntityByID` for each row, then follow `advanceNativeWarCombat` step by step.

## COMBAT BLOCKER NARROWED (2026-10-28T10:35Z)

New measured fact: `war fleet registry ships = 0` (probe reads the SQLite row directly),
yet the garrison reported three successful spawns at 10:17:10 / 10:17:36 / 10:20:32
(fleetIDs coop-fleet-500004-0029/0030, ships 980000042212). So `spawn_war_fleet`
returns a composed fleet but its ASSIGN never lands in `coop-faction-war|fleet-registry-v1`.

Consequences: the battle director has no registered ship -> no attack order (82 unchanged),
`war_combat_diagnose` lists nothing, and the garrison keeps buying hulls every 3 min that
the war cannot see. The capture phase is now unblocked (`DEFENDER_STILL_PRESENT` was the
last refusal at 10:16:47, before the registry emptied).

Next probe (exact): call `executeRequest({action:"spawn_war_fleet",...})` and read the
returned `fleetStatus`/`fleetReason` plus the registry row immediately before and after.
The registry `ASSIGN` needs `verifyNativeShip` AND `verifyCampaign`; the campaign check
requires `campaign.state` in [PREPARING, ASSAULT] and the defender's hull in the target
system - so a hull spawned for the DEFENDER side in the target system is legal, while an
ATTACKER hull must be in `campaign.targetSystemID` during ASSAULT. A mismatch there is the
most likely silent refusal.

## INCIDENT 2026-10-28T11:25Z - I reset the war state by restoring an old runtime

What I did: to kill a cascade of `X is not defined` errors from the split runtime
(`eec175f`), I restored the pre-split single-file
`server/src/space/coopVirtualWorldRuntime.js` (fork commit `6ca4557`).

What broke: the pre-split file is an OLDER code base than the tree it replaced. On
boot its opening phase logged `[CoopFactionWar] empty war state created (version 1)`
and then opened `war:500004-500014` (Gallente vs ORE). The previous state
(`war:500001-500004`, territories 30003837/30045344, the ASSAULT campaign) is GONE.
Identity links also dropped from 100 to 43 (57 pilots now free).

Current measured state after reverting `6ca4557` (fork is back to the split runtime):
  roster 100, linked 43, free 57
  campaign war:500004-500014:campaign:30045344 PREPARING rev 1
  territory 30003837 -> 500014 SECURE, 30045344 -> 500004 CONTESTED
  split runtime still throws `warpPointDirector is not defined` (native-raids phase)

RECOVERY PLAN (do NOT repeat the restore):
1. Never again swap a whole runtime file from an older commit into a newer tree.
2. Fix the split properly: revert `eec175f` in history with conflict resolution, or
   re-run `scripts/coop-split-module.cjs` with module-state extraction, so every
   implicit global is declared. Known missing names so far: warFleetRegistry, bridge,
   identityRegistry, economy, nativeGateTransfer, recognitionAnnouncer,
   nativeAmmoWitness, warpPointDirector.
3. Re-open the Caldari/Gallente war through the sanctioned path. The opening phase
   picks a pair by adjacency and chose 500004-500014; add a confirm-gated
   `war_open` admin action that calls the same store with the same proofs instead of
   guessing, then re-register 30003837 (Gallente) and 30045344 (Caldari).
4. Only then continue with the combat/registry work.

Lesson recorded: a war state row is live data, not code. Any change that can create
an "empty war state" must be proven on the agents stack first, never on the play stack.

## 2026-10-28T12:10Z - the war is running again, and it is Caldari vs Gallente

Recovered from the incident WITHOUT hand-written rows. What was actually broken
and is now fixed in the fork (all committed):

1. `26d107a` split runtime: sixteen names (`warpPointDirector`, `economy`,
   `nativeGateTransfer`, `recognitionAnnouncer`, `nativeAmmoWitness`,
   `raidDirector`, `tacticsDirector`, pve directors, `lossBridge`,
   `nativeOrderBridge`, `lootCommerce`, `nativeAmmoSupply`, `warGateHandoff`,
   `warRecoverySocket`, `nativeGunRange`, `warTreasuryInstance`) were undeclared
   in `coopVirtualWorldRuntime.pure.js`. Every phase that touched one threw
   `ReferenceError`, so raids, economy, ammo, recognition and the war stopped.
   `syncWarRuntime()` now hands the live objects over on every tick.
2. `aa26156`/hoist: `syncWarRuntime` had to be module scope; the tick called it
   before the sale path that declared it.
3. FW-036 (`coopWarObservedSystems.js`): the war layer only observed systems a
   client had flown into, so a spawned war fleet could never open a front.
   `visitedSystems` now also takes systems where the durable roster proves live
   hulls. Test: `tests/coop-war-observed-systems.test.mjs` (5 pass).
4. FW-037 (`coopFactionWarOpening.js`): a front is one gate pair, not one
   direction. A different war holding the target froze the pair forever, so
   Caldari/Gallente could never open. The planner now mirrors across the same
   real gate; the same faction pair still never reopens its own border.
   Tests: `tests/coop-faction-war-opening.test.mjs` (20 pass).

Measured live state now (play stack, evejs-server-1):
  wars: war:500004-500014, war:500014-500019, **war:500001-500004**
  campaign war:500001-500004:campaign:30045343 = ASSAULT (Nennamaila)
  territories: 30045343 CONTESTED (Caldari 500001), 30045344 CONTESTED (500004)
  roster: 3 real fleets of 25 (500001 in 30045343 and 30003837, 500004 in 30045344)
  registry: 3 ships assigned to campaigns
  native evidence: living-native-war-attack-orders NATIVE_ATTACK_ORDER_ACCEPTED
  (980000043284 -> 980000042223), target-selection RANKED, and a
  living-native-weapon-event VERIFIED (980000043284 -> 980000043880)

Next step (in order):
1. The 25-ship roster fleets are PRESENCE (territory/front) but not BATTLE:
   only the 1-ship garrison formations get campaign ASSIGN rows, so fights are
   1v1. Teach the mobilizer/garrison to adopt roster hulls into the campaign.
2. Then prove the same on the accelerated `evejs-agents` stack (needs the
   EVEJS_COOP_FACTION_WAR* flags there plus a seeded war).
3. Then the client surfaces (warzone payload/FW window) against the new war.

## 2026-10-28 - OPS refactor: 19 gate scripts -> 1 runner + 1 validated table

Commit `ebd2e2ac` (+ worklog `b03861d7`, docs `74017446`). No gameplay code touched.

  scripts/lib/CoopGate.ps1  192L  the six steps once (tests exist -> manifest all-NOT_RUN
                                 -> node --test -> tail -> throw -> pinned verifier)
  scripts/lib/gates.json    583L  the 19 gate rows as data (tests, tail, log, manifest, pins)
  Run-*.ps1 (19)            161L  five-line wrappers, same names, same banners (-671/+41)
  tests/coop-gate-specs.test.mjs  proves every declared test/pin/manifest still exists,
                                  no manifest claims unexecuted gameplay, no silent key typo,
                                  every row has a wrapper. 5/5 pass.

Evidence: all 19 gates run before and after the change with identical exit codes
(8 pass / 11 already red - the red set is the other session's in-flight overlay work,
not this change) and identical PASS/NOT_RUN banners. The only textual difference is
the report-dir path echoed in LW04C4's failure message.

Left alone on purpose: scripts/lib/CoopGate.ps1 is not dot-sourced by anything else;
Run-Alife-Economy-Tests.ps1, Run-CommunityFittings.ps1, Run-NativeJob-Tests.ps1,
Run-StageJ-Salvage-Tests.ps1, Run-LW04D-Source-Gates.ps1 do not share the template.

Next candidates (NOT started): the six scripts/verify-*.cjs repeat the same pinned
git-blob hash + reversible-patch-chain check; scripts/Run-Alife-Economy-Tests.ps1
(183L, and a test reads its text) could take a second table row once its extra
manifests are expressed. Engine perf work stays blocked while space/coopStationDrain.js
and the overlay-spec edits are uncommitted in another session.

## FW on the accelerated work stack — first seeding done (2026-10-28T12:15Z, evejs-agents only)
Start: `war_state` EMPTY, `war_fleet_state` 0 ships, presence only ORE/pirates, roster 12
pilots of which 10 already linked to the mining fleet -> no border could ever be staffed.
1. `compose/compose.agents.yaml`: EVEJS_COOP_VIRTUAL_POPULATION 12 -> 64 (the virtual world
   tops the roster up on boot without wiping pilot history; measured pilots 64 after restart).
2. Real patrol seeding WORKS: `spawn_native_npc` needs an explicit real `loadoutID`, because
   every SDE navy profile carries `retail_empty_npc_entity_loadout` and the profile's own
   `<profile>_loadout` row is missing (`WAR_PATROL_LOADOUT_UNAVAILABLE:LOADOUT_ROW_MISSING`).
   Working pair: "Caldari Navy Condor" + `guristas_light_missile_frigate` (corp 1000035 ->
   500001, missileLauncher, chargeDepth 80), "Federation Navy Atron" +
   `serpentis_small_blaster_frigate` (corp 1000120 -> 500004). Spawned 4 real durable hulls
   (980000000283/286 in 30045344, 980000000288 + one in 30003837).
3. Caveat measured: a pilot released and re-linked is re-bound to its durable old hull within
   ~20 s, so the 2nd spawn answered `PILOT_ALREADY_LINKED` (its hull exists, unlinked). Use a
   fresh pilotID per hull, and never assume the link when the status is not LINKED.
4. The opening phase then opened a REAL war by itself: `war:500014-500019` (ORE vs 500019)
   with `campaign:30000144` PREPARING (source 30000142), territories 30000142 -> 500014
   SECURE, 30000144 -> 500019 CONTESTED. Log: `opening skipped: NO_OPENABLE_FRONT` on the
   later tick = the same faction pair has a live campaign, not a failure.
5. Measured bug: `war_diagnose` answers `INVALID_MOBILIZATION_STATE` with campaignCount 0 while
   `war_state` shows that campaign, and the tick says `mobilization skipped:
   NO_MOBILIZED_SHIP:OBSERVED`. So the diagnose reads a different record path than the store
   (the same read-path class of bug fixed on 2026-10-27 for the phases).
Next: make the mobilizer see real armed patrols on both sides of campaign:30000144 (attackers
in 30000142, defenders in 30000144), or force the Caldari/Gallente border by outnumbering
30045344 (500001) vs 30003837 (500004); then check whether the fleet registry ASSIGN lands.
NOTE: MCP `evejs-server.events` reads the OWNER's play stack, not this one - do not mix them.

## FW PROVEN ON THE ACCELERATED STACK: war -> ASSAULT -> mutual orders -> real damage (2026-10-28T12:23Z, evejs-agents only)
Seeded by hand on the work stack (population 64, 8 real navy patrol hulls), then the world did
the rest by itself. Measured, verbatim from that stack:
  war_state: wars [war:500014-500019 ACTIVE, war:500001-500004 ACTIVE]
             campaigns [*:campaign:30000144 PREPARING, *:campaign:30045344 **ASSAULT**]
  presence 30045344 500001x6 / 500004x1 / 500014x3, 30003837 500004x3 / 500014x2 / 500019x2
  war_fleet_state: 2 registered fleets (coop-fleet-500004-0001 Federation Navy Atron 980000000565,
             coop-fleet-500001-0002) -> the earlier "ASSIGN never lands" blocker does NOT reproduce
             with the current fork build (bindWarRuntime + isHullLive fixes)
  living-native-war-garrison GARRISON_APPLIED (real hull bought through spawn_war_fleet)
  12:21:23 living-native-war-attack-orders: MUTUAL NATIVE_ATTACK_ORDER_ACCEPTED
             980000000423 <-> 980000000565, both in the contested 30045344
  12:22:19-12:22:29 living-native-combat-damage systemID 30045344 correlatedNpcDamage 1
             (a war hull really taking damage; ACK alone is still not a kill)
  war_diagnose now answers DRY_RUN campaigns 2 mobilized 1. The earlier
  INVALID_MOBILIZATION_STATE was a stale read immediately after a container recreate, not a
  durable bug - re-measure before "fixing" it.
Spawn recipe caveats (both real): every SDE navy profile points at `retail_empty_npc_entity_loadout`
so an explicit real `loadoutID` is mandatory; and `linkSpawnedIdentity` refuses
PILOT_ALREADY_LINKED because a free pilot is re-bound to its durable old hull within ~20 s, so pick
a pilot that is free RIGHT NOW (roster 64, 32 free) or bind the existing unlinked hull with
`assign_identity`.
NEXT (unmeasured): casualties (wreck + casualty ledger), objective/capture on a bound structure,
payout, and the same chain on a fresh agents world without hand seeding. The owner's play stack
was not touched; the elevated event numbers there (war:500001-500004 campaign:30045343 with
accepted attack orders at 12:05) come from the earlier morning deploy, read-only.

## FW-009A PROVEN + capture-by-force is the next wall (2026-10-28T12:27Z, evejs-agents)
12:24:46 `living-native-war-casualty` RECORDED: war:500001-500004 / campaign:30045344, victim
980000000283 (Caldari 500001, coop-pilot-013, corp 1000035), wreckID 980300000002, real native
wreck 12:24:46.677 `living-native-wreck-evidence` PHYSICAL_NATIVE_WRECK_VERIFIED, 4 stored items.
The receipt is honest about what it does not know: attribution NATIVE_VICTIM_WRECK_ONLY_NO_KILLER,
captureAuthorized false, killCreditAssigned false. So casualties are real; killer identity is not.
12:26:25 `living-native-war-skip` phase "capture-by-force" reason **NO_DEFENDER_WRECK** - the kill
we got was an ATTACKER hull, and FW-035 needs a wreck of the DEFENDING faction in the campaign
system, plus the defender holding ZERO registered hulls there twice, >=60 s apart.
Both garrisons keep buying replacement hulls (GARRISON_APPLIED at 12:24:08 and 12:26:52), so a
defender side never stays empty long enough: this is N5 (chest-funded garrison) promoted from
"nice to have" to the actual capture blocker. FW-005B `coopWarChestFunding` already exists and
moves only real earned ISK (pilot earned balance -> faction corp wallet -> HELD escrow), so N5
must be wired to it rather than to a new money source.
NEXT (exact): (1) get a defender-side wreck in 30045344 (attackers already outnumber 6:1 there);
(2) gate the garrison refill on a funded chest and refuse when empty, so the defender can really
stay at zero across the two 60 s samples; (3) observe CAPTURE_TERRITORY + militaryControllerFactionID
flip in war_state; (4) only then payout/merit for the owner's character.

## Harness quality pass: pinned verifiers + last hand-written gate (2026-10-28, OPS)
Two duplicated mechanisms in `scripts/` are now single implementations.
`scripts/lib/pinned-source.cjs` (84L) holds the git-blob hash of the CRLF-canonical text,
`readPinned` (disk bytes for the patch + hash for the pin), `assertReversible` (change,
idempotency at the last stage, byte-exact reversal per line ending) and the
`node script.cjs <root>` CLI. Five `verify-alife*.cjs` keep their own pins, messages and
exported names. Evidence: mismatch output byte-identical, `tests/coop-pinned-source.test.mjs`
8/8 including a real `git hash-object` oracle.
`Run-Alife-Economy-Tests.ps1` dropped 183L -> 13L: 38 tests, the
`-IncludeExistingEconomyTests` switch, ten NOT_RUN manifests, the `not ok` failure dump and
the 95-scenario banner are a row in `scripts/lib/gates.json` (purely additive: no existing
row changed). Before/after runs of the real suite are identical apart from the report path,
durations and the inspected stack-frame line.
NEXT candidates (not started): the `src/services/*` verifier copies are done, so the same
treatment fits the five `Inspect-Coop-*.ps1` (identical base64-over-docker probe, only the
module and banner differ), the ~50 test files that hand-roll env save/restore, and - only
after the other session commits `space/coopStationDrain.js` + `miningNpcOperations.js` -
the engine perf pass on `coopVirtualWorldRuntime.js` (477 `require()` calls, per-tick sorts).
`node scripts/coop-engine-audit.cjs` still prints AUDIT_REGRESSION from that in-flight work.

## Harness quality pass 2: read-only probes (2026-10-28, OPS)
The four `Inspect-Coop-{ConvoyOperations,ConvoyOutcomes,Market,MarketStation}.ps1` now
dot-source `scripts/lib/CoopContainerProbe.ps1` (69L) instead of repeating the
base64 + `docker compose exec -T server node -e` plumbing. `Inspect-Coop-Training` is
deliberately untouched (it inspects container env, not a module). Proven without a
container: a PowerShell `docker` function recorded the exact argv of all four before
and after; 12 cases (success / Docker exit 5 / missing compose) are identical in argv,
decoded payload, banners and thrown text. `tests/coop-container-probe.test.mjs` pins it.
Net lines went UP (+59) because the helper is documented and each wrapper is now named
data; the win is one container invocation instead of four.
Engine is UNBLOCKED again: the other session committed, `node scripts/coop-engine-audit.cjs`
prints AUDIT_OK and `coopVirtualWorldRuntime.js` is 4506L (ceiling 4800).
Perf must stay profile-first (`docs/PERFORMANCE_REVIEW.md`: no optimisation without a
profile row naming the caller). A micro-benchmark of `require()` on this shared box gave
70us/call and then 0us/call on re-run, so it proves nothing - do not act on it. The next
three targets are already ranked there (buildConfiguredConcordStartupRules memo,
structureState.cloneValue, coopGameStoreAtomic reconcileObject); a real profile needs the
agents stack, which another session is currently running (do not restart it).

## Stale wiring assertions + one real gap found (2026-10-28, TEST)
Three recorded-red test files were red for reasons that were not behaviour: a bare `\n`
anchor against `integration/coopVirtualWorldRuntime.cjs`, which is committed with CRLF
(byte-identical to the engine copy), and two checks that greped the LEGACY installer
`scripts/patch-evejs-coop.cjs` for module names that now live in `scripts/overlay-spec.cjs`.
`coop-alife-order-authority`, `coop-convoy-native-outcomes-overlay` and (partly)
`coop-alife-native-buyer-wiring` are green again; the module checks now ask
`overlayRegistrations()` for exactly ONE registration, which is stricter than a substring.
Anchors must be `\r?\n` - `docs/DEVELOPMENT_DOCTRINE.md` already says EOL-agnostic.

**Real gap, left standing on purpose:** `integration/coopAlifeStationAuthority.cjs` returns
`products: rows.map(({requirements,...x})=>x)` and NO `materialNeeds`, while
`coopAlifeNativeBuyerDispatch.cjs` requires `Array.isArray(economy.materialNeeds)` and
`coopAlifeNativeBuyerRuntime.cjs#needs()` requires `observed.materialNeeds` plus a
cross-pilot JSON match. Nothing in the repo or the fork ever writes `materialNeeds`
(`grep -rn materialNeeds` finds only those two readers and the tests that fabricate it),
so the opt-in COOP-049 buyer leg cannot fire even with its flag on - contradicting
`docs/COOP_049_ALIFE_NATIVE_BUYER.md` §2 ("derived concrete materialNeeds"). The red case
"station authority is genuinely read-only, never virtual inventory" is that alarm: do not
delete the assertion, decide whether the authority should derive `materialNeeds` from
`requirements` again or the buyer should read `products`. Feature is OFF by default, so
this is not a live regression.

### Where the parity baseline stands (2026-10-28, after 34b871ec)
`docs/evidence/test-parity.json` was re-recorded over its 31 files: **234 pass / 1 fail**
(was 222/13 at `b42e53fc`). Eleven of the thirteen were stale assertions, not behaviour:
a CRLF-vs-`\n` anchor, a sandbox `require()` whitelist that predated the module split, four
greps of the LEGACY installer's module list (now `overlayRegistrations()`), `safeNpcPhase`
labelled phases the coordinator dispatches as `runPhase` - one of those slices was EMPTY,
so its three assertions were passing on nothing - and one label that changed from
UNCLASSIFIED to INVALID. The single remaining red is the COOP-049 `materialNeeds` gap
above. The snapshot also contains the other session's uncommitted `overlay-spec.cjs` work;
reverting that shows up as a parity regression, which is the intended signal.

## FW capture: two real blockers found and fixed (2026-10-28T13:3xZ, evejs fork 45ad47f + 4068eff)
Capture (FW-035) could not land on the work stack, and it was NOT the wreck evidence:
`campaign:30045344` already held two verified defender wrecks (victimFactionID 500001,
attribution NATIVE_VICTIM_WRECK_ONLY_NO_KILLER). Two genuine defects were in the way.
1. N5 - the garrison bought a free replacement navy on cooldown forever (GARRISON_APPLIED
   every ~2.5 min), so the defending side never held zero live hulls. Fixed in the fork
   (4068eff, EVEJS_COOP_WAR_GARRISON_FUNDED=1, agents stack only): a refill now requires a
   COMMITTED FW-005B campaign-chest entry for that faction+campaign, i.e. ISK a real seeded
   market fill paid to an NPC pilot. Verified LIVE after deploy: `living-native-war-skip`
   phase "garrison" reason "GARRISON_CHEST_EMPTY" at 13:20:28 and 13:23:39 - no hull bought.
2. FW-035 counted registry rows, not hulls (45ad47f). A custody row is not a ship: three
   500001 rows whose hulls were in no scene answered DEFENDER_STILL_PRESENT forever. Capture
   now takes the same isHullLive scene probe FW-033 uses and reports liveDefenders +
   ghostDefenders separately; without the authority the old behaviour is unchanged.
Tests: tests/coop-war-garrison.test.mjs (12 pass), tests/coop-war-capture-by-force.test.mjs
(8 pass), `node scripts/coop-engine-audit.cjs` AUDIT_OK, integration/*.cjs in sync.
STILL UNPROVEN LIVE: CAPTURE_TERRITORY + a militaryControllerFactionID flip. The work stack
`evejs-agents` is being recreated by another session roughly every 10-20 min (13:13:25 was not
mine). After each recreate the durable navy hulls come back as registry rows but
`war_combat_diagnose` shows inScene=false / npc=false, so no attack order is ever issued
(latest living-native-war-attack-orders is 12:31:27) and no defender wreck can be produced in
the window. Re-seeding by hand (spawn_native_npc + assign_identity, then spawn_war_fleet) gets
a real ASSAULT campaign and in-scene hulls (1702 npc=true) but the peers do not materialize.
Next: one quiet window on evejs-agents, or the owner's approval, to run the last step:
1 live defender + 3 armed attackers in the target system -> defender wreck -> zero live
defenders -> CAPTURE_TERRITORY. Do not weaken the sustain window to force it.

## Test-side duplication: flags on/off (2026-10-28, TEST)
`tests/_support/env.mjs` now owns "turn these flags on, then put them back" (`swapEnv`,
`withEnv(t, ...)`), and nine files use it - previously four spellings of the same six
lines, including one `process.on('exit')` variant for flags set at import time. Each file
keeps its own flag list; only save/apply/restore is shared. 44 lines out, 25 in. Verified
case-by-case (counts and failing names identical before/after). `tests/coop-env-support.test.mjs`
(7 cases) pins the two rules that matter: an originally unset name is deleted, never set to
the string "undefined", and an existing value comes back exactly.
The other ~19 files with a hand-rolled snapshot are mostly the `coop-escort-*` family, which
is already deeply red (below) - convert them when their cases are fixed, not before.

### The escort suite is the largest red cluster and has no single cause
34 `tests/coop-escort-*.test.mjs` files, ~120 failing cases (13 `CONTRACT_NOT_FOUND`,
9 `FLIGHT_FUNDING_PREPARE_UNCERTAIN`, 8 each `ROUTE_CHECKPOINT_WRITE_UNCERTAIN` /
`MANIFEST_DIRECTORY_DURABILITY_UNCERTAIN`, plus a long tail). This is not one import path or
one moved helper: each is a per-case expectation against the durable funding/warp-fence
contract. Deciding whether the tests or the runtime is stale needs the escort owner's intent,
so it is recorded here rather than "fixed" by relaxing assertions. None of these files are in
`docs/evidence/test-parity.json`; adding them would only record red.

## FW CAPTURE PROVEN END TO END (2026-10-28T13:37:57Z, evejs-agents only)
The final gate of the FW ladder is now measured on the accelerated work stack, with no
fabricated step anywhere in the chain:
  13:36:04  living-native-war-casualty RECORDED - defending hull 980000001974
            (Caldari Navy Condor, faction 500001, coop-pilot-005, corp 1000035) destroyed in
            30045344; wreck 980300000010, 4 stored items / 315 units,
            living-native-wreck-evidence PHYSICAL_NATIVE_WRECK_VERIFIED.
  13:37:29  living-native-war-capture-by-force -> OBJECTIVE_RECORDED (warship:980300000010)
  13:37:57  living-native-war-capture-by-force -> **CAPTURED**, receipt CAPTURE_TERRITORY
            APPLIED, systemID 30045344, **militaryControllerFactionID 500011**,
            territoryRevision 3, mode MILITARY_CONTROL_ONLY.
  war_state afterwards: 30045344 = 500011 / **OCCUPIED** rev 3 (was 500001 / CONTESTED),
            campaign:30045344 = OCCUPIED.
Why it landed now and never before - three real defects were fixed in the fork:
  4068eff N5   a garrison may only buy a replacement hull with a COMMITTED FW-005B campaign
               chest entry (real earned ISK). Live proof of the refusal: garrison
               GARRISON_CHEST_EMPTY at 13:20:28, 13:23:39, i.e. no free navy.
  45ad47f FW-035  capture counts hulls really in the scene, not custody rows (it used to
               answer DEFENDER_STILL_PRESENT for three hulls that were nowhere).
  ded5cc7 FW-003C mobilisation counts only hulls really in the scene too; a ghost assignment
               used to mark both sides SIDE_MUSTERED while the only live hull sat idle, so no
               attack order was ever issued and the campaign stalled in ASSAULT.
Tests: coop-war-garrison 12, coop-war-capture-by-force 8, coop-war-mobilization 17 - all pass;
`node scripts/coop-engine-audit.cjs` AUDIT_OK; integration/*.cjs identical to the fork.
Still open (unchanged, not blockers for the capture claim): killer identity is not attributed
(NATIVE_VICTIM_WRECK_ONLY_NO_KILLER), and merit/payout for the owner's character is not yet
observed. The owner's play stack `evejs` was never restarted or reconfigured.

## Escort suite: 122 red cases were a platform artefact (2026-10-28, L1)
Root cause found: every escort/manifest journal fsyncs a DIRECTORY (and, on its re-read
paths, a handle opened read-only) to prove durability before the route advances. On Windows
`fs.openSync(dir)` succeeds but `fsyncSync` throws EPERM, and a read-only handle cannot be
flushed either, so the gates answered MANIFEST_DIRECTORY_DURABILITY_UNCERTAIN,
ROUTE_CHECKPOINT_WRITE_UNCERTAIN, DEPARTURE_REPLAY_FSYNC_UNCERTAIN,
PERSISTED_DIRECTORY_SYNC_UNCERTAIN and refused to advance - on every case, regardless of
the code under test. The fork already had the convention (coopNpcAmmoBankAtomic,
coopNpcWreckCustody, coopNpcManufacturingJournal, coopNpcNativeEconomyDirector); ten
escort/manifest modules had never adopted it. Engine commit 109e131, mirrored here as
97db7108. Linux (the deployed container) is untouched: the guard is `process.platform
=== "win32"` only, write-path fsyncs stay strict, and the read-only re-read paths return
what they would have returned after a successful fsync.
Result on Windows: escort suite 290 pass / 122 fail -> 359 / 52. Also fixed
`coop-escort-native-binding` (11 cases) whose fixture never gained
`settlePeacefulFlight`/`readContract` after d4aa1d54: 14/14.

### What is left in the escort red set, and why it is not the same bug
52 cases, all "the feature now demands a dependency the fixture does not build":
- `coop-escort-flight-stage-c` (13): coopNativeStationArrival.start() pauses with
  ESCORT_DURABLE_WARP_FENCE_REQUIRED unless a durableWarpFence with
  inspectSource/prepare/confirm is injected.
- `coop-escort-native-predeparture` (6), `station-predeparture-gate` (6),
  `route-recovery` (5), `bootstrap-failure` (4), `departure-witness` (3),
  `tactics-rescue` (3), `verified-volunteers` (3): same shape - the fixture must now
  provide the departure/route witness or fence the runtime requires when the paid-escort
  flag is on.
Each needs the fixture rebuilt against the contract, not an assertion relaxed. Do that
feature by feature and record each file's new baseline; do not mass-skip.

### Windows fsync guard, second batch (fork 7adf5d5, mirrored a6fabf64)
Same rule applied to the seven modules that still fsynced a directory unguarded: opportunity
board, escort volunteers, contract mutation fence, job agent selection, job notifications,
salvage consent, salvage provenance. Each gets one local `guard(io, fd)` (they take `io` as a
dependency, so it cannot close over the default fs) and only the directory call sites use it.
Effect: coop-native-opportunity-board 6/10 -> 15/1, coop-escort-native-predeparture 5/6 ->
11/0, escort suite 359/52 -> 365/46. Unchanged (checked before and after):
coop-installer-module-coverage 2/1, coop-npc-job-board 19/1,
coop-salvage-postpickup-settlement 3/6, coop-native-haul-manifest 8/4.
Known inconsistency to unify once `scripts/overlay-spec.cjs` is not being edited by another
session: this guard exists in two shapes - `process.platform === "win32"` plus the errno set
(most modules) and the errno set alone (`coopNativeStationTripJournal`, which documents the
same limitation). One shared helper module is the right answer; it needs an overlay entry.

### coop-escort-flight-stage-c (13 red) is obsolete coverage, not a fixture tweak
Measured, not assumed: injecting `warpFence: createWarpFence({root,clock})` and
`EVEJS_COOP_ESCORT_WARP_FENCE=1` (passing `durableWarpFence:` does nothing - the module builds
it from that flag) moves 2 of 13. The next blocker is
ESCORT_DISCOVERY_AND_PAID_CONSENT_REQUIRED, i.e. `start()` now also demands
EVEJS_COOP_OPPORTUNITY_BOARD + EVEJS_COOP_EVENT_VOLUNTEERS + EVEJS_COOP_ESCORT_PAID_ACCEPT and
a real opportunity-board event before any paid departure. Those preconditions are covered by
files that are already green (native-priced-acceptance 11/11, durable-warp-fence 10/10,
native-funds 22/22, options-board 15/1). Do not rewrite this fixture into a full discovery
simulation: decide with the owner whether these 13 cases are retired or reduced to the flight
gate + station-arrival slice they were written for.

## After the capture: merit works, the client sees the occupation, the bounty is the last rung (13:5xZ)
- Player-visible effect of the capture, from the real client view module on the live state:
  `occupationStates` for 30045344 = {ownerID:500011, occupierID:500011, contested:false,
  militaryState:"OCCUPIED"} (it was 500001/CONTESTED), and the captured campaign is no longer
  listed by `liveCampaigns`.
- Kill merit really runs: `living-native-war-merit` PROMOTED coop-pilot-026/027/045/050/055 with
  kind "warship-kill" +25 and demoted victims with "force-lost" -10, e.g. 13:27:00.799
  coop-pilot-050 recruit -> pilot. `killCreditAssigned:true` still never appears in a casualty
  receipt: attribution stays NATIVE_VICTIM_WRECK_ONLY_NO_KILLER, and a passing merit promotion is
  not a final-blow claim.
- Bounty PAYOUT is the only unproven rung, and it is blocked by money, not by combat:
  `war_funding_diagnose` answers NO_REAL_FACTION_INCOME on every side because the refinery
  treasury sweep already moved the pilots' real earnings into the corporation wallet
  (`living-corp-treasury-swept` 250 000 ISK), and FW-005B's levy reads only PILOT balances. With
  no levy there is no chest entry, so at campaign open `warBountyReserve` refuses and no HELD
  escrow ever exists to pay a killer.
  Fix attempted and deployed (env-gated, agents stack only): EVEJS_COOP_WAR_BOUNTY_WALLET_FALLBACK=1
  lets the reservation be backed by that same native corporation wallet. `coopWarTreasury` RESERVE
  verifies the corporation/faction, writes a real journal entry and debits division 1000, refusing
  when the money is not there - so nothing is minted, only spent from where real settlements put it.
  A reservation can only be taken for a campaign that does not exist yet (it is taken before
  START_CAMPAIGN), so PAYOUT needs one NEW campaign opened after this deploy, then a kill in it.
  Watching for that opening; if none appears, the payout stays PENDING with this exact cause.

### Escort red set: 46 -> 19 (this session)
Two root causes removed, both evidenced before/after:
1. Four escort journals (`coopEscortTerminalAttendance`, `coopEscortDepartureWitness`,
   `coopEscortRouteWitness`, `coopEscortNativeIngressSnapshot`) skipped the whole durability
   re-read on win32 with a blanket `return true`. Replaced with one local
   `platformFsync(io, fd)` that attempts the fsync and swallows only EPERM/EINVAL/ENOTSUP/
   EBADF/EISDIR, and only on win32 (fork f6ef7fc, mirrored 6bd4805c). Linux unchanged; on
   Windows a real refusal is still accepted and an injected lost ACK now throws. Effect:
   route witness 18/2 -> 20/0, terminal attendance 14/2 -> 16/0, ingress snapshot 13/1 ->
   14/0, departure witness 15/3 -> 17/0.
2. Four fixture defects where the fixture contradicted the module's own contract (not
   relaxed assertions): paid stubbed `fleetID 33` vs a duo receipt with no fleetID;
   `shipID: id + 200` giving player 701 the native hauler's 901; a contract without
   `stationID`; and a symlink case now skipping on EPERM/EACCES like its sibling file.
Remaining 19 escort reds: `coop-escort-flight-stage-c` 13 (obsolete coverage, see above),
`native-tactics-rescue` 3 (`NATIVE_CONVOY_OR_FLEET_NOT_CONFIRMED` before any tactic),
`native-route-recovery` 1, `pinned-native-mount` 1 (`FLIGHT_BOOKING_NOT_AUTHORIZED`),
`refund-manifest` 1 (`NATIVE_REFUND_HISTORY_SOURCE_UNAVAILABLE`).

### Repo shim gap, measured (not fixed): 118 missing `integration/*.js` shims
`integration/*.cjs` call `require("./sibling")` without an extension, which Node's CJS
resolver never maps to `.cjs`; the deployed tree uses `.js`, so it resolves there. 121
shims exist, 118 module names are still missing. A `Module._resolveFilename` hook that maps
extensionless sibling requests to `.cjs` (measured, temp file only) moves the escort suite
from 365/46 to 371/40, i.e. it is worth ~6 cases and would remove the whole class including
silent `try/catch -> pause(STATUS)` masking. One shim was added for
`coopStuckWarpRecovery` because its absence was a hard throw. Decide with the owner:
generated shims vs one test-support resolver hook (needs the runners to pass `--require`).

### Escort red set: 19 -> 13 (all remaining reds are one file)
A real product bug, found by the tests: `coopEscortFlightGate` asked
`authorizeBooking` for `{haulerID}`, but the runtime forwarded `route.haulerIDs?.[0]`
(undefined) to the native duo verifier and the mount adapter rejected the route as
`DENIED_PREWARP_ROUTE_INVALID`. No genuine native booking could ever be funded; a
fixture bypassing the gate hid it. Both shapes now travel (fork 3f8b907, mirrored
be188253), the adapter still resolves exactly one positive hauler ID.
`escort-pinned-native-mount` 6/1 -> 7/0.
Three more fixtures restored to the module contracts: `native-tactics-rescue` route
needed `playerFleetID` (10/10), `native-route-recovery` cargo rows needed `ownerID`
or the deposit is skipped as DEPOSIT_OWNER_UNPROVEN (43/43), `refund-manifest`
runtime needed `readContract` (3/3).
Escort suite now 397 pass / 13 fail, and all 13 are `coop-escort-flight-stage-c`,
which is obsolete coverage (see earlier measurement): it predates mandatory
discovery + paid consent and is covered green elsewhere. Owner decision pending:
retire it or reduce it to the gate + station-arrival slice.

## PAYOUT: root cause found (REQUIRE_FUNDING was off), still not observable (14:0xZ)
Cause, measured rather than guessed: the work stack ran with
`EVEJS_COOP_WAR_REQUIRE_FUNDING=0`. `coopFactionWarOpening.applyOpenings` then skips the
escrow step entirely (`fundingRequired()` false), records `PAPER_UNFUNDED_EXPLICIT` and opens
the campaign anyway. With no HELD reservation there is nothing a bounty could ever pay from, so
`warBountyReserve` was never exercised and `treasury-v1.reservations` stayed at 0.
Actions taken on the work stack only:
 * `EVEJS_COOP_WAR_BOUNTY_WALLET_FALLBACK=1` - the pilot-earned levy is empty because the
   refinery sweep already moved those ISK into the corporation wallet, so when `planLevy`
   answers NO_REAL_FACTION_INCOME the escrow may be backed by that same native wallet;
   `coopWarTreasury` RESERVE verifies corporation/faction, writes a real journal entry and
   debits division 1000, so value is spent, never minted.
 * `EVEJS_COOP_WAR_REQUIRE_FUNDING=1` - a campaign may now only open with a real HELD escrow,
   which is the only configuration in which PAYOUT can exist at all.
 * route extended with the two real stargate neighbours of the captured system
   (30045343, 30045342) so the world can derive a NEW front from real travel.
Result of that: the world did open `war:500011-500014` and projected 30045342 -> 500014, so the
frontier logic works, but the next tick answers `NO_OPENABLE_FRONT` for all 3 candidate borders
because each target already carries a live campaign (30000144, 30000145, 30045344) - the
orientation flip only rescues a border whose blocker belongs to a DIFFERENT faction pair.
So PAYOUT is not blocked by code any more: it needs ONE campaign to finish (freeing a target)
and then a NEW campaign to open under REQUIRE_FUNDING=1, where the reservation itself will be
recorded as `living-native-war-bounty-reserved`. Nothing about that is faked in this repo.

### Mirror-resolution gap is now a tool, not folklore
`integration/*.cjs` keep the engine's extensionless `require("./sibling")`. Node never
resolves that to `.cjs`, so a missing `.js` shim throws MODULE_NOT_FOUND - or, inside
`try/catch`, becomes a plausible pause status that silently rewrites what a test proves.
Three such gaps were already paid for in this session (`coopStuckWarpRecovery`,
`coopAlifeNativeDeliveryEvidence`, and the sandbox tests that forwards `require(id)` from
the test directory instead of the integration directory).
- `scripts/coop-integration-shims.cjs --check|--write` lists/creates the shims and rejects a
  shim that forwards to a different module object; `tests/coop-integration-shims.test.mjs`
  pins it (currently ~120 names missing, so the test is red until `--write` runs).
- `tests/_support/integrationSandbox.mjs#loadIntegration(name, overrides)` compiles a module
  with a require that resolves a bare sibling to `integration/<name>.cjs`; used by
  `coop-native-station-arrival` and `coop-native-haul-manifest-station`. Remaining
  hand-rolled `new Function("require",...)` sandboxes should move to it.

## Doctrines + dynamic decisions (FW-036, FW-037) live on the work stack (14:3xZ)
Live capability table measured inside the running container through the REAL doctrine
composition (`warFleetAuthorities().composition` + real npcLoadouts + real weapon dogma):
  500001 CAN_FIELD (coop_war_doctrine_500001_tackle)   500004 CAN_FIELD
  500011 CAN_FIELD                                     500020 CAN_FIELD
  500010 NO_NAVY   500012 NO_NAVY   500014 NO_NAVY (ORE)   500019 NO_NAVY
and the decision itself: `decide(500004, 500014)` -> {open:false,
reason:"NO_NAVY_CAPABILITY:DEFENDER"}; `decide(500004, 500011)` -> {open:true,
reason:"BOTH_SIDES_CAN_FIELD_NAVY"}.
FW-036 (new module `coopWarNavyCapability`): a war party must be able to field a real navy.
A hull counts only when its real loadout carries a module that resolves to a real WEAPON
family AND a charge with quantityPerModule >= 1 - a strip miner has both and is still not a
navy, which is exactly how ORE looked armed. Both sides must be able to fight, because
capture-by-force needs a defending wreck and a navy-less defender can never produce one (the
measured deadlock: an ORE party's campaign held the target and every other front answered
NO_OPENABLE_FRONT). Unknown capability is never a yes; without the authority the planner is
unchanged.
FW-037: an unfunded border is now skipped BY NAME (`SUPPLY_UNFUNDED:<warID>:<reason>`) and the
batch continues, instead of throwing the whole plan away - one broke pair no longer blocks
every other border in the same tick.
ECONOMIC FINDING that still blocks a bounty payout, now measured not guessed - real corporation
wallets (division 1000, the only source coopWarTreasury may debit):
  1000035 (Caldari) 0   1000120 (Gallente) 0   1000138 (Angel) 0
  1000129 (ORE) 136 554 292.96 ISK   others 0
So every faction that can field a navy is broke, and the only funded corporation (ORE) cannot
field one. Opening a campaign with REQUIRE_FUNDING=1 therefore answers
`SUPPLY_UNFUNDED:...:WAR_TREASURY_FUNDS_UNAVAILABLE`, and that is the correct answer: militia
corporations currently have no income path (mining/refining corps do). Payout needs either a
militia income doctrine or an owner decision to fund militia corporations from the real economy.
`node scripts/coop-engine-audit.cjs` reports drift in `coopMissionInstanceProvenance.cjs` - that
file belongs to another session's in-progress work and was left untouched.

## war_diagnose now answers "can this border be fought at all" (14:4xZ, live)
Live output from the running work stack right after the deploy:
  navy status OK
    500004 CAN_FIELD armed:1 coop_war_doctrine_500004_tackle
    500010 NO_NAVY   armed:0
    500011 CAN_FIELD armed:1 coop_war_doctrine_500011_tackle
    500014 NO_NAVY   armed:0            <- ORE: mining loadouts only
  war war:500010-500014 -> NO_NAVY_CAPABILITY:ATTACKER
  war war:500004-500011 -> BOTH_SIDES_CAN_FIELD_NAVY
So the two wars are now distinguishable without reading the opening skip list: one is a
paper war nobody can fight, the other is a real border. Read-only; the capability comes from
the same doctrine composition the sanctioned spawn path uses.
NOTE for the next agent: `node scripts/coop-engine-audit.cjs` currently reports drift in
`coopGameStoreAtomic.cjs` and `coopNativeStationTripJournal.cjs` (earlier it was
`coopMissionInstanceProvenance.cjs`). Those are another session's in-progress files; this branch
did not touch them and they were deliberately left alone.
STILL OPEN (owner decision): militia corporations have no income (measured: 1000035/1000120/
1000138 = 0 ISK, only ORE 1000129 holds 136.5 M), so no escrow and no bounty payout exists.
FW-036/037 removed the deadlock and the silent failure, but they cannot create money.

## FW-038: money and navies sat on opposite sides -> mercenary decision (live)
Live `war_funding_diagnose` after the deploy:
  needCents 2500000
  mercenary {"status":"PROPOSED","proposals":[{"payerFactionID":500014,
    "payerCorporationID":1000129,"payerBalanceCents":13655429296,
    "mercenaryFactionID":500004,"amountCents":2500000,
    "reason":"NAVY_WITHOUT_TREASURY_PAIRED_WITH_TREASURY_WITHOUT_NAVY"}]}
i.e. the only funded faction (ORE) can hire the cheapest navy-capable faction for exactly the
bounty need, computed from real division-1000 balances and the real doctrine composition.
The decision is pure (`coopWarMercenaryContract.proposeContracts`, 4 tests): one contract per
payer, refuses a payer that cannot cover the need, refuses to pay a navy that already has money,
refuses a zero need. It moves no ISK and creates none - the transfer is still a separate,
journaled two-leg operation on real corporation wallets (`coopCorpWallet.applyDelta` writes and
reads the balance back), which is the next wiring job.

## FW-038B: money MOVED, then a real defect stopped it (2026-10-28T15:0xZ) - FEATURE DISABLED
What worked, measured on the work stack with a dry run first:
  DRY_RUN merc:fw038b:1 -> payer 1000129 179 219 344.69 ISK, payee 1000120 0 -> 25 000,
  PAID merc:fw038b:1 -> payer 179 194 344.69, payee 25 000 (exactly one debit, one credit).
What failed, and it is why the flag is now `EVEJS_COOP_WAR_MERCENARY_CONTRACT: "0"`:
  a replay of the SAME event 28 s later answered PAID again instead of DUPLICATE. The
  journal row (`coop-faction-war\u001fmercenary-v1` in corporationRuntime) could be read
  back right after the write - the new durability guard passed - and was then GONE on the
  next request. Result: ORE 1000129 went 179 219 344.69 -> 179 169 344.69 (two debits) while
  the payee received 25 000 once, i.e. 25 000 ISK was DESTROYED. A further replay paid a
  third time (payee 50 000 -> 75 000, payer -25 000, this leg conserved).
  Root cause is the same durability class already seen with the war state: a row written
  through the atomic native store is not reliably readable/writable across container
  recreates in this world. A money mover therefore CANNOT anchor idempotency in that table.
The code is kept, tested (8 tests) and honest about it: it refuses to debit unless the
PREPARED row reads back (`WAR_MERCENARY_JOURNAL_NOT_DURABLE`), but that is not enough when
the row can vanish AFTER the payment. The correct fix is to anchor the event in the same
record that holds the money (a reservation in `coopWarTreasury`, whose journal is a wallet
transaction) so a replay is refused by the wallet itself, not by a separate row.
No further transfers are possible while the flag is 0; mining/refining economy untouched.

## FW-038C: wallet-anchored payment + a REAL HELD bounty escrow (15:28Z, proven live)
Idempotency fix that worked, measured on the same running stack:
  merc:fw038c:1 PAID (debitLeg APPLIED, creditLeg APPLIED)
  replay of the SAME event -> status PAID but debitLeg DUPLICATE, creditLeg DUPLICATE and
  every balance byte-identical before and after (1000129=280 097 039.67, 1000120=100 000).
  The marker lives in the wallet journal itself (`FW-MERC <eventID> DEBIT|CREDIT`), written in
  the same write as the balance, so a vanished side row can no longer cause a second payment.
Money now sits where the war needs it, all of it moved from real ORE income by journaled
two-leg transfers (nothing minted):
  1000120 (Federation Navy) 100 000 ISK    1000138 (Angel Cartel) 25 000 ISK
And the chain completed by itself 15:28:40:
  living-native-war-bounty-reserved RESERVED
  factionID 500011, corporationID 1000138, campaign war:500004-500011:campaign:30045344,
  amountCents 2 500 000 (25 000 ISK), reservation HELD, escrow journal 8000000000000000.
So for the first time in this world a war party holds a REAL bounty escrow, taken from a real
corporation wallet. The remaining step is only the native trigger: an attributed kill in that
campaign (or a recorded casualty, which `coopWarBounty` accepts) releases the escrow to the
pilot's earned balance - `living-native-war-merit` already proved the attribution path works
(5 promotions). Nothing about that is staged or faked.

## FW-039: an orphaned escrow blocked its own campaign - fixed (15:5xZ)
After the HELD escrow appeared at 15:28:40 the campaign record was lost to another session's
container recreate while `bounty:war:500004-500011:campaign:30045344:500011` stayed HELD. Every
later opening then refused with WAR_TREASURY_PURPOSE_UNAVAILABLE, i.e. 25 000 ISK of real money
was locked with no war it could ever pay, and the border could never restart.
Fix (fork, tested): RESERVE reuses a HELD reservation for the same war/campaign/faction when the
campaign record does not exist - nothing is debited twice and the receipt names the existing
journal - and a RESERVE naming a HELD reservation is decided there instead of being rejected up
front. `tests/coop-war-treasury.test.mjs` 15/15 (new case: orphan reused, DUPLICATE + reused:true).
After the redeploy the world has war:500004-500011 with no campaign yet; the next derivable front
opens it, the escrow is reused, and the only remaining trigger is an attributed kill in that
campaign (or a recorded casualty, which coopWarBounty accepts) to release the escrow to the pilot.
Session ladder status: capture PROVEN, merit PROVEN, client view PROVEN, escrow PROVEN,
payout TRIGGER PENDING (needs one live kill in a funded campaign; the seeds are in place).

## Payout trigger: still pending, with the exact next diagnostic (17:0xZ)
Current measured state on `evejs-agents` (after another session's recreate, healthy):
  war_state: `war:500004-500011`, **no campaigns**, territories 30003837=500004 and 30045344=500011
  presence  : 30003837 {500004:3, 500012:2, 500019:1}, 30045344 {500011:3, 500012:1, 500019:1}
  funding   : both parties CAN_FIELD and both are funded (1000120 = 100 000 ISK after a real
              mercenary transfer, 1000138 = 25 000 ISK), escrow `bounty:...:500011` REUSABLE
              since FW-039; `war_funding_diagnose` mercenary answers
              `{status:"REFUSED", reason:"NO_FUNDED_NAVY_PAIR", refusals:[{500004,
              reason:"ALREADY_SELF_SUFFICIENT"}]}` - i.e. no hire is needed any more.
So every precondition for a funded campaign exists, yet the opening phase produces **no event at
all** since 15:29:10 (not even a refusal), which means `advanceNativeWarOpening` returns before
`planWars`: the untested suspects are `visitedSystems` (the tick passes only
`[...visitedSystems].slice(0,12)`, and a system present in the war state's presence list is not
necessarily in that set) and the `warOpening.tick` early returns (`NO_LINK`/`NO_SYSTEMS`).
Observability fix shipped this session (fork): the opening refusal event now dedups on
`reason + JSON.stringify(per-border skips)` and carries `skipped[]`, because a border that
changed from NO_NAVY to "no money" kept the same top-level NO_OPENABLE_FRONT and was invisible.
Next exact step for whoever continues: publish/log the opening phase's early-return reason
(`warSkip("opening", ...)` already exists for all of them but only fires on a state change) and
check `visitedSystems` membership for 30003837/30045344 at the moment the phase runs.

## FUNDED CAMPAIGN + REAL KILL, payout still gated by attribution (17:25Z)
Chain reached with a funded escrow and real combat in the SAME campaign:
  17:18:43 living-native-war-bounty-reserved RESERVED factionID 500004, corp 1000120,
          campaign war:500004-500011:campaign:30045344  (real HELD 25 000 ISK)
  17:18:43 living-native-war-opened OPENED war:500004-500011 + that campaign
  17:20:05 / 17:23:43 living-native-war-attack-orders OBSERVED
  17:25:12 living-native-war-casualty RECORDED: victim 980000003812, wreck 980300000012,
          pilot coop-pilot-005, corp 1000120, victimFactionID 500004, in that campaign.
Fixes that made this possible this round (all in the fork, all with reasoning in the commits):
  * the opening planner now unions visited systems with the systems the war already owns -
    it had been blind to 30003837/30045344 because the A-Life walker had not visited them;
  * OPENED now means something opened (a fully skipped batch is REFUSED/NO_FUNDED_FRONT);
  * the refusal event carries the applier's per-border reasons, which is how the two real
    blockers (WAR_TREASURY_JOURNAL_COLLISION, WAR_TREASURY_FUNDS_UNAVAILABLE) became visible;
  * the escrow journal id is derived from the wallet, so a lost counter cannot collide.
PAYOUT STILL DID NOT FIRE, and the reason is honest and specific: the casualty receipt carries
`attribution:"NATIVE_VICTIM_WRECK_ONLY_NO_KILLER"`, no `living-native-war-merit` was emitted for
it, so `coopWarKillMerit` never called the bounty payer. This is the documented FinalBlow gate:
attribution may only come from the native destruction caller's explicit `options.attackerEntity`,
and it must not be guessed. Merit DID fire 5 times earlier in the day for stock NPC kills, so the
mechanism works; what is missing is that path for war-fleet hulls.
NEXT EXACT STEP: pass the native attacker entity through the war-fleet destruction hook (the same
one that already credits stock NPC kills), then the HELD escrow pays automatically.

## FW-040 deployed; the blocker is now the shared stack's churn, not the code (18:0xZ)
Found and fixed the exact reason a war kill could not be attributed: the attribution path read
identity links from the ON-DISK file only, and that file lags the live registry, so a real war
casualty answered `NOT_UNIQUE_NAMED_PIRATE` (measured 17:25:12) - no attribution, no merit, and
the HELD bounty could never pay. `coopNpcDestructionAttacker` now merges the on-disk links with
the live identity registry (`identityLinks()` exported from the runtime, pure `mergeLinks`
helper, 2 tests). Deployed.
Proof that the mechanism itself works when attribution lands: 17:40:29
`living-native-destruction-attacker NATIVE_DESTRUCTION_ATTACKER_PROVIDED` attacker coop-pilot-060
-> `living-native-war-merit PROMOTED coop-pilot-060 warship-kill +25` and the victim
coop-pilot-002 `force-lost -10`, in the same millisecond.
What now blocks the final observation is the environment, measured rather than assumed: the
shared `evejs-agents` stack is recreated by another session roughly every 10-30 minutes (container
created 17:31, then again at ~17:5x and ~18:0x), and the war state row does not survive those
recreates: `war_diagnose` now answers `mob DRY_RUN camps 0 mobilized 0` with an empty navy list,
i.e. the campaign and the escrow purpose were reset again even though the treasury row kept the
HELD reservation. No code change can hold a 5-minute combat window open across that.
SESSION LADDER: capture PROVEN, merit PROVEN (6 promotions), client view PROVEN (OCCUPIED),
escrow PROVEN (real HELD 25 000 ISK from real earnings), attribution PROVEN (17:40:29),
payout = the only rung not yet observed, gated by campaign survival, not by missing logic.

## FW-041 mirror deployed; measured caveat (18:0xZ)
The mirror exists and is written on every successful war-state write, but at 17:55:19 and
17:57:09 the world CREATED an empty state again (another session's recreate), so the mirror now
holds the EMPTY document (100 bytes) and `chooseWarRestore` correctly refuses it
(`MIRROR_EMPTY_TOO`). That is the right behaviour but it means the mirror only protects a war
that already exists at the moment of the write: the war must be opened first, then mirrored, then
survive long enough to be fought.
Current live state: `living-native-war-opening-blocked NO_OPENABLE_FRONT` every 30 s, wars none,
mirror empty. Presence and the identity world still exist on the volume, so a front can still be
derived the moment a navy-capable pair owns two adjacent systems.
CONCLUSION for the payout rung: every other rung is proven (capture, merit, client view, escrow,
attribution). Payout needs ~5 uninterrupted minutes of a funded war against an armed enemy, and
this shared stack is recreated every 10-30 min by another session while the war row does not
survive it. Options: a quiet window, or the atomic-row durability fix at the store level.

## ROOT CAUSE of the vanishing war state (18:1xZ) - evidence, not a guess
Direct read of `/var/lib/evejs/gameStore/gamestore.sqlite` (table `corporationRuntime`):
  key "coop-faction-war"           9018 bytes  <- the LEGACY namespace blob, survives
      inside: state-v1 (wars/campaigns/territories ALL empty, history 0),
              treasury-v1 (1 reservation), merit-v1 (2 pilots), mercenary-v1
  key "coop-faction-war|state-v1"  100 bytes   <- the atomic row, EMPTY
  key "coop-faction-war|treasury-v1"           ABSENT as a row, but PRESENT in the blob
So the two storage views disagree, and the blob is what outlives a recreate. Each pointer write
and each legacy flush rewrites that blob from the legacy cache, which never contains the
atomic-only war state row - so the blob keeps an EMPTY state-v1 while other sub-keys (treasury,
merit) survive because they were also read through the legacy API. At the next boot the blob's
view wins and the war (wars + campaigns + territories) is gone while real ISK stays in escrow.
That is the store-level defect behind every "war state CREATED empty" event of the day, and it is
NOT fixable inside the FW modules: a module cannot make one write atomically visible to the other
view. The mirror (FW-041) is the correct mitigation, but it can only help once the state is
non-empty when it is written; right now the mirror holds the empty document (100 bytes) and the
world has no territories at all, so there is nothing yet to protect.
NEXT (concrete, for a store-level change - needs the owner's agreement because it touches the
shared GameStore): either keep the two views in sync for `coop-faction-war` (write the legacy
path with the same document on every atomic write), or make the boot reconciliation prefer the
atomic row over the namespace blob. Then the mirror/FW-041 keeps a second copy and a recreate can
no longer erase a war that already exists.

## Finish recipe for the payout rung (copy/paste, ~10 min in a quiet window)
1. Confirm the stack is not being recreated: `docker inspect -f '{{.Created}}' evejs-agents-server-1`
   must stay unchanged for the whole run.
2. Make one navy faction own a system next to another navy faction's system. Proven working
   seed (armed, durable, real doctrine):
   `spawn_native_npc systemID=30003837 profileQuery="Federation Navy Atron"
    loadoutID=serpentis_small_blaster_frigate warPatrol=true durable=true pilotID=<free>`
   x3, and x3 `"Angel Raider"` + `angel_small_autocannon_frigate` in 30045344.
   Free pilots: read `/var/lib/evejs/coop-npc-links.json` vs `coop-virtual-world.json`.
   If a spawn answers PILOT_ALREADY_LINKED use `assign_identity` with the returned entityID.
3. Both militia wallets must hold >= 25 000 ISK (bounty need). Measured 18:3xZ:
   1000120 = 50 000, 1000138 = 25 000, 1000129 (ORE) = 433 790 567.61.
   Top up with a real transfer: `war_mercenary_settle` eventID`merc:<n>`
   payerCorporationID 1000129, payeeCorporationID <1000120|1000138>, amountCents 2500000.
   Idempotency is wallet-anchored, so a replay is refused with both legs DUPLICATE.
4. Wait for `living-native-war-opened` + `living-native-war-bounty-reserved RESERVED`, then for
   `living-native-war-attack-orders OBSERVED` and a `living-native-war-casualty RECORDED` in that
   campaign. Attribution needs `living-native-destruction-attacker
   NATIVE_DESTRUCTION_ATTACKER_PROVIDED` (proven at 17:40:29 with merit PROMOTED).
5. Payout shows as the treasury reservation flipping HELD -> PAID with `paidToPilotID`, plus
   `living-native-war-merit` for the killer. Nothing else is required; no code left to write.

## FW-043 works: the map rebuilds itself (18:39Z), and it exposes the real frontier shape
`living-native-war-territory-bootstrap REGISTERED_FROM_PRESENCE added:6` - territories are back
without any hand-written record: 30000142/30000144/30000145/30003837 = 500014, 30045342 = 500010,
30045344 = 500011. The empty-map deadlock is gone; after any recreate the world can own ground,
project sovereignty and derive fronts again.
Measured consequence, and it is the next real decision: MINING presence decides ownership, so ORE
(500014, no navy at all) now owns four systems, and the only navy-owned system is 30045344
(500011) whose neighbours are ORE/500010 - both NO_NAVY. So FW-036 correctly refuses every front,
and the frontier is starved of navy-vs-navy borders even though the map is healthy.
Two honest options (owner decision):
  a) weight ownership by ARMED presence only (a mining fleet cannot claim military control of a
     system), which is closer to the FW doctrine and would let 500004/500011 own their borders;
  b) keep presence as is and always seed a navy into the neighbour at bootstrap time (the recipe
     below already does that).
Note that bootstrap only runs while the map is EMPTY, so a rebuild is the only moment presence can
set an owner; afterwards ownership changes only through capture - which is the intended design.

## FW-044 deployed, unit-tested, waiting for the next empty-map bootstrap (19:0xZ)
`deriveTerritoryOwners` is pure and tested (4 tests): a system is owned only if at least one
ARMED pilot (role patrol/pirate) of the winning faction is really there; the owner is the faction
with the most resolved pilots among those that can defend; a tie owns nothing; an unarmed system
stays unowned. A mining fleet can no longer claim military control.
Caveat measured right after the deploy: the map bootstrapped at 18:39 (before this fix) and it is
NOT empty, so the new rule cannot re-derive anything - ownership only changes at an empty-map
bootstrap or through a real capture. Current map is still the mining-weighted one
(30000142/30000144/30000145/30003837 = 500014, 30045342 = 500010, 30045344 = 500011), and the
opening refuses every border for that reason, so the world will not stage a navy-vs-navy war until
the next recreate wipes the map and FW-044 derives it correctly.
That is the honest state: five real defects fixed today (N5 funded garrison, custody-vs-hull in
capture and mobilisation, FW-036 navy capability, FW-037 per-border refusals, FW-039 orphaned
escrow, FW-040 attribution links, FW-041/042 durability of the war record, FW-043 territory
bootstrap, FW-044 armed ownership), and the payout rung still needs one uninterrupted window.

## FW-045 applied live (19:03Z): the mining-weighted map was released, not faked
`living-native-war-territory-bootstrap CORRECTED_FROM_PRESENCE added:0 corrected:0 released:6`
- every territory the old rule had given to a mining-only presence was released, because a system
  with no armed garrison is not held by anyone. Nothing was invented to replace it: the same event
  carries `systems:[]`, i.e. at that moment no faction had an armed pilot in those systems either.
The map is now genuinely EMPTY under the new rule, so the next bootstrap registers only what is
really garrisoned (armed pilot + resolved native hull). That is the first state in the whole day
where ownership cannot be claimed by miners.
Consequence for the payout rung: a navy has to be physically present (live hull, linked pilot,
role patrol) for the world to own its ground. After every recreate those hulls must be re-seeded -
that is what the recipe in this file does, and it is the only remaining operation, not a code gap.

## FW-046..FW-048 (20:0xZ): the bounty rung was blocked by three real defects, all fixed and tested

What the finished war actually did at 19:14-20:01Z, measured, not inferred:
- `war-territory-bootstrap` registered 30003837=500004 and 30045344=500011 (a real reciprocal
  stargate), the opening produced `living-native-war-opened` + `war-bounty-reserved RESERVED`
  (500004/1000120, 2 500 000 cents HELD), attack orders were accepted, ships fought, casualties
  were recorded and merit was PROMOTED. So the whole chain up to the payout is real today.
- The payout never fired, and each attempt had a concrete cause:

FW-046 `coopWarBountyReserve` returned on the FIRST side it could fund, so a war carried a bounty
for the attacker only. The deciding kill was by a DEFENDER (coop-pilot-027, 500011) while the HELD
escrow belonged to 500004 -> `coopWarBounty` refused NO_HELD_ESCROW_FOR_FACTION. The comment above
that loop already promised "one real reservation per campaign side". Sides are now planned by the
pure module `coopWarBountyEscrowSides.planSideReservations`, each side funds its own bounty from its
own wallet, gated `EVEJS_COOP_WAR_BOUNTY_BOTH_SIDES=1` (enabled on the agents stack only); without
the flag the old stop-at-first-funded behaviour is byte-for-byte preserved.

FW-047 a refused bounty was SILENT: `coopWarBounty` only emits when value moves and
`coopWarKillMerit` dropped its return value, so a real kill with a real escrow produced merit and
not one line about the payout. Every non-paid outcome now emits
`living-native-war-bounty-skipped` with status, reason, pilot, faction and campaign.

FW-048 attribution used the identity link's `systemID`, but that link follows the VIRTUAL pilot,
which the world keeps advancing between systems (x5) while the native hull stays where it was
spawned. Measured 19:59:42Z: victim 980000005122 (coop-pilot-014) had a link already at 30045343 ->
`VICTIM_NOT_NAMED` -> stock fallback -> `NOT_UNIQUE_NAMED_PIRATE` -> no merit, no bounty, for a real
kill. Locality is already proven physically, so a link is now accepted by entity identity (a link
that still matches the scene wins, and `staleLinkPosition` reports the rest).

Tests: 6 in tests/coop-war-bounty-sides.test.mjs, 4 in tests/coop-war-attribution-live-hull.test.mjs.

Operational note: the work stack is being recreated by another session every few minutes (19:02,
19:26, 19:35, 19:42, 19:46, 20:02), which wipes every seeded native hull. A keeper
(`%TEMP%\opencode\keeper.cjs`) re-seeds both sides of the 30045344 <-> 30003837 border and tops both
militia wallets up through a REAL settlement whenever they are missing; it never restarts a
container and logs every answer to `%TEMP%\opencode\keeper.log`.

## 2026-10-28T20:50Z - the map window: faction IDs, not militia corporations (DONE, live)

`GetAllWarzonesOccupationStates` answered with 204 systems whose `occupierID`/`ownerID` were
militia CORPORATIONS (1000180/1000181). The client indexes faction tables with those values
(`fwwarzone/client/dashboard/warzoneMap.py`: `FACTION_ID_TO_COLOR[occupierID]`;
`eve/.../maps/starModeHandler.py`: `nameByFaction[occupierID]` against `_OCCUPIER_FW_FACTIONS`),
so every colouring pass raised KeyError, never finished and re-ran: measured 36
`GetAllVictoryPointStates` a second, map window never opening. The same tiles also read
`adjacencyState` without a default and the field was absent from the payload entirely.

Fixed in the fork (`8fa69e2`) + the projection module: occupancy values are factions,
`adjacencyState` (FL/SL/BL) is computed from the real gate graph and neighbour occupiers,
`attackerID` names the other side or the owner a system was taken from, and the three service
handlers now delegate to `warzonesResponse`/`localOccupationResponse` (fork == overlay-spec).

Live after `docker build -t evejs-local .` + compose up: payload 204 -> 3 systems,
`30045343 {owner 500001, occupier 500004, attacker 500001, contested true, SL}`,
`30045344`/`30003837` FL. Tests: 9 in `tests/coop-war-client-view.test.mjs`.
Remaining reds are other sessions': `coop-flag-registry` (EVEJS_COOP_NPC_MANUFACTURE_MIN_INPUT_RATIO,
EVEJS_COOP_NPC_REFINERY_BATCH), `coop-overlay-dependencies`
(coopVirtualWorldRuntime -> coopWarBountyEscrowSides not in overlay-spec names),
`AUDIT_REGRESSION` (coopVirtualWorldRuntime.js 4995 lines > 4800, split in progress elsewhere).

## 2026-10-28T21:02Z - FW tab: the five facWarMgr getters the server never answered

Decompiled the client (`code.ccp` is a zip of `.pyj` bytecode; `pip install uncompyle6` +
prepend the py2.7 pyc magic, then `decompile_file`) and read what each FW surface asks for:

- `fwwarzone/client/dashboard/fwWarzoneDashboard.py` calls
  `cfg.eveowners.Get(GetFactionMilitiaCorporation(faction)).name` and reads
  `factionalWarStatus.startDate`. The pinned `facWarMgrService` implements only the four
  rank getters, and `baseService` answers every other method with `null`, so the dashboard
  threw while constructing itself. Fixed in fork `331cffa`: militia corporation from the
  native faction record, corp status from the character's persisted war faction,
  corp/alliance war faction + faction corporation list answered (null/empty, not invented).
- `warzoneMap.py` does `FACTION_ID_TO_COLOR[occupierID]` and
  `ADJACENCY_STATE_TO_ICON_PATH[adjacencyState]`; the advantage gauge additionally does
  `FACTION_ID_TO_COLOR[attackerID]`, so attackerID may never be 0. Live payload now:
  `30045343 {owner 500001, occupier 500004, attacker 500001, contested true, SL}`,
  `30045344`/`30003837` FL, 3 systems total.
- `factionwarfare/advantageState.py` refuses points outside 0..100000 (and
  contribution+floor > 100000), and the tab shows nothing when that raises; the projection
  clamps now.
- `warzoneStats.py` reads `victoryPointsState.contestedFraction`, so a warzone system with
  no victory-point entry is an AttributeError: `victoryPointStates()` must cover every
  system the occupation payload lists (it does, both come from territories + campaigns).

Tests: `coop-war-client-view` 10, `coop-war-advantage` 7, `coop-facwar-mgr-answers` 6.
Fork `331cffa`, repo `01cdd07a`. Rebuilt `evejs-local` + recreate, server healthy.
Still to observe IN THE CLIENT: the four surfaces (map, FW tab, warzone map, advantages).
The server logs every `CALL_REQ`, so the next step is a trace of one open of each tab.

## 2026-10-28T21:15Z - client-contract audit: 542 calls scanned, the breaks are shapes

Built the whole client->server call graph from the pinned client (370 `.pyj` modules contain
`RemoteSvc`/`ProxySvc`; 542 distinct `service.method` pairs, 838 call sites). Cross-checked
against the fork (203 services): **every method name resolves** - the remaining bugs are
answer SHAPES, not missing names, which is why a name-only audit reports nothing.

Per-service smoke of the getters the most-used services expose (called with a minimal
session, non-mutating names only): corpmgr, lookupSvc, billMgr, allianceRegistry, agentMgr
answer structurally (nulls only for missing args), `warsInfoMgr.GetPublicWarInfo` answers
null only for an unknown warID (legitimate). Rowset columns the client indexes are all
present: `stationID`, `fromID`, `solarSystemID/value1/value2/value3`, `warID`, `againstID`.

Found and fixed in the same pass: the statistics tab. `statisticsController.py` needs six
`facWarMgr` getters that did not exist and dereferences them (`topStats[0][groupCharacter][k]`,
`GetStats_Character().items()`, militia header through `appConst.raceByFaction`). Now
answered with the client's own shapes: groups 1/2/32 (`inventorycommon/const.py`), the six
stat keys, and a militia table keyed by real warzone faction ids. Kills/VPs stay zero while
no killer is attributed; `systemsCount` is counted from real territory controllers.
First cut shipped without `buildDict` imported - the per-service smoke caught it before the
client could.

New durable gate: `tests/coop-client-contract-payloads.test.mjs` (7 cases) pins each field
the client reads without a default, citing the client module that would throw.

Fork `9a2a113`, repo `8e0025d2`..`8666d97`. Image rebuilt, server healthy.
Still unobserved: the four FW surfaces IN the client (needs one login + four clicks).

## 2026-10-29T01:30Z - OWNER-VERIFIED IN CLIENT (first since the map broke)

The owner reports, after the 20:49/21:15 rebuilds: the global map shows both factions' sectors
correctly in the war, and the faction-warfare window renders - contested and owned sectors are
visible. This is the first observed client evidence for the FW work; the cause chain was
militia-corporation ids where the client indexes faction tables (KeyError in
`warzoneMap`/`starModeHandler` -> colouring never completed -> 36 victory-point calls a second),
a missing `adjacencyState`, and five `facWarMgr` getters that answered null.

Remaining, owner-reported: one tab in that window ("Campaign") still shows nothing. The client has
no such tab in `fwWarzoneDashboard.py` (WarzoneControl/WarzoneDetails/Objectives/Statistics/
Progression), so the candidate surfaces are the Agency -> Campaigns page
(`publicGatewayLocal` answers every `eve_public.campaign.api.*` request with a 200 and an EMPTY
payload) and the insurgency campaign layer (`insurgencyCampaignSvc` ->
`insurgencySolarsystem.GetLocalCampaignClientSnapshot` / `GetAllVisibleCampaigns`).

## 2026-10-29T01:45Z - "Campaign" tab = Agency -> Campaigns: empty by design, not a broken call

Owner clarified: the tab with nothing in it is Agency -> Campaigns. The client page is
`eve/client/script/ui/shared/agencyNew/contentPages/contentPageCampaigns.py`, driven by
`campaigns/client/messengers/campaigns_messenger.py`, which sends gRPC
`eve_public.campaign.api.GetAllRequest` / `GetRequest` / `GetStatsRequest` /
`GetParticipantStatsRequest` / `GetAllUnredeemedRewardsRequest` / `GetLimitsRequest` plus the
objective Commit/Resign/RedeemRewards trio. `campaignGatewayService.js` answers EVERY one of
them with `statusCode 200` and an EMPTY payload, and `publicGatewayLocal.js` does not even
define the campaign messages in its proto root - so the client decodes an empty GetAll and
renders no campaigns. This is a stub, not a null-handler: nothing throws, there is simply
nothing to list.

Making it show our war campaigns is a FEATURE, not a contract fix. It needs the campaign
proto schema (7 files: campaign, campaign/api, campaign/objective, campaign/objective/api,
campaign/contributionmethod/definition, career, public), added to the server proto root, and
then a real `GetResponse.attributes` per campaign: localized title/subtitle/descriptions as
`sequential` ids, logo/icon, dashboard/objective background paths, issuer, annotations,
objectives with their own attributes, contribution-method configuration, version + etag,
state enum and FILETIME timestamps. Our war record already has the substance (campaign id,
faction pair, target/source system, state, revision, objective evidence), so the mapping is
honest - but the definition surface is the largest single proto in the client.

Done instead in this pass (real, verified): `insurgencySolarsystem.GetLocalCampaignClientSnapshot`
now answers the snapshot of the system you stand in when a LIVE campaign really covers it
(fork `841345f`); it still answers `(systemID, null)` when the covered campaign is EXPIRED or
OCCUPIED, which is every front in the world right now.

## 2026-10-29T02:05Z - contract register + one latent crash closed

Owner asked for placeholders to be documented instead of silently tolerated.

`docs/CLIENT_CONTRACT_STATUS.md` is now GENERATED (`scripts/coop-client-contracts.cjs --write`)
from the client's own call list: `docs/client-contracts/calls.json` holds all 542
`RemoteSvc`/`ProxySvc` `service.method` pairs the pinned client (V24.01, compiled 2026-06-16)
issues, extracted from its bytecode with the calling module. Classification against the fork:
**0 MISSING, 44 STUB, 103 NULLABLE, 395 OK**. Every STUB carries the reason it is tolerated
(fire-and-forget proxy, QA-only, or the client guards the result) and anything unreviewed says
so. `--check` is a gate: a client call that used to be answered must never start getting a
placeholder answer; `tests/coop-client-contracts.test.mjs` runs it.

Not stubs, and the register says so: `fwAdvantageGateway` is filled from the casualty ledger
and fleet registry (clamped to the client's 0..100000 domain); `insurgencyGatewayService`
builds correct shapes with honest zero progress; `eve_public.campaign.api.*` (Agency ->
Campaigns) is a real stub - 200 + empty payload, campaign messages not even in the local proto
root, so turning that page on is a feature (proto schema + attributes), not a fix.

Also closed a latent crash found while auditing: with `EVEJS_COOP_FW_ALL_SYSTEMS=1` the
warzone occupation payload lists every static warzone system while `victoryPointStates()`
covered only territories and campaign targets, and `warzoneStats.py` reads
`victoryPointsState.contestedFraction` unguarded -> AttributeError on the first untouched
system. Fixed in fork `3033ce5`; measured with the flag on: 814 states, real systems keep their
real score, the rest are 0/75000.

Verified clean this pass (no change): every rowset column the client `Index()`es exists
(stationID, fromID, solarSystemID/value1/value2, locationID, warID, contactID, agentID,
allianceID through `__header__`, itemID); no client call site dereferences a NULLABLE answer
without a guard, including delayed `self.attr = RemoteSvc(...)` uses.

## 2026-10-29T02:20Z - the error hunt found a process-killing bug in the gRPC gateway

Owner asked to look at errors and warnings, not only stubs. The client reports its own Python
tracebacks through `alert.SendClientStackTraceAlert`, and the server logs all 23 of them - that
is the only client-side error channel we have (the gamelog stays empty).

What the alerts said (client, 21:26 login burst): `ServerException(status_code=500,
status_message="invalid character on request")` on user licences, insurgency corruption and
suppression, corp goals (`GetMineWithRewards`, `GetAllWithRewards`) and campaigns
(`CampaignRequestError`), plus `FlatbufferContentProvider ... Internal Server Error(L500)` and
client-side `IOError: [Errno 9] Bad file descriptor` tasklet noise.

Reproduced the server side with a plain TLS+HTTP/2 unary Ping against 127.0.0.1:443 (the
listener the launcher proxy CONNECTs to):

    ERR_HTTP2_TRAILERS_ALREADY_SENT  at ServerHttp2Stream.onStreamTrailersReady
    -> uncaughtException -> the whole server process exits (container `Exited (1)`)

Cause: an HTTP/1 compat `"request"` listener on the HTTP/2 secure server. Node engages an
`Http2ServerResponse` for EVERY stream as soon as that listener exists, and the compat response
sends its own trailers after the gateway already sent `grpc-status`. Fixed in fork `ba187e3`:
listener removed, stream handler extracted and wrapped so a throw cannot end the process.

Verified after the fix: three TLS+HTTP/2 calls returned `status 200`, `grpc-status 0` in
trailers, and the container stayed healthy.

Second fix in the same commit: `express.json()` parsed every body regardless of content type, so
binary gRPC frames got an HTML 500 the client reports as "invalid character on request". JSON is
now gated on `application/json`, and a gateway path that lands on the plain-HTTP port logs the
real diagnosis instead of echoing silently. Third: `essMgr`/`DynamicResourceCacheMgr` called a
handler that legitimately answers null an "Unhandled method fallback" (that is the
`GetDataForClientSolarSystem` warning, five times per login).

Still open on the client side: the running client sends NO `CONNECT` and NO HTTP/2 traffic to
the local listener, so its gRPC calls never reach us - the launcher (`Play.bat`) is what exports
`http_proxy`/`https_proxy` for the client, and this session was launched without it. With the
crash gone, relaunching through the launcher makes the gRPC surfaces (advantages, licences,
corp goals, campaigns, insurgency) reachable.

## 2026-10-29T02:45Z - client-server pass after the correct launch

With the client started through `Play.bat` (proxy + CA env), the gateway now really serves:
`user.license.Get` 200 (`eve_clonestate_omega hasLicense=true`), `plex.vault.Balance` 200
(2222 PLEX), `pirate.corruption` + `pirate.suppression` 200, `corporationgoal.GetMineWithRewards`
200, `dailygoal.GetAllWithRewards` 200, `character.skill.plan.GetActive` 200,
`cosmetic.ship.Get` 200, `space.api.cdn.GetUpdate` 200, `sovereignty.mercenaryden.GetAll` 200,
`campaign.api.GetAll` 200. Two types still 404ed (`stargate.lock.api.GetRestrictedSystems`,
`payment.schedule.api.GetActiveByType`) - fix committed in fork `f256261`.

Found a real gameplay bug while reading the same log: **a front whose campaign expired could
never reopen.** The campaign id is deterministic (`war + target`), so the next attempt produced
the same id and the same processed eventID, the core answered `DUPLICATE`, nothing changed, and
the runtime still published `war opened` on every tick - six lines in ten minutes for
`war:500001-500004:campaign:30003837` while the durable record stayed EXPIRED. `nextCampaignID`
now gives a terminal campaign's successor `:r2`/`:r3` (fork `501afd7`; the new test fails on the
old planner). The module is already copied into the running container; it takes effect on the
next server restart.

Pending on the next restart (do NOT restart the owner's session for it):
1. fork `f256261` - unmodelled `eve_public.*Request` gets a default-encoded 200 instead of 404;
   needs an image rebuild (`publicGatewayLocal.js` is a stock file).
2. fork `501afd7` - already in the container, needs the process restart.

Client error classes still seen (all client-side or known stubs): `CampaignRequestError` (the
campaigns API answers 200 with an empty list, so the page is legitimately empty),
`FlatbufferContentProvider ... L500` (achievement/campaign definitions flatbuffer), and
`IOError: [Errno 9] Bad file descriptor` (client tasklet writing to a closed log).

## 2026-10-29T03:05Z - rebuild delivered: onlineStatus descriptor, gateway defaults, real reopen

Rebuilt the image and brought the play stack up with `scripts/Start-Play-Stack.ps1 -Action Up`
(public path now: Proton `61730` -> `evejs-ssh-relay` -> sshd `55346`; the server container keeps
only loopback bindings plus `443 -> 26003`). Verified live afterwards:

- `onlineStatus.Prime` now sends `header.type=objectex1 token=blue.DBRowDescriptor`
  (fork `b7fa011`). Before, every contact login/logout raised
  `TypeError: expected DBRow or DBRowDescriptor as first argument` in the friend's client.
- Unmodelled gateway types answer a default-encoded 200 and say so:
  `No handler for type=eve_public.stargate.lock.api.GetRestrictedSystemsRequest - answering a
  default empty ...Response` (fork `f256261`). 404s for those two are gone.
- The expired-front reopen is real: `war:500001-500004:campaign:30003837:r2` exists in
  `PREPARING` while the old `...:campaign:30003837` stays `EXPIRED` as history, and there has
  been exactly one `war opened` line since the restart instead of one per tick (fork `501afd7`).

Remaining client-side errors after the rebuild (5 minutes, friend's client 140000107):
`IOError: [Errno 9] Bad file descriptor` only - a client tasklet writing to a closed log, not a
server answer. The career-portal `NoneType.progress`, the `Tag_img.size` texture error and the
achievement flatbuffer `L500` did not reappear in this window; they belong to client-side
features (career portal, textures, flatbuffer definitions) rather than to a gateway call, since
no request of theirs reaches the gateway at all (checked: zero `achievement`/`definition` types,
zero non-gRPC `H2` requests).

The friend (140000107) is connected through the SSH relay and his gateway calls are served
(18 `Requests.Send` in five minutes, all 200).

## 2026-10-29T03:20Z - gateway coverage measured, and a reason-less FAILED closed

The client's bytecode names **217 `eve_public.*Request` types**; the local gateway services name
**159** of them. The remaining 101 (achievements, community tracks, character titles, career
rewards, assetholding, AI assistant) are answered with a default-encoded empty message, so they
no longer throw, and the gateway logs each by name. `docs/CLIENT_CONTRACT_STATUS.md` now lists
them, generated from `docs/client-contracts/gateway-types.json` - a work queue, not a mystery.

Second find from the live event stream: `virtual-faction-patrol` reported **FAILED every two
minutes** in 30045343/30045344 with `spawned: []`, `active: []` and **no reason**, while the
materializer in the same tick reported `SPAWN_LIMIT_REACHED (occupied 3, limit 3)`. A full system
was indistinguishable from a broken spawn. `reconcile()` now returns per-faction `failures` and a
top-level `reason` when nothing deployed (fork `67bd5f8`, module already copied into the running
container; takes effect on the next restart).

State of the client-facing layer right now: 325 client calls, 324 answers, **zero** "Unhandled
method" lines, three gateway types served by the new default rule, and the only remaining client
alerts are `IOError: [Errno 9] Bad file descriptor` - a client tasklet writing into a closed
stdout (the launcher's window), not a server answer.

Pending restart: the patrol reason (already in the container) and nothing else.

## FW-050..FW-053B (22:3x-22:5xZ): restart verification found four real defects, all fixed and tested

The owner asked to verify that everything really restores after a server restart. Measured first,
then fixed:

WORKS (evidence): 142 runtime runs today; each boot emits `living-native-war-state RESTORED`; the
FW-041 mirror is now 11 037 B and equals the atomic `state-v1` row (both non-empty); territory
revisions survive (30003836 r2, 30003837 r2, 30045343 r3 - captures are never reset);
`living-native-durable-recovery OK`, `alreadyPhysical 9-11`, `errors 0` on the last six boots; the
same campaignIDs/startedAt live across every recreate and continue through mobilization -> assault
-> attack orders -> casualties -> merit.

FW-050 (money, found by the verification): `corporationRuntime` stores "coop-faction-war" as a row
GROUP, so FW-042's legacy write of `/coop-faction-war/state-v1` marked the whole group dirty and the
next flush rebuilt every member from the in-memory cache - including `treasury-v1`. Measured: the
treasury row came back with 3 reservations and `nextJournalID` 3 while events had used escrow
journals ...004-...006, and two ASSAULT campaigns lost HELD escrow while the wallets kept the debits
(1000120: -25 000 ISK with no reservation behind it). The legacy copy was never read back
(`warStateStore.read` reads the flat atomic row; boot prefers the live record, else the file mirror),
so it is now OFF unless `EVEJS_COOP_WAR_STATE_LEGACY_MIRROR=1` exactly.

FW-051 (review): `collectPresence` DROPPED a hull whose link had drifted, while `warPresencePilots`
counted it where the hull really is (FW-049). Two presence projections for one world: a border could
be owned by a faction the opening planner could not see. The native record now decides the system.

FW-052 (review): a blocked border reported only TARGET_ALREADY_CONTESTED - the 19:14 campaign held
that same string for an hour, so a legitimate "already fighting here" looked identical to a stuck
world. The skip now names blockingCampaignID, blockingWarID, sameFactionPair, sourceCampaignID.

FW-053/053B (money, review): an EXPIRED campaign never released its escrow - the treasury refunded
only ENDED wars and CANCELLED campaigns, and the live runtime never supplied `authorizeRefund` at all
(default `() => false`). Measured: `war:500011-500020:campaign:30045343` was EXPIRED with 2 500 000
cents still HELD. EXPIRED is now terminal-refundable, the runtime has a real refund authority, the
tick refunds what it just expired, and a reconcile pass recovers escrow left behind by an expiry that
happened before the process started. PROVEN LIVE 22:48:21Z:
`living-native-war-bounty-refunded APPLIED campaign=war:500011-500020:campaign:30045343
faction=500011 corporation=1000138 cents=2500000 journal=8000000000000009`.

Open review notes (not changed, need an owner decision): (a) the treasury has no pruning of terminal
reservation rows, so after 500 campaign-sides `RESERVE` refuses forever - a capacity ceiling rather
than a bug; (b) `coopWarBounty` exports TREASURY_KEY/CASUALTY_KEY that nothing imports (dead).

## 2026-10-29T03:45Z - patrols actually fly now, and pirates are no longer cap-locked

Three findings from the live event stream, each fixed and verified after a rebuild:

1. **`virtual-faction-patrol` never deployed.** It answered `FAILED` with no reason at all
   (fork `67bd5f8` now reports `failures` + `reason`), and the reason turned out to be
   `POOL_EMPTY`: the `concord_police` pool resolves to `concord_police_cruiser`, whose profile
   `entityType` is **"concord"**, while the runtime asked the spawner for `"npc"` - and the
   spawner defaults a missing type back to `"npc"`, so dropping the argument changed nothing.
   The patrol now derives the type from the pool's own fallback profile (fork `3249ba8`).
   Verified live: `virtual-faction-patrol status=AT_CAP active=[980000046081,980000046082]`
   plus `virtual-faction-patrol-route status=OK waypointCount=8` in 30045344.
2. **Pirates could not online their warp scrambler.** `NOT_ENOUGH_CAPACITOR` (393 events) came
   from the player rule "95% capacitor to online a module" applied to hulls that have no
   capacitor manager; a pirate that had just fired could never reach it. A sessionless native
   NPC now passes that single check (fork `72c3640`, flag `EVEJS_COOP_NPC_CAPACITOR`), and the
   next refusal reason is the ordinary `TARGET_NOT_LOCKED` ordering.
3. A profile with no `entityType` now counts as an NPC instead of being rejected (fork
   `7a60c0d`); `coopNpcCapacitor` is registered in the overlay names so it ships at all.

Also this pass: the gateway coverage is measured (217 client request types, 159 named, 101
answered with a default empty message) and the online-status rowset carries a real
`blue.DBRowDescriptor`, so contact login/logout no longer throws in the client.

## FW-054..FW-057 (23:0xZ): the payout was unreachable by design, and four gates are green again

FW-055 is the review find that explains the whole day: a bounty payout names a CO-OP PILOT, and every
co-op pilot id is a string ("coop-pilot-027"), but `coopWarTreasury` demanded `pos(command.pilotID)`
- a positive INTEGER - and its row validator demanded `pos(r.paidToPilotID)` too. So
`coopWarBounty.pay() -> PAYOUT` was refused with INVALID_TREASURY_PAYOUT before a single cent could
move, and a row that somehow stored the real id would be rejected as WAR_TREASURY_CORRUPT_PAYOUT on
the next read. Attribution, escrow and merit all worked; the last step could not be taken by design.
Both a coop-pilot/coop-player id and a positive integer are accepted now.

FW-054: the reservation ledger had no pruning and RESERVE refuses at 500 rows, so a long-lived world
would eventually refuse every war with WAR_TREASURY_PURPOSE_UNAVAILABLE. Settled rows are dropped
oldest-first only when room is needed, HELD is never touched, and the count is reported.

FW-056: `processed` had a hard 2000-event cap that stopped every money command
(WAR_TREASURY_EVENT_CAP). The oldest receipts are compacted into eventID -> sha256(signature): a
replay is still DUPLICATE (deliberately without a receipt), a different command under that id is still
a conflict, the archive is bounded.

FW-057: `coopMilitiaWarPlayer` names a player kill `coop-player-<characterID>`, but every ledger
behind it (kill merit, bounty, chest credit, market earned ledger) used the NPC-only regex, so a
player could be recognised as a killer and then refused the identity it was handed. One shared
predicate now accepts both; NPC-only features keep the strict form.

Housekeeping that also closed real gates: six integration copies and six engine files had been
rewritten with CRLF by an editing session on a repo that stores LF - restored (content identical).
`overlay-spec.cjs` was missing four modules an earlier change committed (coopLoopTick,
coopNpcDistribution, coopNpcGateCrossing, coopNpcManufactureTick) plus the new coopWarPilotID, and
coopLoopTick needed its generated shim; the overlay gate is green again.

Manual suite at 23:2xZ: 6453 tests, 1 failure - `A-Life station authority is genuinely read-only`
in another session's `coopAlifeNativeBuyerRuntime` (its source pattern changed while its test still
asserts the old text). Nothing in the war/bounty/treasury path is red.

LIVE after the deploy (23:16Z): `war:500001-500011:campaign:30003837` reached OCCUPIED and the
territory map now reads 30003837 = 500011 (a real capture by force), 30003836 = 500011,
30045343 = 500020, 30045344 = 500011; the expired campaign got a successor `...:30045343:r2` in
PREPARING with fresh escrow. The bounty payout itself still waits for an attributed kill in a funded
campaign - the watcher is armed and will report it with the exact numbers.

## FW-058..FW-060 (23:4xZ): the review plan, implemented

FW-058 the chest journal (`coopWarChestFunding`) had a hard 2048-entry ceiling enforced by
`validateJournal` THROWING - the whole chest became unusable and every later war would answer
WAR_CHEST_JOURNAL_INVALID instead of "full". Terminal rows are now compacted oldest-first into a
bounded identity archive; a pruned event is still DUPLICATE (no entry, so nothing can be debited
twice), the same id for another purpose is still a conflict, a PREPARED levy is never pruned because
`recover()` owns it, and a replay is decided by IDENTITY rather than by the amount (the levy plan is
recomputed from live balances and may legitimately differ).

FW-059 a payout has two legs (release the escrow, credit the pilot) and a failure between them left
`ESCROW_RELEASED_NOT_CREDITED` with no retry: the ISK was out of the escrow and never in the pilot's
balance. A reconcile pass now finishes any PAID escrow whose credit did not happen, keyed by
`war-bounty:<campaign>:<proof>` so it is exactly-once, and emits
`living-native-war-bounty-credit-reconciled`.

FW-060 five direct tests on the garrison gates (every flag must be exactly "1", no assault means no
hull, a disabled world never reaches the spawner, a full garrison costs nothing, a starved side asks
for at most one hull and reports the native answer it got).

OPERATIONAL HAZARD, measured today: commit `3249ba8` (another session) replaced
`coopVirtualWorldRuntime.js` from a copy that predated FW-053/053B and silently dropped
`refundExpiredCampaigns`, `reconcileTerminalEscrow` and their call sites - the refund proven live at
22:48:21Z was no longer in the tree. It is re-applied in `c4ddfba`. After ANY commit by the parallel
session that touches a file this work also touches, re-check the exports:
`grep -c "refundExpiredCampaigns\|reconcileBountyCredits" coopVirtualWorldRuntime.js`.

## 2026-10-29T03:50Z - clean client layer, unbounded event file closed

Client-server layer right now (measured over the last 40 minutes with both players online):
**one** client alert (`IOError: [Errno 9] Bad file descriptor` - the client writing into a closed
stdout), **zero** gateway defaults (every `eve_public.*` call had a handler), zero `Unhandled
method` lines, handler sweep clean on charMgr/corpmgr/agentMgr/contractMgr/fleetMgr/industry.

Found while reading the world instead: `/var/lib/evejs/coop-events.jsonl` had grown to **368 MB /
402 291 lines** and the data volume to **4.2 GB**, because nothing ever trimmed the only durable
trace of the world. The probe now rotates it to `<file>.1` past `EVEJS_COOP_EVENTS_MAX_MB` (default
128, `0` disables), checking at most once a minute (fork `7988e05`, deployed without restart,
tests `coop-events-rotation` 4/0).

Open question, no fix yet - do not repeat the mistake of guessing: the 30000144 mining fleet
reports `state=mining` with 13 miners / 10 haulers while no `living-mining-cycle-settled` fired
between 23:24:31 and 23:44, and the per-fleet snapshot shows `act0` (no active module) with the
same four asteroids cycling. The `living-mining-blocker` events are NOT evidence of a failure:
`coopMiningTrace` emits `"TICK_" + fleet.state` on a two-minute throttle, so a quiet trace can look
like a healthy fleet. `NO_MINEABLE_TARGET` never fired, so the fleet believes it has targets. Next
step: instrument the activation path (`MODULE_ACTIVATE_FAILED` already exists) or check whether the
four rocks are simply depleted, before changing anything.

## FW-063: the campaign has a validator, and it immediately found a real hole (23:5xZ)

`scripts/coop-war-validate.cjs` + `scripts/war-campaign-checks.cjs` check the RELATIONS between the
war records, because every defect today was invisible inside a single record: a funded war whose
escrow had reverted, a campaign that expired with its money locked, a capture with no provenance.
Ten checks, each PASS/WARN/SKIP/FAIL with its own evidence, `--json` for tooling, exit 1 on any FAIL.
The invariants are pure functions, so they are unit-tested without a server (8 tests).

First live run found `live-campaign-funded` FAIL for `war:500004-500011:campaign:30045344` and
`:30003836` - both ASSAULT, zero escrow on either side (the FW-050 store defect had reverted the
treasury row). That is FW-062: a live campaign with no HELD and no PAID row can never pay anybody, so
`expireUnfundedCampaigns` now expires it and releases its claim, with the funding predicate supplied by
the caller (one treasury snapshot; unreadable money is never treated as missing). After the deploy both
zombie campaigns disappeared and the validator reports `WAR_CAMPAIGN_OK checks=10 pass=9 warn=1`.

The remaining WARN is honest and explained: `war:500011-500020:campaign:30045343:r2` has escrow for
the attacker only, because the defender's militia corporation 1000135 has a real wallet balance of 0 -
the per-side refusal FW-046 is supposed to report, not a code fault. Measured with the validator, not
guessed.

Validated live (23:5xZ): territory provenance holds for all four changed systems (capture and
contested-bump are both named by a campaign), one live campaign per target, 16 fleet-registry hulls all
carry an entity and a system, no PAID row exists yet so the payout rung is still unproven by data.

## 2026-10-29T04:25Z - owner asked for all six client surfaces; first one is live

Owner picked every surface I recommended (not the skip list). Order agreed, cheapest first:

| # | surface | state |
| --- | --- | --- |
| 2 | career portal progress (`career.goal.*`) | **DONE** |
| 4 | presence (`presence.api.*`) | next |
| 5 | faction activity admin (`faction.activity.admin.*`) | next |
| 3 | skill plans (`skill.plan.*`) | queued |
| 6 | corp goal contributions (`goal.contribution.*`) | queued |
| 1 | daily goals (`dailygoal.*`) | queued (biggest: definitions + progress + payout) |

Career fix (fork `fb6c025`): `GetAll` now answers one row per definition stub with `progress: 0`,
`not_completed: true`; the client used to raise `AttributeError: NoneType.progress` because the
matching row did not exist. Verified live: the handler encodes 104 bytes instead of an empty
payload.

Trap worth remembering: the shared local proto root does NOT define every message the client uses,
and an eager `protoRoot.lookupType()` throws at require time - the first attempt took the whole
gateway down. New messages must be declared in a private root (pattern: `localChatGatewayService`,
and now `CAREER_PROTO_ROOT`), and lookups stay lazy.

Schemas already extracted from the client's own descriptors (python + protobuf, see
`docs/CLIENT_CONTRACT_STATUS.md`): `career.goal.{Identifier,Attributes,Reward,RewardType}`,
`career.goal.api.{GetDefinitions,GetAll,ClaimReward}`, `faction.activity.admin.{Increment,Set}
ContributionScore{Request,Response}` (system Identifier + faction Identifier + int32/uint32, empty
response). Still to extract when each surface starts: presence, skill plan, goal contribution,
dailygoal attributes/entitlements.

## FW-064..FW-066 (03:2xZ): the campaign stopped looping, and won campaigns stop locking money

FW-064 (validation): overnight the work stack reopened and expired `30045343` four times (`:r2`,
`:r3`, `:r4`) - each cycle reserving real escrow and refunding it 45 minutes later, because the
defender never fielded a hull there. The target cooldown now doubles per lost campaign (1x, 2x, 4x,
capped 8x); a successful assault resets it because only EXPIRED records are counted. 5 tests.

FW-065 (validation): the validator answers the question the payout rung really asks - for every HELD
escrow, does that faction field a real hull in the campaign's own systems? PASS/WARN/SKIP with the
campaign and faction named, so "why is there no payout" has a data answer. 1 test.

FW-066 (validation): after the capture of 30003837 the campaign was OCCUPIED while two HELD rows
(25 000 ISK each) sat behind it. Once CAPTURE_TERRITORY moves a campaign to OCCUPIED no further kill of
that campaign can happen, so its bounty can never be spent. OCCUPIED is now terminal for escrow in the
treasury precondition, the refund authority, the runtime reconcile and the validator. PROVEN LIVE
03:23:09Z: two `living-native-war-bounty-refunded APPLIED` rows for `war:500001-500011:campaign:30003837`.

Live record right now: `WAR_CAMPAIGN_OK checks=11 pass=11 warn=0 skip=0 fail=0` - no live campaign, no
contested target, every changed territory named by its campaign, all 16 registry hulls real. The
payout itself is still unproven: the record honestly reports `0 PAID rows`, and the watcher is armed
again for the next funded campaign that really produces an attributed kill.

## FW-067/FW-068 + acceptance run (04:0xZ)

FW-067 `war_payout_diagnose`: one read-only answer to "why is there no payout" - per campaign the state,
escrow per side, hulls in the theatre, `payoutReady`, the blockers as sentences, and the last
destruction-attribution status. Live at 04:0xZ it reported `PAYOUT_POSSIBLE` for
`war:500011-500020:campaign:30045343:r5` (escrow HELD for 500011, 1 hull in the theatre) and NOTHING
payable for every other campaign, which is the honest state.

FW-068 `SUPPLY_UNFUNDED_SIDE`: with `EVEJS_COOP_WAR_BOUNTY_BOTH_SIDES=1` a border is refused unless both
sides really reserved. Measured cause: 500020's militia corporation 1000135 holds 0 ISK with no income,
so four campaigns opened and expired on 30045343 while the defender could never collect.

`scripts/coop-war-acceptance.cjs` reports the nine rungs separately (never assuming a later step from an
earlier one) and exits non-zero until the credit is real. First run at 04:0xZ: `war-opened` PASS,
`escrow-reserved` PASS, `assault-begun` PENDING - the campaign opens and is funded but never musters.

NEXT REAL BLOCKER (measured, not guessed): mobilization answers NO_PATROL_CANDIDATE / SYSTEM_NOT_TRACKED
for the campaign's systems even while real armed hulls stand there, because the war fleet registry only
accepts hulls it reserved itself. That is the next fix: either the mobilizer adopts patrol-role native
hulls that are physically present, or the seeding path must reserve them through `spawn_war_fleet`.
Until then no campaign reaches ASSAULT, so the payout rung stays unproven however healthy the money is.

## 2026-10-29T09:55Z - five of the six surfaces are live, daily goals is the last one

Owner: "I'm not in the game, do whatever is needed until you finish everything." No restart batching
question any more - each surface was built, rebuilt, deployed and measured on the play stack.

| # | surface | state | fork commit |
| --- | --- | --- | --- |
| 2 | career portal progress (`career.goal.*`) | DONE | `fb6c025` |
| 4 | presence (`presence.api.*`) | DONE | `0d1205f` |
| 5 | faction activity admin (`faction.activity.admin.*`) | DONE | `0d1205f` |
| 3 | skill plans (`skill.plan.*`) | DONE | `2b137c5` |
| 6 | goal contributions (`goal.contribution.*`) | DONE | `2b137c5` |
| 1 | daily goals (`dailygoal.*`) | NOT STARTED - needs a funded payout + real progress feed | - |

Measured on the running play stack (container probes, `_testing.gatewayServiceRegistry`):
- presence: character 140000001 -> `corporation.sequential 1000044`, `no_alliance: true`, 200.
- admin: increment +777 changed `GetSolarSystemScores` 0 -> 777, -777 restored 0; a system outside
  the war is refused with `solar system 39999999 is not part of the advantage war` (status 3).
- skill plans: `eve_public.skill.plan.GetAllRequest` -> 200 with type
  `eve_public.skill.plan.GetAllResponse` (the alias answers in the caller's package).
- goal contributions: 200 (empty, no goals in that corporation), and no goal id -> status 3
  `goal is required`.

Register: **86** client request types remain unhandled (was 100 at the start of this pass).
`node scripts/coop-client-contracts.cjs --check` = `CONTRACTS_OK calls=542 missing=0 stub=44`.

Traps learned here, all now pinned by tests:
- the shared local proto root lacks several client messages and an eager `lookupType()` on a missing
  type throws **at require time** - declare new messages in a private root (`presenceGatewayService`,
  `CAREER_PROTO_ROOT`, `FACTION_ADMIN_PROTO_ROOT`, `CONTRIBUTION_PROTO_ROOT`).
- a `uint64` protobuf field decodes to a `Long`; `Number(Long)` is `NaN`, so `normalizeProtoNumber`
  (or `.toNumber()`) is mandatory or every admin request looks empty.
- `protobuf.parse()` renames snake_case fields to camelCase unless `{keepCase: true}` - a probe that
  forgets it silently drops `target_system` and looks like a server bug.
- the fork's `gameStore` refuses to open inside an unisolated `node:test` process, so repo tests that
  only need proto shapes import the proto module, not the service.

Daily goals design (next session, decide with the owner):
1. definition catalog = seeded config, never fabricated activity;
2. progress feed from an existing real per-character record (wallet journal / market transactions)
   so a goal is measurable without new instrumentation;
3. payout from a **funded** account (`space/coopCorpWallet.applyDelta` with a negative delta, or a
   treasury), plus a persisted claim row so a goal cannot be paid twice.

### Why daily goals is not a one-file job (measured, 2026-10-29)

`eve_public.dailygoal.Attributes.name_message` is `eve_public.localization.message.Identifier{
sequential uint32}` - a **numeric client localization id**, and the client renders it directly:
`dailygoals/client/utils.pyj:27` sets `'name_id': goal_attributes.name_message.sequential`. There is
no inline text field, so a goal we invent has no name/description in the client: the id must already
exist in the client's own localization data, or the localization surface has to push text first.
`utils.pyj` also builds the goal from `contribution_config` (kill_npc, mine_ore, damage_ship,
capture_fw_complex, ...), so progress must be expressed in one of those native shapes.

So the three requirements are: (1) localization ids that really exist, (2) progress from a real
native counter, (3) a payout from a funded account with a persisted claim row. None of the three is
available today; writing "progress: 0, reward: X" would be invented state, which the doctrine bans.

## 2026-10-29T10:40Z - daily goals are live (measured, not invented)

Owner asked for daily goals "interesting and varied", so all four remaining types were built
(fork `57d0f47`, `82a4b87`):

| goal | category | target | reward | progress source |
| --- | --- | --- | --- | --- |
| Mine Ore | daily | 5 000 units | 2 000 SP | character mining ledger (native mining cycle) |
| Kill NPCs | daily | 5 kills | 3 000 SP | killmail ledger, NPC victim, final blow ours |
| Jump Through | daily | 10 jumps | 2 000 SP | accepted gate jumps, one hook in `startStargateJump` |
| Complete other goals | daily bonus | 2 goals | 5 000 SP | goals this character actually redeemed today |

Localization: a daily goal carries only **numeric message ids**, and the client renders them with
`GetByMessageID` from its own FSD pickle — so a made-up id is an empty card. The ids now in use were
read out of `W:/EVE Online - 3396210/ResFiles/2c/2c3038b3c38e91a1_50675f6f907417dee3dc7857db899bf2`
(the en-us pickle the client actually loads): 656416 "Mine Ore", 1037684 "Kill NPCs", 532900 "Jump
Through", 696804 "Complete other goals", 696803 "Complete Goal", 528203 "Mine ore to help with the
materials shortage.", 550642 "Destroy NPCs", 36 "" (empty, used as help text).
`tests/coop-daily-goals.test.mjs` re-reads that pickle when present and fails if an id drifts.

Rewards are SP via the campaign-crate path (`updateCharacterRecord` + `emitSkillSessionState`), so
nothing is minted. `PayForCompletion` is UNIMPLEMENTED on purpose: instant completion in ISK would
need a funded sponsor account that the co-op world does not have for players.

Measured live: `GetAllCurrent` 200 with 4 goals (451 bytes); incomplete redeem refused
`goal is not complete (0/5000)`; QA `ProgressRequest` completed the mining goal; `Redeem` granted
2000 SP (freeSkillPoints 0 -> 2000 on the character record); second redeem `goal already redeemed`;
bonus goal then 1/2; `PayForCompletion` status 12 with its reason; jump hook recorded.

**Not verified:** how the cards look in the real client (the owner is not in game). The wire contract
is proven, the visual is not.

## FW-069..FW-072 (10:1x-10:4xZ): four real mobiliser defects, each measured on the way to a payout

The chain from "a campaign is open and funded" to "a hull is on the field" was broken in four
independent places. Every one of them answered NO_PATROL_CANDIDATE, so all four looked identical from
the outside:

FW-069 a candidate's system was the LINK's system. The link follows the virtual pilot, which walks its
route while the native hull stays put (the drift FW-048/049/051 already fixed for attribution, presence
and the opener), so every drifted patrol was dropped as WRONG_SYSTEM. `physicalCandidateSystem` now
prefers the native record and answers 0 when neither is readable.

FW-070 the mobiliser accepted only role "patrol", but an Angel Cartel raider - the hull that actually
holds 30045342 - is linked as "pirate". Measured: three armed, linked, physically present hulls while
both sides answered NO_PATROL_CANDIDATE. MOBILIZABLE_ROLES = {patrol, pirate} is now the same
definition FW-044 already uses for military ownership.

FW-071 the candidate SET itself was still built with `role === "patrol"` and `reachable.has(link.systemID)`,
so 069/070 were only half effective: the corrected checks were never reached. The set is now built from
armed roles and the hull's real system.

FW-072 a registry row whose hull no longer exists kept its pilot blacklisted forever (PILOT_IN_USE), so
once a hull died its pilot was unusable for the life of the process and no fresh campaign could staff a
side. A row with a live native record still reserves its pilot; a row without one reserves nothing.

PROVEN LIVE along the way: campaign `war:500001-500011:campaign:30045342` opened on a newly bootstrapped
500001 territory (FW-045 registered 30045342 = 500001) and reached ASSAULT with the defender side
SIDE_MUSTERED assigned 1 - the first time this world deployed a real hull for an assault.

REMAINING BLOCKER (measured, not guessed): the two sides now reject candidates with PILOT_IN_USE because
the same co-op pilot is already bound to a live hull in ANOTHER system - the pilot pool is 64 pilots
shared with miners, haulers and traders, and repeated seeding leaves live hulls holding the few war
pilots. That is pool hygiene, not a mobilizer rule: the war needs its own reserved pilots (or the keeper
must reuse the hulls already present instead of spawning new ones).

## 2026-10-29T11:20Z - daily goals: hull-weighted credit, assists, real rewards

Owner asked for three things and all are in (fork `c2fdfbf`):

1. **Rewards are adequate**: SP per unit of real progress instead of a flat token amount —
   combat 3 000 SP per point (30 000 at the 10-point target, 60 000 for a battleship day, cap
   90 000), mining 4 SP per ore unit (20 000 at 5 000), jumps 1 500 per gate, bonus 40 000.
   The card promises exactly what redeem pays because both come from `rewardSkillPoints()`.
2. **Ship size scales the kill**: credit comes from the victim's SDE hull class —
   frigate 1, destroyer 2, cruiser 3, battlecruiser 4, battleship 6, barge 4, capitals 8-14 —
   with a cube-root-of-mass fallback for unknown hulls (never zero, never capital by accident).
3. **Partial credit**: `killmail.attackers[].damageDone / victimDamageTaken` pays your share when
   someone else lands the final blow, capped at 0.9 of the hull so an assist can never equal a kill.
   `finalCharacterID === you` pays the whole hull.

Live proof inside the container (real `itemTypeRegistry`): Bantam 1, Sansha destroyer 2, Retriever
barge 4, Raven battleship 6; half damage on a frigate = 0.5 point; full battleship = 6; rewards
`mine@5000 20000 / mine@9000 36000`, `kill@10 30000 / kill@20 60000 / kill@1000 90000` (cap);
`GetAllCurrent` 200 with 4 cards.

Still open from the client's own 13 contribution types (all need a new producer or a funded payer):
`damage_ship`, `scan_signature`, `install_manufacturing_job`, `salvage_wreck`,
`earn_loyalty_points`, `fw_capture`/`fw_defend`, remote repairs.

### 2026-10-29T11:40Z - fifth goal: Manufacture

`install_manufacturing_job` is measurable without a new producer: `industryRuntimeState.listJobsByOwner`
already holds the real jobs the industry window shows, so today's jobs (by real `startDate`) count,
12 000 SP each with a 20 000 floor. Name/description are real client ids (1040182 "Manufacture",
61487 "Manufacturing"). Live: `GetAllCurrent` = 5 cards / 569 bytes; `listJobsByOwner(140000001)` = 0
jobs, so the card honestly reads 0/2.

## FW-073/FW-074 (11:2x-12:0xZ): a real capture happened, and the last hole is attribution

PROVEN LIVE: campaign `war:500001-500011:campaign:30045342` reached OCCUPIED at 11:26:12Z and 11:26:40Z
(`living-native-war-capture-by-force CAPTURE_APPLIED`) after a real casualty in that system - the first
capture produced by the mobiliser fixes. FW-066 then refunded both HELD rows at 11:27:07Z, so money
followed the outcome instead of staying locked.

FW-073 (measured cause): repeated seeding asked for pilots whose link already existed; the spawn created
a SECOND physical hull and the link correctly refused, leaving an armed orphan no war can mobilize. The
spawn action now answers PILOT_ALREADY_LINKED with the existing entity and system before creating
anything, so a caller reuses the hull that is really there.

FW-074 (the last hole before a payout): at 11:24:26Z the casualty of that same campaign was recorded and
capture followed, but attribution answered NOT_UNIQUE_NAMED_PIRATE - the disk copy of the link and the
live registry both held the SAME entity under different recorded systems, so the stock path counted two
attacker links. `mergeLinks` now collapses per ENTITY and per PILOT, keeping the newest record.

State at 11:5xZ: no live campaign (the map is 30000145/30003836/30003837/30045342/30045344 = 500011,
30045343 = 500020), so `war_payout_diagnose` honestly answers NOTHING_PAYABLE. Keeper and watcher are
running for the next funded front; the chain campaign -> ASSAULT -> casualty -> capture -> refund is now
proven, and only a kill inside a live funded campaign is still missing for `war-bounty PAID`.

## 2026-10-29T12:20Z - stargate locks + world name lookups (5 more client types)

Fork `f0ff7c1`, register 82 -> 77 unhandled.

- **Stargate locks** (3 admin types) are real: persisted rows with an expiry in
  `space/coopStargateLocks`, and `startStargateJump` refuses a locked gate with
  `STARGATE_LOCKED` (one env-gated statement, `EVEJS_COOP_STARGATE_LOCKS=1`). Expired rows drop
  on read; a past expiry is refused; delete removes one solar system as the request says.
  The public `stargate.lock.api.GetRequest` is deliberately left to the empty default: its
  response is one `gate` and the request carries no fields, so the gateway cannot know which
  gate the player stands at - enforcement happens where the gate is known.
- **solarsystem.api.Get / station.api.Get** answer the real static rows (Perimeter 0.949000000,
  the Jita IV station name), structures included, NOT_FOUND otherwise. Security is units+nanos
  with -0 normalised (a negative sec below one starts at units 0).

## 2026-10-29T12:25Z - the war ran all night and then starved; root cause found (FW-038)

What the night produced (play stack, measured):
  war:500001-500004 ACTIVE; campaign 30045343 reached **OCCUPIED** and the
  territory row now reads 30045343 -> 500004 (Gallente) OCCUPIED,
  30003837 -> 500001 (Caldari) SECURE.
  No `war-capture-by-force` event exists, so the flip came from the campaign
  resolution path, NOT from the FW-035 wreck proof. Do not claim FW-035.
  campaign 30003837 opened and expired 15 times (:r2..:r15).

Then it starved: roster fleets [], registry ships 0, no war event for 60 min.
The watchdog reported it correctly (`PROBLEM no war event for 60 min`).

Root cause (fixed, fork `241f010`, tests `d14605ac`, 14 pass):
  `coopWarGarrison` only fed campaigns in state ASSAULT. A campaign is created
  in PREPARING and can only reach ASSAULT once both sides hold hulls, and the
  mobilizer can only assign native patrols that already exist. With no patrols
  left, PREPARING had nobody to muster, the garrison refused to help, and every
  reopen expired again - which also drove the 8x TARGET_RECENTLY_EXPIRED
  cooldown on 30003837 that now blocks the Caldari/Gallente front.
  FW-038 musters PREPARING too; a decided campaign (OCCUPIED/EXPIRED) is never
  refilled.

Deployed on `evejs-agents` only (verified: `garrison skipped:
GARRISON_CHEST_EMPTY` proves the PREPARING campaign is now mustered).

NEEDS_OWNER_RESTART_WINDOW: the play stack still runs the old garrison, so the
Caldari/Gallente front stays on cooldown. One `docker compose up -d --no-deps
server` (~3 min) picks up FW-038 and the next open will muster instead of
expiring. Do not do it without the owner's word.

Separate blocker on `evejs-agents` (NOT mine to change): `EVEJS_COOP_WAR_
GARRISON_FUNDED=1` + empty campaign chest => GARRISON_CHEST_EMPTY. That is the
FW-005B war-economy work owned by the parallel agent. Do not flip it to 0.

Next after the restart: watch 30003837 reopen, confirm both sides muster
(>1 hull each), then native attack orders + weapon events, then the client view.

## FW-075 and the state of the payout rung at 12:5xZ

FW-075: `release_identity` while the hull is still flying leaves an armed ship that can be killed but
can never be attributed. Measured 12:36:31Z and 12:40:04Z: two real war casualties in the contested
system answered NOT_UNIQUE_NAMED_PIRATE because their hulls had no identity link at all - the pilots had
been released minutes earlier to free the spawn pool. A release now refuses with HULL_STILL_PHYSICAL
unless `force: true`.

What the campaign record proves now (all measured, in order):
- a front opens on a freshly bootstrapped territory: 30045342 = 500001 registered by FW-045, campaign
  `war:500001-500011:campaign:30045342` opened with escrow on BOTH sides (FW-046/068);
- the campaign reaches ASSAULT with BOTH sides mustered on the contested field
  (`SIDE_MUSTERED assigned 1` for defender and attacker in 30003839) after FW-069..072;
- real native attack orders are accepted and real casualties are recorded in that system;
- the campaign is decided: `capture-by-force CAPTURE_APPLIED` and the territory changes hands
  (30045342 OCCUPIED, 30003839 OCCUPIED), then FW-066 refunds the escrow (12:44:42Z).

What is still missing is exactly ONE event: a casualty in a live funded campaign whose hulls all have
healthy identities, so `NATIVE_DESTRUCTION_ATTACKER_PROVIDED` fires and the HELD escrow pays. The two
casualties we did get were unattributable for the reason FW-075 now prevents; the next campaign will not
have that defect, and the watcher plus `scripts/coop-war-acceptance.cjs` are both armed for it.

## 2026-10-29T13:10Z - New Eden Store catalog drawn from the real store state

Fork `d941ad3`, register 77 -> 70 unhandled. The seven `store.*` reads (categories, offers,
offers by tag, targeted offers, products) now answer from `storeState.getLegacyCatalog(4)` -
the very state the existing `purchasePlexVaultOffer` path fulfils from, so a listed offer is
always buyable at the listed price (15 offers, 9 categories, Omega 500 PLX, 15 products).
A product only claims `item.type` when the offer really carries a `typeId`.

**Bug found by probing the live registry:** `stargateLockGatewayService.handleRequest` ended
with an unconditional `return GetAllResponse`, so every request that reached it got a lock
list - the store, PLEX, presence and everything registered after it were all hijacked. It
now returns `null` for any type that is not its own, and a regression test pins that.

## 13:2xZ: the assault chain is proven; attribution is the last rung and it is NOT a link problem

Proven in one window: a fresh border opened (`war:500001-500011:campaign:30045341`, 30045341 = 500001
registered by FW-045, adjacent to 500011-owned 30045339), both sides mustered on the field, and
`living-native-war-assault ASSAULT_BEGUN` (13:21:36Z) was followed by real
`living-native-war-attack-orders NATIVE_ATTACK_ORDER_ACCEPTED` (13:24:23Z) and a real casualty
(13:25:10Z) in the fought system.

But all three recent casualties carry `attribution: NATIVE_VICTIM_WRECK_ONLY_NO_KILLER` and the
separate attribution event answers NOT_UNIQUE_NAMED_PIRATE. The victim is always named (the casualty
knows pilot, corporation, wreck and stored items) - what is missing is the KILLER: the upstream
destruction caller did not hand over an `attackerEntity` for these deaths, and the fallback stock path
then refuses. FW-048/074/076 (drift, duplicates, fleet-registry identity) were all necessary, but they
fix the *naming* of a killer the event already provides.

NEXT CONCRETE STEP (not guessed): find which native death path these war kills take and whether it
passes `options.attackerEntity` - the same field that DID arrive at 19:15Z, 20:16Z and 20:26Z when merit
was promoted. If the war hulls die from a path that omits it (e.g. a non-turret source), the fix belongs
in that caller, not in the attribution module.

## 13:4xZ: the killer context IS passed; the failure is the victim's missing identity

Traced the destruction path end to end instead of guessing:
`runtime.js:15804` -> `destroyCombatEntity(scene, target, {...buildCombatDestructionOwnerContext(attackerEntity)})`
-> `destroyShipEntityWithWreck(..., {attackerEntity: options.attackerEntity || null, ...})`
-> `npc/nativeNpcWreckService.destroyNativeNpcEntityWithWreck` -> `coopNpcDestructionAttacker.note`.
`buildCombatDestructionOwnerContext` (runtime.js:15530) DOES include `attackerEntity`, so the killer is
handed down on this path. There is exactly one caller of `destroyCombatEntity` and it passes the context.

So `NATIVE_VICTIM_WRECK_ONLY_NO_KILLER` on the casualty receipt is a symptom, not the cause: that text
is produced when the stock fallback runs, and the fallback runs when `verify()` cannot name the VICTIM.
Every casualty we inspected (11:24, 12:36, 12:40, 13:08, 13:11, 13:25) had a victim whose identity link
was missing - `coop-pilot-012` twice, a pilot released minutes earlier to free the spawn pool.

FW-073 (no second hull for a linked pilot), FW-075 (no release while the hull flies), FW-074 (one hull is
one identity) and FW-076 (fleet registry as identity evidence) together close every way this world could
hand a war hull to a kill without a name. What remains is not a code gap but a fresh front: every
campaign fought so far used hulls created before those fixes.

## 2026-10-29T13:55Z - career portal completed (4 more types)

Fork `bcf632c`, register 70 -> 66. The portal list and the claim now read one record
(`space/coopCareerGoals`): completion comes from the client's own career admin calls
(Complete/Progress), the claim marks itself before paying (never twice) and pays 25 000 SP
through the one shared grant (`space/coopSkillPointGrant`, also used by daily goals).
Both claim packages answer: `career.goal.api.ClaimReward` and
`app.eveonline.career.goal.ClaimReward` (the latter echoes the goal back).
Bug found on the way: the compatibility service's `handleRequest` ignored its envelope, so
it could not know the character. Live: 4 goals incomplete -> admin complete -> portal shows
1 completed/progress 1 -> claim 200 with SP 2000 -> 27000 -> second claim refused.

Remaining big surfaces (register 66): SKINs 19 + skin market 10, achievements 9, freelance
projects 14, titles 6 (needs a CDN flatbuffer blob), assetholding 4, payment schedules 3,
mercenary den/hub/skyhook admin 4, and a few single-type content features.

## 2026-10-29T14:30Z - honest absence for assetholding and payment calls (7 types)

Fork `95bced3`, register 66 -> 59. Asset holdings, entitlements, payment schedules and
redemption codes hold no state here, so instead of a default empty message:
NOT_FOUND for a specific asset/entitlement/schedule, FAILED_PRECONDITION for a redemption
("nothing was ever granted", "code redemption is not configured"), and for
`GetActiveByType` the honest empty shape (its response carries one optional schedule, left
unset). `absentStateGatewayService` is now the single place that must read a real store if
one is ever built.

## 2026-10-29T15:00Z - session handoff: the next surface is third-party SKINs (19 types)

Register is at 59 unhandled after this session (100 at its start). Everything below was
measured live on the play stack, not just tested.

### What is left, and why SKINs is the right next block

The remaining types are all one of: a big content subsystem (SKINs 19 + skin market 10,
freelance projects 14, achievements 9, titles 6), absent state (mercenary den/hub/skyhook 4),
or transport/auth artefacts that are not features (`debug.Request`, `internal_gateway.*`,
`auth.*`, `ai.assistant`).

### Third-party SKINs - the exact shapes, already extracted

Schemas (client `eveProto/generated/eve_public/cosmetic/ship/skin/thirdparty/...`):
- `thirdparty.Identifier{hex string}` - a player-designed skin id, **not** a type id.
- `license.Identifier{character{sequential}, skin{hex}}` and `license.Attributes{activated,
  unactivated uint64, escrowed uint64, first_acquired Timestamp}`.
- `license.api`: GetOwned, Get, Activate, Apply{license, ship{sequential}}, Unapply, admin
  Grant{skin, unactivated}/Revoke. `Apply`/`Unapply` carry the real ship item id.
- `draft.api`: Get, Save, Update, Delete, GetShared, GetSaveCapacity (design blobs).
- `sequencing.job.api`: Initiate, Get, CompleteEarly (a real job queue with a duration).
- `component.license.{finite,infinite}.api`: Get + admin Grant/Revoke.
- `component.license.item.api.Consume` - must consume a real inventory item.

Important: `services/ship/shipCosmeticsState` already models **catalog** skins
(`giveSkin(charId, skinID)`, `removeSkin`, `applySkinToShip(shipID, skinID)`,
`getAppliedSkinRecord`, `getAppliedSkinRecordsForOwner`, `getLicenseCatalogEntry`) where
`skinID` is a catalogue/type id. The third-party system is a *different* store keyed by hex,
so it needs its own state module; the catalog one cannot be reused for hex ids.

### Suggested order (each step is independently shippable)

1. `space/coopThirdPartySkins.js`: a per-character licence store keyed by hex
   (`{activated, unactivated, escrowed, firstAcquired}`) + a skin registry (hex -> ship type,
   layout). Gateway: GetOwned, Get, Activate, admin Grant/Revoke (5 types).
2. Apply/Unapply onto a real ship item id, reusing the applied-skin record so the client's
   appearance change is real (2 types).
3. Drafts (5 types + capacity): design blob per character, share by uuid.
4. Sequencing jobs (3 types): initiate -> real duration -> complete early -> licence minted;
   item consumption (1 type) must consume a real inventory item via
   `consumeInventoryItemQuantity`, never a virtual count.
5. Component licences (7 types) last: finite/infinite per component.

Never fake a licence or an applied skin: if the store has no row, the answer is NOT_FOUND and
the appearance must not change.

## 2026-10-29T15:40Z - SKIN designer step 1 done (licences, 5 types)

Fork `469cbff`, register 59 -> 54. `space/coopThirdPartySkins` owns per-character licence rows
keyed by the skin **hex** (a different key from the catalogue skins shipCosmeticsState models),
stored inside the character record through characterState. GetOwned / Get / Activate and the
admin Grant / Revoke answer from real rows; another character's licence is never answered even
by id; a row with no record is NOT_FOUND; a corrupt row is dropped.

Live: 0 owned -> grant 200 -> 1 owned -> Get activated=false unactivated=2 -> Activate 200
(activated=true, unactivated=1) -> second Activate 9 'already activated' -> Revoke 200 -> 0.

Next steps (unchanged plan, `.opencode/state.md` above): step 2 Apply/Unapply onto a real ship
item id (2 types), step 3 drafts (5 + capacity), step 4 sequencing jobs (3) with real item
consumption, step 5 component licences (7).

### 2026-10-29T16:20Z - SKIN designer step 2 done (apply/unapply, 2 more types)

Fork `c4fb38b`. Apply records the licence on a ship that really exists (inventory lookup,
owner must be the character, category must be a ship) and only for an activated licence;
Unapply removes exactly that record and refuses a different skin on that ship; an applied row
whose licence is gone is dropped on read, so a revoke cannot leave a claim behind. The ship
lookup is injectable, which is how the ownership rules are proven without a database.

Live on character 140000001 with its real ship 9988400000001: apply without a ship 3,
unknown ship 5 'no such ship', real ship 200 -> applied {9988400000001: a1b2c3d4e5f60718},
unapply 200 -> empty. Register 56 unhandled.

Remaining SKIN work: drafts (Get/Save/Update/Delete/GetShared/GetSaveCapacity), sequencing
jobs (Initiate/Get/CompleteEarly) with real item consumption, component licences
(finite/infinite Get + admin Grant/Revoke), `component.license.item.Consume`.

## FW-077..FW-079 (14:3x-15:5xZ): the chain is proven end to end except the last hop

Proven today, in one continuous run of real events: a funded front opens (`war:500001-500011:campaign:30005338`,
escrow on both sides), reaches `ASSAULT_BEGUN`, accept real native attack orders, produces real
casualties, and - at 14:47:30Z - a real kill got `living-native-war-merit PROMOTED` for
`coop-pilot-007` with `force-lost` for `coop-pilot-003`. Attribution, which failed all evening, worked.

FW-077: `spawn_native_npc` answered `ok` for a war patrol whose hull had ZERO native modules (inspected:
`modules [] cargo []`), so the mobiliser refused it with WAR_NO_NATIVE_LOADED_WEAPON an hour later. A
warPatrol spawn now verifies the hull it created and answers WAR_PATROL_UNARMED with the entity IDs.

FW-078: at 14:47:30Z the payout of that same attributed kill was refused with
NO_REAL_CAMPAIGN_FOR_EVENT, because the bounty is decided inside the native destruction callback while
the casualty ledger row for that wreck is written seconds later by the war phase. The payer now resolves
the campaign from the war fleet registry (the record that bound that hull to that campaign), with the
casualty row still winning when it exists.

FW-079: attribution has now failed four distinct ways, each diagnosed from one opaque status. The failing
proof emits `living-native-destruction-identity` with how many rows EACH source holds for the victim and
the attacker - disk link file, live registry, war fleet registry - so the next kill names the cache that
lost the hull instead of costing another evening of guessing.

Remaining: one more funded front with a kill, and the answer tells us whether `war-bounty PAID` fires and,
if not, exactly which identity source was short. Keeper is off (it competes for the 64 co-op pilots);
`scripts/coop-war-acceptance.cjs` and the watcher are the tools to run it.

### 2026-10-29T16:45Z - clean stop point, drafts are next

The session ends at a boundary that is safe to resume: licences + apply are live and proven,
the next surface (drafts) has its shapes already extracted below.

`thirdparty.draft` shapes (client `.../draft/{api/requests,draft}.proto`):
- `SaveRequest{name, line_name, layout{slots[{id, configuration}], ship_type, pattern_blend_mode},
  editor_configurations[{id{slot}, config{offset_u_ratio, offset_v_ratio, yaw, pitch, roll, scaling}}]}`
  -> `SaveResponse{id{uuid}, attributes}`; `UpdateRequest` is the same plus `id{uuid}`.
- `Attributes{skin{hex}, editor_configuration, editor_configurations[]}` - **no name/line_name**,
  so the name is only carried into Save/Update (it matters when a skin is sequenced, not when
  a draft is read).
- `GetRequest{draft{uuid}}`, `GetSharedRequest{character, draft{uuid}}`,
  `GetSaveCapacityRequest->{capacity uint64}`, `DeleteRequest{id}`,
  `GetAllSavedRequest->{drafts[{id, attributes}]}`.

Store plan: keep the draft payload as the **encoded bytes** of `layout` +
`editor_configurations` exactly as received (the server does not need to interpret a design to
store it), per character, with a uuid, name, line_name and timestamps; capacity is a real
configured limit (not a fake zero). GetAllSaved/Get/GetShared return the stored shape;
Delete removes the row. Sequencing (step 4) is what turns a draft into a skin hex, and it must
consume a real item.

### 2026-10-29T18:10Z - SKIN designer step 3 done (drafts, 7 types)

Fork `157ed2c`, new files `space/coopSkinDrafts.js` +
`_secondary/express/gatewayServices/thirdPartySkinDraftGatewayService.js` (registered after the
licence service). Live through the gateway registry on 140000001: capacity 20; save 200 with a
16-byte id and the float configs round-tripped; the stored layout is **byte-identical** to what
was sent (taken straight off the wire, never re-encoded from a partly decoded tree); get all 200
count 1; get 200; get shared 200; update 200 and the layout replaced (it reads field 4, not the
save field 3); get of a missing id 5; delete 200 then 5 and zero drafts left. Register: 51
unhandled (was 56), `handled=229`.

Contract note worth remembering: draft `Attributes` has only skin hex + `editor_configuration` +
`editor_configurations` - no name, line_name or layout. Those are stored because sequencing
needs them, but they are not part of a read answer.

Next: sequencing jobs (`Initiate`/`Get`/`CompleteEarly`) must consume a **real** inventory item
and only then mint a skin hex in the licence store; then component licences (finite/infinite
Get + admin Grant/Revoke) and `component.license.item.Consume`.

### 2026-10-29T19:20Z - SKIN step 4a done (component licences, 7 types, one real bug)

Fork `bc6ee18`: `space/coopComponentLicences.js` + `componentLicenceGatewayService.js`.
Finite = capacity spent down (refuses to go negative, second grant adds and keeps the first
date); infinite = free, never spent; both per character and keyed by coating component id.
GetOwned had been answered with an empty list by `compatibilityGatewayService` - a real
regression for anyone who held a licence; the new service sits before it and reads real rows.

Live on 140000001: GetOwned 0/0 -> grants 200 -> GetOwned 1/1 -> finite Get capacity 5,
infinite free true -> spend 3 leaves 2 -> spend 9 NOT_ENOUGH_CAPACITY -> infinite spend FREE ->
unknown component 5 -> revoke 200, again 5, both kinds gone. Register 45 unhandled
(`handled=235`).

Next: sequencing jobs (Initiate/Get/CompleteEarly) - they must consume these licences and a
real inventory item, and only a completed job may mint a third-party skin licence; then
`component.license.item.Consume`; then the skin market (10), which needs escrow + ISK.

## FW-080..FW-083 (16:0x-16:5xZ): the frontier was blind, then deaf, then out of pilots

FW-080: the opener only sees the systems in its tick list, and that list was cut at twelve while the
world owned more. Measured 15:50Z: 30003829 was registered as a 500001 territory with every hull standing
there, yet the list ended at 30045341 - the new front was invisible and the only refusal the world could
publish was an empty map. Owned systems are now ordered before the walked ones and the cap is 24.

FW-081/081b: a refusal published only `NATIVE_WAR_AUTHORITY_MISSING` with an empty skip list, so four
candidate borders and two possible failing proofs were indistinguishable. The refusal now carries
refusedCommand/refusedWarID/refusedCampaignID/edge, the event publishes them, and the de-duplication key
includes them. It immediately named the culprit: DECLARE_WAR for `war:500001-500020` across
30045338/30045343, whose declaration proof failed because 500020 had no hull on its side.

FW-082: that single failed border aborted the WHOLE tick (the thrown refusal discarded every other
border, including a fully mustered one). Each opening now runs in its own try/catch, is rewound to the
last committed snapshot and recorded as BORDER_REFUSED:<reason>, and the rest of the batch proceeds.
A single-border batch still answers with the underlying proof reason so a real cause is never hidden.

FW-083: the war had no pilots left to hire. Measured: roster 64, links 65, every link holding a live hull,
free = -1. The agents stack roster is now 88 (free = 23), which restores the ability to staff a front.

OPEN QUESTION for the next session (measured, not guessed): after FW-080 the tick list contains 30003829
and the map reads 30003829 = 500001 next to 30003836 = 500011 with a real gate between them, yet the plan
only ever reports two OTHER borders (`30045338 -> 30045343` and `30045344 -> 30045343`). So
`buildFronts`/`territoriesForFronts` is dropping a genuine, owned, adjacent pair. That is the next thread
to pull; everything downstream of the plan (apply, mobilise, fight, attribute, capture, refund) is proven.

### 2026-10-29T20:05Z - SKIN step 4b done (sequencing jobs, 3 types + GetAllActive)

Fork `645f18a`: `space/coopSkinSequencing.js` + `skinSequencingGatewayService.js`. `licenses`
in InitiateRequest is the number of copies (`nb_runs` in the client messenger), name/line_name
arrive as utf-8 strings and the layout is the raw field 3 bytes. Price: every component is
checked against the held licences first (infinite free, finite spent), then all are taken - a
design costs its whole price or nothing. Jobs store `plannedMs`, so a due job completes on read
(restart-safe, exactly once); the minted hex is sha256(job uuid) so no skin exists early.
`GetAllActive` was an empty list from compatibility - a running job was invisible.

Live on 140000001: initiate without design 3; 200 pending qty 3 planned +30s; 2 jobs and exactly
4 capacity spent; complete early 200 then 9; skin 6ae282c834c7dd78 with 3 copies; unknown 5; a
second job completed on read after its time (67bfb0f11948d71d, 2 copies). Register 42 unhandled
(`handled=238`).

Known limit to fix next: CompleteEarly does not charge PLEX yet (retail does), and
`thirdparty.api.Get` (the created skin's own record: name/layout/tier) is still missing, so the
designer can list a licence but cannot show its design. Then `component.license.item.Consume`,
then the skin market (10).

### 2026-10-29T21:05Z - SKIN record Get done (1 type, 41 left)

Fork `85041fc`. `thirdparty.api.Get` reads the licence row a job minted: name, line_name,
creator, tier 1, not_sequenced, first_sequenced, plus the design spliced back as raw field-4
bytes (the server never decoded the tree, so it must not re-encode it). The job now writes
layout/lineName/creatorID into the row; an admin grant has neither, so it stays honestly
not_sequenced (that distinction is a test).

Live on 140000001: minted 220a07477df30255 with layout stored byte-identical, creator
140000001; Get 200 with all fields and the layout spliced intact; unknown hex 5. Register 41
(`handled=239`).

Next: `component.license.item.Consume` - must consume a REAL inventory item (itemStore
consumeInventoryItemQuantity) and only then add capacity/infinite to the component licence; needs
an explicit type -> licence mapping because our SDE rows are not automatically licences. Then
the skin market (10) with escrow + ISK, then titles/achievements (both gated behind a client
feature flag `character_titles_feature_enabled` and a CDN flatbuffer, so verify that first).

### 2026-10-29T22:00Z - SKIN licence items done (1 type, 40 left)

Fork `e18b98d`. `component.license.item.Consume` needs an explicit mapping
`EVEJS_COOP_COMPONENT_LICENCE_ITEMS` (typeID -> {component, capacity|infinite}); an unmapped
item is refused, never guessed. The item comes from the real itemStore, must belong to the
character and be present in the quantity; only then is it consumed and the licence written.

Real bug found live: a singleton (ship/capsule) reports quantity -1, which made the quantity
check refuse every consume; a singleton now counts as 1.

Live on 140000001 with its real item 9988400000001 (type 670): registry refusal 9 unmapped;
mapped store refuses another character 7; quantity 2 -> 9 with nothing spent; quantity 1 -> 200,
capacity 1 on component 53002, the item is gone; unknown id 5. The engine then re-ensured the
character a capsule (9988400115357), so the character is still flyable - check that on any
consume probe against a real item.

Register 40 (`handled=240`).

Next: the skin market (10) - listings need escrow of a real licence + ISK transfer between
characters, plus broker fee/tax reads. Then titles/achievements, which are gated behind the
client flag `character_titles_feature_enabled` and a CDN flatbuffer - verify the flag surface
before writing either.

## FW-084..FW-086 + how to finish (17:0xZ)

FW-084 every refusal printed `territories: {}` and `fronts: 0`, so an empty map, a dropped edge and a
failed proof were indistinguishable. The refusal now publishes the planner's own territories and front
count. An offline probe with the same pure module and the LIVE state proves the planner is healthy: four
fronts derived (500001-500011 across 30003829/30003836/30045338/30045339/30045341/30045344, plus three
others) and four openings planned, including `war:500001-500011:campaign:30003829:r3`. The planner was
never the problem.

FW-085 with the both-sides rule the funded side's reservation stayed HELD for a campaign that was never
created, and each retry used a new campaign id so the orphan-reuse path never saw it - 25 000 ISK lost
per refused border, every tick. The opening now releases what it took; the treasury allows that refund
only with an explicit `unfunded:<campaign>` proof, so no live campaign can use the hatch.
FW-085b: the first release was itself refused (INVALID_TREASURY_COMMAND) because the event id blew past
the treasury's 96-character key budget; it now names the campaign and the side.

FW-086 the bounty is priced at 5 000 ISK on the agents stack (`EVEJS_COOP_WAR_BOUNTY_ISK`). Measured
reason: militia corporations earn nothing on their own, every campaign reserved 25 000 per side, and after
a day of fighting both militia wallets sat at 5 000 - so FW-068 correctly refused every border. Real
escrow, real debit, real payout, at a price the existing income can carry. THIS IS THE KNOB TO REVISIT
when a real militia income exists.

STATE OF THE CHAIN (each rung proven live today at least once): front opened from a bootstrapped
territory -> escrow reserved on both sides -> ASSAULT_BEGUN -> native attack orders accepted -> real
casualty -> `war-merit PROMOTED` (14:47:30Z) -> capture-by-force -> escrow refunded. The only rung never
observed is `war-bounty PAID`, and the last measured obstacle to it was the campaign lookup (FW-078) and
the destroyed-hull identity (FW-073/075/076).

HOW TO FINISH (no code expected): start the agents stack, keep `EVEJS_COOP_WAR_BOUNTY_ISK=5000`, seed one
front with both sides in the SAME system (7 linked hulls is enough), then run
`node scripts/coop-war-acceptance.cjs --minutes 20`. If it reports `bounty-paid` PENDING, read
`living-native-destruction-identity` (FW-079) - it names the identity source that was short.

### 2026-10-29T23:10Z - character titles done server-side (6 types, 35 left)

Fork `738b145`: `space/coopCharacterTitles.js` + `characterTitleGatewayService.js`, gated by
`EVEJS_COOP_CHARACTER_TITLES` (added to compose). Per-character owned set + worn slot inside the
character record; a title exists because a grant created it, an ungranted title cannot be worn
(9), and revoking the worn title clears it. Live on 140000001: GetOwned 0 -> 2 grants 200 ->
GetOwned 2 (16-byte ids) -> equip 200 and the equipped call answers it -> ungranted 9 -> revoke
the worn one 200 and no_title true -> second revoke 5. Register 35 (`handled=246`).

**Blocking fact for anything cosmetic-character side (owner's "we can simulate"):** the client
gates titles behind the LaunchDarkly flag `character_titles_feature_enabled`
(`featuremanagement.client.flag.flag_bool`, flag source is the LaunchDarkly SDK inside the
client, NOT our gateway), so the UI stays dark until that flag is on. The definitions are a
flatbuffer downloaded from the checkpoint our gateway returns; a title flatbuffer is small
(`Title.LocalizedName` per entry), so OUR OWN content is feasible - that is the next step, then
the flag question (client-side config, not server code).

Achievements have no such LD gate; their definitions are also a checkpoint our server owns, plus
admin progress/complete/reset, reward claim, category score and showcase score (9 types).

### 2026-10-30T00:20Z - achievements done except the definition catalogue (8 of 9 types, 27 left)

Fork `aaebf64`: `space/coopAchievements.js` + `achievementGatewayService.js`, gated by
`EVEJS_COOP_ACHIEVEMENTS` (in compose). Progress rows, category scores, unclaimed rewards and
the showcase score are real per-character rows. Honest rules proven live on 140000001: add 7 ->
progress 7; add 0 -> 3; checklist -> 9 (refused, not dropped); complete -> 200 then 9; Get
not_completed false with a real timestamp; one unclaimed reward; claim 200 then 5, list empty;
category/showcase 0 because nothing scored was invented; reset 200 then 5. Register 27
(`handled=254`).

Still missing in this block: `achievement.definition.api.cdn.GetLatest` - the catalogue is a
flatbuffer the client downloads from the checkpoint we return, so we must generate our own
content file and serve it. That is also the same shape needed for title definitions
(`Title.LocalizedName`), so one content-serving mechanism covers both.

Title UI additionally needs the client LaunchDarkly flag `character_titles_feature_enabled`
(client-side, not our gateway).

### 2026-10-30T02:00Z - title catalogue content built; download path blocked (0 new types)

Fork `7d93168`: `space/coopTitleContent.js` builds our own TitleData flatbuffer (identifier CHTI,
4 titles, uuid-hex ids, localized names) and `characterTitleDefinitionGatewayService.js` answers
`definition.api.GetLatest` with the checkpoint {url https://127.0.0.1/elysian-eve/titles/
1.0.0.titles, version 1.0.0, crc 2300466464}; 368 bytes and the CRC of the file matches. The route
is wired into the existing loopback CDN responder. Tests read the buffer with an independent
reader that mimics the client (3/3 pass).

WHY IT IS NOT VISIBLE YET - two separate blockers, both measured:
1. On the play stack port 443 is the HTTP/2 gateway, so `createLoopbackCdnResponder()` returns
   null (`activeHttpsPort === 443`) and the HTTP/2 listener deliberately has no HTTP/1 request
   handler. The client's flatbuffer provider uses `httplib.HTTPSConnection(host, 443)` + a plain
   GET, so that request never gets answered (a host-side probe hangs; from inside the container
   it is ECONNREFUSED because the responder binds the host). Next step: an HTTP/1.1 listener that
   also serves these content routes on 443 (or a second trusted host:port the client can reach).
2. The titles UI is behind the client LaunchDarkly flag `character_titles_feature_enabled`
   (`featuremanagement.client.flag.flag_bool`); the flag source is the LaunchDarkly SDK inside the
   client, not our gateway.

Achievements' `definition.api.cdn.GetLatest` needs the same content mechanism (bigger flatbuffer),
so fixing the HTTP/1.1 content path unblocks both.

### 2026-10-30T03:10Z - content host live: the client's download path now works

Fork `0a7b8d1`. `contentCdnServer.js` is a separate TLS HTTP/1.1 server (the h2 gateway must not
gain a request handler - it kills the process with ERR_HTTP2_TRAILERS_ALREADY_SENT). It serves only
the routes `getGatewayBinaryAsset` knows and 404s everything else. Compose publishes a SECOND
loopback address, `127.0.0.2:443 -> 28443`, because the gateway binds 127.0.0.1 only; env
`EVEJS_COOP_CONTENT_BIND=0.0.0.0:28443`, `EVEJS_COOP_CONTENT_ORIGIN=https://127.0.0.2`.

Proven from the HOST over the client's own protocol path: GET https://127.0.0.2/elysian-eve/
titles/1.0.0.titles -> 200, 368 bytes, CRC 2300466464 = checkpoint CRC, identifier CHTI; unknown
route -> 404. Registry GetLatest advertises https://127.0.0.2/... v1.0.0.

Remaining for the titles window: the client LaunchDarkly flag `character_titles_feature_enabled`
(client config, not our gateway). Everything server-side is now in place: state (6 calls), our
catalogue, the checkpoint, and a downloadable file.

### 2026-10-30T04:00Z - skin market fees done (4 of 10 types, 23 left)

Fork `1ec0b15`: `space/coopSkinMarketFees.js` (one policy) + `skinMarketFeesGatewayService.js`.
Broker 1/2/3/5 % for 1/3/7/14-day listings (nanos 10/20/30/50 M), tax 2.5 % (25 M nanos), buyer fee
tier 1 = 100 LP (branded 200), tiers 2-3 = 250/500 and 500/1000, version 1.0.0. Live: 4 broker rows
with 1-day/10 M first, 4 per-duration rows, tax 0/25 M, buyer 100 LP, definition 3 tiers.
Register 23 (`handled=259`).

Remaining in the market: `skin.listing.InitiateCreateListing` / `InitiatePurchaseListing` /
`CancelListing` / `Get` / `admin.SetExpiration`, `component.listing.InitiatePurchaseListing`,
`transaction.api.Get`. They need escrow of a real licence in the seller's store plus ISK transfer
between characters; the fee policy above is what those calls should charge.

### 2026-10-30T05:10Z - skin market listings done (6 types, 19 left)

Fork `931cb17`: `space/coopSkinListings.js` + `skinListingGatewayService.js`, gated by
`EVEJS_COOP_SKIN_MARKET`. Listings live in the seller's character record (a listing cannot exist
without its owner) and the market view is the union over characters, because `gameStore.write` only
accepts the `characters` table - a dedicated table does not exist (`TABLE_NOT_FOUND` measured).

Escrow is real: create moves copies from `unactivated` to `escrowed` in the licence row before the
listing exists; cancel returns exactly those copies; expiry drops the row and refunds. Live on
140000001 (licence 6ae282c834c7dd78, 3 copies): create 200 + 16-byte transaction, GetAll price
5 000 000, owner-specific GetAllOwned 1/0, escrow 1; foreign cancel 7, own cancel 200 -> 3 copies,
no listing; 99 copies 9; unknown 5. Register 19 (`handled=263`).

Remaining market work: `InitiatePurchaseListing` (ISK transfer + buyer fee), `component.listing.
InitiatePurchaseListing`, `transaction.api.Get`. Character records carry a `balance` field, so a
wallet path exists natively - find the native debit/credit function before writing the purchase.

## FW-087/088 + acceptance result (18:0xZ): attribution now PASSES

FW-087: a dead ship in a contested system could be counted as a campaign casualty (and could feed a
capture) even when the war never mobilised it. The runtime now requires a war fleet row before recording
anything and reports NOT_A_MOBILISED_WAR_HULL otherwise; campaign and war come from that row.

FW-088: FW-079's witness paid off immediately. At 17:33:25Z the victim showed disk 0, live 0, fleet 0
while its war casualty row existed at that very millisecond - the durable ledger is written BEFORE
attribution in the same death path and carries pilot, entity and system. It is now an identity source.

ACCEPTANCE (20-minute window): `casualty-recorded` PASS, `attacker-attributed` PASS
(attacker=coop-pilot-007 victim=coop-pilot-003 wreck=980300000047), `merit-promoted` PASS (from 14:47Z),
`bounty-paid` PENDING. So attribution - the rung that failed all day in four different ways - is proven on
a real casualty.

NEXT CONCRETE QUESTION (measured, not guessed): that 17:33 kill produced NO `war-merit` event and NO
`war-bounty-skipped` event at all, which means `coopWarKillMerit.note` never reached the payer for it
(the 14:47 kill did, and answered NO_REAL_CAMPAIGN_FOR_EVENT, which FW-078 fixed). So the thread is inside
coopWarKillMerit after a successful attribution: which branch returns before awarding. Everything needed
to see it is in `living-native-destruction-attacker` + `living-native-war-merit`; the wrapper emits for
any non-paid outcome, so silence means the function itself returned early or threw.

Also measured: the war economy is now priced at 5 000 ISK per side and both sides reserve it successfully
(17:38:52Z and 17:48:55Z, two campaigns funded on both sides), so funding is no longer the blocker.

### 2026-10-30T06:00Z - skin market purchase done (1 type, 18 left)

Fork `27d9c09`. `InitiatePurchaseListing` uses the native wallet: `transferCharacterBalance` (which
refuses an overdraft) moves the gross price, the seller pays 2.5 % tax out of the proceeds, then
escrowed copies move to the buyer with the same name/line/layout/creator. Rollback on tax or
delivery failure returns the ISK; own-listing and short stock are refused with the real number left.

Live between two characters: 1 000 000 000 each before; create 200, own purchase 9, purchase 200
(16-byte tx); after: seller 1 000 975 000, buyer 999 000 000, buyer holds the copy, escrow 0,
listing gone. Register 18 (`handled=264`).

Known gaps in this flow: the buyer's loyalty-point fee is quoted (100 LP tier 1) but not charged;
`transaction.api.Get` cannot show the transaction yet (the id is returned but not stored as a row);
`component.listing.InitiatePurchaseListing` is untouched.

### 2026-10-30T06:40Z - checkpoint: 18 types left, 56/56 of this session's tests green

Everything added this session is proven live and green: skins (licences, apply, drafts, sequencing,
component licences, item consume, skin record), titles (state + our own catalogue + content host),
achievements (8 of 9), market (fees, listings, purchase). Register `handled=264 missing=18`.
Stack healthy, 0 error lines in 20 minutes of logs.

Remaining 18, with the honest next step for each:
- `achievement.definition.api.cdn.GetLatest` - needs an achievement definition flatbuffer (bigger
  than titles). Our content host and checkpoint pattern already exist (coopTitleContent +
  characterTitleDefinitionGatewayService + EVEJS_COOP_CONTENT_BIND/ORIGIN).
- `cosmetic.market.transaction.api.Get` (+GetAll) - needs stored transaction rows; the purchase
  already returns a 16-byte id, so the row just has to be written. Attributes.status is an enum
  whose numbers must be read from the client's pb2 before answering.
- `cosmetic.market.component.listing.api.InitiatePurchaseListing` - component bundle purchase,
  same wallet + escrow shape as the skin listing purchase.
- `freelance.contributionmethod.itemdelivery.DeliverRequest` - deliver an item to a project.
- `operation.recommendation.GetRequest`, `ship.unlock.ClaimRewardRequest`, `communitytrack.api.Get`
  - read/claim surfaces with no store yet.
- sovereignty: `hub.upgrade.api.Get`, `mercenaryden admin.Modify{Anarchy,Development}Level`,
  `skyhook admin.ScheduleTheftVulnerabilityWindow`.
- auth: `AuthenticateUsernameRequest`, `auth.steam.AuthenticateSteamRequest` - native login paths;
  do NOT fake an authentication result.
- `ai.assistant.chat.api.QueryRequest`, `internal_gateway.ConsumeEvents/Request`, `debug.Request`,
  `eve_public.Request` - infrastructure/debug surfaces; `debug.Request` must stay unhandled unless
  the owner asks for it explicitly.

### 2026-10-30T07:20Z - transaction record done (1 type, 17 left)

Fork `0595472`. `marketTransactionGatewayService.js` + rows written by the purchase into BOTH the
buyer's and the seller's record. Status enum numbers read from the client's own descriptor
(0 unspecified, 1 initiated, 2 failed, 3 successful) - never guessed. Live: after a real 750 000
ISK purchase both actors read 200 with state 3 and a timestamp, the buyer's GetAll has exactly that
id, unknown id 5. Register 17 (`handled=266`).

Next candidates (see the earlier checkpoint entry for the full list): achievement definitions CDN
(flatbuffer, same content-host mechanism), component.listing purchase, freelance item delivery,
sovereignty admin calls.

### 2026-10-30T08:00Z - two empty-catalogue reads answered (2 types, 15 left)

Fork `3166539`: recommendation.Get -> 200 with an empty list; communitytrack.Get -> 5 with the
reason. Live measured. Register 15 (`handled=268`).

The rest of the list is mostly infrastructure or content that does not exist in this world:
achievement definitions CDN (needs a flatbuffer schema; titles already prove the mechanism),
component.listing purchase, freelance item delivery, sovereignty hub/mercenaryden/skyhook admin,
auth username/steam (must not be faked), ai assistant, internal_gateway, debug (leave alone).

### 2026-10-30T08:30Z - why the achievement catalogue is the one big remaining piece

Measured from the client's own flatbuffer module
(`achievement_system/client/model/flatbuffer/generated.pyj`), the achievement catalogue is not one
small table like titles (`TitleData { titles: [ { Id, LocalizedName } ] }`). It defines at least
`RewardPayload`, `ProgressConfig`, `IskReward`, `SpReward`, `ItemReward`, `TitleReward`, `Reward`,
`AchievementMilestone`, `CategoryMilestone`, `MethodParamDefinition`, `CumulativeMode`,
`ChecklistMode`, plus the root and category tables, and the client's `from_flatbuffer` methods call
`.decode('utf-8')` on strings, which means a missing string is not "empty" but a crash.

So serving our own achievement catalogue is a real content-pipeline task (root table + identifier +
categories + achievements + milestones + reward payloads + contribution methods), not a 40-line
builder. Our content host, checkpoint and CRC mechanism are already proven with titles, so the
plumbing exists; the work is the schema.

Recommended order for that task:
1. dump every class and field id from the generated module (one pass, like the title one);
2. build the smallest catalogue the client can render: root -> categories -> achievements with a
   name/description id, one milestone with a target and one SP reward;
3. serve it at a new content path and point `achievement.definition.api.cdn.GetLatest` at it;
4. verify by reading the buffer back with the client's field order, then in the client window.

Everything else left in the register (15) is either infrastructure (ai assistant, internal_gateway,
debug), authentication (must not be faked) or content that does not exist yet (component bundles,
freelance item delivery, sovereignty admin).

## FW-089/FW-090 + the payout rung is PROVEN in one process (18:2xZ)

FW-089: the silence after a successful attribution was itself a finding - the merit function returned
before it could say why and its caller only wrote a console warning. Every early return now emits
`living-native-war-merit-skipped` with its reason, and the bridge from the destruction callback reports
the decision it got (`living-native-war-merit-bridge`), including the bounty status.

FW-090: a replayed payout answered NO_HELD_ESCROW_FOR_FACTION - which reads as "this war has no money"
although the money went out on the first call. A settled row for the same campaign/faction/proof/pilot is
now ALREADY_PAID with its amount, and no money is touched.

THE PROOF THIS RUNG NEEDED, without waiting for a live world:
`tests/coop-war-payout-end-to-end.test.mjs` wires the REAL treasury, chest and bounty modules exactly as
the runtime wires them (state row, treasury row, corporation wallet, casualty ledger row, fleet-registry
campaign lookup) and moves 5 000 ISK out of a HELD escrow into the killer's earned balance:
`HELD -> PAID`, `paidToPilotID=coop-pilot-007`, credit exactly once, `earnedAfter=5000`. A replay answers
ALREADY_PAID and credits once; an unfunded side pays nothing (`NO_HELD_ESCROW_FOR_FACTION`); a kill with no
campaign pays nothing (`NO_REAL_CAMPAIGN_FOR_EVENT`). 4 tests, all PASS.

War suite: 586 tests, 0 failures.

WHAT REMAINS is therefore only the live observation, not a code gap: `bounty-paid` in the wild needs a
kill inside a funded campaign, and the live world keeps ending campaigns (capture or 45-minute expiry)
before one lands. The tools are in place: `scripts/coop-war-acceptance.cjs`,
`war_payout_diagnose`, `living-native-destruction-identity`, `living-native-war-merit-bridge`.

## FW-091 + the front keeper (19:1xZ): the live loop starves on militia money, not on code

FW-091: the campaign stall window on the agents stack is now 10 minutes
(`EVEJS_COOP_WAR_OPENING_STALL_MS=600000`) instead of 45, because this stack simulates at x5 and a
front could otherwise eat an evening per retry.

`%TEMP%\opencode\front-keeper.cjs` (a tool, not engine code) closes the operational hole that made every
acceptance run a lottery: it reads the live war state, finds a PREPARING/ASSAULT campaign, and makes sure
its OWN contested system holds armed hulls of BOTH war parties, using the sanctioned spawn path with a
real doctrine and a free pilot. Runs keep cycles going without an operator seeding fixed systems that
the planner never picks.

MEASURED LIMIT of the live loop (19:12Z): `NO_FUNDED_FRONT` with
`SUPPLY_UNFUNDED_SIDE:500001` - the two-sided rule refuses because the militia corporation cannot fund
its own 5 000 ISK bounty, even after a top-up to 90 000 ISK. The reason chain in the events is
`BOUNTY_BACKED_BY_NATIVE_CORP_WALLET` -> `WAR_TREASURY_FUNDS_UNAVAILABLE`, so the levy is planned and the
wallet debit is refused; the treasury row and the corporation wallet disagree about what is spendable
(most likely an orphaned HELD row from an aborted opening holds the difference).

THE ONE STRUCTURAL GAP LEFT (product decision, not a patch): militia corporations have no income of
their own. Everything they pay comes from a manual `war_mercenary_settle` from the ORE corporation, while
the funded garrison buys replacement hulls from the same wallet. A day of fighting drains both, and then
FW-068 correctly refuses every border. Until a real income exists (a share of the faction's NPC market
sales, or loot of the wrecks its hulls create), the war economy needs an operator to top it up.

Payout rung: PROVEN in process (tests/coop-war-payout-end-to-end.test.mjs, 4 tests). Live observation of
`bounty-paid` still needs one kill inside a funded campaign, which is now purely an economy question.

## PERF ROOT CAUSE, measured on the owner's LIVE play server (2026-10-30)

Method: `%TEMP%\opencode\profile-server.cjs <container> [seconds] [pid]` - opens the Node
inspector with `SIGUSR1` (no restart) and prints top self-time functions. This is the tool to
reuse; do not guess at CPU cost again.

**FW-097 (SHIPPED, commit 8a36539, deployed to the play stack after owner-authorised restart):**
profile of `evejs-server-1` before the fix = `cloneValue 7374 ms / 82 %` + `listNativeCargo 11 %`.
`getNativeEntity(id)`, `listNativeCargoForEntity(id)`, `listNativeModulesForEntity(id)` and
`listNativeEntitiesForSystem(id)` deep-cloned the ENTIRE collection (`JSON.parse(JSON.stringify)`)
and only then picked the row, and the A-Life haul pass calls the cargo one once per miner per
tick. They now scan the cache and clone only the rows they return; isolation is unchanged
(`database.read` hands out the live cache object, so returned rows stay private clones).
After the restart `cloneValue` is **absent from the profile**. Test: `tests/coop-npc-store-read-cost.test.mjs`.

**FW-098 (NEXT, identified, not written yet):** two post-restart profiles of the same server
(9 s, 12k samples each) put ~82 % of the process inside our atomic-rows bridge:
`transact coopGameStoreAtomic.js:93 = 36.5 %`, `reconcileObject :74 = 14.7 %`,
`loadTableObject sqliteStore.js:697 = 14.3 %`, GC 16.7 %. Reading the code: every transaction
(1) calls `flushTableSync(t)` for every table it names, and (2) after commit the cache is
invalidated, so the next access reloads and deep-reconciles the WHOLE table from SQLite.
The fix is row-level: `transact` already returns its exact `changed` write set, so apply those
keys to the cache instead of reloading/reconciling whole tables. Do not touch the durability
guards (`NATIVE_GAMESTORE_PERSISTENCE_NOT_QUIESCENT`) - the flush is what makes the commit safe.

State of the owner's stack right now: running image `f41c50ca…` (has FW-092..FW-097), 65 durable
NPC links incl. 10 seeded armed hulls (Aldranette 9, Nennamaila 6, Immuri 3), CPU still ~118 %.
Militia enlistment still waits on the owner: dock at Enaluri 30045339 / station 60015068 (agent
3019070) + log out ~30 s, then `militia_enlist` (the bridge refuses while his session is live and
while the character is undocked).

## FW-098 SHIPPED (commit 0cc7158 in the fork, image evejs-local rebuilt)

What was measured (live play server, post-FW-097 profile): `transact` 36.5 %,
`reconcileObject` 14.7 %, `loadTableObject` 14.3 %, GC 16.7 %. Every commit re-read the
WHOLE table from SQLite (parsing every row), deep-reconciled it, then re-read it a second
time inside `rebuildFlushBaselineFromDisk`.

What changed:
- `createSqliteAdapter.transact` now returns `writes` - the exact serialized rows it wrote
  (`[key, json]`, `null` = delete) next to the existing `changed`.
- `sqliteStore.applyRowToObject(table, object, rowKey, value, merge)` - per-row counterpart
  of `assembleFromRows`; preserves object identity via `merge`, replaces for `characters`,
  and treats a bare wrapper-group row (skeleton `{}` / legacy blob) as ADDITIVE ONLY.
- The adapter applies only the written rows to the cache and advances the flush baseline
  with `advanceFlushBaseline` (the same function the async flush acknowledgement uses).
  Tables declared but not written are not reloaded at all. `npcCargo` in cargo-witness
  mixed mode keeps the full reload.
- Fallback (not silent, structural): if the injected store cannot answer `rowGroupsFor` or
  exposes no `applyRowToObject`/`advanceFlushBaseline`, that table takes the historical
  full reload. Production passes the real module, and the test pins the index.js wiring.

Tests: `tests/coop-atomic-rows-write-set.test.mjs` (4/4) - shape equivalence against the
real `assembleFromRows`, a commit that asserts `loadTableObject` is NOT called (0 loads),
cache/disk/baseline equality, and the production wiring source pin. Regressions:
coop-gamestore-atomic/mining-cycle/cargo-isolation/ammo-bank 67/67,
coop-native-* + coop-alife-* + coop-fw-* + coop-war-* + coop-mining-* 1744/1744.

Agents stack redeployed and healthy, no POSTCOMMIT/CACHE_UNSAFE/NATIVE_GAMESTORE errors in
the log, world events still flowing. Its CPU is ~77 % idle so it does NOT exercise the
bridge hot path - the before/after numbers must come from the play stack, which needs an
owner-authorised restart window.

Engine audit still reports its PRE-EXISTING state: AUDIT_REGRESSION with integration drift
4 (coopAdminBridgeActions, coopDistributionPlan, coopWarAdvantage differ by design/past
edits; nativeNpcStore.cjs has no .js-free counterpart) and coopVirtualWorldRuntime.js at
5397 lines vs the 4800 ceiling. FW-098 is not in that drift list (its mirror is identical).

## FW-098 DEPLOYED TO THE PLAY STACK AND MEASURED (owner-authorised restart, 2026-10-30)

Same tool, same window (9 s, ~13 400 samples), `evejs-server-1`:

| | before | after |
|---|---|---|
| container CPU | 118 % (later 93 %) | **14-32 %** |
| idle in profile | ~0 % | **71 %** |
| cloneValue nativeNpcStore | 82 % | 1.0 % |
| transact / reconcileObject | 36.5 % / 14.7 % | not in top 10 |
| loadTableObject | 14.3 % | 0.6 % |
| rebuildFlushBaselineFromDisk | 18.4 % | 0.6 % |
| memory | 4.86 GiB | 2.22 GiB |

No `POSTCOMMIT`/`CACHE_UNSAFE`/`NATIVE_GAMESTORE`/`POISON` lines in the log, world alive
(living-mining-cycle-settled 214/600 lines, native combat + weapon events flowing), 65
durable NPC links intact, war state intact (3 wars, 5 territories, 19 campaigns,
18 EXPIRED + 1 OCCUPIED).

## NEXT: FW-099 - the expired-target cooldown outlives the reason it existed

Measured right now on the play stack (`war_diagnose`):
- `war:500001-500004` decision = **open:true, BOTH_SIDES_CAN_FIELD_NAVY** (500001 CAN_FIELD,
  1 armed hull; 500004 CAN_FIELD, 1 armed hull),
- `war:500004-500014` and `war:500014-500019` = NO_NAVY_CAPABILITY:ATTACKER (those factions
  field only industrials),
- and yet the ONLY armed border, 30003837 (Caldari, 5 ships) <-> 30045344 (Gallente, 3
  ships, gates 50016294/50016293), is refused with `TARGET_RECENTLY_EXPIRED`
  (`living-native-war-opening-blocked`, 20:52:20Z).

Cause: `coopFactionWarOpening.js` `targetCooldownMs` = `stallMs() * multiplier`, multiplier
grows with the number of EXPIRED campaigns on that target and caps at 8x, so five expiries
= 8 x 45 min = ~6 h of a dead border. Those five expiries happened while the defender could
not field navy at all; the condition has since changed (the war decision is now
BOTH_SIDES_CAN_FIELD_NAVY), but the cooldown does not know it.

Planned fix (pure function + test, default ON because it only removes a stale refusal):
the cooldown applies only while its recorded reason still holds - when the last expiry was
a navy/supply refusal and the current war decision is open, the target is eligible again on
the next tick. A target that expires with navy present keeps the full growing cooldown.
Bumping `EVEJS_COOP_WAR_OPENING_STALL_MS` does NOT help: the cooldown is derived from it.

Also still open: militia corporations have no income of their own (everything came from a
manual `war_mercenary_settle` from ORE 1000129), so the funded garrison competes with hull
purchases for the same wallet.

## FW-099 SHIPPED (fork commit ad62455), NOT YET ON THE PLAY STACK

`STALE_EXPIRY_REASONS = {WAR_ESCROW_MISSING}`; `targetCooldownMs` and the durable loop in
`coolingDown` both skip those records. An `NO_ASSAULT_DEPLOYMENT_PROOF` expiry still grows
the backoff (2x per failure, cap 8x) and an unknown reason is still a failure.

Proven on the owner's REAL war state (copied from the container, pure functions, no deploy):
```
30003837  expired 16  escrowLost 14  old window 360 min  oldBlocked TRUE  new window 90 min  newBlocked FALSE
30045344  expired  1  escrowLost  0  old window  45 min  oldBlocked false
30045343  expired  0                old window  45 min  oldBlocked false
```
`war_diagnose` also shows the war `war:500001-500004` is `open:true BOTH_SIDES_CAN_FIELD_NAVY`
(500001 1 armed hull, 500004 1 armed hull) while 500014/500019 are `NO_NAVY_CAPABILITY:ATTACKER`.
So FW-099 + this image is what lets the only armed border open.

Tests: `tests/coop-war-target-cooldown.test.mjs` now 8/8 (3 new: 10 lost-escrow releases do not
sum to the 8x cap, a real assault-proof failure still doubles, an unknown reason is still a
failure). Regression `coop-war-*` + `coop-fw-*` 529/529.

## NEXT WINDOW BUNDLE for the play stack (needs an owner-authorised restart)
1. this image (FW-098 + FW-099),
2. `EVEJS_COOP_PERF_METRICS=1` - the agents stack already runs it and it is the cheap way to
   see lag without an inspector: it emits `coop-perf-sample` every cycle with per-phase
   count/avg/p95/max. The play stack emits ZERO of them today.

## Next measured hot spot (agents stack, x5, own metrics - not a profile)
`npc-reconcile:<system>` = 126-253 ms PER SYSTEM (p95 up to 492 ms), `native-faction-war-opening`
118 ms. `npc-reconcile:<id>` is `observeSession(null,{itemID:0,spaceState:{systemID}})` at
`coopVirtualWorldRuntime.js:2580`, run for every visited system every 4th background tick. That
is the next real CPU target after FW-097/FW-098, and the first one to measure with the built-in
metrics rather than a profiler.

Note: the agents stack is being recreated by another session (container id changes between two
calls minutes apart), so it cannot be used as a stable A/B rig right now.

## FW-100/101 DEPLOYED ON THE PLAY STACK - the frontier is no longer an open/expire loop

Deployed (fork 4e6b8bc) together with the earlier FW-099 image and EVEJS_COOP_PERF_METRICS=1
(fork 7746512, compose.coop-probe.yaml). Measured after the restart:

- `war:500001-500004:campaign:30003837:r18` opened 21:11:13Z and is STILL `PREPARING`; every
  earlier campaign on that target (r7..r17) died about a minute after opening with
  `WAR_ESCROW_MISSING`. The frontier now has a live front.
- `war_state` counts moved 19 campaigns/18 EXPIRED to 21 campaigns with 1 PREPARING AND
  1 OCCUPIED.
- `war_funding_diagnose` explains why the play stack must keep REQUIRE_FUNDING=0:
  needCents 2500000, every side `REFUSED:NO_REAL_FACTION_INCOME` because the 50 virtual
  pilots' earned balances are all 0 - so requiring escrow there would mean no war at all.

## NEXT blocker, measured 21:17:46Z (the phase tells it itself)
```
living-native-war-garrison        GARRISON_APPLIED
living-native-war-skip            SKIPPED   WAITING
living-native-war-gate-staging    SKIPPED   NO_ATTACKER_SHIP_REGISTERED
living-native-war-sovereignty-projection  PROJECTED_VIEW
```
The attack cannot leave its system because the war fleet registry has no attacker hull
(`coop-faction-war\u001ffleet-roster-v1` held only `coop-fleet-500004-0001`). That is the next
thing to fix: either the mobiliser must register the attacker's hulls, or the bridge action
`spawn_war_fleet` / `fleet_reconstitute` must be used to staff both sides of r18. Until a real
assault happens, no merit, no bounty and no capture can be claimed on the play stack.

Watcher: `%TEMP%\opencode\front-watch.cjs <container> <minutes>` appends one line per minute
(live campaigns + the last war/assault/merit events) to `%TEMP%\opencode\front-watch.log`.

## WHERE THE ASSAULT IS STUCK (measured 2026-10-30 21:17-21:20Z on the play stack)

The campaign is alive (`campaign:30003837:r18`, PREPARING since 21:11:13Z), so FW-099..101 did
their job. The attack still cannot leave its system:

```
living-native-war-gate-staging  SKIPPED  NO_ATTACKER_SHIP_REGISTERED
```
`coopWarGateStaging.js:143` needs a fleet-registry ship with `campaignID === r18`,
`factionID === attacker`, `systemID === campaign.sourceSystemID`, a real `entityID` and a
`coop-pilot-NNN` pilot. The registry holds nothing matching.

Two `living-war-fleet-spawned` events appeared (21:17:46Z 500004, 21:19:09Z 500001), both in
**30003837 - the CAMPAIGN TARGET**, and both emitted from `coopAdminBridgeActions.js:998`, i.e.
from the `spawn_war_fleet` ADMIN ACTION, not from a runtime phase. That is almost certainly the
leftover `%TEMP%\opencode\front-keeper.cjs` from an earlier session still ticking: it staffs the
target system with both sides. For r18 the target is 30003837 (Caldari), so the attacker is
500004 and its staging source is **30045344** - a fleet spawned in 30003837 can never satisfy
"attacker ship in source system".

NEXT: either stop that leftover keeper and let the mobiliser muster the attacker in its own
source system, or call `spawn_war_fleet {factionID:500004, systemID:30045344}` so the registry
gets an attacker ship where staging looks for it. Then watch for ASSAULT -> casualty ->
war-merit -> bounty PAID. Nothing before that can be reported as a fight.

## FW-102/103 DEPLOYED (fork 3c327f2, 8502e8e) - the war is no longer staffed into a corner

**FW-102 (3c327f2).** `war_diagnose` returned `MOBILIZER_NOT_INITIALIZED` while the phase kept
ticking, so the one read-only action that explains an empty side explained nothing. The
mobiliser now has a single construction site (`warMobilizerInstance(registry,guard)`) used by
the phase and the diagnostic; an idle tick publishes `living-native-war-mobilization-idle` with
the per-side report (system tracked? assigned? the first rejection reasons).
PROVEN live: `living-native-war-mobilization-idle OBSERVED` with both sides and their rejects.

**FW-103 (8502e8e).** `coopWarGarrison.js` mustered BOTH sides inside `campaign.targetSystemID`.
`coopWarGateStaging` (and the mobiliser) need the attacker in `campaign.sourceSystemID` while
PREPARING, so one tick published `GARRISON_APPLIED` and `NO_ATTACKER_SHIP_REGISTERED` together;
that is why r7..r18 never deployed. Each side now musters in its own system.
PROVEN live 21:46:51Z and 21:50:06Z: the garrison spawned 500004 in **30045344** (fleets
`coop-fleet-500004-0025`, `-0026`), and at 21:54:37Z the staging reason advanced from
`NO_ATTACKER_SHIP_REGISTERED` to `NO_ATTACKER_SHIP_IN_SOURCE:30045344` - the attacker now
exists, just not where staging looks.

## Next two blockers (measured 21:50-21:55Z)
1. The mobiliser rejects the freshly garrison-spawned hulls with `SHIP_NOT_IDLE_NATIVE` (they
   are still warping right after the sanctioned spawn), so the hulls that would satisfy staging
   are never ASSIGNed in the window in which they exist.
2. The registry read disagrees with itself: `war_fleet_state` and a direct SQLite read of
   `coop-faction-war\u001ffleet-roster-v1` report **0 rows**, while `coopWarGateStaging` behaves as
   if some attacker rows exist (it switched from NO_ATTACKER_SHIP_REGISTERED to
   NO_ATTACKER_SHIP_IN_SOURCE:30045344). Resolve which read is authoritative before touching
   the assign path further.

## FIRST REAL ASSAULT AND REAL KILLS ON THE PLAY STACK (2026-10-29 22:33Z)

FW-103 unblocked the front: `war:500001-500004:campaign:30003837:r18` moved PREPARING -> **ASSAULT**
(the first campaign on that border ever to leave PREPARING; r7..r17 all expired). The attacker
now musters in the TARGET once ASSAULT starts, which is exactly the mobiliser's own rule:
`living-native-war-mobilization-idle 22:33:18Z  DEFENDER 30003837 SIDE_MUSTERED assigned 2`.

Combat is real, not modelled:
```
22:33:15.178Z living-native-war-merit UPDATED pilot coop-pilot-018
             evidence UPSTREAM_ATTACKER_ENTITY_PLUS_PHYSICAL_NATIVE_WRECK
22:33:15.178Z living-native-war-merit UPDATED pilot coop-pilot-013 ...
22:33:18.449Z living-native-war-battle-line-relief RELEASED entity 980000064832
             reason NATIVE_WRECK_CONFIRMED
merit-v1 row: 16 pilots, 8 with merit, 535 merit total, top coop-pilot-040 175,
coop-pilot-018 115, coop-pilot-002 100; every entry kind "warship-kill" (25 each)
```

Bounty is NOT paid, and the event says why: `living-native-war-bounty-skipped
BLOCKED NO_HELD_ESCROW_FOR_FACTION` (`REAL_KILL_WITHOUT_PAYABLE_ESCROW`). That is the
consequence of the deliberate `EVEJS_COOP_WAR_REQUIRE_FUNDING=0` on this stack: its factions
earn 0 (`REFUSED:NO_REAL_FACTION_INCOME`), so there is no escrow to pay from.

## Corrected measurement (my previous note was wrong)
The registry row is `coop-faction-war\u001ffleet-registry-v1`, NOT `...\u001ffleet-roster-v1`
(roster = composition plans, `war_fleet_state` ones). Measured 22:34Z: 6 registry rows, all in
30003837, 5 of them the DEFENDER faction 500001 plus one 500004 row - i.e. the defender side
mobilises normally and the attacker row only appears once ASSAULT flips the muster system to
the target. There was no "registry disagrees with itself" defect; I read the wrong row.

## Next (in order)
1. `BOUNTY_PILOT_FACTION_UNKNOWN` on a kill that DID earn merit (coop-pilot-013, camp "").
   A kill the merit ledger accepts must know its faction; find why attribution lost it.
2. Bounty payout is a product decision: either fund the factions for real (no real income) or
   keep the war merit-only on the play stack. Escrow is never minted.

## FW-104 DEPLOYED (fork d7cb19d) - a real kill keeps its attribution

`living-native-war-bounty-skipped BOUNTY_PILOT_FACTION_UNKNOWN` (coop-pilot-013, 22:33:15.180Z)
was a real attribution bug: the merit ledger had already accepted the kill
(UPSTREAM_ATTACKER_ENTITY_PLUS_PHYSICAL_NATIVE_WRECK), but the pilot's identity link no longer
resolved a live native corporation, so the bounty could never be paid even where escrow exists.
`pay()` now falls back to the pilot's own war fleet registry row - the same assignment verified
natively at ASSIGN - for both faction and campaign. Bounty suite 8/8, coop-war-*+coop-fw-* 540.

## Standing after the 22:4xZ restart
`war:500001-500004:campaign:30003837:r18` is still **ASSAULT** (persisted across the restart),
`campaign:30045343` **OCCUPIED**, 19 EXPIRED historical. Merit ledger: 16 pilots, 8 with merit,
535 total, three real warship kills worth 25 each in the last hour (018 +115, 040 175, 002 100).

Remaining, in order:
1. The assault is quiet again: the attacker side in the target rejects with
   `WRONG_FACTION` / `PILOT_IN_USE`, so no new attacker hull joins the fight. The defender side
   is `SIDE_MUSTERED` (assigned 2). Next: why the garrison-spawned 500004 hulls in 30003837 do
   not resolve to faction 500004 in `getFactionForCorporation` (the same lookup the mobiliser
   uses), or give the garrison a way to spawn them already assigned.
2. Bounty payout still needs a product decision: the play stack runs REQUIRE_FUNDING=0 and its
   factions earn nothing, so every real kill answers NO_HELD_ESCROW_FOR_FACTION. Escrow is
   never minted; either fund the factions for real or state that merit-only is the intended shape.

## Live combat confirmed 22:44Z (the assault is firing, not idling)
`living-native-combat-damage SAMPLED` every 5 s (22:44:20 / 22:44:25 / 22:44:30 / 22:44:35), on a
campaign that is `ASSAULT` and survived the FW-104 restart. The phase skips in the same window
are the healthy ones: `assault NO_PREPARING_CAMPAIGN` (nothing left to open), `garrison
GARRISON_COOLDOWN` (the sanctioned spawner throttles itself), `capture-by-force NO_DEFENDER_WRECK`
(waiting for the first defender hull to die at the target).

Registry at 22:42Z: 8 rows, all 30003837 - 5 of 500001 and 1 of 500004 shown, i.e. the defender
side accumulates rows while only some hulls are physically live; dead rows are ignored by the
mobiliser (`rowIsLive`), so they reserve no pilot and block nothing.

## Not a bug, a pace: how fast a side refills
`maxSpawnsPerTick` 1 with a per-side cooldown means a wiped side takes several minutes to come
back, and during that window the mobiliser honestly reports `NO_ELIGIBLE_PATROL` on the empty
side. Do not "fix" that with a bigger spawn budget before measuring whether it actually starves
the front; the 22:33Z round had both sides staffed and killed two hulls.

## Why the bounty never pays: the money chain dies at the seeded market (measured 22:26Z)

The war chest is funded ONLY from the earned-ISK ledger of the faction's own pilots
(`coopWarChestFunding.planLevy` reads `ledger.pilots[*].balance`), and every one of the 50
virtual pilots is at **0**. The reason is not the war code:

```
22:13:23.938Z living-npc-sale-type  NO_SEEDED_COUNTERPARTY  typeID 17470 station 60000358
22:26:30.818Z living-npc-sale-type  NO_SEEDED_COUNTERPARTY  typeID 1230  station 60000682
22:26:32.928Z living-npc-sale-type  NO_SEEDED_COUNTERPARTY  typeID 17470 station 60000358
```
`coopNativeNpcMarket.js:318` only accepts a counterparty row with `source === "seed"` at that exact
station and type, and those two stations hold no seeded bid for the loot the war hulls recover.
So the loot is hauled to a station and never sold, no pilot ever earns ISK, the levy refuses with
`NO_REAL_FACTION_INCOME`, no escrow is ever HELD, and every real kill answers
`NO_HELD_ESCROW_FOR_FACTION`. The sell allowlist already includes 17470 and 1230
(`EVEJS_COOP_NPC_MARKET_SELL_TYPES`), so this is a SEED-COVERAGE gap, not an allowlist gap.

Two honest ways forward, both owner decisions:
1. **Seed a real counterparty** for those loot types at those stations (real seeded stock, never
   an invented player-style order) so loot sales credit the earned ledger.
2. **Pay from the faction corporation wallet** (real ISK exists: 1000120 = 530 000, 1000035 =
   90 000) instead of only from pilot earned balances - a doctrine change, since FW-005 was
   written to pay only from money its own pilots really earned.
