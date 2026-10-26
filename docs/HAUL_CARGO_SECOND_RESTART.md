# P0 second-restart original cargo recovery (Issue #282)

**Source implemented behind an additional OFF-by-default gate; NOT live gameplay accepted.**

After a first orphan reparent, the same original native `cargoID` carries
`coopHaulAdoptedAt`. A second process restart can strand that row because a
plain adoption skips all previously adopted cargo. Simply removing this skip
would replay potentially settled ore.

## Strict operator gates

Both must be explicitly `1`:

```text
EVEJS_COOP_HAUL_CARGO_ADOPTION=1
EVEJS_COOP_HAUL_CARGO_RE_ADOPTION=1
EVEJS_COOP_NATIVE_WAREHOUSE_ROOT=<ABSOLUTE_PATH_TO_THE_ACTUAL_NATIVE_WAREHOUSE_WRITER_ROOT>
```

The third value is not a switch. It **must** point to the same absolute root
passed to the original `coopNativeWarehouse.createWarehouse({root})`; there is
no guessed default. A missing receipt directory, unreadable directory, or
invalid path blocks repeat adoption. This protocol assumes the warehouse,
depot and GameStore have only **one authoritative live writer**. Do not
enable on a multi-writer deployment or an unknown path. The existing feature
flags remain OFF; source merge does not activate them.

### Before any second native cargo upsert

For an already-adopted source row, all must hold:

- Real cargoID, source miner, system, fleet, and corporate owner remain valid;
  original previous-hauler scene and registry prove the carrier is gone.
- A valid prior `coopHaulAdoptedFrom` and a bounded last adopted timestamp
  establish repeat-recovery history.
- The actual warehouse `receipts/<cargoID>.json` and in-progress
  `<cargoID>.json.tmp-*` files are absent in a successfully enumerated directory.
- The pinned native ItemStore `findWarehouseItem({cargoID})` finds no
  physical item carrying that original warehouse marker.
- The authoritative `coopNativeDepot.snapshot()` finds no pending or
  committed record for this original `cargoID`.
- All rows of a planned batch are eligible. Any unknown ledger, receipt,
  registry or ItemStore result refuses the entire batch, with **zero**
  partial reparent writes. Existing commit/readback and compensation holds
  still apply.

An existing receipt (even PREPARED), a committed/uncertain depot journal, a
physical warehouse marker, or an unavailable authority is an **operator
reconciliation**, never an automatic new cargo, new ISK, or second sale.

## Verification

Isolated exact-source V8 harness executed the existing plus new adoption
regression tests: **38/38 PASS**. This proves source paths under deterministic
injected native adapters, **not** pinned SQLite or gameplay.

```bash
node --test tests/coop-haul-cargo-adoption.test.mjs tests/coop-restart-haul-adoption.test.mjs
```

Still **NOT_RUN**: local Node 22 on the owner's full checkout; the original
GameStore SQLite WAL/FULL cold restart; actual warehouse and depot reopen;
Rust; two authenticated EVE clients. Do not claim Issue #282 fully accepted
until these physical gates, plus crashed transfer/receipt injections, pass
on a disposable **copy** of evejs-data. Never wipe or mutate the live volume.

Rollback: revert the fix PR; leave the repeat gate unset. No GitHub CI,
automatic deployment, wallet changes or native data migrations are used.
