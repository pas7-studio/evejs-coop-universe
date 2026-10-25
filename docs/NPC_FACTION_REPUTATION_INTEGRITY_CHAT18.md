# Chat 18 — native NPC faction/reputation state integrity

Date: 2026-10-25. Pinned EveJS upstream: `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
Status: **SOURCE/LOGIC VERIFIED, LIVE_UNVERIFIED**.

## Existing native integration, reused (not replaced)

- `coopNpcMemory` is the existing durable NPC-pilot / player-character ledger, activated by `EVEJS_COOP_NPC_MEMORY=1`. It is a **relationship memory**, not a second EveJS standings ledger.
- `coopVirtualWorldRuntime.cjs` already consumes real native attack actions via `factionDirector.onEngagement`, verified NPC wrecks via `onLoss`, and named-NPC memory in `additionalResponders` for `coopNpcTactics`. Only actual existing native patrol ships can receive an extra EveJS attack/warp order. Separate `coopNpcRecognition` sends private recognition notices only near real ship entities.
- `coopNpcHostility` is an opt-in exception for cross-faction *NPC versus NPC* combat with explicit native attack intent. Other native standings, dogma, lawfulness, and NPC-vs-player policy remain the authority. The narrative faction tag must not override native corporation identity.
- Personal goals are already persisted in `coopNpcPersonalGoals`; native movement orders and the NPC order arbiter remain untouched.

## Changes in this commit

1. **`coopFactionDirector.cjs`** now uses exclusive temporary files, file fsync and atomic rename; on I/O failure it rolls back the mutated in-process faction state. This applies to confirmed losses, attack-order rivalry and virtual strategic planning ticks. No crash can leave *in-memory* phantom processed IDs/engagements after a failed write. File corruption or missing processed-event ledger fails closed.
2. Event identifiers must be bounded printable event keys. Each newly recorded event retains immutable source identity `{kind,faction,systemID}` for a native wreck, or `{kind,aggressorFaction,defenderFaction,systemID,attackerPilotID,defenderPilotID}` for an attack order. Exact replay yields `DUPLICATE`, conflicting reuse yields `CONFLICT`. Historical `processed[eventID] === true` records remain deduped without inventing missing attribution.
3. **`coopNpcMemory.cjs`** uses the same durable atomic write ordering, constructs a new snapshot before committing and validates loaded relation scores, encounter counts and bounded incidents. A failed fsync/rename does not consume the memory event in RAM or corrupt the prior saved file.
4. `noteVerified` rejects invalid evidence, malformed identity registry and duplicate named-NPC pilots/entity IDs in the same solar system before granting *any* memories. Both legacy registry records without a version and supported v1 records remain accepted; no new player/NPC identity is created.
5. **`coopNpcHostility.cjs`** prevents different *virtual faction* tags from overriding matching, real positive native `corporationID` values. Different native corporations continue to need all existing native attack/controller/identity proofs.

## Verification

Source code of existing main and native chain was inspected. The revised modules were parsed/executed in a JavaScript V8 isolated harness with mocked synchronous filesystem and fault injection: **18 faction-state assertions, 14 NPC-memory assertions, 4 hostility/corporation assertions passed**. The three updated repository test files were additionally executed with their actual module sources in a V8 `node:test`-shaped harness using an in-memory filesystem: **18/18 test cases passed**. Neither suite is a substitute for a real checkout or native engine. This proves logical behavior of the inspected source under the modeled failures, **not** real SQLite, EveJS client UI or native server lifecycle. Updated runnable Node regression suites:
- `node --test tests/coop-faction-director.test.mjs tests/coop-npc-memory.test.mjs tests/coop-npc-hostility.test.mjs`
- Additional existing source-specific native standing/combat tests may be required by the operator.

The above full Node command was **not run against a real checkout in this session**. There is no local Docker container, live EVE client, permission to restart the owner's server, or direct repository checkout. No full-suite PASS or live approval is claimed.

## Limits, operator validation and rollback

- Faction strategic `shipsRebuilt` and readiness counters are still *virtual* plans; they do not manufacture a native ship or withdraw actual itemStore materials. Native standings/LP/crime changes cannot be inferred from memory-score deltas.
- Multiple independent OS processes writing the *same* state file at once are **not** covered by an interprocess lock; exclusive temp creation prevents silent tmp-file collisions, but not all serial last-writer-wins races. A single authoritative EveJS server process is assumed. Do not scale to multi-writer without a durable transactional coordinator.
- After a crash leaves a `.tmp-PID` file, exclusive open fails closed. Investigate/reconcile it with the saved state; never silently delete the source-of-truth or reapply native standing transactions.
- For live acceptance, use two different authenticated characters (A/B) and one real named NPC. Trigger an original *applied native* standing receipt/confirmed wreck for A, prove B remains `UNKNOWN`, restart and confirm exactly one retained A incident, unchanged native standing, and no duplicate faction loss/reward. Repeat hostile encounters and verify an actual spare same-faction patrol receives a native order, where legitimately permitted. Check same native corporation never attacks itself due merely to virtual tags. Verify NPC responses before and after reconnect in both clients.
- No central hook, direct upstream edit, CI, wallet edit, new ships, synthetic rewards, deployment or server restart is performed. Feature flags stay default **OFF**. Roll back by reverting this commit and using the prior compatible state files; the new `processed` identity objects remain valid v1 JSON but older readers should be reviewed before rollback.
