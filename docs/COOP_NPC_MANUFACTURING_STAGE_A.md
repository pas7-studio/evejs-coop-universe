# COOP-032A — Native NPC industry director and durable job protocol

**Status: partial implementation, default OFF, not an autonomous factory.**
Pinned upstream: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
This work deliberately does **not** create products, mint ISK, fabricate blueprint IDs, change a live DB, or claim a successful real NPC job. The native atomic executor that writes materials+wallet+job+BPO is a separate, blocking COOP-032B deliverable.

## What exists in this PR

- `integration/coopNpcManufacturingPlanner.cjs`: synchronous read-only shortage director for first genuine **charge/ammunition category 8**, from published native SDE blueprint definitions and the exact native manufacturing material function. Candidate blueprints must be *existing* NPC corporation-owned original item instances at the same native station, with registered original state and no installed job. The planner cannot seed a BPO or fabricate a fake employee session.
- `integration/coopNpcManufacturingNative.cjs`: native dependencies **at server/src/space**, reading `corporationState`, `worldData`, `industryStaticData`, `industryParityHelpers`, `itemStore`, and native `industryBlueprintState` / `industryJobs` GameStore tables. No external market/virtual-economy data can authorize material credit.
- `integration/coopNpcManufacturingJournal.cjs`: durable exclusive-file-lock job coordinator. The state transitions are `PREPARED -> INSTALL_OUTCOME_UNKNOWN -> INSTALLED -> DELIVERY_OUTCOME_UNKNOWN -> DELIVERED`. Unknown outcome never reissues a potentially duplicate debit/job/delivery. It first stores PREPARED with fsync and atomic rename, then records UNKNOWN **before** crossing an untrusted native call boundary. Matching real item IDs / job ID evidence required before recording success.
- `tests/coop-npc-manufacturing.test.mjs`: deterministic tests on real source modules for materials, blueprints, available stock, jobs, cross-job reservations, crash uncertainty, no double spend, and READY time barrier.

## Exact server boundaries and safety

- Native items, not virtual `coopVirtualEconomy.goods`, are the only available minerals, and native jobs are the only work-in-progress. Existing market stock is a separate user-supplied read-only input. **Any market-input value must be verified by caller**; absence of trusted stock is not proof the NPC can sell.
- `getBlueprintState()` in pinned EveJS can **create** blueprint state records if missing, so the director instead uses read-only native `industryBlueprintState.records`. If a blueprint has no persisted state, it is excluded. Real original BPOs must be acquired via native inventory independently, with audited purchase/one-time seed.
- No more than two proposed jobs per station, one active operation per blueprint and no double allocation of verified mineral stock. Output quantity is taken from native activity.products; no price/quantity guesses or infinite replenishment.
- A plan is **not** the true authorized industry quote. The server must still calculate the cost/index/skills/access and check an actual NPC corporation wallet and facility. Until implemented, `createJournal.install()` returns `ATOMIC_NATIVE_INSTALL_UNAVAILABLE`, with zero native mutations.
- The future `native` adapter contract needs: `supportsAtomicInstall`, `supportsAtomicDelivery`, `revalidate(plan)`, `installOnce(plan, operationID)`, `getJobByOperation(operationID)`, `deliverOnce(job, operationID)`, `verifyDelivered(operationID)`. These cannot be wired to upstream `installIndustryJob(session)` / `deliverIndustryJob(session)` with forged player or GM sessions. A real trusted server-only capability and exactly-once durable DB transaction across actual items, real BPO, native industry job, wallet and delivery is required.
- A job only delivers once the actual native job status equals `READY` (3). Manufacturing time follows native job timestamps; a reconnect, tick counter or process restart does not fast-forward jobs. Every output item must be owned by the same NPC corporation, located at the same real station, have the exact product type and total native recipe quantity.
- The journal uses an exclusive `.lock` file (`wx`). Stale lock blocks operations until deliberate audit; never auto-delete stale locks. Journal `UNKNOWN` requires **manual native SQLite provenance reconciliation**. This is not a distributed lock, so deploy one writer per warehouse while any future multi-process coordination uses a transactional DB lock.

## Developer dependency graph

1. **COOP-030B**: physical NPC hauler arrival + durable native station item custody. PR #40 was still draft/open at the audit point. Verify its merge and production acceptance.
2. **COOP-031**: native refinery with zero-fee guarded mineral output. PR #43 was draft/open; corporate ISK handling remains blocked. Must have confirmed real mineral item IDs before any job.
3. **COOP-032A (this PR)**: native director & durable job intent, isolated tests. **Not installed as an autonomous factory.**
4. **COOP-032B**: trusted native corporate job installer: atomic/minimally recoverable material debit, corporation wallet charge, blueprint lock, native industryJobs insertion with immutable opID index. Fail-closed on unknown; no fake sessions; no stock grants before READY.
5. **COOP-032C**: real atomic output delivery: `industryJobs` COMPLETED/DELIVERED transition, tagged native itemStore outputs, BPO return/BPC runs accounting, native corporate-wallet evidence. Full restart tests on disposable DB.
6. **COOP-033**: reserve and expose outputs through real market escrow/sell orders with ISK/player-hangar evidence; **do not merely call AdjustSeedStock without provenance**.

## Proof still required for playable outcome

- Disposable **actual** pinned SQLite: conflicting NPC item jobs and crashes after each of material debit, wallet charge, job insert, blueprint reservation, output grant, job state update; verify native source/target conservation and manual reconciliation. Test actual factory facility IDs and recipes, including first real T1 ammunition type selected from native SDE, not an arbitrary ID.
- Two genuine EVE clients: NPC transports ore, station receives it, native refinery converts to mineral items, real NPC original BPO and paid industry job consumes those items, the ready job delivers exactly one item batch, native market sells to player with wallet debit and persistent hangar item after restart.
- Never run these tests against live named Docker volume `evejs-data`; no automatic build, restart, seeding or PR merge.