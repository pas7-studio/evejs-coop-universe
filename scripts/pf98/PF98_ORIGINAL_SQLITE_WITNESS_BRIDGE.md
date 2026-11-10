# PF98 — Source-owned native SQLite session witness for PF91/PF92

**2026-11-07 · Draft PR #350 · Original EveJS owner hook NOT installed · Personal Fleet OFF**

## Corrected integration gap

PF91 original player ship activation and PF92 generic character row
writer both called `verifyOriginalWitnessCannotWrite` in
`scripts/pf58/native/coopPersonalFleetOriginalNativePermit.cjs`.
The PF93 method hashed all original SQLite character/item/corporate
rows before and after a caller-supplied read-only witness. That
fingerprint can miss write-then-restore, identical-value writes,
and deletes of non-existent keys. PF95/PF96 proposed the durable
solution **inside** the original `createSqliteAdapter` owner:
`tx.verifyReadOnlySessionWitness(callback,request)`, including
transaction-scoped sticky poison before `COMMIT`. But PF91/PF92
had never called that stronger owner-issued method.

PF98 connects the **existing** PF91/PF92 witness sites to the
PF95/PF96 original GameStore method; no new owner or SQLite table.

## Behavior

- When `EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=1`,
  both PF91 and PF92 **must** call the original source-owned
  `tx.verifyReadOnlySessionWitness`. Missing method throws
  `PF98_ORIGINAL_SQLITE_OWNER_SESSION_WITNESS_REQUIRED`.
  There is **no snapshot fallback** in this mode.
- A thenable result from a purported native witness is rejected;
  a native owner callback must synchronously return exactly true.
- When the feature flag is absent in a normal server process,
  ship-identity witness verification **throws**
  `PF98_NATIVE_SOURCE_OWNER_WITNESS_FLAG_REQUIRED`.
  Consequently PF91 cannot activate a ship and PF92 cannot make a
  protected character change by silently falling back to PF93.
- The historical PF93 snapshot verifier remains accessible only
  from Node's test-runner child process
  (`NODE_TEST_CONTEXT=child-v8`), for existing archived isolated
  PF91/92/93 tests whose mock transaction never had an original
  source-owned method. It is NOT a runtime release authority.
  A privileged operator could spoof test environment variables,
  so secure deployment/configuration review is still necessary.
- Purely economic PF92 edits that do not touch protected ship
  identity can still execute as before, but are subject to their
  existing before-image and original transaction checks.
- PF98 does not claim that a caller-supplied witness callback is
  the actual authenticated game session: only original source
  integration can supply that authority. The original GameStore
  Git blob currently lacks PF95/PF96, so this is a preparatory
  bridge and **not yet a functional feature**.

## Tests

New `scripts/pf98/tests/pf98-native-owner-bridge.test.cjs`:
**14 authored Node test cases** using the existing PF54 real SQLite
fixture, including missing owner method, source-owner method called
twice for PF91 and PF92, true/false and late revocation, async
witnesses, captured-tx write attempts, wallet-only PF92, and
simulated normal server lacking the native flag. The transaction
witness in these fixture tests is a **double**, NOT the original
PF95/PF96 source-owned writer, so they must not be treated as
live original gameplay evidence.

Separately, the PF98 native-mode bridge function and a
reconstructed PF96 original `createSqliteAdapter` function were
executed together with real **Node v22.16.0 `node:sqlite`**:
**12/12 PASS**, including caught SQL write attempts, rollback,
source-owner-missing error, two witness checks, and a prior false
that cannot be converted into a later true. Those are standalone
module-fragment tests, NOT a run of the PF54 fixture suite in
this remote environment and NOT a full original EveJS server.

Four Python archive/static tests verify source selection,
post-COMMIT poison contract, absent-flag fail-close and package
hashes. PF58 and PF80 WORK preflight run the new Node suite.
No executable release evidence is inferred from authored tests.

Local Windows check:

```powershell
.\scripts\pf98\Test-PF98-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

## Original fork integration required

The connected GitHub integration has **HTTP 403** on attempts
to create a branch in `pas7-studio/EveJS` (`coop/pas7std`).
No original source file has been changed, and PLAY is untouched.

A local original-fork author must install/review the PF95/PF96
GameStore owner code, connect the real source-bound session/
authenticated docking lease for CharacterState and ItemStore,
replace PF97's intentional stock title blocks with the real
PF91/PF92 owner operation, then prove original cache
reconciliation, real player hull vs NPC ownership, restart/
SIGKILL recovery, Mining/WAR/Exploration writer contention and
two independent WORK clients. Before those checks, feature stays
OFF, PR stays Draft, no main merge.
