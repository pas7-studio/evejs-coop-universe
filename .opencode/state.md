# State — co-op loop (mining → haul → station → sale)

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
