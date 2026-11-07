# PF99 — Original EveJS authenticated session witness and PF91/PF92 binding

**2026-11-07 | Draft PR #350 | Original fork UNCHANGED | Personal Fleet OFF**

## Source facts, not assumed design

Audited the existing original `pas7-studio/EveJS`, branch
`coop/pas7std`, as-is:

1. `Code/server/src/services/chat/sessionRegistry.js` owns the actual
   `Set` of live session object identities. Its `getSessions()`
   requires a live socket; `findSessionByCharacterID()` uses the
   indexed session with scan fallback and login-takeover semantics.
   Git blob: `01892cb8f6e35ef46268eae5f2909fd96c4a2a51`.
2. `Code/server/src/services/character/charService.js`
   `Handle_SelectCharacterID()` verifies the real account owner via
   `session.userid` and `character.accountId`, and rejects duplicate
   session unless takeover is enabled. Git blob:
   `c1159a66622370cd1fd3f5963cddd5de7fe6a52e`.
3. `Code/server/src/services/structure/structureLocation.js`
   owns docked station/structure resolution, based on the real server
   session; Git blob
   `0e12ae00721359d526c4453529c81a16f337df22`.
4. `characterState.applyCharacterToSession()` applies the selected
   character to `session.characterID`, `charid`, ship aliases and
   dock location and calls the original `sessionRegistry.indexCharacterSession`.
   No native Personal Fleet source wiring is installed here.

## New executable native candidates

`native/coopPersonalFleetOriginalSessionWitness.js` is intended
to be staged as
`Code/server/src/space/coopPersonalFleetOriginalSessionWitness.js`
in a separately reviewed original WORK fork commit. It has fixed
original local `require('../services/chat/sessionRegistry')` and
`require('../services/structure/structureLocation')` imports.
**It takes no injected registry, account ownership check, docking
resolver, callback or caller-certified boolean.**

Both PF91 and PF92 source-owned witness callbacks verify synchronously:

- Native flag `EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=1`.
- Exact session object membership (not shape equality) in the
  original live socket registry; no other simultaneously live
  session for that character; registry's preferred session is the
  exact same object.
- Positive safe integer `characterID` and all present
  `session.characterID/charID/charid` aliases consistent.
- Original SQLite reader returns this physical existing
  `characters/<id>` row, not a caller supplied snapshot.
  `character.accountId === session.userid`, matching
  `charService`'s original account selection authority.
- Exactly one original docked station or structure, no conflicting
  aliases, server docking helper agrees, and persistent
  `stationID/structureID` row agrees. PF91's requested
  `stationID` must identify that location.
- Existing original `shipID/shipid/activeShipID` aliases in the
  live session match the actual pre-write original character row;
  PF92's previous physical ship reference matches that identity.
- Repeated verification re-reads all the above; disconnect,
  logout, session takeover, dock change or ship selection
  invalidates a subsequent witness.

`native/coopPersonalFleetOriginalSessionBindings.js` is intended
for `Code/server/src/space/coopPersonalFleetOriginalSessionBindings.js`,
adjacent to the native permit and witness. It constructs
`createSourceBoundPlayerShipActivation` and
`createSourceBoundCharacterRecordWriteBarrier` from the
pre-existing PF91/PF92 original permit factories and always wires
the **actual imported** source-bound verifier itself.
A caller's `verifyOriginalDockedPlayerSession` or
`verifyOriginalSessionLease` property is ignored. Flag OFF
also blocks both wrapper operations, even in a Node test process.

Neither JS file changes the original game until it is explicitly
copied and wired in the real original fork. Both are **review
candidates**, never automatic runtime patches.

## What was actually executed

1. **16/16 PASS**, Node.js 22.16.0, real in-memory
   `node:sqlite` DatabaseSync with the exact two source modules
   (Git blob SHA verified). Exercises live/clone identity,
   account ownership, station/structure consistency, logout,
   duplicate login, ship ID validation, same-transaction second
   session check and SQLite ROLLBACK, and binder rejecting forged
   callbacks.
2. **19/19 PASS**, direct V8 execution of exact GitHub JS source
   with the **actual original sessionRegistry and
   structureLocation code**. Covers real original registry
   `register/unregister`, login duplication, user/account
   identity, ship aliases, both original source-bound wrappers,
   and default-off denial. Not a full original server start.
3. The new `pf99-authenticated-original-session.test.cjs`
   contains **22 authored Node tests**, including a
   source-pin original WORK test of the three owner files.
   The new `pf99-source-bound-pf91-pf92-sqlite.test.cjs`
   contains **11 authored SQLite fixture tests** invoking the
   existing PF91/PF92 factories with an isolated original
   session authority. These 33 *repo test files* are **NOT
   executed in this remote container** because its filesystem
   cannot access the full repo/fork. The 16 executed tests
   above are a separate faithfully sourced local harness.
4. Five additional Python archive/static test cases authored;
   exact SHA256 manifests and the full local WORK preflight
   must still be run on a local checkout.

## Local Windows review

```powershell
.\scripts\pf99\Test-PF99-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

This command reads original source, verifies the three exact
Git blobs, executes tests in a disposable harness and leaves the
original fork unchanged. PF58's local Node runner now includes
the PF99 tests. PF80's native WORK preflight requires both tests
and archive integrity including the original source pins.

## What still blocks a REAL Personal Fleet activation

**The two PF99 source modules are not installed in
`pas7-studio/EveJS`.** GitHub App writes to that fork continue
to return HTTP 403. A separate local original WORK commit must
carry them and install the PF95/PF96 original SQLite-owner
`verifyReadOnlySessionWitness` method.

The production CharacterState/ItemStore route must be explicitly
rewired to use **only**
`createSourceBoundPlayerShipActivation` and
`createSourceBoundCharacterRecordWriteBarrier` (never
raw factories with caller-supplied verifier) under the same
GameStore `BEGIN IMMEDIATE` as original item custody, NPC
reservations, payroll and player ship title. PF97's interim
ItemStore lazy-ship/title hard blocks must be replaced by a
real audited native custody/repair flow. Session change
notifications and capsule consumption must occur only after
durable GameStore commit, with correct failure recovery.

Original raw writer bypasses, `ItemStore` cache reconciliation,
Mining/WAR/Exploration concurrency, restart/SIGKILL recovery
and **two independent authenticated WORK gameplay clients** are
not proven. Do NOT enable Personal Fleet, merge PR #350,
restart PLAY or treat this preflight as feature acceptance.
