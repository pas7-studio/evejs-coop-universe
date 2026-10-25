# COOP-032F — Materialize native calculated READY as a persisted industry status

**Status: manual, isolated proof only. Not a live factory or active scheduler.** Depends on PR #60 (scoped industry), PR #54 (GameStore transaction), PR #51 (delivery), PR #50 (installer).

## Actual pinned behavior

On the pinned EveJS `industryRuntimeState.getJobStatus(job)`, a persisted `status=1` INSTALLED job with `endDate <= currentFileTime()` is **projected** as READY (3) for the UI without necessarily persisting `status=3`. The COOP-032C safe delivery kernel explicitly requires stored `status=3`; a completed timer alone will not satisfy delivery. The native helper `markIndustryJobReady(jobID)` is a separate pathway that updates endDate; do **not** invoke it to bypass the job duration.

## Implemented

`integration/coopNpcIndustryReady.cjs` exports `createNpcIndustryReadyProof` and `markReadyOnce(operationID)` with a single `gameStore.coopAtomicNativeRows.transact(["industryJobs","items","industryBlueprintState"], callback)`. No independent SQLite handle, no player impersonation or stock industry handler.

Before transitioning `INSTALLED (1) → READY (3)`, it requires:

- Exactly one native `industryJobs.jobs<jobID>` with matching `coopOperationID`, native manufacturing activity (1), original BPO, real positive owner/station/facility IDs, same station output and no pause;
- Parseable trusted FILETIME start/end, monotonically ordered, **real time has reached the original endDate**;
- Original signed/verified native quote metadata, *exact* expected duration from `quote.timeInSeconds` (10,000,000 FILETIME ticks/sec), output type/quantity and ownership, and positive approvals from two independently supplied trusted owner and canonical output verifiers;
- The actual original BPO native item remains owned by the same corporation in location 2003 with its expected inventory flag; matching `industryBlueprintState.records<blueprintItemID>` still points to this job.

The only write is the native industry's `industryJobs.jobs<jobID>.status = 3` plus `coopReadyAt = currentFileTime()`. Crucially the **native original endDate is untouched**, and no minerals, wallets, item IDs, output stock, blueprints or market entries change in this step. On repeated READY, returns `ALREADY_READY` without writes; canceled, paused, completed, duplicate-ID and forged-timer jobs fail closed.

Requires both default-OFF environment guards `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1` and `EVEJS_COOP_NATIVE_NPC_TX_PROOF=1`. Export explicitly says `supportsNativeReadiness:false` because this is an isolated proof, not enabled native gameplay. Nothing added to live overlay module list.

## Evidence and deployment gate

`tests/coop-npc-industry-ready.test.mjs` contains ten disposable `node:sqlite` regression scenarios: too-early timer, exact end-time, full real install→READY→delivery/replay, BPO ownership/state mismatch, changed timer, invalid status/pause, duplicate operations, external owner denial, feature flag validation.

Local sandbox tested exact production-ready-module logic with the existing real B/C kernels and scoped SQL adapters in disposable SQLite: **23/23 PASS** (6 focused readiness scenarios, 7 industry scoped integration tests, and 10 scoped SQL contract tests). The committed ten-case readiness test file has not yet been executed in a full checkout on the production driver; this is **not** a real server/worker restart proof.

**Blocked P0:** attested pinned GameStore `better-sqlite3` + persistence worker + restart, production native SDE/corporation/BPO verifier bindings, real NPC-owned assets, durable journal tick scheduler, native itemStore visibility and client market transactions. Do not claim NPC factories or market are playable until verified on isolated full server with real stock handlers.

No `main` merge, Docker, market reseed, CI/Actions or `evejs-data` modification.
