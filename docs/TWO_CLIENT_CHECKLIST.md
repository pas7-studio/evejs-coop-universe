# Two-client gameplay checklist (server preconditions verified 2026-10-27)

Purpose: give the human tester the exact, already-verified server state and a
step order that can produce **real** two-character evidence. Nothing here
claims client success; the client half is unverified until a person does it.

## What is already proven server-side (this session)

| Fact | Evidence |
| --- | --- |
| Overlay installs and matches the pin | `node scripts/patch-evejs-coop.cjs --check` -> `OVERLAY_OK`, 353 modules |
| Server healthy | `docker ps` -> `evejs-server-1 Up (healthy)` |
| Two real faction structures exist | `worldData.getStructuresForSystem(30000144)` -> 1 Astrahus `1030000000000` (faction 500014); `30000145` -> `1030000000001` |
| A real war opened from real presence | `living-native-war-opened OPENED war:500011-500014` with campaigns for 30000144 and 30000145 |
| Front chat reports are wired | `warFrontChat` in `coopVirtualWorldRuntime`, tests 3/3 |
| War client projection is live | `EVEJS_COOP_WAR_CLIENT_VIEW=1`, `campaignSnapshots` emits the bound `structure:<id>` |

## Refresh 2026-10-27 04:00Z — the fitting gap is closed, one assault is live

The earlier limitation ("no NPC has any native module") no longer holds. The
authored war-patrol loadout row plus `EVEJS_COOP_WAR_PATROL_AMMO_DEPTH=60` give a
real fitted weapon **and** a real charge bank:

- `spawn_native_npc` -> `loadout {"status":"RESOLVED","reason":"AUTHORED_MULTI_CHARGE_ROW",
  "chargeTypeID":20767,"chargeDepth":60}` and `inspect_npc 980000017150` ->
  `moduleCount 5`, cargo 5 x typeID 20057 x 60.
- Real measured damage, wreck, stored loot, casualty, strict attacker, merit and
  a promotion are all proven (`living-native-war-merit PROMOTED`).
- War state right now: 2 ACTIVE wars, 4 campaigns — `war:500011-500020:campaign:30001363`
  in **ASSAULT** (both sides armed, this is the theatre that really fights) and
  three `war:500011-500014` campaigns in PREPARING (see below).
- `living-native-durable-recovery` is `OK` again after the stale-link fix
  (`ff071de9`); the materializer bridge exists, so raids, loot delivery and
  market assignments are no longer inert.
- War chest: ORE 500014 really funded its own chest from earned ISK and its
  bounty is HELD in escrow for `campaign:30000143`.

### Still true, and it is not a client problem

`war:500011-500014` campaigns cannot muster: ORE 500014 has **no armed native
profile** (the resolver only has empire/pirate `parity_*` combat profiles), so
`war_diagnose` mobilises 0 ships and ORE's HELD escrow can never pay a kill or a
death benefit. Angel 500011 and Serpentis 500020 can fight but have no real
income, because the only system where they really fight (30001363) sits in region
10000016, which has **zero** seeded buy orders — recovered loot has no buyer
there. Exact evidence and the single decision needed: `.opencode/state.md`,
"item 1 code PASS, live income BLOCKED BY WORLD GEOGRAPHY".

So when the human tester opens the map, expect the Angel/Serpentis campaign in
30001363 to be visible and real; do not expect a 500011-500014 assault.

## Refresh 2026-10-27 06:00Z — the front now sits in a seeded region

The owner-approved default was applied: an armed pair's front was brought into
region 10000002 instead of leaving the only real fight in the market-less region
10000016.

- **Maurasi 30000140** is now real military control of Serpentis 500020
  (`warState.territories["30000140"].militaryControllerFactionID = 500020`)
  after the armed cruiser `980000018084` (coop-pilot-063) was spawned there.
  It is the only seeded-region system that is both belt-bearing (25 real SDE
  belts) and gated to Jita by a real reciprocal pair (`50000802 <-> 50001248`),
  and it is not ORE-owned, so a border between two **armed** factions exists
  inside region 10000002.
- Seeded buyers really exist there: 431 station/type buy rows for the loot and
  ore types, all at Jita 30000142 and New Caldari 30000145 stations.
- The campaign is refused for exactly one reason, measured:
  `living-native-war-opening-blocked` ->
  `SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500020:NO_REAL_FACTION_INCOME`.
- Raids are live again (three silent blockers fixed, `9ff67b86`): a real armed
  pirate gets real native attack orders with `orderDiagnosis PERMITTED`, and
  `npc_pair_diagnose` reports `engagementAllowed true` with 300 fitted charges.
- **Not** solved: no kill yet in Jita/New Caldari, because the stock mining fleet
  there sits at AU-scale positions and keeps warping, so the raid cannot convert
  into damage. Nothing was minted or faked. Exact data and the two honest options:
  `.opencode/state.md`, "FW-013 result".

## Human steps (two characters, one machine)

1. Confirm the server: `docker compose -f compose.yaml -f compose.coop-probe.yaml ps`
   shows `evejs-server-1` healthy and the market container healthy.
2. Start the client **once** per account directory and log in character A.
3. Character A: dock/undock in Jita (30000142), then open the **map** and the
   **Faction Warfare** tab. Expected: the campaign layer shows the coop campaigns
   (Angel/ORE fronts plus the Angel/Serpentis front on the Maurasi border), and
   the FW tab lists 30000140 / 30000142 / 30000144 / 30000145 with the real
   owner/occupier. If the tab is empty, capture the client log tail instead of
   guessing.
4. Character B: log in on the second client, fly to Jita, and form a fleet with A.
5. Both: undock together and jump Jita -> Perimeter (30000144). Expected: both
   ships arrive in the same scene, and the Astrahus `Perimeter Anchor Keep` is
   visible on grid near the first asteroid belt.
6. Capture evidence per step: client screenshot + the server tail
   `docker exec evejs-server-1 tail -n 40 /var/lib/evejs/coop-events.jsonl`
   (look for `virtual-world-presence`, `living-native-war-*`,
   `living-war-front-report`).

## What must NOT be claimed without the client

- that a player sees the campaign, the FW tab, the structures or any chat report;
- that two characters share a scene, fleet or warp;
- that an assault began on the Maurasi border (it cannot until an armed faction
  really earns its bounty - see above).

## Stop rules

If the client cannot be started, report `BLOCKED_CLIENT_UNAVAILABLE` with the
exact launcher error. If the map shows no campaign while the server state has
one, capture the client log and the `coop-events.jsonl` window; that is a real
projection bug to fix, not a reason to fake a screenshot.

## Refresh 2026-10-27 08:15Z - a real mining fleet mines again; the raid geometry is the open item

**Proven server-side since the last refresh (all read-only probes, verbatim in
.opencode/state.md):**
- fleet 960004609 in Perimeter 30000144 is state=mining with ct=13
  (13 of 13 miners carry 2 live module effects) and all 13 within 200 km of a real
  belt; living-mining-cycle-settled really raises the ore
  (
extCargo 1874 -> 3748, eforeRock 228126 -> afterRock 226252).
- The delivery leg completes: living-native-haul-delivered DELIVERED twice, and
  the deposit gate now explains any refusal by name (detail.term).
- An aggressed stock fleet now resumes after 120 s
  (EVEJS_MINING_NPC_FLEET_AUTO_RESUME_DELAY_MS, a real stock knob).
- war_funding_diagnose: ORE 500014 FUNDED (coop-pilot-001 183 400 ISK); Angel
  500011 and Serpentis 500020 both REFUSED:NO_REAL_FACTION_INCOME, so
  living-native-war-opening-blocked still reports
  SUPPLY_UNFUNDED:500011:...|500020:... and ronts:0.

**Open server item (not a client problem):** the raid in New Caldari 30000145
holds an attack order it cannot execute. 
pc_pair_diagnose 980000018058 ->
980000016311 reports distanceMeters 373994639646 (2.5 AU) with the attacker in
mode:GOTO, and the fleet's aggression clock keeps being re-armed
(lastAggressedAtMs 08:12:31, esumeInMs 92113, esponseWing 0), so the fleet
never returns to mining and coopMiningBeltReturn never flies its 13 miners
(0 of 13 at a belt) back. Fix direction: the raid director must refuse or release
an approach the native controller cannot fly (a "warp" that lands in GOTO) and
publish the reason; the fleet then resumes, the belt return runs, and the next
raid at the belt is the one that can really fire.

### Human steps (unchanged, still the only way to prove the client half)

1. Launch the client once (client_launch), log the first character in, and stay
   in Perimeter 30000144 so the working mining fleet is on grid.
2. Second character in the same system; both must be able to see the same named
   NPCs (living-native-* names) and the same fleet.
3. Report what the map campaign layer and the FW front tab show; the server
   projection is EVEJS_COOP_WAR_CLIENT_VIEW=1.
4. Nothing in this document claims any of that is client-verified.
