# COOP-044 — Native NPC economy loop integrity audit

Scope: **real stock → industry job → READY → delivered output → physical escrow → Rust sale → renewed demand**. This is a focused defect-fix branch against current `main`. The separate A-Life money deadlock fix was committed to the dependent Draft PR #98, because COOP-043 is not merged to main yet.

## Confirmed defects and fixes

| Severity | Fault | Consequence | Fix |
|---|---|---|---|
| P0 | `coopNpcManufacturingPlanner` counted all job statuses `>=1 && <100`, including **COOP DELIVERED=4** | Permanently inflated pending output after a sale: NPC would stop producing despite a real shortage | WIP statuses explicitly `1=INSTALLED, 2=PAUSED, 3=READY`. `4=DELIVERED` and cancelled/finished historical jobs excluded |
| P0 | `coopNpcNativeEconomyDirector` counted all `snapshot.jobs` as in-flight inventory, including historical delivered jobs | Same endless phantom WIP at the economics director layer even when planner was fixed | Include only native status 1/2/3 in WIP; validate exact station, owner, activity and job identity; delivered job records remain audit history but never stock |
| P0 | Ignoring `PAUSED=2` while repairing WIP would allow premature second install | Extra material/ISK debit and stock overproduction while first industry job paused | Count `PAUSED` as outstanding reserved production; it is *not* marked delivered |
| P1 | Active job without facility/activity or corrupt/duplicate active output was silently treated as zero/duplicated WIP | Potential duplicate paid industry install based on incomplete source evidence | Block planner with `NATIVE_ACTIVE_JOB_SCOPE_UNVERIFIED`, `NATIVE_ACTIVE_JOB_PROOF_INVALID` or `NATIVE_JOB_OUTPUT_OVERFLOW` |
| P1 | Negative/fractional station item quantities and duplicated item IDs were ignored or aggregated as normal stock | Bad GameStore state can lead to planning with phantom/incorrect minerals | `NATIVE_ITEM_PROVENANCE_UNVERIFIED` before any paid industry plan |
| P0 (dependent) | COOP-043 A-Life checked for positive corporate ISK **before** listing already-manufactured output or delivering READY jobs | NPC could spend its last ISK on manufacturing and get trapped: cannot sell existing cargo to earn more ISK | Fixed in existing Draft PR #98: zero-ISK wallets **may LIST_OUTPUT or COMPLETE_JOB**, but new paid `MANUFACTURE` / `BUY_SUPPLIES` intents still require cash. Missing wallet proof remains blocked. Four new regressions in PR #98 |

Pinned source statuses verified against `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, `Code/server/src/services/industry/industryConstants.js`: stock EveJS `INSTALLED=1`, `PAUSED=2`, `READY=3`, `COMPLETED=100`, `DELIVERED=101`, `CANCELLED=102`. Our COOP-032C native NPC industry layer uses `DELIVERED=4`. The special COOP delivered status is **not** the same as stock EveJS `READY=3`. Both must be accounted for deliberately.

## Regression tests committed

`tests/coop-npc-manufacturing.test.mjs`: delivered status 4 never counts as active stock, PAUSED and READY do count, cancelled/wrong-station jobs excluded, missing owner station/activity fails closed, corrupt or repeated native itemID/negative mineral quantity blocks new jobs, malformed output and duplicate active jobID refuse a new paid install.

`tests/coop-npc-native-economy-director.test.mjs`: historical status 4 cannot keep stock permanently fulfilled, PAUSED and READY count pending output, missing job status/owner station proof blocks manufacturing, and existing injected failure/restart/ACK-loss tests remain in place.

New `tests/scenarios/coop-044-industry-replenishment-integrity.json`: **10 additional local E2E, all NOT_RUN**, including 5 full buy/replenish iterations, crash after native install, dual NPC corporation isolation, Rust client settlement and post-restart conservation. The existing `scripts/Run-Alife-Economy-Tests.ps1` now includes both test files in the default local run, and verifies the 10 scenario rows are still `NOT_RUN`.

**Source-level isolated checks executed this turn:** 23/23 pure planner cases; 22/22 director cases with a deterministic in-memory native filesystem journal (not a full Node filesystem); dependent PR #98 A-Life wallet/isolation 12/12. Full Node runner, compiled Rust daemon, native GameStore worker and player client E2E **not executed**. Do not mark the 10 gameplay scenarios passed from mocks.

## Local acceptance

On disposable checkout with the COOP-044 patch and actual native server source:

```powershell
pwsh -File scripts/Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests
```

Then execute every row of `tests/scenarios/coop-044-industry-replenishment-integrity.json` against the disposable server with genuine `industryJobs`, `items`, corporate wallet journal, Rust market order/escrow/fill IDs. Check that each native itemID and jobID appears exactly once, corporate ISK debits happen only once, and paused/finished jobs never fabricate physical stock. Inject a persistence restart and lost ACK at every durable transition. Store actual evidence and operator PASS/FAIL for each row; do not alter the manifest merely to make CI green.

**Do not use production data** or change the named persistent Docker volume `evejs-data` for these tests.

## Remaining open risks (not claimed fixed)

- Full A-Life **ACT/SETTLE** routing is not yet connected; COOP-033/034/035 still gate their own real native writers. There must be one idempotent native dispatcher and durable operation identity, not an additional scheduler.
- Partial market purchases require an atomically conserved native stack split. Current verified corporate buyer settlement is whole-stack only.
- Rust pending order and GameStore escrow can temporarily disagree during a crash; pending orders must stay invisible to all buyers until reconciled. The 10 acceptance scenarios intentionally cover this boundary.
- Native job status `COMPLETED=100` needs authoritative stock/upstream semantics review before using it to count undelivered supply; do not silently treat unknown status as available stock.
- The upstream inventory, Rust market and transaction concurrency still need real executable acceptance. In-memory tests are necessary but insufficient.

Feature flags default OFF. This patch does not change Docker, player inventory, market data, `main` or `evejs-data`.
