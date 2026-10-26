# LW-04C3B — Original NPC factory Rust fill and financial settlement

**Status:** Manual source-backed settlement bridge plus read-only source
audit implemented. Not live A-Life. Depends on PR #215 → #210 → #207 → #193.
All flags default OFF. This PR does not modify original Rust daemon or
auto-enable GameStore financial writers.

## Source authorities: REUSE, not duplicate

- **Full stack:** Existing COOP-035 `coopNpcCorporateSettlement`
  has original `ClaimNpcSellOrder` → *one* GameStore transaction across
  `characters`, `corporationRuntime`, `items`, `marketEscrow`,
  `npcMarketFills` → `FinalizeNpcSellOrder` / `GetNpcSellClaim`.
  Existing server buyer runtime `coopNpcCorporateBuyRuntime` binds a
  real authenticated docked player session and native inventory notification.
- **Partial:** Existing COOP-047 `coopNpcPartialFillAtomic` uses the same
  original Rust claim/finalize sequence plus original ItemStore
  `identityState` for an atomic split. Its persisted native partial receipt
  contains the original fill ID, buyer itemID and remaining escrow.
- **New manual bridge:** `coopNpcIndustryOriginalBuyerSettlement`
  authorizes a **LISTED** factory operation and a still-open original
  NPC Rust sell order, original escrow, physical inventory, authenticated
  buyer, and server-issued buyer/order/quantity-bound partial claim key.
  It invokes the above existing settlement modules **only**; does not
  issue its own wallet or item transactions. Post-commit uncertainty creates
  an operator hold and never auto-replays.
- **New read-only financial audit:** `coopNpcIndustryOriginalSaleAudit`
  reconstructs exact source `NATIVE_COMMITTED` whole and
  `NATIVE_PARTIAL_COMMITTED` partial receipts, independently verifies
  Rust FINALIZED fill identities, buyer item custody, original wallet
  evidence and conserved quantities/ISK. GameStore receipt iteration
  may be unordered; the audit reconstructs remainingBefore ordering,
  rejects duplicates, gaps, lost ACKs and stale journal. It can return
  `ORIGINAL_FULL_SALE_ATTESTED` or `ORIGINAL_PARTIAL_SALE_ATTESTED`
  **without** writing `SOLD` or paying anyone.
- **New wallet witness:** `coopNpcIndustryOriginalWalletWitness`
  checks actual character `walletJournal`, `marketTransactions`,
  NPC corporation `wallet.divisions['1000'].journal/transactions`
  against exactly one original fill ID, debit/credit cents, order ID and
  recorded post-transaction balances. Later legitimate wallet activity
  doesn't invalidate the historical receipt; truncated/corrupt finance
  journals are held for review.

## Defaults and strict blockers

The bridge additionally requires original manual flags,
`EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF=1`, and
`EVEJS_COOP_NATIVE_NPC_PARTIAL_FILL=1` for partial.
The original COOP-035 / COOP-047 writer also checks its own native flags.
A-Life ACT, independent market writer and NPC economy scheduler must be
OFF. All operations are manual; no new timer, command, live executor or
player-session impersonation.

`verifyNativePartialClaimKey` must be a trusted **server-issued** binding
for the original authenticated buyer, exact order, station, operation and
quantity. A regular-expression-only string check is insufficient.

`SOLD` is NOT auto-applied. An operator must reconcile the existing
fsynced manufacturing director journal with verified original Rust
fills, GameStore receipts, ItemStore and wallet journals. Only then may
a future audited native status transition close the job; no retry of an
unknown COMMIT with a new operation/fill key.

## Tests

Run:

```powershell
pwsh -File scripts/Run-LW04C3B-Sale-Finance-Gates.ps1
```

Author-authored source tests include 18 read-only sale audit, 14 manual
buyer admission and 10 original wallet witness cases, plus existing
COOP-035/047 native settlement regression suites and three end-to-end
source-model checks that run **actual COOP-035 atomic settlement source**
followed by the new Rust/ItemStore/wallet audit. All of these are
disposable in-memory GameStore fixtures, NOT real SQLite/Rust E2E. Exact-source isolated
V8 tests are not actual repo Node/SQLite/Rust gameplay execution.

All 14 physical native acceptance scenarios in
`tests/scenarios/lw04c3b-factory-sale-finance-e2e.json` remain
`NOT_RUN` until a disposable pinned native server and two clients
prove Rust+SQLite COMMIT, crash recovery and wallet conservation.
Protected `evejs-data` must not be modified.
