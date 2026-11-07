# PF91 — Original per-character SQLite rows and atomic stock player ship switch

**2026-11-07, Draft PR #350. This is candidate code only.** Original
`pas7-studio/EveJS` cannot be written via the connected GitHub App
(HTTP 403). No native engine hook, runtime feature flag, PLAY or main
branch was changed. Original WORK E2E and Node/SQLite suite have NOT
been run in this environment.

## P0 correction to PF87

PF87's strict native original ItemStore transfer correctly placed the
original stock ship and one-shot PF58 permit in the same
`BEGIN IMMEDIATE` transaction. However, its character active-ship
check used:

```js
tx.get('characters','characters')
```

That was **only valid in the synthetic PF54 fixture**, where a complete
map of characters was stored under a noncanonical SQLite
`characters.key='characters'`. The real original
`characterState.writeCharacterRecord(charId)` writes
`repo.write('characters', '/<characterID>', record)`, so the original
SQLite table uses **one key per character**. The old check would deny
legitimate deployments or, if fixtures hid the mismatch, create false
confidence about active character collision coverage.

PF91 replaces the strict PF87 call with
`inspectOriginalCharacterShipRows(tx,{ownerCharacterID,shipItemID})`.
It calls **`tx.scan('characters')` inside the same SQLite transaction**
as PF87's original title and PF58 permit. It validates every individual
numeric key and matching `characterID`, rejects synthetic aggregate
rows, noncanonical/duplicate keys, malformed records, absent owner,
scan failures, an owner-row changed between scan and read, and any
character whose native `shipID`, `shipid` or `activeShipID` points
to the reserved physical hull. Unknown/invalid reads fail closed.

PF87's original strict fixture was updated after PF53/PF54 onboarding
to remove the synthetic aggregate row and create one real per-character
row. All the older unrelated PF54 reference fixtures remain unchanged.
PF87 still never moves the original stock hull postcommit in strict
mode, never creates a new hull item and never retries the consumed
one-shot permit.

## Candidate original player ship switch

The existing PF58 native permit module also exports:

```js
createOriginalPlayerShipActivation({
  gameStore, pf52, enabled, allWritersFenced,
  verifyOriginalDockedPlayerSession,
}).activate({
  characterID, targetShipItemID, stationID,
  expectedBefore, session,
})
```

**Disabled by default**. It uses the original
`coopAtomicNativeRows.transact(['corporationRuntime','items','characters'])`
transaction (the code declares the equivalent set in a different order):

- Original character is fetched under key `String(characterID)` and
  checked against a detached, exact before-image.
- The target must be the original single player-owned ItemStore hull
  in the requested hangar (same original itemID, owner, type, flag,
  station and singleton). No hull/itemID is created.
- Original character rows are scanned for a competing active
  character claim to the target.
- PF88's reciprocal checks apply to both target hull and previous
  active stock ship when present, inspecting PF52 reservation, PF
  actor claims, PF58 one-shot transfer and PF60 terminal custody.
- Caller must provide a live **source-bound** session witness, which
  is rechecked immediately before the character row write; otherwise
  the method rejects. Failed original SQLite writes must rollback,
  and the same original record is read back before returning success.
- Exactly one character row is updated with the stock fields
  `shipID`, `shipTypeID`, `shipName` and removal of legacy
  `storedShips`. Existing wallet, skill and other state is preserved.
  It never calls a separate asynchronous stock `repo.write`.

`createNativeBootstrap` exposes
`activateStockPlayerShipWithinOriginalTransaction`, but **the
original `characterState.activateShipForSession` DOES NOT CALL IT**.
The source-bound bootstrap still forces the separate PF88
`verifyOriginalWriterHooks` check; the session witness defaults to
false. A mocked witness callback is not independent proof that stock
player sessions and inventory mutation owners actually honor it.

## Manual local regression

```powershell
node --test --test-concurrency=1 scripts/pf58/tests/pf87-atomic-handoff.test.cjs scripts/pf58/tests/pf91-original-character-rows.test.cjs
python -m unittest discover -s scripts/pf58/tests -p 'test_pf91_*.py' -v
```

PF91 adds 22 Node/SQLite fixture cases and six Python static contract
checks, and updates the nine existing PF87 strict SQLite scenarios to
real per-character source layout. The PF58 local runner includes PF91;
the PF80 `-ApplyToWork` preflight reruns both PF87 and PF91 **before**
any native WORK patch assembly. Original source pins for
`characterState`, `itemStore`, GameStore and its owner repository
remain in `scripts/pf90/inspect-original-owner-writes.cjs`;
do not duplicate a second audit or source-pin manifest.

## Unclosed integration gates

1. Commit a genuine original `pas7-studio/EveJS` fork owner integration
   for stock `characterState` and `itemStore`, preserving each table's
   sole owner, invalidation, notifications, cache consistency and live
   session-side transition. A separate check followed by `repo.write`
   recreates the PF90 TOCTOU and cache-alias risks.
2. Prove the original engine's per-character row semantics with real
   SQLite `BEGIN IMMEDIATE`, `COMMIT`, `ROLLBACK`, worker flush,
   SIGKILL and restart evidence on WORK.
3. Prove player login/switch, active ship replacement, handoff, Mining,
   WAR, Exploration, docking and salary ownership under two real EVE
   clients. A transient session event between the final witness and
   commit remains unsafe without a genuine original writer lease.
4. Only after real source integration and independent WORK E2E may the
   owner consider an activation/merge decision. Until then PR #350
   remains Draft, Personal Fleet OFF and PLAY untouched.
