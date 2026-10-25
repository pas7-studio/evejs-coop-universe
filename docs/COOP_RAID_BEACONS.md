# Real native PvE raid beacons (COOP-GAMEPLAY-01)

**Scope:** a discoverable, organic two-pilot activity. No new spawn, quest, NPC decision, scripted arena, damage, ISK, salvage, reputation or reward authority.

## In-game behavior

`coopVirtualWorldRuntime.advanceNativeRaids()` already invokes `coopWorldSignals.notifyRaid(scene, result.actions)` **only when the pinned EveJS NPC runtime accepted a real pirate warp/attack order**. This patch upgrades that existing in-game Local chat notification without touching the NPC decision owner, the native fleet/mission/loot owners or the overlay installer:

- A readable Ukrainian announcement identifies a *native* miner/ore hauler threatened by a *native* pirate. The location is the closest real static waypoint from `coopSystemIntel.nearest`; if none exists, the announcement only claims the system.
- An accepted warp-approach order is explicitly *not* presented as a shot, damage or kill. A subsequent native attack order gets its own alert, helping players decide whether to defend the convoy or engage opportunistically.
- Only actual Ballpark-ready authenticated characters with an existing native ship entity in the same scene/system are addressed. Ghost sessions, wrong-system characters, disconnected clients, duplicate character sessions and player-owned ships masquerading as NPCs are excluded.
- Repeated identical `(character, system, pirate, target, phase)` notices are suppressed for four minutes. Cache is per process, bounded to 1024 entries and never changes saved game state. A new native target/phase or newly arrived co-op partner can still get information.
- Invalid/unverifiable NPC action, lost ship, invalid coordinates or failed chat delivery never creates success evidence. A failed chat send is retried on a later real event; the reporter's `sent` field counts synchronous dispatch calls, **not confirmed on-screen client rendering**.

## Local verification

Node 22+: `node --test tests/coop-raid-beacon.test.mjs`

Checks cover two independent pilots, same-event deduplication, new attack phases, four-minute expiry, missing NPC entities, player ship identity exclusion, wrong system, ghost/disconnected sessions, duplicate character sessions, failed chat send, fallback on missing topology, malicious waypoint names and invalid scenes.

## Manual acceptance on a permitted real client

1. Preserve volumes and the running world. Deploy the overlay **only when owner-authorized**; do not reinitialize the market or rewrite client binaries.
2. Complete `docs/GAMEPLAY_TESTING.md` phases 1-3. `World` must already prove real native NPC activity, and both authorized clients must independently reach actual in-space Ballpark.
3. With both characters in the same system as an ore-bearing NPC mining convoy and its organically arriving native pirate, watch Local for the approach and/or attack signal. Record the *actual* server-side `living-pirate-raid` evidence, timestamps, target IDs (redacted outside private logs), ship presence and user-visible message.
4. Verify duplicate 30-second raid ticks do not spam Local; a later true attack phase is distinguishable from approach; an offline or cross-system character receives nothing. Fly to the real waypoint, observe the physical native ships and choose to help or intervene.
5. Claim a playable co-op success only after separate fleet/loot/missions and actual two-client in-game gates pass. Server tests and this beacon alone never establish gameplay PASS.

**Known limitations:** no remote/local Docker or actual game client run was performed by this branch. `main`, PR #2, operator's upstream checkout and `evejs-data` remain unchanged. A process restart clears the notification cooldown and can cause one repeated alert.

## Additional P0: actionable native activity intel

The existing `coopSystemIntel` (already called from `coopVirtualWorldRuntime` when `EVEJS_COOP_LOCAL_INTEL=1`) also gains a grounded duo-friendly Local summary, without introducing new NPC/mission/market systems:

- Report only live native `kind: ship` entities with finite positions; discard wrecks, missing entities, duplicate IDs and player-owned ships posing as NPCs. Count escorts from actual physical ships, not merely saved response IDs.
- Include only existing stock mining fleet counts, real reported loaded hauler ore, genuine pirate ships and an authoritative static nearest waypoint; no fictional rewards or goals.
- Use Ukrainian activity options for two pilots, while not claiming an attack or reward just because pirate ships exist.
- Send to an authenticated, Ballpark-ready connected pilot with a physical ship in the same native scene/system.
- Suppress an unchanged activity digest for up to 15 minutes, preserve the existing 90-second minimum cadence for meaningful state changes, and cap the per-player cache at 256 entries. Changed ore quantity buckets or actual ship counts can trigger a fresh update.
- Local tests: `node --test tests/coop-actionable-intel.test.mjs` (8/8 on Node 22), using the existing repo `coopNpcTopology.cjs` fallback; after overlay install the same code uses `coopNpcTopology.js`.

Manual acceptance: after the World/authorized-client gates, check that static or stale NPC IDs cannot produce an in-game mining/pirate summary, that real ore growth or newly arrived physical ships can update the message, and that idle 30-second reconciliation does not spam Local. These are player-information improvements only, not proof that the two-player game loop is complete.
