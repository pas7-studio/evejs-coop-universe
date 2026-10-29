# Co-op mission verification plan (implemented, never exercised live)

Why this document exists: the mission families below were implemented and unit-tested long ago, but
**not one of their runtime events has ever appeared in a real world.** Measured on the owner's play
stack (`/var/lib/evejs/coop-events.jsonl`, ~37 MB of history):

```
15261  living-mining-cycle-settled      2763  native-npc-combat-sample
 2558  living-haul-no-hauler            2286  living-mining-blocker
 ...
courier / escort / rescue / mission / duo / pve  ->  0 events
```

The world has only ever run the living-world loop (mining, hauling, war fleets, NPC industry). So the
mission code is in the "green tests, unproven in game" state, which the project treats as *not done*.

## What already exists

- 88 test files for these families, **835 assertions green / 0 failing / 12 skipped** (`node --test
  tests/coop-courier-*.test.mjs tests/coop-escort-*.test.mjs tests/coop-rescue-*.test.mjs
  tests/coop-duo-*.test.mjs tests/coop-pve-*.test.mjs tests/coop-fleet-mission*.test.mjs
  tests/coop-mission*.test.mjs`).
- Modules (fork `Code/server/src/space/`): `coopCourier*` (7), `coopEscort*` (20), `coopRescue*` (6),
  `coopFleetMission{Join,Turnin}` (2), `coopDuo*` (3), `coopPveDuo*` (3), `coopStoryMission*` (2),
  `coopMissionInstanceProvenance` + `coopMissionWavePacing` (2).
- Runtime instruments already built and proven elsewhere: `coop-events.jsonl` with explicit statuses,
  the read-only admin bridge (`trip_diagnose`, `arrival_diagnose`, `war_state`, `war_fleet_state`,
  `scene_slim_diagnose`, `inspect_npc`, `spawn_native_npc`, `chat_command`), and
  `scripts/coop-overview-check.cjs` for what a client is actually told.

## Gates, family by family

| Family | Live gate (what must appear) | Preconditions | Clients |
| --- | --- | --- | --- |
| Courier dispatch | `courier-*` events for accept/flight/gate-hop/settlement with a real `contractID` and native cargo changing hands | a real native courier contract on the character + `EVEJS_COOP_COURIER_DISPATCH=1`; the code already refuses when the contract is not genuine | 1 (server-side flight) |
| Escort (priced offer → accept → fly → settle) | `escort-*` events: offer, acceptance, departure witness, warp fence, terminal history writer, settlement; the same ISK movement visible in the wallet | a real priced escort contract; two ships in the same scene for the party legs | 1 for the solo legs, 2 for the party legs |
| Rescue contracts | `rescue-native-acceptance` + rescue settlement events, with the rescued hull and the reward in the real ledger | an NPC in distress in the same system; the rescue site must exist (see the scanning gap) | 1 |
| Fleet mission join / turn-in | `living-pve-duo-native-mission-turnin`, `...-reward-custody`, `...-reward-evidence` | a mission instance with provenance; two characters in the same fleet | 2 |
| PvE duo reward | the three `living-pve-duo-native-*` events with a real item/wallet delta on the same victim/kill | native kill evidence (the destruction-attacker path already proven) | 1–2 |
| Story mission guard/settlement fence | the guard refusing an unproven settlement, then accepting a proven one | a story mission instance | 1 |
| Mission wave pacing / provenance | paced waves and provenance rows in the journal | dungeon/site content (blocked by the missing site spawner) | 1 |

## Order of work (cheapest true proof first)

1. **Courier** - fully server-side once a genuine contract exists; no second client, no new content.
   Start here: it exercises accept → native cargo → gate hops → settlement, which is the same glue the
   other families need.
2. **Fleet mission join / turn-in** - needs two characters but no new content.
3. **Escort solo legs**, then the **party legs** (two clients).
4. **Rescue** - after the site spawner exists (see `docs/CLIENT_GAPS.md`, "Scanning surfaces are empty").
5. **PvE duo / story mission** - after (4).

## Definition of done for each family

- the family's events appear with real ids (contract/mission/entity) and an explicit status;
- the money/cargo/licence movement is visible in the same record (wallet before/after, cargo before/
  after) - never just "the code ran";
- what the client shows is confirmed by a human at least once (the project's rule: a server-side PASS
  is not gameplay PASS);
- a failing path is demonstrated too (refusal keeps state unchanged).

## Known blockers to record honestly

- `docs/CLIENT_GAPS.md` -> "Scanning surfaces are empty because no site is spawned": rescue/PvE/story
  content needs dungeon sites in scenes, which no spawner currently produces (SDE carries 1404 real
  dungeons).
- Two-client gates need the owner's friend connected (play stack, SSH tunnel) or a second local client.
