# PF96 — Sticky original SQLite session witness fence

**2026-11-07 | Draft PR #350 | Original EveJS fork unchanged | Personal Fleet OFF**

## P0 error in the PF95 source-owned witness

The PF95 review diff detected that a read-only session witness tried to
write to the source-owned SQLite transaction. Its method threw, but the
outer stock mutation callback could **catch and discard** that error,
then return successfully. The source-owned `createSqliteAdapter.transact`
would still execute `COMMIT`. This could commit earlier writes even
though the witness was rejected. A similarly swallowed async witness,
nested witness exception or source-witness-disabled error also could
be ignored.

PF96 updates the **same** PF95 one-file review-only diff at
`scripts/pf95/review/coopGameStoreAtomic.pf95.review-only.patch`,
still against the exact original EveJS source Git blob
`2b28b48145f3fbc989ce7346384487ee75e52280`.
No second patch or source writer is introduced.

## Single-owner behavior

The existing `BEGIN IMMEDIATE` original SQLite transaction now owns
three private, transaction-scoped conditions:

- `witnessRunning`: any call to original `tx.put` or `tx.del`
  during the witness marks `witnessPoison` and throws **before SQL**.
  The callback cannot clear this state by catching the exception.
- `witnessDenied`: if a witness returns anything other than exactly
  `true`, subsequent `put/del` is denied; a previously written
  transaction cannot commit after this failed authorization either.
  A clean `false` with zero writes may return its blocked result.
- `witnessPoison`: an attempted witness write, nested witness,
  callback exception, async thenable, disabled or missing witness
  makes the transaction permanently uncommittable, even when the
  surrounding callback catches every exception.

Immediately **before the original SQLite `COMMIT`**, after the
mutation callback returns, the SQLite owner independently checks
`witnessPoison` and `witnessDenied + mutationEpoch`. These checks
throw into the **original rollback path**; no caller-supplied status,
catch block or second later `true` can reset them. The prior PF95
`PF95_ORIGINAL_SESSION_WITNESS_WRITE_ATTEMPT_ROLLBACK` error reason
is retained for existing source-pinned tests.

Original receipt bookkeeping (`changed`/`writes`), cache
reconciliation, durable FULL synchronous setting and single writer
claim remain outside the modified owner policy, unchanged. Transactions
that never invoke the PF95 optional session witness retain original
behavior.

## Reproducible evidence and limits

An isolated fragment of the original `createSqliteAdapter` was
patched with PF95+PF96 logic and executed with **Node.js v22.16.0
real `node:sqlite`**:

- PF95 existing fragment regressions: **9/9 PASS**.
- PF96 source-owner sticky witness regressions: **16/16 PASS**.
- These include caught errors at inner and outer callback levels,
  false witness before/after writes, later true after a false,
  nested witness, rejected thenables, disabled witness and unrelated
  corporate-row writes.

The GitHub original source's complete exact file has not been copied
into this container; the **23 source-pinned tests** in
`scripts/pf95/tests/pf95-original-game-store-epoch.test.cjs`
require a local `PF95_NATIVE_WORKTREE` and operate ONLY on a
temporary copy of the pinned original. Those 23 tests are authored,
**NOT RUN** here. This is not proof of original player sessions or
two-client WORK gameplay.

The original `pas7-studio/EveJS` fork remains write-blocked by the
connected GitHub integration (HTTP 403). The review-only patch is
**not** registered in `patches/upstream/MANIFEST.json`, installed,
enabled, merged or deployed. Even when installed, direct raw SQLite
writers outside the original `tx.put/del` still need an owner source
audit and fencing. Native `ItemStore`, `characterState`, session
lease, Mining/WAR/Exploration and two-client WORK E2E are still
unproven; do not turn on Personal Fleet or touch PLAY.

## Local WORK check

```powershell
.\scripts\pf95\Test-PF95-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

The existing PF58 and PF80 WORK preflight entrypoints already run
the same source-pinned PF95 test file, so the new PF96 scenarios are
required automatically with **no second patch installer, runner or
production config**.
