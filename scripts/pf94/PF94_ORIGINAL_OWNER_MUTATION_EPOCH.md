# PF94 — Original GameStore owner mutation epoch (candidate)

**2026-11-07 · Draft PR #350 · Original EveJS hook NOT installed · Personal Fleet OFF**

## Why PF93 full-table fingerprints are insufficient

A session-witness callback may call `tx.put()`, then restore the
exact same serialized value before returning. PF93's SHA256 before/
after snapshot then looks unchanged even though the supposedly
read-only callback performed SQLite writes. The risk remains when
the callback writes an *identical* value or attempts to delete
a missing row. Proof of **zero attempted writes** requires a
trusted original GameStore owner write counter, not just a hash of
the final database state.

## Candidate code

`scripts/pf94/native/coopOriginalOwnerMutationEpoch.cjs`

- `createOriginalOwnerMutationEpoch({get,scan,put,del})` constructs a
  frozen transaction facade. Every call to `put/del` increments
  an unmodifiable internal generation **before** executing the
  corresponding SQLite writer. Failed, no-op, write-restore and
  delete-missing attempts are therefore still detectable.
- `verifyOriginalSessionWitnessWithOwnerEpoch(tx,callback,request)`
  reads the private generation before and after the session witness,
  grants the witness only detached read-only `get/scan`, rejects
  promises/thenables, propagates callback exceptions and **throws**
  `PF94_NATIVE_OWNER_SQLITE_WRITE_ATTEMPT_ROLLBACK` if the generation
  changed, even when the callback returned `false`.
- A `WeakMap` protects the private counter and rejects arbitrary
  objects claiming to be an instrumented transaction. This is
  only object-level identity: because the factory is importable,
  it **does not attest** that the transaction belongs to the real
  original EveJS GameStore. That needs source-reviewed integration.
- Transactions are explicitly closed at the end of the original
  owner callback. A stale wrapper cannot be re-used.

The standalone candidate intentionally does NOT wrap an already-live
PF93 transaction at runtime. Doing that would leave a reference to
the original noninstrumented writer and make write detection
bypassable, recreating the exact weakness this feature addresses.

## Required original source integration (not yet authorized)

Source: original `pas7-studio/EveJS` branch `coop/pas7std`,
`Code/server/src/space/coopGameStoreAtomic.js`, pinned by the
**single existing PF90 original source manifest**:

1. In `createSqliteAdapter`, after `BEGIN IMMEDIATE`, let the
   **original SQLite owner** create the one and only transaction
   `get/scan/put/del` methods through the PF94 epoch constructor.
   Do not expose the underlying uninstrumented `db.prepare(...).run`
   writers to any session, callback or competing original owner.
2. Ensure both the original owner `put` **and** `del` routes
   increment the same generation. Table scope remains explicit,
   and SQLite `PRAGMA synchronous=FULL`, write ordering,
   `COMMIT`, `ROLLBACK`, poisoned outcome and cache invalidation
   retain their original semantics.
3. The original `characterState.writeCharacterRecord` and
   `itemStore` transaction writers must participate; the native
   login/session authority should consume an original owner-issued
   write-free witness, **never an unverified caller callback**.
4. Only after source-owner hooks are installed can PF91/92 replace
   PF93's O(database) snapshot fallback with the O(1) generation
   proof. Until then, a missing/forged epoch must fail closed.
5. Any other direct SQLite writers that bypass this owner must be
   prohibited or fenced by the original owner; instrumenting a
   wrapper around an already-public `tx` is insufficient.

### Known negative case (deliberately included in tests)

The `PF94 deliberately does NOT attest raw DB writes bypassing
original writer closure` test demonstrates that invoking the raw
SQLite writer instead of the wrapped writer does not increment the
epoch. The source integration **must close this escape hatch**.
A passing PF94 unit suite alone cannot authorize game activation.

## Execution evidence

The candidate module and 14-test suite were executed on Linux in
the current isolated workspace with **Node v22.16.0** and the real
built-in `node:sqlite` `DatabaseSync`. Result: **14 PASS, 0 FAIL**.
The exact file Git blob hashes verified against the staged GitHub
files were:

- module `6b4f8fcc1457409c2258eb6a79d3725daf06b33c`
- Node SQLite test `9a503a6de88f7b68f27db33e09dcd150f0d2ce1c`

Tests cover write-restore, identical-value writes, delete-missing,
collateral corporation write with false witness, forged facade,
reader cloning, stale transaction reuse, asynchronous witnesses,
callback exception, actual `ROLLBACK` restoring a SQLite row, and
the deliberate bypass limitation.

These tests run **only the PF94 standalone candidate**, not the
original EveJS owner, PLAY or WORK gameplay. Original source checks
skip when the local fork checkout is unavailable. All prior PF87–93
Node/SQLite suites remain NOT RUN in this cloud environment.

Local Windows WORK command:

```powershell
.\scripts\pf94\Test-PF94-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

## Release gates

The connected GitHub App cannot create even a branch in the original
`pas7-studio/EveJS` repository (HTTP 403). No code was installed in
that fork, and PLAY was not touched. To close Personal Fleet, the local
development agent must make a reviewed original-fork owner commit,
run full original Node/SQLite tests, exercise kill/restart, Mining,
WAR and Exploration contention, and conduct two-client WORK E2E.
Keep PR #350 Draft and Personal Fleet OFF.
