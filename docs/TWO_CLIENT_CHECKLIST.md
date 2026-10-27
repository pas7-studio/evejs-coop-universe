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

## Human steps (two characters, one machine)

1. Confirm the server: `docker compose -f compose.yaml -f compose.coop-probe.yaml ps`
   shows `evejs-server-1` healthy and the market container healthy.
2. Start the client **once** per account directory and log in character A.
3. Character A: dock/undock in Jita (30000142), then open the **map** and the
   **Faction Warfare** tab. Expected: the campaign layer shows the coop campaign
   for the Angel/ORE front, and the FW tab lists 30000142 / 30000144 / 30000145
   with the real owner/occupier. If the tab is empty, capture the client log tail
   instead of guessing.
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
- that an assault began (it cannot, see above).

## Stop rules

If the client cannot be started, report `BLOCKED_CLIENT_UNAVAILABLE` with the
exact launcher error. If the map shows no campaign while the server state has
one, capture the client log and the `coop-events.jsonl` window; that is a real
projection bug to fix, not a reason to fake a screenshot.
