# PF73 — Original GameStore native restart fence after PF56 docking intent

**Status:** source candidate committed to Personal Fleet Draft PR #350. Feature OFF.
**No WORK server startup, original engine install or two-client E2E is claimed.**

## Proven failure in the previous admission contract

PF58's `createPermitVerifier.verify()` checked PF54 `ACTIVE`, the consumed
original hull handoff, original ItemStore in-space hull and matching PF actor
claim. The PF56 return/docking record was not part of this same transaction.
After `PF56.requestDock()` committed `DOCK_ISSUING`, a crash before the PF66
ItemStore dock left the original hull in space while all four old PF58 guards
still succeeded. Native NPC startup could then materialize the ship again.

## PF73 fix

`native/coopPersonalFleetOriginalNativePermit.cjs` now reads the following
*original GameStore* `corporationRuntime` keys in its existing atomic read
transaction with the original ItemStore, PF54 and global actor claims:

- `coop-personal-fleet\x1freturn-dock-v1:<assignment>` (PF56)
- `coop-personal-fleet\x1fdock-native-attempt-v1:<assignment>` (PF66)
- `coop-personal-fleet\x1fdock-scene-attempt-v1:<assignment>` (PF67)
- `coop-personal-fleet\x1fterminal-v1:<assignment>` (PF60)

A missing record must be explicitly read as `null`. `undefined` or a thrown
read is uncertain and denies materialization. Any durable PF66/PF67/PF60
attempt denies startup; malformed rows also deny. A PF56 row is allowed only
when it is a fully matching, zero-dock-attempt pre-dock return stage:
`RETURN_ISSUING`, `RETURNING`, or `ARRIVAL_OBSERVED`. No foreign assignment,
ship, pilot, system, station, generation, type or owner may be accepted.
The PF56 `operationID` and canonical SHA256 `signature` are also verified
for consistency. This digest is **not a keyed MAC** and cannot authenticate
a malicious writer; reciprocal original GameStore writer fencing remains a
mandatory release requirement.
`DOCK_ISSUING` and `DOCKED` are unconditionally denied before physical actor
creation, regardless of whether the original ItemStore move occurred.

PF54 `ISSUING` one-shot handoff is still possible only with `allowIssuing=true`
and *no* return, dock or terminal intent. PF54 `ACTIVE` without any return row
remains eligible under all existing original claim/stock/feature/fencing gates.
Unmarked ordinary native NPCs do not call this PF58 original permit.

**Never delete or rewrite a prior PF56/PF66/PF67/PF60 record to make startup
pass.** Unknown results require human-controlled reconciliation; no automatic
retry, re-dock, or new ItemStore title is introduced by PF73.

## Verification

`node --test scripts/pf58/tests/pf73-docking-restart-permit.test.cjs`

25/25 Node 22 tests passed on real SQLite `DatabaseSync`, `WAL`,
`synchronous=FULL`. Tests include a separate Linux child process SIGKILL just
after the actual PF56 `DOCK_ISSUING` SQLite commit and before original ship
ItemStore change; a second process sees the durable row and denies native
restart. Other cases cover early return, both dock phases, mismatched custody,
corrupt/unreadable records, PF66/PF67 one-shot tokens, PF60 terminal record,
explicit PF58 issuing, and read-only permit behavior.

**Remaining live integration gates:** genuine 19-file EveJS native WORK patch,
real native service startup, reciprocal multi-writer fencing, two EVE clients,
late PF56/PF66/PF60 reconciliation, physical item/cargo/title audit. A
single-process SQLite admission check does not by itself guarantee the absence
of a cross-process TOCTOU race between the permit check and scene spawning;
that requires the previously identified global exclusive native writer gate.
