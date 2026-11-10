# PF-47 — Mining shutdown + native GameStore adapter (INERT source)

Date: 2026-11-05. State: isolated implementation/tested; **NOT gameplay-integrated**.

## Verified facts

- Original authoritative `pas7-studio/EveJS`, branch `coop/pas7std`, file
  `Code/server/src/space/coopGameStoreAtomic.js` (SHA256 of Git blob `2b28b48145f3fbc989ce7346384487ee75e52280`):
  `coopAtomicNativeRows.transact(["corporationRuntime"], fn)` supplies synchronous
  `tx.get(table,key)`, `tx.put(table,key, object)`, `tx.scan`, `tx.del`.
  Native bridge uses SQLite `BEGIN IMMEDIATE`, `PRAGMA synchronous=FULL` and
  poisons the GameStore on unknown COMMIT/cache status. Wrapper returns the
  mutation result directly, **not `{result}`** in the current fork.
- `coopNativeMiningFleetDurable.js` uses `npcEntities.coopMiningFleetSlots`
  but has not been fully instrumented with the PF-46 shutdown permits.
- PF-43/44/45 packages mentioned in chat are **not present in the public
  source branch**. PF-45's `coopPersonalFleetMiningQuiescenceAudit.js` does not
  exist at the inspected fork path. Native audit return shape must be verified
  from the real local package before enabling release.
- `pas7-studio/evejs-coop-universe` PR #350 is a **draft reference/contract** PR,
  not the native implementation. Local-only testing; GitHub CI forbidden.

## Implemented source components

1. `coopPersonalFleetMiningShutdownProtocol.cjs` — writes durable ACTIVE ->
   DRAINING -> VERIFYING -> RELEASED gates. `stopPhase: IN_PROGRESS` is reserved
   under the original atomic transaction **before** `nativeStop`. Concurrent
   calls return `BLOCKED_STOP_OUTCOME_UNKNOWN`. An interrupted native stop is
   never replayed on restart; explicit `reconcileStopped` uses an independent
   `verifyNativeStop` callback before advancing. Pending writes block release;
   receipt verification occurs inside the same atomic gate transaction.
2. `coopPersonalFleetMiningGameStoreAdapter.cjs` — uses exactly one
   `corporationRuntime` table and atomic native `transact`. Stores per-system
   gate/permits and global operation indexes as original row-shaped records,
   reads PF claim registry, checks PF44 lease identity and exact token,
   invokes the original PF44 lease release callback inside the **same**
   transaction and re-reads the resulting released witness before success.
   No sidecar DB, file lease or timeout unlocking.
3. Local tests (`pf46-shutdown`, `pf47-gamestore-adapter`) — 51/51 PASS on
   Node 22 synthetic SQLite fixture. These verify the protocol and native
   *API shape*, NOT an original GameStore runtime or EVE client.

## NOT IMPLEMENTED — mandatory before gameplay / turning feature ON

- Supply and inspect the actual PF-43, PF-44 and PF-45 source ZIPs and their
  `corporationRuntime` lease key/format. `leaseAuthority.readLease` and
  `leaseAuthority.releaseLease` MUST be actual source-verified PF-44 code,
  not the fake binding from the fixture. A wrong or absent authority must
  block initialization.
- Integrate the gate into **every native Mining writer** including original
  startup, slot spawn, restore, mining ore cycle, haul load/unload, recurring
  agent orders, cleanup, repair, delayed callbacks and off-system haulers.
  Reserve a durable permit in the same serialized authority **before** each
  mutation; independently verify native receipts before marking ACKED.
  Amend gate activation to occur atomically with PF-43 STARTING lease; never
  graft the gate onto a running fleet with unknown in-flight writers.
- Bind `nativeStop` to verified shutdown of the real original controllers and
  slot manifests. Bind `verifyNativeStop` to independent native source checks,
  NOT the stop callback's self-reported success.
- PF-45 observer must examine all 16 slots, original NPC entity/controller,
  in-memory registry, physical scene, remote haulers, transfer and cargo
  manifests, unknown/corrupt state and pending mutations. Zero objects alone
  must yield `OBSERVED_EMPTY_UNPROVEN`, not READY.
- `verifyCoverage` must compute a reproducible hash from an audited source
  inventory plus **runtime registration** of every writer, reject missing or
  uninstrumented write paths, and reject deployment/source drift. Returning
  `{status:'ALL_WRITERS_FENCED',sourceFingerprint:'a'.repeat(64)}` as in the
  isolated fixture is deliberately **not acceptable** in production.
- Verify operationID retention/compaction before 8192 tracked writes per
  system; never evict PENDING or ACKED proof while a lease is active. Test
  memory and write volume on real native workloads.
- Execute crash matrix against the actual original GameStore: after shutdown
  CAS, mid nativeStop, after controller disposal, before/after VERIFYING, after
  empty-observer, before/after atomic lease release, and against two independent
  processes competing for ownership. Verify original ship IDs, cargo and ISK.
- Run WORK gameplay with two genuine client sessions: hire, assignment,
  physical native mining/haul, return-to-base (docking unavailable until proven),
  release, concurrent PF claim, restart persistence, exploratory role handoff.
- Implement reciprocal Exploration ownership and native RETURN_TO_BASE +
  verified docking/inventory custody. These are separate uncompleted phases.

## Safety / release gate

- KEEP the PF-42 simultaneous activation restriction.
- Personal Fleet and new shutdown hooks remain default OFF.
- Do not run on PLAY or replace any original native source with archived CJS.
- No new GitHub Actions or remote CI; no automatic deployment or main merge.
- `RELEASED` observed in synthetic tests is **not** proof that any original
  Mining hull is free in the running game. Native acceptance remains NOT_RUN.