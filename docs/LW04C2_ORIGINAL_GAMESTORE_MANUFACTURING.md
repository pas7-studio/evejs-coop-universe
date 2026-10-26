# LW-04C2 — Original GameStore native manufacturing stages

**Status:** Manual controlled executor implemented, **not live automatic A-Life**.
Stack on LW-04C1 PR #207 -> LW-04B PR #193. No default financial flags
are enabled. This module is installed as an importable server source but
never started or mounted to player commands, NPC AI, world ticker or a bot.

## In-process original authority

`coopNpcIndustryOriginalGameStorePreflight.cjs` checks the **already claimed**
original `gameStore.coopAtomicNativeRows` writer and original corporation
wallet/job rows. It does not claim another writer or reopen SQLite.

`coopNpcIndustryOriginalStageExecutor.cjs` is a strictly manual,
explicit-flagged, single-station stage executor. It calls the existing
`coopNpcIndustryNativeBindings` COOP-032D/E/F kernels for exactly one of:

1. `INSTALL`: original trusted SDE/native industry quote; GameStore transaction
   consumes source mineral stacks, deducts the corporation's persisted wallet
   **once** and locks the original BPO into the original industry job.
2. `MARK_READY`: original job time/FILETIME verification; no acceleration.
3. `DELIVER`: original item allocator, original ItemStore new stack, exact
   job delivery receipt and BPO restored atomically.
4. `INSPECT`: read-only persisted job, debit and original ItemStore custody.

No support for `LIST_OUTPUT` is claimed: original Rust escrow listing,
ACK recovery, order fill and wallet credit remain separate LW-04C3 work.

## Safety gates

- `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`,
  `EVEJS_COOP_NATIVE_NPC_TX_PROOF=1` and
  `EVEJS_COOP_NATIVE_NPC_MANUAL_FACTORY_PROOF=1` are needed **only** in a
  disposable/manual test server; all default OFF.
- A-Life ACT, independent native NPC market writer or NPC economy scheduler
  must be OFF. No second scheduler is introduced.
- The original GameStore transaction itself must assert
  `synchronous=FULL`, single-writer ownership, no transient/dirty/in-flight
  state and post-COMMIT cache invalidation. Preflight alone cannot grant an
  atomic transaction lease or attest that the native live runtime is safe.
- On unknown commit, lost readback, original wallet mismatch or poisoned
  cache, the station is quarantined **in process**; restart requires manual
  audit from source. Repeating an operation ID reads its original native job.
- `supportsLiveRuntime:false` and `supportsAutomaticAlife:false` are
  intentional. There is **no production-ready live director resolver**.

## Source tests

Run:

```powershell
pwsh -File scripts/Run-LW04C2-Original-Industry-Gates.ps1
```

Besides basic mocks, the suite uses **the genuine source**
`coopNpcIndustryNativeBindings`,
`coopNpcIndustryGameStoreScope`, `coopNpcIndustryOfflineAtomic`,
`coopNpcIndustryReady`, `coopNpcIndustryOfflineDelivery` against
an isolated transactional **in-memory fake GameStore row store**. This is
a source-level test, **not** an original SQLite/Rust integration or full
physical EveJS gameplay test. The ten scenarios in
`tests/scenarios/lw04c2-original-manufacturing-stage-e2e.json` are NOT_RUN.

No Docker volume or protected `evejs-data` is touched.

## Next

LW-04C3: implement original Rust **sell-side custody and ACK** adapter,
native owner order/escrow reconciliation, and reuse the existing recovered
GameStore/ItemStore/Rust journals. Verify one production cycle on a disposable
pinned server with actual original SQLite/Rust and two clients before
allowing A-Life to invoke live production.
