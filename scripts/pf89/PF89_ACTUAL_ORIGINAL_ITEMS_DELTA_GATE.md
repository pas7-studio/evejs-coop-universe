# PF89 — Verify actual changed original ItemStore rows, not declared item IDs

**Status: CANDIDATE / Draft PR #350 only. The original EveJS fork remains
write-protected to this GitHub integration (HTTP 403). NO source hook is
installed in the live engine. Personal Fleet OFF, PLAY untouched.**

## Verified implementation in the existing PF62 native module

The existing PF58 module, `coopPersonalFleetOriginalNativePermit.cjs`,
adds `createReciprocalWriterFence({pf52})
.mutateOriginalItemsInTransaction({tx,writer,buildNext,declaredItemIDs})`.

This guards an **actual GameStore transaction**, not a delayed stock write.
Its caller must declare the original `items` and `corporationRuntime`
tables. The candidate method:

1. Reads the full `items/items` stock row in that transaction and gives
   a synchronous, explicitly acknowledged builder a **clone**, not
   the authoritative row.
2. Computes changed item IDs by comparing the actual before/after full
   item maps. A declared item-ID list, when supplied, must match exactly.
   Wrong IDs, missing IDs, unexpected new keys, malformed JSON, oversized
   batches or asynchronous builder acknowledgements fail closed.
3. Walks both the old and proposed new parent chains for **every changed
   item**. A fitted module, a cargo row, a moved item or a newly inserted
   cargo row cannot bypass custody by naming an unrelated stock item.
4. Checks the PF88 reciprocal custody guard for **every affected original
   ship** (PF52 reservation, PF actor claim, PF58 handoff, PF60 terminal).
   New ship *creation* is not permitted through this gateway; it must
   remain in the original stock ItemStore ship-creation API.
5. Detects a builder that directly wrote `tx.items` while evaluating its
   clone and throws, requiring outer GameStore SQLite **ROLLBACK**.
   Only then does it perform one `tx.put('items','items',next)`.

This API is also returned from the candidate source-bound bootstrap as
`mutateForeignOriginalItemsWithinTransaction` for later native integration.
It **does not** make this API part of stock ItemStore by itself.

### Original engine source boundaries (source-pinned)

Original `pas7-studio/EveJS@coop/pas7std` currently has:

- `Code/server/src/services/inventory/itemStore.js`:
  original `writeItems()` calls owned `repo.write('items','/',...)`;
  original `updateInventoryItem()`, `removeInventoryItem()`,
  `moveShipToSpace()`, `dockShipToLocation()` eventually use it.
  Shipping only an added check in `moveShipToSpace` is insufficient:
  player-driven fitting, inventory transfer and deletion can bypass it.
  This stock file has Git blob
  `e992d56ee9cff1911d54247bf46d44d01e5d8060`.
- `Code/server/src/services/character/characterState.js`:
  `writeCharacterRecord()` is the sole stock character writer;
  `itemStore.syncCharacterActiveShip()` delegates to that writer.
  Both active-ship and inventory writes must validate custody under the
  same authoritative database transaction, NOT in a second read-only
  transaction. Original Git blob:
  `8a002d190899b6cb1e1068a565451e6d1d808401`.
- Mining, startup Mining, WAR and Exploration have their own native
  paths. See `scripts/pf88/PF88_RECIPROCAL_WRITER_CONTRACT.md`
  for the six-source original hook audit.

Because original `itemStore.writeItems()` is an owner-scoped repository
write rather than the generic PF58 `GameStore.transact` callback, the
stock writer must be carefully refactored **in the engine fork** before
using this gateway. In particular, we must preserve the item index/cache
invalidator, inventory notification ordering, stock owner contract,
and the GameStore transient cargo isolation. Do **not** merely call this
gateway as a pre-check and then write through `repo.write` later;
that recreates PF86's TOCTOU race.

## Test coverage and manual commands

- `scripts/pf58/tests/pf89-actual-item-delta.test.cjs`: 21 new
  isolated Node/SQLite fixture cases cover reserved hull title, fitted
  modules, cargo, insertion and removal, shifted destination, misleading
  declared IDs, independent stock inventory, builder throw/false/Promise,
  untrusted direct `tx.put`, duplicate IDs, malformed inventory and
  owner-only original new-ship creation.
- `scripts/pf58/tests/test_pf89_stock_delta_gate.py`: 4 source-contract
  checks for before/after scanning, strict bootstrap and local WORK gate.
- `scripts/pf58/Test-PF58-Local.ps1` now includes PF89; the PF80
  `-ApplyToWork` preflight runs the same Node fixture before creating a
  review tree.

Local Windows checkout:

```powershell
node --test --test-concurrency=1 scripts/pf58/tests/pf89-actual-item-delta.test.cjs
python -m unittest discover -s scripts/pf58/tests -p 'test_pf89_*.py' -v
./scripts/pf58/Test-PF58-Local.ps1
```

**Do not deploy, enable the flag, or merge based on these tests.**
The candidate implementation has an O(total original item rows) diff:
profile the real WORK stock inventory size before selecting this as a
hot-path writer API, and retain a proven original inventory index invalidator
and notifications. It does not prove that stock player sessions, character
active-ship changes or Mining/WAR/Exploration writes are fenced. Actual
original fork source commits and two-client WORK gameplay remain mandatory.

## Explicit blockers

- GitHub App cannot create a native engine branch: original fork returned
  `Resource not accessible by integration` HTTP **403**.
- The six original writers have **no PF88/PF89 hooks installed** on
  `coop/pas7std`. No native installation, Docker build, game client or
  SQLite SIGKILL experiment has been executed here.
- The archive is a candidate transaction policy; no replacement overlay or
  second native patching mechanism should be added to ship it. The owner or
  local agent must commit actual original writer changes in the engine fork,
  preserve single-writer boundaries, then run both stacks' acceptance gates.
