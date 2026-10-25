# LW-04F — Reuse existing native depot grant and flush before ALIFE-09 completion

**Status:** Source fix implemented in stacked Draft PR, not live activated. Base
LW-04E PR #244 → LW-04D #239 → #229 → #221 → #215 → #210 → #207 → #193.
All original ACT, warehouse finance and strict station proof flags default OFF.

## Real original-source finding

The public EveJS ItemStore `grantItemToOwnerLocation()` routes stackable
ore through `applyStackableGrant()`, which selects merge candidates by
owner/location/flag/type, ignoring `customInfo`. Passing cargo provenance
`customInfo` to that stock method is **not sufficient** to guarantee an
isolated physical source item ID.

But this EveJS-Co-op overlay **already installs** a reversible extension
in `scripts/coop-native-warehouse-item-patch.cjs`:

- `grantUniqueNpcDepotItem({ownerID,stationID,typeID,quantity,cargoID})`
  constructs ONE original stack with
  `customInfo=coop-warehouse:v1:cargo:<cargoID>` and distinct native
  `itemID` without the normal stack-merge route.
- `findWarehouseItem({cargoID})` returns the one original item by marker
  or rejects duplicate marker/cargoID collision.
- `integration/coopNativeWarehouse.cjs` already relies on these hooks and
  explicitly flushes the native `items` table synchronously.

These interfaces were already implemented; no second ItemStore patch,
allocator, wallet writer, SQL writer or shadow inventory is introduced.

## Specific P0 code fix

The **strict opt-in** `coopNativeStationOreSettlement` path
(`EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF=1`) is changed from the
merge-prone stock `grantItemToOwnerLocation()` to the existing
`grantUniqueNpcDepotItem()`.

It now requires the same native `findWarehouseItem()` and a server-owned
`flushNativeItems('items')` callback BEFORE even writing the
`GRANT_OUTCOME_UNKNOWN` journal fence. It then:
1. validates source station, depot receipt and absence of existing cargo marker;
2. fsyncs the original ALIFE-09 `GRANT_OUTCOME_UNKNOWN` journal BEFORE grant;
3. issues exactly ONE original native unique grant, rejecting `existing:true`
   when no pre-existing source was found;
4. checks native synchronous items flush returned `success:true`;
5. verifies same original `itemID`, corp owner, station, type, exact
   quantity, flag and cargo marker through the existing native item reader;
6. only THEN persists `COMPLETED` with original `oreItemID` and marker.

The legacy station grant behavior stays unchanged when this new flag is OFF.

If native grant ACK disappears, durable flush fails, real source item differs,
or an existing marker appears, the operation returns
`NEEDS_OPERATOR_REPAIR` and the journal remains
`GRANT_OUTCOME_UNKNOWN`. Restart does not issue a second stock grant.

## Important native limits

- A server integration must wire `flushNativeItems` to the **actual
  synchronous original SQLite/GameStore items flush**, not a dummy resolver.
  This PR does not attach a new live runtime or assert such wiring exists.
- Actual pinned ItemStore source and SQLite WAL were **not executed** here.
  The COOP-030 source hook is tested in an isolated source harness; this is
  not an authenticated multi-client or real disk durability test.
- Native `coopNativeWarehouse` and strict ALIFE-09 both recognize the same
  cargo marker. Do **not** allow two independent automatic station deposit
  paths to race in production; strict ALIFE-09 remains manually gated
  until there is one explicit station authority owner and verified original
  cargo debit custody.

## Tests and commands

Exact-source isolated tests cover the real COOP-030 patch function and
its extracted deployed ItemStore hook (7/7 PASS), plus original
station settlement with source grant, synchronous flush, restart, orphan
and fail-closed behaviors (14/14 PASS).

Run the authored full Node 22 source tests locally:

```powershell
pwsh -File scripts/Run-LW04F-Source-Gates.ps1
```

Or the extended original economy suite:

```powershell
node scripts/lw04d-native-readiness.cjs --source
```

All 12 original physical scenarios in
`tests/scenarios/lw04f-original-depot-e2e.json` remain `NOT_RUN`
until a real disposable pinned GameStore/SQLite/Rust server and two
authenticated clients provide actual logs and post-restart evidence.
Protected `evejs-data` must stay unmounted/unchanged.
