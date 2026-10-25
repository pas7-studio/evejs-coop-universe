# COOP-PVE-CONTRIBUTION-001 — real player damage and native objective credit

**Implementation status:** read-only witness, reversible pinned-source patch helper, causal report and focused tests are committed. **The native hook is NOT installed by the main overlay yet. Live NPC damage, native mission and two-client GUI evidence are NOT verified.**

## Why this is a separate workstream

PR #2 owns native fleet, loot and dungeon objective progress, PR #3 owns overall reliability and PR #5 owns raid → physical wreck → source-debited loot correlation. This slice only asks **whether both real pilots actually damaged the same native NPC** and whether **both have independently native-credited dungeon objectives**. It does not edit these owners, grant rewards, pick final blow, spawn enemies or claim two-person combat from shared fleet membership.

## Evidence contract

The pinned upstream `Code/server/src/space/combat/killmailTracker.js` owns `noteDamage(attackerEntity, targetEntity, appliedDamage, options)`. We verified its exact source anchor appears once at upstream SHA `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`: the ledger update `ledger.attackers[attackerKey] = currentEntry;` followed by `ledger.damageTaken = ...` and `ledger.lastUpdatedAtMs = whenMs;`.

New module `integration/coopPlayerCombatWitness.cjs` only accepts a **positive applied native damage value**, an existing physical `kind: ship` **native NPC victim**, an existing non-NPC player ship and exactly one authenticated, Ballpark-ready, same-scene session **owning that exact ship object**. Disconnected/duplicate player sessions, wrong system, ghost ship, mismatched explicit pilot identity and different target entity object are rejected. Direct player-ship hits only: drone/fighter ownership and indirect damage are **not** falsely inferred in this first slice.

On a valid source callback, optional telemetry emits:

```json
{
  "event": "coop-native-player-damage",
  "status": "APPLIED_NATIVE_PLAYER_DAMAGE",
  "source": "NATIVE_KILLMAIL_TRACKER_NOTE_DAMAGE",
  "systemID": 30000144,
  "characterID": 11,
  "shipID": 201,
  "victimEntityID": 501,
  "appliedDamage": 15
}
```

Numbers above are **test fixture placeholders, never live evidence**. The native `coopRuntimeProbe` adds the timestamp. It remains optional and failure to emit must not break native combat; missing telemetry means no reported PASS.

Existing PR #2's separate `coop-fleet-dungeon-objective` event is accepted only with `status: TWO_PLAYER_NATIVE_DUNGEON_OBJECTIVE_CREDITED`, two distinct character IDs, actual native instance, agent, fleet and same-system party evidence. It establishes **native objective credit**, not double reward settlement or proof that the objective is part of the same unrelated pirate encounter.

## Report

The read-only CLI consumes current server JSONL:

```powershell
# Run in the co-op project checkout with owner-approved, already-running Docker.
docker compose --project-directory 'C:\Games\EveCoop\upstream-evejs\Code' -f 'C:\Games\EveCoop\upstream-evejs\Code\compose.yaml' exec -T server cat /var/lib/evejs/coop-events.jsonl |
  node .\scripts\coop-duo-contribution-report.cjs --window-minutes 120
```

It enforces a current headless boot, mutual **two different physical** ship scene, matching system and ship identity at each native hit, and no intervening disconnect without a new scene proof. Hits must affect the **same real NPC entity**; optional confirmed physical wreck is separately correlated. The objective event must match those same two authenticated characters. It never includes raw character IDs in its JSON output.

Even `SERVER_TWO_PLAYER_DAMAGE_AND_MISSION_CREDIT` means **server-side proof only**. The report always keeps `actualGameplayVerified=false`, `clientRenderingVerified=false`, `missionRewardsVerified=false`. It never substitutes two sockets for two clients, claims which player killed the NPC, or says both looted.

## Integration handoff (NOT deployed)

The source patch helper `scripts/coop-player-damage-native-patch.cjs` exports `patch(text, {remove})`. It refuses unknown or partial pinned source, is idempotent and reversible, and inserts one optional post-ledger hook. **It does not write to disk.**

Once PR #2 is stable and the current native overlay maintainer approves:

1. Include this helper in the **existing transactional** `scripts/patch-evejs-coop.cjs` source-patch pipeline, targeting **only** `server/src/space/combat/killmailTracker.js`. Do not run an independent competing patcher or overwrite the operator's protected upstream tree.
2. Copy `integration/coopPlayerCombatWitness.cjs` to existing deployed `server/src/space/coopPlayerCombatWitness.js` through the existing overlay module mapping. Its internal relative runtime imports expect that destination.
3. Add `EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE=1` only to an explicitly selected LivingCoop run; default **OFF**. Preserve loopback-only networking and `evejs-data`.
4. Run pinned source parse/patch/unpatch and negative tests; after an owner-approved deployment prove that the native `noteDamage` call is actually reached for player-on-NPC damage. This runtime path has **not** been live verified here.
5. Resolve the known `BLOCKED_TELEMETRY` problem with `DiagnoseWorld` before using reports; then perform actual authorized two-client UI/mission/loot acceptance.

**No GitHub Actions/CI, no deployment, no merge, no client modification, no fake events and no game-data mutation.** No overlap with open PR #2, #3, #4 or #5.

## Tested locally

```powershell
node --test tests/coop-player-combat-witness.test.mjs tests/coop-duo-contribution-report.test.mjs
```

**21/21 isolated tests passed on Node 22**. Includes native applied-damage validation, object identity, session ghosts/reconnects, wrong targets and systems, broken source anchor, reversible hook, split victims, stale boot, malformed events, missing second player, optional physical wreck and mission mismatch. These are **not** Docker/client acceptance tests.
