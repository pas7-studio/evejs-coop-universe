# COOP-PVE-CONTRIBUTION-001 — real player damage and native objective credit

**Integration status (stacked PR atop PR #2):** the native witness, reversible pinned hook, causal report, tests, **transactional overlay installer, LivingCoop feature flag and Windows verifier registration** are committed. **Not merged, deployed or verified against live Docker or either game client.**

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

It enforces a current headless boot, mutual **two different physical** ship scene, matching system and ship identity at each native hit, and no intervening disconnect without a new scene proof. Hits must affect the **same real NPC entity**; optional confirmed physical wreck is separately correlated. The objective event must match those same two authenticated characters **in the same native system and within 30 minutes after the last correlated hit**. This timing is correlation, **not proof that a particular NPC kill completed the dungeon**. It never includes raw character IDs in its JSON output.

Even `SERVER_TWO_PLAYER_DAMAGE_AND_MISSION_CREDIT` means **server-side proof only**. The report always keeps `actualGameplayVerified=false`, `clientRenderingVerified=false`, `missionRewardsVerified=false`. It never substitutes two sockets for two clients, claims which player killed the NPC, or says both looted.

## Transactional overlay integration (IMPLEMENTED IN STACKED BRANCH; NOT DEPLOYED)

The source patch helper `scripts/coop-player-damage-native-patch.cjs` exports `patch(text, {remove})`. It refuses unknown or partial pinned source, is idempotent and reversible, and inserts one optional post-ledger hook. **It does not write to disk.**

1. **Wired:** `scripts/patch-evejs-coop.cjs` adds exactly one `server/src/space/combat/killmailTracker.js` spec and applies the reversible helper **during the existing all-file preflight**. Failure rejects the install before writing. Undo invokes the same helper with `remove:true`.
2. **Wired:** the installer copies `integration/coopPlayerCombatWitness.cjs` to `server/src/space/coopPlayerCombatWitness.js` with the other validated overlay modules. No parallel patcher or extra ad-hoc server changes.
3. **Wired:** `scripts/Deploy-Coop-RuntimeProbe.ps1 -LivingCoop` adds `EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE=1`; ordinary modes keep it disabled. No new public network listener or persistent writer beyond the existing opt-in probe.
4. **Wired:** `scripts/Verify-Local-Coop.ps1` includes the two native evidence suites and `tests/coop-player-damage-overlay-integration.test.mjs`. The integration test checks install/uninstall/idempotency and simulated native ledger fault isolation; it also runs full upstream patch parity when an authorized checkout is present.
5. **NOT YET VERIFIED:** after PR #2 is stable and owner-authorized, run the project’s pinned read-only patch dry-run and existing local tests; then an approved deployment must verify that the native `noteDamage` path is actually called on real player-on-NPC hits. Resolve `BLOCKED_TELEMETRY` with `DiagnoseWorld` and prove two authorized clients, mission tracker, physical wreck and loot separately.

**No GitHub Actions/CI, no deployment, no merge, no client modification, no fake events and no game-data mutation.** This is a **stacked PR based on PR #2's branch**; it deliberately adds changes to that branch's installer *only in its own independent child branch*, leaving PR #2 itself untouched.

## Tested locally

```powershell
node --test tests/coop-player-combat-witness.test.mjs tests/coop-duo-contribution-report.test.mjs tests/coop-player-damage-overlay-integration.test.mjs
```

**The 21 original standalone tests previously passed on Node 22.** The stacked branch adds two regression cases about unrelated mission causality and seven integration tests for transactional native wiring. Run the full command above after checking out the stacked branch; do not treat native source or actual client deployment as validated by synthetic tests.
