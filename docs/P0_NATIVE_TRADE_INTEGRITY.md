# P0 — Native trade custody: atomic item batch (code ready, live proof pending)

## Source failure in pinned EveJS

Stock `tradeMgrService._completeItemTransfers` moves each top-level native item and then its descendants using separate `itemStore.transferItemToOwnerLocation` writes. A failed child write after a successful ship write changes the ship owner without changing all fittings/cargo. `walletState.adjustCharacterBalance` likewise moves ISK separately from items. Neither sequence is atomic.

## Opt-in implementation

- `EVEJS_COOP_ATOMIC_TRADE=1`: for **all** trades served by pinned `tradeMgrService`, reject nonzero-money offers before the native wallet path. This is intentionally restrictive until a genuine cross-table wallet+inventory transaction is available.
- `coopNativeTradeAtomic.plan` checks the entire *authoritative* native items map immediately before commit: exact staged roots in trade container, two recipients, no nested cycles, no cross-owner cargo, no duplicate IDs, no active ship, no invalid singleton or stack quantities. Entire nested ship inventory retains its original location/flag and changes owner along with the ship.
- Pinned `itemStore` patch creates **one** new `items` table snapshot and calls its existing `writeItems` once; if it fails, no original read/cache object is modified. It never generates a new item or changes any wallet value. It forces the existing native SQLite items-table `flushTableSync` before reporting completion. On an uncertain flush it fails closed and requires operator reconciliation; no blind replay. Exactly one notification batch is returned to stock EveJS completion.
- Pinned patch transform is reversible. Does not activate itself without the explicit environment flag, which is only enabled when the operator explicitly passes `-EnableAtomicCoopTrade` together with `-LivingCoop` on a reviewed deployment. No live Docker mutation in this PR.

## Tests / acceptance

Local deterministic tests cover ship with nested fittings/cargo, two-way exchange, stale staged inventory, cross-owner nesting, active hull rejection, duplicate/replayed completion, invalid quantities, nonzero ISK block, patch round-trip. Source contract tests should run on pinned upstream code, then actual two-client docked trade/reconnect, interrupted confirmation and post-restart DB read on real Docker **without forced crash on irreplaceable persistent volume**.

## Limitations

One native items-table write plus synchronous native SQLite flush reduces partial item states; process/power-loss durability depends on the pinned GameStore transaction/recovery implementation. This does **not** establish atomic cross-table ISK+item transfers and is not a claim of crash-safe trading until live forced-fault validation in a disposable copy of `evejs-data`. Nonzero ISK trades are currently blocked in atomic mode rather than risking incorrectly balanced wallets. Existing upstream direct trade remains unchanged when the flag is off.
**Open P0 blocker:** stock EveJS stages items into a temporary trade container **before** confirmation. Abrupt process loss while a trade is open can strand staged items because the in-memory trade session and original station location are lost. The atomic *completion* fix does not resolve this separate crash-recovery gap. Stage custody recovery requires a persistent trade origin journal and controlled replay; no forced-crash proof on the live `evejs-data` is authorized.
