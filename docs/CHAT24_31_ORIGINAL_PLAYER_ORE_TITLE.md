# Chat 24 + 31 — Stage C1: Original NPC ore title -> native player corporate hangar

**Source status:** CODE_READY (contract mock), **LIVE_UNVERIFIED, default OFF**. This is a manual server-side transactional adapter only, not a shipped player-facing UI and not verified in live EveJS. It extends PR #287, built on original CH24+31 Stages A/B.

## Existing native value chain, not a new economy

1. Existing native mining NPC creates original source ore. Native miner-to-hauler cargo transfer retains a unique cargoID.
2. Native warehouse deposits exactly one **original tagged item** `coop-warehouse:v1:cargo:<cargoID>` under the NPC employer corporation at the real station. The warehouse COMMITTED receipt carries original fleet ID, hauler ID, type, quantity, source corporation and itemID.
3. The player's actual corporation funds an NPC shift using the existing Stage A wallet payment. **Payroll is not title transfer.**
4. The player corp manager **separately buys** the original deposited ore with a trusted native quote. `coopPlayerMiningOreTitle.transfer` requires authoritative native member, industry and wallet 1000 TAKE roles, hangar QUERY role, verified native station office and a COMMITTED original warehouse receipt **after the shift was funded**.
5. In **one** GameStore `coopAtomicNativeRows.transact(["items","corporationRuntime"])`: the existing itemID and unique marker are retained; only `ownerID`, `locationID` and `flagID` move to the native office folder/selected hangar division (115-121). The player's corp wallet is debited, NPC employer corp wallet is credited and reciprocal native journal/transaction entries plus a per-cargo immutable receipt are written.
6. Receipt key `coopPlayerMiningOreTitle\u001f<cargoID>` is unique across shifts. The legacy NPC warehouse-to-NPC title receipt is checked and exclusive. On replay, the receipt and **both** wallet journals are verified without moving the item again, even if the original was later consumed.
7. Native `coopNativeWarehouse.getReceipt(cargoID)` gives a validated read-only original warehouse journal. The warehouse `audit`, `deposit` replay and `resume` paths can now accept a **trusted opt-in `verifyTransferredTitle`**; it requires source cargo already absent and a full read-only committed receipt, native item and native two-wallet proof (not merely a missing item).
8. `coopNativeStationArrival.createStationArrival` passes an optional `verifyTransferredTitle` dependency to the same warehouse; no new scheduler or implicit reroute.

## Boundaries and activation

- Gate: `EVEJS_COOP_PLAYER_NPC_MINING_ORE_TITLE` is declared and **OFF by default**. The module is installed by the single overlay installer but has no user RPC entrypoint. `createPlayerMiningOreTitle` requires explicitly injected `enabled` and trusted callbacks, and defaults to false.
- `verifyOffice` must read the original native corporation office record, require its **exact** `officeFolderID`, target `stationID`, unimpounded lease and division, and check session docked status where appropriate. None of those can be client assertions.
- `quoteOre` is a trusted server quote **in integer cents**. The client can supply only a maximum price bound and original object identity; it cannot set the final price.
- `getWarehouseReceipt` is the original fsynced warehouse journal; `coopNativeWarehouse.getReceipt` returns a clone. DO NOT substitute a virtual depot or an arrival timer. Native ItemStore and GameStore are sources of truth.
- The source-only title verifier `createPlayerMiningOreAudit` accepts read-only injected native row readers and exact native office verification. **It is not automatically instantiated by the live station runtime**: wire those trusted readers before enabling title transfers. If a receipt lacks the original item or either wallet, return false and demand operator repair.
- The existing default warehouse audit is deliberately unchanged when no verifier is passed. For ore that was later sold, refined or reprocessed, a further native **consumption** proof is still required; title transfer by itself does not prove downstream stock.
- The existing `coopLivingWorldNativeChainProof` currently handles NPC-to-NPC original title receipts, not this new player transfer. Extend its conservation oracle before full live chain release.
- No automatic retries on uncertain atomic writes, no free corporate stock, no new NPC character wallet, no order impersonation, no stock market bypass, no GitHub Actions.
- Never activate on preserved `evejs-data` until the original GameStore SQLite writer's poisoned/cache/replay behaviour, office inventory indexing and restart are tested on disposable data.

## Isolated test evidence (Node 22)

Run:
```powershell
node --test tests/coop-player-mining-*.test.mjs
```

At this source revision: **61/61 PASS** locally across Stage A/B and 21 Stage C tests plus a read-only polling performance regression, including identical itemID/title, exact two-wallet cents, confirmed post-shift cargo, invalid membership/office/quote, mixed owner, duplicated marker, insufficient ISK, transaction failure rollback in mock, replay after item consumption, legacy title collision, forged receipts and read-only warehouse reconciliation. This **does not** establish native deployed SQLite, warehouse `fsync`, client display or two authenticated pilots. The warehouse integration itself needs an additional disposable native test before claim of runtime PASS.

## Remaining stages

- Stage C2: production native adapter for trusted server office/market quote, GameStore read-only title verifier binding, strict original warehouse audit acceptance plus a crash/restart matrix; no fake stock.
- Stage D: in-client corporation commands + shift management, actual ore hangar views and permission-scoped sell/reprocess through existing native market/industry, real payroll/revenue ledger derived from GameStore.
- Stage E: physical multiplayer E2E with miner, hauler, escort defense/retreat, actual warp/docking, same itemID from NPC warehouse to corp and native wallet conservation across server restart.

### Extra native warehouse integration tests

Added `tests/coop-player-mining-warehouse-integration.test.mjs` (5 cases: title acceptance, replay, missing proof, source cargo still present, read-only receipt cloning). **NOT_RUN against the actual warehouse module in this session**; these require the complete working checkout. They are excluded from 61/61 local mock count.
