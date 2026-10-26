# LW-02a / ALIFE-13 — startup audit of original native mining cargo

Status: **SOURCE IMPLEMENTED, DEFAULT OFF, LOCAL NATIVE GAMEPLAY NOT TESTED**.
This patch is a first fail-closed custody gate for issue #148, not complete acceptance of ALIFE-13 or ALIFE-12.

## Verified design

On a restored ALIFE-08 ACTIVE mining slot, before materializing ANY physical
NPC, the new opt-in gate scans the entire original same-fleet history:

- The original GameStore `npcCargo` root (never a virtual cargo store).
- Every matching original `coopNativeHaulTransfer:<cargoID>` same-commit ALIFE-10 receipt,
  with source miner, destination hauler, type, quantity, owner and SHA-256 afterHash.
- Original native NPC cargo cache for both miners and haulers; every relevant original
  cargoID must agree with the authoritative GameStore row.
- ALL original `trip-manifests/<system>-<fleet>-<start>.json` for this slot,
  with duplicate-source checks, the exact cargoID transfer and stable fleetID.
- Original ALIFE-12 `trip-departure-acks`, and original warehouse
  `receipts/<cargoID>.json` plus real ItemStore owner, item, quantity, location and tag.

A genuine loaded original hauler is valid only with its original transfer receipt,
and a completed warehouse delivery is valid only with COMMITTED + original ItemStore
credit and no source cargo. Pending/ambiguous receipts, corrupted records, partial
loss, missing warp ACK, foreign cargo, reused cargoID, unknown native reads or
cache divergence result in **NEEDS_OPERATOR_REPAIR**. There is NO automatic
reparent, warp, grant, refund, replay, payout or replacement mining cycle.

This explicitly catches the ALIFE-12 empty-hauler crash hole: no restored hauler
cargo **does not** imply the previous manifest is fully delivered.

## Feature gate

Opt in only on a disposable original native world with all baseline safety flags:

```text
EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE=1
EVEJS_COOP_NATIVE_HAUL_MANIFEST=1
EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY=1
EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC=1
EVEJS_COOP_NATIVE_CARGO_TRANSIENT_ISOLATION=1
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_NPC_STATION_DELIVERY=1
EVEJS_COOP_ALIFE_STARTUP_CARGO_AUDIT=1
```

New flag defaults OFF, so existing world behavior is unchanged.
Do not enable this on saved `evejs-data` prior to the local checks.
Existing historical fleets from pre-ALIFE-10 must be operator reviewed, not
silently treated as source-verified.

## Tests

```powershell
node --test tests/coop-alife13-startup-cargo-audit.test.mjs tests/coop-native-mining-fleet-durable.test.mjs tests/coop-alife12-station-trip-journal.test.mjs
pwsh -File scripts/Run-Alife12-Native-Station-Restart-Tests.ps1 -UpstreamCodeRoot 'C:\Games\EveCoop\upstream-evejs\Code'
```

A PR workflow includes the new Node test source; a passing result there is
NOT original EveJS Docker/SQLite physical gameplay acceptance.
See `tests/scenarios/alife13-startup-cargo-gate.json` for manually recorded
NOT_RUN original native scenarios.

## Remaining ALIFE-13 P0

1. Pin and prove native GameStore read quiescence versus the persistence worker
   and original SQLite WAL/FULL configuration. Current gate reads original
   GameStore rows and refuses mismatches, but its read API alone is not
   independent durable SQLite storage evidence.
2. Crash-inject before/after original SQLite transfer commit, source cargo removal,
   original warehouse receipt durability and itemStore credit, with a second
   separate process restart. Verify read-only fail-closed without false PASS.
3. Confirm transient isolation path and original single SQLite writer boundaries
   on disposable native engine, not only injected mocks.
4. Verify real physical hauler arrival, ItemStore/warehouse evidence, two native
   clients, and repeated cold restart. No additional ore/ISK credited.
5. Only after above and ALIFE-12 original route gates are GREEN can operators
   evaluate enabling the startup-audit flag on a persistent local universe.

## Files

- `integration/coopAlifeStartupCargoAudit.cjs` — original source-only auditor.
- `integration/coopNativeMiningFleetDurable.cjs` — pre-materialization gate.
- `scripts/patch-evejs-coop.cjs` — pinned overlay registration.
- `tests/coop-alife13-startup-cargo-audit.test.mjs` — Node filesystem/source tests.
- ALIFE-12 PS runner and GitHub workflow include the new regression source.
