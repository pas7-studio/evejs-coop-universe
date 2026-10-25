# Chat 33 — Native skills, Alpha/Omega and skill-rate cutover

**Status: CODE_READY / LIVE_UNVERIFIED**. Pinned upstream `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Existing production data and world untouched. This change does NOT claim complete crash-atomic native skill migration, two-client UI acceptance or deployed 48×. Chat 01 owns shared installer/deployment hooks.

## Current project configuration: protect operator's 100× setting

`main` currently defines `[ValidateSet(6,12,24,48,100)][int]$CoopSkillTrainingSpeed = 100` in `scripts/Deploy-Coop-RuntimeProbe.ps1`. An explicitly selected new/rebased profile can use `-CoopSkillTrainingSpeed 48`. `docs/COOP_LOCAL_PROGRESSION_V2.md` is older and calls 48× the default: **it is superseded by the actual active deployment source**. Do not silently change 100× to 48×; a slowdown is also a migration of active queue epochs, and an old activeStartTime may retroactively under/over-accrue SP. If a world already runs 48×, keep it until verified otherwise. Reading Compose source is not proof of the running container rate.

## Native facts verified from pinned source (source contracts, not gameplay)

- `skills/training/skillTrainingMath.js`: `getSkillPointsForLevel(rank,level)` retains native CCP thresholds; `getEffectiveSkillPointsPerMinute` multiplies native primary + secondary/2 attributes, account Omega/Alpha factor (1 or 0.5), and `getGlobalTrainingSpeedMultiplier`. Native queue ETA uses the same effective rate.
- `skills/training/skillQueueRuntime.js`: `getQueueSnapshot` invokes `settleCharacterTraining` first, and may mutate state. `buildProjectedQueueEntries` derives elapsed training from **persisted activeStartTime** plus **currently configured rate**. Queue read/cached projection alone is not safe after a rate change. `rebaseActiveTrainingProgress` settles old-rate progress, records a partial skill and resets activeStartTime. It writes native `skills` and `skillQueues` separately, therefore itself is **not crash-atomic**.
- `skills/training/skillQueueState.js` and `skillState.js`: persistent native queue table `skillQueues`, persistent native skill records, native offline training and scheduler. No separate overlay skill database should be introduced.
- `skillCloneRestrictions.js`: native Alpha 5,000,000 SP training cap and per-skill level restrictions, Omega resolved through account license. `subscription/subscriptionMgrService.js`, skill runtime and clone-restriction checks rely on the native account Omega authority.
- `skillbooks/skillbookRuntime.js` and `skillMgrService.js`: skillbooks are native inventory-backed items; prerequisites, skill queue limits and account training slots remain native checks. Do not auto-inject, mint or bypass skillbooks.
- `skills/training/skillTrainingSpeed.js` adjusts the five mental attributes sent by `skillMgrService` and Dogma for native client ETA. Exact two-client UI appearance and observed actual skill progression still require an authorized game client.

## New files

- `integration/coopSkillRateCutover.cjs`: explicit native old-rate cutover coordinator using the existing **pinned native `rebaseActiveTrainingProgress`**. Exports `prepare`, `readJournal`, `executeCutover`, `verifyCutover`, `RATES`. Requires an operator-verified quiesced maintenance window, a confirmed recoverable backup, explicit approval, exact roster of characters and old runtime rate. Does not change speed or write native SP directly. Writes an fsync'd `PREPARED` manifest **before** the first native operation, then `CHAR_PREPARED` / `CHAR_REBASED` per active native character. `READY_FOR_SWITCH` is durable only after every active character passes queue-order, timestamp, monotonic SP and native result verification. A torn journal, ambiguous ACK, missing active player, competing rate, queue drift, corruption or failed write stops with repair status. No auto-retry after partial native mutation.
- `integration/coopSkillEtaEvidence.cjs`: **read-only evidence evaluator**, given independent captured native snapshots and *separately observed* actual client ETAs. It compares effective native SP/min, native queue duration, Alpha/Omega grade and observed client ETA for two distinct character IDs **and** account IDs. It explicitly reports `CLIENT_ETA_NOT_OBSERVED` when only server data exists. It does not promise a GUI state or mutate SP.
- `tests/coop-skill-rate-cutover.test.mjs`, `tests/coop-skill-eta-evidence.test.mjs`, `tests/coop-skill-native-source-contract.test.mjs`, `tests/scenarios/coop33-native-two-player-skill-acceptance.json`.

## Migration procedure / Chat 01 integration contract

**Not a live-run-ready migration command.** Connect through Chat 01's approved, operator-gated native maintenance entrypoint only after the following requirements hold:

1. Inspect running rate/Omega with `scripts/Inspect-Coop-Training.ps1`; inspect the actual native queue/skill records and client ETAs for all relevant accounts. Do not mistake `-CoopSkillTrainingSpeed 100` in source for a verified deployed 100× runtime.
2. Take **and restore-test** a full native persistent GameStore/SQLite and relevant account state snapshot. Quiesce native skill queue API requests and scheduler activity while still running the **OLD** multiplier; ensure no other server instance can modify the tables during migration. The `systemQuiesced`/`backupVerified` booleans are assertions, **not proof** that a deployment achieved this.
3. Build a native object providing `getAllQueueStates`, `getCharacterQueueState`, `getCharacterBaseSkills`, `rebaseActiveTrainingProgress`, `getTrainingMultiplier`, `getNowFileTime` from original pinned modules. Do NOT use a fabricated skill or queue writer. Pass the full roster of every potentially training character, not just the visible two clients; unenumerated active players block migration.
4. Call `executeCutover({oldRate:CURRENT, newRate:48, expectedCharacterIDs:ALL_IDS, journalFile:ABSOLUTE_PERSISTENT_PATH, native, systemQuiesced:true, backupVerified:true, operatorApproved:true})` **only during this verified exclusive old-rate maintenance window**. Journal file should live under an owner-approved persistent path, e.g. `/var/lib/evejs/coop-skill-rate-cutover.jsonl`, with the journal file and `.lock` on the same durable filesystem. Native state must be backed up and journal kept as an independent durable receipt.
5. Any result other than `READY_FOR_SWITCH` means **STOP**. Never blind-retry on an UNKNOWN, partial, corrupt, or interrupted journal; an interrupted native rebase may already have committed SP. Only a manual restore/reconciliation against native skill points, active queue state, history and backup can resume.
6. Immediately stop the old-rate maintenance runtime without allowing further skill scheduling. Verify native skill and queue stores really persisted, and compare journal roster/hash using `verifyCutover`. Ensure the **requested speed** matches the attested `newRate` and the original approved native data snapshot; the current deployment `-ConfirmActiveTrainingRebased` is just a human assertion and **does not automatically verify this journal**. Chat 01 must make that gate mandatory before authorizing the new rate on an existing world.
7. Reconfigure the existing deployment with explicit `-LivingCoop -CoopSkillTrainingSpeed 48` only after full backup/receipt/readiness acceptance. Run source `--dry-run`, `--check` then execute the separately approved deployment. **No change to the current 100× default was made in this commit.** `EVEJS_OMEGA_LICENSE` and account subscriptions are not modified.
8. Validate both independent characters' exact SP totals, skill levels, queue order, native completion times, client ETAs, skillbook inventory, prerequisites, Alpha limits, Omega licenses and offline time through reconnect and restart. Do not claim live PASS without this evidence.

**Remaining blocker for zero-loss automated migration:** native `rebaseActiveTrainingProgress` persists `skills` and `skillQueues` in separate GameStore writes. A crash between those native writes can yield partial state. The coordinator blocks duplicate attempts and preserves evidence but cannot magically complete an ambiguous native transaction. A truly crash-atomic native migration requires one storage transaction or an operator-reconciled restoration procedure controlled by Chat 01. Until then **not fully completed / LIVE_UNVERIFIED**.

## Test commands and result interpretation

```bash
node --test tests/coop-skill-rate-cutover.test.mjs tests/coop-skill-eta-evidence.test.mjs tests/coop-skill-native-source-contract.test.mjs
# To execute the six direct pinned-source tests, with authorized local checkout:
EVEJS_COOP_CODE_PATH=/absolute/path/to/pinned/Code node --test tests/coop-skill-native-source-contract.test.mjs
```

Local isolated Node22 result: **29 PASS / 0 FAIL / 6 SKIP** (source tests require checkout). Pinned upstream contracts were also inspected directly via GitHub source and confirmed: native skill queue / attributes / clone restrictions / skillbook / account license functions exist. Neither unit simulations nor source inspection are two-client, Docker, SQLite-fsck or real SP progression evidence.

## Ownership / no-overlap declaration

No modifications to pinned upstream, `scripts/patch-evejs-coop.cjs`, `scripts/Deploy-Coop-RuntimeProbe.ps1`, deployed Compose, game client, persistent world, skillbook inventory, character SP or account license. No CI. One final direct fast-forward commit. Chat 01 owns enabling the native maintenance adapter and the deployment journal check; do not copy modules into a live world merely because their tests pass.
