# P1 Escort Contracts — native-funded settlement fence (Stage A)

**Status: settlement kernel + tests only. No real EveJS wallet adapter or runtime hook. DEFAULT OFF, not deployable.**

## Dependency graph

- PR #40 → PR #59: durable physical station arrival and immutable complete native cargo manifest.
- PR #48 → PR #53: real pirate encounter, two distinct real pilot damage witnesses, native warehouse custody/loss receipts.
- This PR: `integration/coopEscortContractSettlement.cjs` — separate fail-closed payment fence consuming the above evidence. It **does not** create another inventory, market, wallet, quest engine or NPC simulation.

## Implemented stages

1. **OFFERED:** An authoritative native offer has to match every ID, both sorted player character IDs, corporation, amount, one hauler, and immutable original trip manifest. The exact trip gets an exclusive disk claim (cannot be sold twice). Offer and claim are file-fsynced, with directory fsync.
2. **FUNDING_PREPARED → FUNDED:** A journal event is durably written *before* one native `reserveAtomic` call. An independent `verifyReservation` read must confirm a native durable escrow, exact corporation, ID and ISK amount before finalizing. Any ambiguous call/result leaves the writer locked for manual reconciliation. No blind retry.
3. **Proof:** Exact `coopNativeHaulManifest.read/verify` complete item set + physical station `DELIVERED` proof + two actual PR #48 pilots who damaged a native pirate (confirmed physical pirate wreck) + PR #53 every original cargo stack at destination in the native warehouse + **no native hauler wreck**, plus still-held native escrow. A timeout, one good cargo stack, wrong fleet or one player never counts.
4. **SETTLEMENT_PREPARED → SETTLED:** Another fsynced intent before *one* `settleAtomic` native double-entry transaction that consumes the escrow and credits **both** existing player wallets together. Re-read a durable native `SETTLED` receipt with `escrowConsumed:true` and exact two recipients before journaling completion. Never perform two separate wallet transfers.
5. **Recovery:** Journal phases are strictly checked; torn/corrupt event chains refuse service. PREPARED or an unknown external write is non-replayable and writer lock persists across restart until operator-led reconciliation with true native records. A repeated offer for the same manifest is fenced by its exclusive claim.

First slice: exactly **one physical hauler**, exactly **two different player characters**, equal integer 50/50 ISK shares, maximum budget 1,000,000,000 whole ISK, and no partial-completion rewards. This is a deliberate safety bound, not a complete multi-hauler mission service.

## Required nativeFunds adapter — not yet implemented

These must be *synchronous trusted native server* functions backed by a **real atomic** EveJS corporate/player wallet and escrow, not the existing separate per-NPC market simulation:

- `capabilities()` returns `{nativeDurable:true, atomicDualCredit:true, durableIdempotency:true}` **only** if those guarantees actually exist.
- `verifyReservation(contract)` reads the committed native escrow and returns either `{status:'NOT_FOUND'}` or `{status:'RESERVED',contractID,corporationID,amountISK,escrowKey:contractID,nativeDurable:true}`.
- `reserveAtomic(contract)` debits the NPC corporation, reserves exactly the money and enforces a durable unique contract idempotency key, all in **one native transaction**. Insufficient funds must fail without changing any balance.
- `verifySettlement(contract)` reads true native wallet, escrow and transfer records and returns either `{status:'NOT_FOUND'}` or `{status:'SETTLED',contractID,corporationID,amountISK,escrowKey:contractID,escrowConsumed:true,nativeDurable:true,credits:[{characterID,amountISK},...]}`.
- `settleAtomic({contractID,corporationID,amountISK,credits})` atomically consumes the reserved NPC money and credits both actual character wallets in one transaction, with native durable unique transfer IDs. No second transfer on duplicate requests.

The injected proof authorities `authorizeOffer`, `readManifest`, `verifyManifest`, `readIncidents`, `readOutcomes`, `readNativeDelivery` must be wired only to trusted real game-server sources. Never accept a client-supplied `status:DELIVERED` or `status:SETTLED` as proof.

## Remaining gates before player-visible release

1. Implement and fault-test a real native GameStore wallet/escrow provider, including company balance before/after, both player balances and a unique receipt in one SQLite transaction. The current per-pilot NPC market ledger is **not** the corporation's native funds.
2. Add a trusted **pre-warp** contract offer and funding point. In PR #59, `coopNativeStationArrival.start()` currently prepares its manifest and immediately warps; split into prepare/reserve/warp steps, or another explicitly fail-closed pre-warp hook.
3. Persist genuine native `DELIVERED` terminal evidence separately. The PR #59 in-memory route is lost on crash: an old manifest alone cannot prove arrival.
4. Merge the two dependent PR stacks without overwriting later installer/deployment A-Life changes. Register this L2 module and new opt-in flag only once the real native wallet provider exists; **`EVEJS_COOP_ESCORT_CONTRACTS=1` is intentionally not wired into deployment**.
5. On disposable backed-up Docker data, test actual two-client acceptance, full vs partial cargo, pirate/hauler wreck, wrong ship/fleet, RPC timeout before/after native commit, simultaneous contracts, restart at each journal phase, and genuine native balance/custody reconciliation.

## Evidence

Local isolated Node 22 run: **13/13 focused tests PASS** with a fake adapter solely to test *kernel* behavior, file fsync, idempotency and failure fences. Real wallet, full pinned EveJS Docker, live clients and true power-loss fault injection **NOT RUN**. No Docker change, GitHub CI, production `evejs-data` mutation, market reseed or real ISK transfer.

Local command: `node --test tests/coop-escort-native-contract-settlement.test.mjs`.

**Operator safety:** An existing `FUNDING_PREPARED`, `SETTLEMENT_PREPARED` or writer lock must be reconciled with native wallet/escrow records. Do not automatically delete locks, reset journals or retry unknown transfers.
