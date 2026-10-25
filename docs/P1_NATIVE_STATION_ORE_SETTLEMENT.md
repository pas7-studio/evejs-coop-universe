# P1 economy — NPC ore receipt to native station stock (stage 2a)

## Scope and current status

This is a **manual, explicit, OFF-by-default** settlement primitive, not a live
NPC warehouse driver. The source is a **COMMITTED** receipt from the custody
journal introduced in draft PR #20, not a synthetic virtual economy balance.
Stock is credited into native EveJS `services/inventory/itemStore` using
`grantItemToOwnerLocation`, `listContainerItems` and stock `ITEM_FLAGS.HANGAR`.
It does **not** credit either human player account. The station must be an
actual same-system station and its owner must be verified independently as
an eligible non-player warehouse owner. Ore type is checked against an
independent authoritative catalog predicate, not trusted from the receipt.

### Correctness boundary

- Input: exact committed `cargoID`, `typeID`, integer `quantity`, NPC `haulerID`,
  `fleetID`, `systemID` from PR #20 after successful source removal.
- Preflight: depot `audit().status === OK`, zero unresolved/invalid receipts;
  real station and same system; verified warehouse owner and genuine ore type.
- Native output: one owner/station/type stock delta using pinned EveJS itemStore.
  This supports native itemStack merging without depending on itemID equality.
- Before invoking itemStore, an `GRANT_OUTCOME_UNKNOWN` journal entry is persisted.
  After native stock delta is verified, it becomes `COMPLETED`. Repeated calls
  return `ALREADY_SETTLED`, never duplicate cargo.
- If the native grant throws, returns a false/ambiguous acknowledgement, stock
  delta mismatches, or the process crashes after intent, it stays
  `NEEDS_OPERATOR_REPAIR` and never retries automatically. Lock residue also
  blocks mutation. An operator must reconcile against the actual authoritative
  itemStore and source receipt before any explicit repair.
- Each worker must use **one shared journal path** on the same writable,
  backed-up filesystem. The lock is fail-closed and is never auto-cleared.
  A cross-filesystem DB transaction is not available; the fence limits replay
  risk, but does not make power-loss settlement fully atomic.

### Explicit missing work (NOT delivered)

1. Merge/rebase PR #20 with current main and verify its custody audit on the
   actual pinned checkout. This module refuses earlier direct virtual receipts.
2. Integrate a source-verified station/owner resolver and ore catalog, then
   invoke the settlement from a single authorized manual/backfill path behind
   a new default-off feature flag. No timer/background automatic replay.
3. Reconcile old virtual economy counters: a physical itemStore deposit and
   an existing virtual goods credit must not become two separately spendable
   piles of resources. Keep the bridge OFF until virtual credit migration is
   explicitly designed.
4. Expose NPC warehouse stock for a **legitimate, funded** player purchase or
   corporation transfer, not a free player `grantItemToCharacterLocation`.
5. Complete native ore refinery consumption and real blueprint industry job
   reservation/delivery; then native market escrow and wallet settlement.
6. Manual Windows `node --test` suite, exact pinned upstream overlay dry-run,
   disposable backed-up volume fault tests, server-native World gate, and two
   independent authorized game clients. Never run CI or deploy to live world
   automatically.

**This module alone does not finish the miner → courier → refinery →
manufacturer → market → ISK split co-op loop.** Never call physical warehouse
creation a fully playable economy without the remaining acceptance gates.

## Source validation

Pinned `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`:
`Code/server/src/services/inventory/itemStore.js` exports
`grantItemToOwnerLocation`, `listContainerItems`, `ITEM_FLAGS.HANGAR=4`.
`grantItemToOwnerLocation` can merge with an existing stock stack; therefore
we verify **quantity difference by warehouse owner, location, type** rather
than claim one source cargo ID will equal one destination inventory item ID.

## Local isolated regression

`node --test tests/coop-native-station-ore-settlement.test.mjs`

Seven isolated regression cases passed under Node 22.16.0 on 2026-10-25
against injected native API-shaped in-memory inventory/depot fixtures.
This is **not** pinned checkout roundtrip, native SQLite durability evidence,
market liquidity or live two-client gameplay acceptance.
