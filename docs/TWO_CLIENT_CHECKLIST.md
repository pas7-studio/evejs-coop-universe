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

## Known server-side limitation before an assault can begin

`coopWarMusterReadiness` requires a native fitted weapon plus exactly one
compatible charge. In this world **no NPC has any native module at all**
(`inspect_npc 980000000113` -> `moduleCount 0, cargoCount 0`), because the pinned
`nativeNpcService.buildNativeModuleRecords` only fits `definition.loadout.modules`
and these profiles resolve to an empty loadout. So:

- the war, its campaigns and the structures are real;
- `BEGIN_ASSAULT` cannot fire until that fitting gap is fixed (see
  `.opencode/state.md`, "NEXT ACTION");
- do not expect an assault on the map in this build.

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
