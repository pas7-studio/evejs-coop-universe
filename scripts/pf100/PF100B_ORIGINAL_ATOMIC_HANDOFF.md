# PF-100B — One original SQLite transaction for player-to-NPC hull handoff

**2026-11-07 · Draft PR #350 · original EveJS unmodified · Personal Fleet OFF**

## Exact P0 that this candidate addresses

PF87 `createOriginalShipHandoff` refuses a ship still active in a
player's `characters/<id>` record; PF91 changes active stock ship in a
*different* GameStore transaction. Calling PF91 and PF87 one after the
other is not atomic: another writer can intervene between them, and
a crash can strand an active player reference or physical NPC hull.

`native/coopPersonalFleetOriginalAtomicSwitchAndHandoff.cjs` is a
**review candidate**, intended for the native server's existing
`Code/server/src/space/` directory. It imports exact PF58 permit,
handoff, stock-move and PF99 session-witness modules. It does not
accept caller-supplied session verifier/registry/docking source.

An original `coopAtomicNativeRows.transact` must atomically:

1. Verify source-bound live docked session twice using the PF95/PF96
   `tx.verifyReadOnlySessionWitness` method.
2. Require PF54 *already durable* `ISSUING` and the matching PF52
   reserved stock hull, employment roster and one-shot absence.
3. Prove player currently occupies that exact physical hull, and no
   other character claims the source or replacement hull.
4. Require an **already existing**, unreserved, original ItemStore
   capsule (typeID 670) in the same hangar. No new item ID, fabricated
   ship or silent empty-ship fallback is allowed.
5. Check native actor absence, original equipment hashes, unique
   stock undock coordinates, reciprocal writer fence and independent
   custody authority.
6. Route external equipment, actor-presence, undock and timestamp
   callbacks through the **same original owner-issued sticky read-only
   witness**, not merely a read-only facade; caught SQL writes must
   force rollback rather than silently allow commit.
7. Write a single updated `characters/<owner>` row pointing to the
   capsule, the exact original source item relocated into the real
   system/space, and two PF58 handoff permit keys — all inside the
   *same BEGIN IMMEDIATE / COMMIT*.
7. Return `COMMITTED_PENDING_SESSION_AND_NPC_RECONCILE` only after
   GameStore returns successfully. Any unknown transaction/cache result
   is `OUTCOME_UNKNOWN` and is **not automatically retryable**.

The candidate does **not** spawn the actor, update the live player's
session, emit client notifications, consume the capsule or retry PF54.
A durable PF58 one-shot permit remains consumed; normal PF58
`execute()` is **not** a valid replay after this combined transaction.

### Evidence actually executed

- Node.js 22.16.0, real `node:sqlite` in-memory
  `BEGIN IMMEDIATE` and `COMMIT`: **26/26 PASS**.
- Tests include: correct three-table commit, no new item IDs, wallet
  preservation, preexisting capsule validation, conflicting ownership,
  duplicate permit, account/docking change, first/second witness
  revocation, equipment/actor absence, negative writer flags, and
  two injected post-write failures with actual SQLite rollback, and a\n  caught same-value write attempted inside a simulated PF96 sticky witness.
- A simulated COMMIT acknowledgment failure verifies that no retry
  token is returned even though the durable rows may already exist.
- The executed test loads **exact candidate source** with controlled
  PF58/PF99 mocks and a real SQLite adapter fixture. This is **not**
  a full original `coopGameStoreAtomic`, PF58/PF99 runtime
  integration, SIGKILL experiment, Windows run or two-client WORK E2E.
- The Git blob hashes of the candidate module and test published to
  PR #350 match the exact files exercised in the local Node tests.
- Files are SHA256-pinned by `scripts/pf100/SHA256SUMS.txt` and the
  manual PF100 runner, already called by PF58/PF80 preflight.

## Manual review

```powershell
.\scripts\pf100\Test-PF100-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

This checks the candidate **but never installs or enables it**.
The six original source pins require an original checkout. Windows
PowerShell has **not** been run in this environment.

## Hard blockers before real gameplay

1. **Original source-owned entrypoint:** Wire this candidate to
   CharacterState, ItemStore, PF54/PF58 dispatch, original session owner
   and stock GameStore; remove the separate PF91 -> PF87 calls for this
   scenario. Original GitHub fork write still returns HTTP 403.
2. **Session mutation lease:** Two synchronous session checks are not
   equivalent to a real fence preventing concurrent logout,
   boarding, socket replacement and live game ticks while the
   original SQLite lock is held. Add an authoritative source-owned
   in-process lease covering transaction and postcommit handoff.
3. **Replacement capsule provisioning:** Prove how a native original
   already-existing capsule can be made available while preserving
   ItemStore ownership. PF100B intentionally refuses to allocate it.
4. **Durable post-COMMIT workflow:** Independently read back the PF58
   permit + stock items + character row, then reconcile **one-shot**
   player session notifications and NPC actor materialization.
   Ambiguous postcommit effects require operator reconciliation.
5. **End-to-end invariants:** Original source-pinned GameStore with
   stock owner, original PF52/53/54/58/87/91/92/95/96/99, cache
   invalidation, competing Mining/WAR/Exploration writers, real
   SIGKILL/restart and two independent authenticated WORK clients.

`main`, `PLAY` and original EveJS remain unchanged. Keep PR #350
Draft; no GitHub Actions added; default feature flags OFF.
