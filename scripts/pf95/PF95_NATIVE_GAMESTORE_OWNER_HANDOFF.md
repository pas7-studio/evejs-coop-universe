# PF95 — Original GameStore single-writer mutation witness (review-only)

**2026-11-07 | Draft PR #350 | Original fork NOT modified | Personal Fleet OFF**

## What changed

PF94 proved that an epoch counter detects a put/restore cycle that
PF93's complete SQLite-table fingerprints cannot detect. PF95 moves
from an independently constructed epoch wrapper towards the real
original `coopGameStoreAtomic.js` owner.

Exact source: `pas7-studio/EveJS` `coop/pas7std`,
`Code/server/src/space/coopGameStoreAtomic.js`; pinned Git blob
`2b28b48145f3fbc989ce7346384487ee75e52280` (the same pin as PF90).

Review-only diff:
`scripts/pf95/review/coopGameStoreAtomic.pf95.review-only.patch`.
It changes **one original engine source file**, adds no new table,
writer, database, runtime patcher or market/character ownership path,
and is **not registered with the legacy upstream patch installer**.

Within the already existing `createSqliteAdapter`:
1. Start a per-transaction `mutationEpoch=0` after `BEGIN IMMEDIATE`.
2. Each source-owned `tx.put` or `tx.del` increments the epoch
   before its SQLite write attempt, including same-value upserts and
   delete-missing. The original native `changed`/`writes` receipt
   and GameStore post-commit cache synchronization stay unchanged.
3. Expose `tx.verifyReadOnlySessionWitness(callback,request)`,
   available **only** with
   `EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=1`.
   It passes detached read-only `get/scan`, refuses async witnesses,
   and throws (forcing SQLite rollback) if the epoch changed during
   the witness, even when it returned `false`.
4. Every `get/scan/put/del` and witness call checks `txLive`.
   On any transaction exit, success or rollback, the escaped tx
   capability is revoked.
5. Default shipping behavior remains unchanged: the witness method
   is not invoked by the original game; feature flag OFF.

## Verification

`scripts/pf95/tests/pf95-original-game-store-epoch.test.cjs`:

- Requires `PF95_NATIVE_WORKTREE` and an absolute local path to the
  **original WORK checkout**. Refuses known PLAY/production paths.
- Verifies the **exact native Git blob SHA1** and refuses drift.
- Copies that source file to a unique temporary directory, checks
  the review diff with `git apply --check`, then applies it **only
  in the temporary directory**.
- Loads the patched **original** `createSqliteAdapter` with the real
  Node `node:sqlite` `DatabaseSync` and executes 12 tests:
  committed receipt integrity, write/restore, same-value write,
  delete-missing, unrelated corporation write + false callback,
  async callback, default-disabled, escaped tx after both commit
  and rollback, and preservation of `synchronous=FULL` plus
  `BEGIN IMMEDIATE`.
- Deletes the temporary directory afterward. It does **not**
  write, patch, build or restart the original fork or PLAY.
- Uses existing PF90 source pin, not a duplicated verification
  manifest.

Additionally, a reconstructed source-accurate
`createSqliteAdapter` fragment was patched in a disposable local
fixture; `git apply --check`, `node --check` and **9/9 actual
Node.js 22.16.0 SQLite integration scenarios PASS**. This is only
the fragment, **not the complete exact original pinned source**.
The 12 source-pinned native tests above are authored but **NOT RUN**
here because the original fork is not accessible in the container.

Local command:

```powershell
.\scripts\pf95\Test-PF95-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

## Known remaining blockers

**No native fork integration yet.** The GitHub connection returns
HTTP 403 for creating a branch in `pas7-studio/EveJS`. The patch is
a review artifact, **not** a source commit in that fork. Do not
register it in `patches/upstream/MANIFEST.json`: that registry feeds
legacy tooling with potentially mutating behavior.

The original native `characterState.writeCharacterRecord`,
`ItemStore`, original session owner and PF91/PF92 guest code still
must call **this source-owned verified witness** under one transaction.
An attested epoch counter does not stop direct raw SQLite writes made
outside the instrumented `tx.put/del`; source review must prove
those bypasses unavailable for this path. The original
`createGameStoreAdapter` cache reconciliation and post-commit poison
behavior must be tested after any actual fork commit.

PF95 cannot authorize merging PR #350 or enabling Personal Fleet.
The next actual handoff belongs to the original WORK fork agent:
land the source-owned epoch as a reviewed commit, run native unit
and original source-pinned SQLite tests, integrate ItemStore/
characterState/session write paths, then run crash/restart, concurrent
Mining/WAR/Exploration and **two-client WORK E2E**. No PLAY restart
or global main merge until those proofs exist.
