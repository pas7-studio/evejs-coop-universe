# PF87 — original stock ship title and durable permit share one SQLite transaction

**Draft PR #350. Original EveJS / PLAY not modified. Personal Fleet OFF.**

## Scope

PF86 reduced the timing window before the original `ItemStore.moveShipToSpace`,
but could not remove it: the stock title changed in a separate step **after**
the PF58 durable permit transaction. PF87 adds **strict atomic original title
transfer** and makes it compulsory in the source-bound native bootstrap.

The existing original `gameStore.coopAtomicNativeRows.transact` executes
`BEGIN IMMEDIATE` and requires SQLite `synchronous=FULL`. Strict PF58
now declares `corporationRuntime`, `items`, and `characters` in that
single transaction. It checks the PF54 ISSUING record, PF52 ownership,
original hangared ship ID/title, original character active-ship records,
session/actor absence, stock equipment and other native writer fences.
It writes the ORIGINAL ItemStore item under the same existing ID and consumes
the one-shot handoff permit **inside that same transaction**.

After transaction commit, PF58 only reads original ItemStore and invokes
one-shot native NPC materialization and independent proof. It never calls
the separate `ItemStore.moveShipToSpace` in strict mode. If any step before
commit fails, there is no stock title move or permit consumption.
A failed actor materialization **after commit** keeps the permit consumed
and requires reconciliation; it may NOT automatically retry or refund.

## Source binding and compatibility

`createSourceBoundNativeBootstrap()` forces `atomicOriginalTransfer:true`
even if a caller supplies false. It also forces PF86 original session/NPC
registry readers. `createNativeBootstrap()` remains legacy mode by default
to avoid silently changing existing disconnected PF58 fixture contracts.
Strict mode injects `moveOriginalShipToSpaceAtomically(row,spawn,tx)` into
the PF58 transaction and disables legacy postcommit ItemStore movement.

The original stock item row is copied, not recreated, preserving original
`itemID`, `ownerID`, `typeID`, fitted modules, cargo, condition, and
other fields. It updates `locationID`, `flagID` and a stopped native
`spaceState` matching original ItemStore normalization defaults. No
new entity, item ID, module, cargo entry or wallet journal is created.
Independent PF54 native actor reconciliation remains required.

## Manual local safety gates

- `scripts/pf58/tests/pf87-atomic-handoff.test.cjs`: successful move,
  no legacy ItemStore call, rollback after false ACK or injected exception,
  active player ship, active foreign ship, session flip, unchanged itemID and
  wallet, and mandatory atomic dependency.
- `scripts/pf58/Test-PF58-Local.ps1` includes PF87.
- `scripts/pf62/Prepare-PF80-CompleteNativeWork.ps1 -ApplyToWork` runs
  PF85, PF86 and PF87 preflights before creating any native WORK output.
- Re-attest the PF58 and PF62 SHA256 manifests locally. Remote CI is
  disallowed by the repository's AGENTS.md.

## Explicit limitations

This guarantees the **PF58 permit and stock title** share an atomic SQLite
transaction when the strict path runs under the original GameStore
transactor. It does NOT guarantee that all independent player, Mining,
WAR, Exploration and ItemStore cache writers are already fencing the same
original ship. Those writers must honor authoritative claims and may require
additional original-engine patches. In particular, stock player-session
transitions still need a coordinated reject-before-move protocol.

PF87 is unverified against a running original EveJS WORK server because
the connected GitHub App cannot write to the engine fork (HTTP 403) and
the native checkout is inaccessible in this environment. Native WORK
start, restart/SIGKILL, player + NPC race, salaries, combat, docking,
crash reconciliation and two-client gameplay E2E are NOT RUN.
No PLAY or main merge is authorized.
