# LW-04C1 — Original NPC industry recovery fence

## Status and dependencies

**Implementation:** pure read-only reconciliation + an audited wrapper for a
*future* reviewed native live manufacturing director. **Not live production
manufacturing.** Depends on staged LW-04B [PR #193](https://github.com/pas7-studio/evejs-coop-universe/pull/193),
which supplies original A-Life intents and actor checks. Neither PR enables
the financial runtime. The shipped industry/director bindings still declare
`supportsLiveRuntime:false`; this PR does NOT override them.

## What was implemented

- `coopNpcIndustryRecoveryFence.cjs` audits a bounded original director
  `inspect()` snapshot across native GameStore `getJob` /
  `getIndustryDebit`, original ItemStore `getItem`, and Rust
  `getOrder` / `getSaleEvidence` / `getWalletEntry`.
- `PREPARED` must not already have a native job. `INSTALLED` and
  `READY` require exact job + cost debit. `DELIVERED` requires the
  persisted original job receipt and exact hangar item identity.
  `LISTED` requires exact original native escrow and order quantity.
  `SOLD` requires full nonzero-price Rust fills, exact wallet entries
  and conservation of units and ISK.
- `INSTALL_UNKNOWN`, `DELIVERY_UNKNOWN`, `LIST_UNKNOWN` and
  `REPAIR_REQUIRED` remain **BLOCKED**, never re-run. A separate reviewed
  operator recovery flow must resolve ambiguous prior commits. These
  statuses must not be misrepresented as completed financial transactions.
- Every audit re-reads the durable director journal after reading native
  receipts and rejects changes. Async authority getters are rejected;
  native Rust adapters must provide a consistent pre-verified snapshot or
  a future explicitly reviewed asynchronous snapshot lease.
- `coopNpcLiveFactoryReadiness.cjs` wraps only an explicitly verified
  `supportsLiveRuntime:true` original director. It independently audits
  before **every** delegated `tick()`; audit results are never cached.
- The original A-Life ACT also requires `auditBeforeTick()` and an exact
  `READY` proof for a live director, then **rechecks the physical actor**
  after audit completion. No money is spent if the actor changes owners,
  warps, becomes player-controlled or enters combat.
- Overlay modules deploy as `.js` alongside the existing CJS source
  modules; no additional scheduler, original wallet, inventory, journal,
  RPC endpoint or game command is introduced.

## Known limitations, never interpret as PASS

The Rust market/ItemStore readiness proof in this source-only fence is
**not** a proof that a live write adapter exists. A large historical journal
over the configured audit budget requires a reviewed archive/compaction
strategy. Partial or unknown Rust transactions remain operator-blocked.
A real live director must be built separately with original GameStore
cache/WAL and Rust exactly-once mutation contracts before activation.

Run source regression tests:

```powershell
pwsh -File scripts/Run-LW04C-Industry-Recovery-Gates.ps1
```

The ten original native crash/finance/two-client cases in
`tests/scenarios/lw04c-industry-recovery-e2e.json` remain `NOT_RUN`.
Never test on protected `evejs-data`; use a disposable pinned upstream copy.

## LW-04C2 next real native implementation

1. Review original live GameStore SQLite single-writer cache/poison rules
   for existing `coopAtomicNativeRows.transact` and original ItemStore
   invalidation. Wire reviewed live quote/install/READY/deliver bindings,
   not the isolated offline-exclusive adapter.
2. Bind genuine Rust native NPC seller listing/fill/escrow/wallet witnesses,
   including crash after Rust COMMIT and before GameStore acknowledgement.
3. Attach those original verified bindings to the director, retain the
   recovery fence, and prove 2-client mining-to-ammo-consumption E2E.
