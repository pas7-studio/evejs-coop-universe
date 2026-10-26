# LW-04C4 — Strict original NPC factory SOLD finalization

**Status:** SOURCE-only manual operator finalizer implemented, not enabled
in production. Stacked on LW-04C3B PR #221 → #215 → #210 → #207 → #193.

## Existing original authorities

The existing `coopNpcNativeEconomyDirector` owns one fsynced
`npc-manufacture:<id>` journal, exclusive `.lock` and no new timer.
This change adds the **optional** `saleAudit` and
`authorizeSoldOperator` dependencies to that same director.

If both dependencies are supplied, the old `LISTED` projection-to-SOLD
path is **blocked**: synthetic market sales and bare wallet status cannot
reclassify NPC corporate profit. `confirmSoldOnce()` is the only
source-journal SOLD transition for this configured manual mode.

The method is OFF unless both
`EVEJS_COOP_NATIVE_NPC_ECONOMY=1` and
`EVEJS_COOP_NATIVE_NPC_SOLD_FINALIZE_PROOF=1`.
No source file or installer sets either flag. The method is NOT exposed as
a player command, unauthenticated admin API, or independent scheduler.

## Durable reconciliation

1. Require the server-injected synchronous scoped operator authority.
   Deny absent or asynchronous authorization.
2. Acquire the original director exclusive journal lock; verify original
   NPC owner/station, operation, jobID, itemID and orderID.
3. If already SOLD with intact immutable settlement metadata, return
   `ALREADY_SOLD` without a Rust transaction, GameStore debit or audit.
4. For LISTED, call the **trusted server-injected**
   `coopNpcIndustryOriginalSaleAudit.audit()`, which requires actual
   original Rust FINALIZED CLAIM(s), original GameStore settlement
   receipt(s), ItemStore buyer items and original wallet journals.
5. Require exact same operation/station/order/quantity, zero remaining
   escrow, full quantity conserved, positive cent-exact revenue,
   unique original fill IDs, readOnly/nativeMutation=false and exact
   proof `RUST_FINALIZED_GAMESTORE_BUYER_ITEM_AND_CORP_WALLET`.
6. Re-read the durable journal under the lock after the asynchronous
   audit; refuse if the journal entry changed meanwhile.
7. Transition `LISTED → SOLD` ONCE using the director's existing
   fsync+rename+directory fsync, persisting immutable revenueCents,
   soldQuantity, settlementFillIDs, proof and soldAt.

**No** new Rust order, wallet credit/debit, ItemStore transfer, scheduler,
synthetic NPC money or source-of-truth inventory database is added.
Original economic actor and original 30-second A-Life tick remain distinct
from this manually authorized release gate.

## Safety qualification

The operator may only invoke the method with server-owned
`saleAudit` built over real original native APIs. Passing a
user-crafted object as a trusted audit would violate this contract.
No live native Rust/SQLite adapter or protected data is mounted by this
source PR. For a real release, a reviewed secure operator route with
authenticated scoped grants and physical source authority adapters is
required.

Read-only `saleAudit` may fail closed if a buyer has already moved or
consumed their physical item before operator reconciliation. Handle this
with an audited source consumption lineage, **never** bypass the native
source/provenance guard to force SOLD.

## Source regression

```powershell
pwsh -File scripts/Run-LW04C4-Sold-Gates.ps1
```

New and legacy director tests include native crash recovery, original
fsynced source-journal replay, concurrent writer lock, async read audit,
partially sold orders, forged claims, unauthorized operator and journal
mutation under audit. The exact-source V8 test harness executed all
45 director test callbacks; this is NOT a full original Node checkout
or pinned Rust/SQLite integration.

The 13 original physical acceptance cases in
`tests/scenarios/lw04c4-original-npc-sold-e2e.json` remain
`NOT_RUN`, never marked PASS from source tests.

## Next original E2E gate

Run original pinned Node/SQLite GameStore and Rust daemon against a
disposable copy, with two authenticated clients. Verify one manufacturing
job, one order, one buyer payment, original wallet/ItemStore custody,
lost ACK at each COMMIT boundary, and durable SOLD replay. Only after
this may the separate live financial flags be considered for activation.
