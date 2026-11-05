# PF-51 — original native Mining Startup/Recovery Fence (source candidate)

**2026-11-05. INERT / NOT GAMEPLAY-READY.** Source candidate for the authoritative `pas7-studio/EveJS` fork (branch `coop/pas7std`), NOT a deployed or merged game feature.

The original `coopNativeMiningFleetDurable.js` can spawn, repair and restore original NPCs. A crash after a slot witness or controller creation makes an unguarded retry unsafe if the same physical NPC is being claimed by Personal Fleet or WAR.

## New code

- `native/coopPersonalFleetMiningStartupFence.js`: original `corporationRuntime` single-writer `BEGIN IMMEDIATE` admission/reconcile. Validates **all** PF claims (including malformed unrelated rows), WAR ships and transfers, the PF44 STARTING/ACTIVE lease, matching PF46 STARTING/ACTIVE gate and token, absence of pending cargo permits, and required reciprocal writer coverage. Persists a sticky `IN_FLIGHT` record **before** `spawn`, `repair`, `materialize`, and `register`. TTL never reclaims it. `finish()` and `reconcile()` require independent original entity/controller/cargo evidence; no retry spawns in recovery.
- `build_patch.py`: source-pinned patch generator for `Code/server/src/space/coopNativeMiningFleetDurable.js`, plus the new native guard module. It checks original Git blob `2162c82ccdc358b47ef622308de26b7345eeaf43` exactly; on drift, refuses. It only writes a patch into this package, **not into the fork**. `git apply --check` may then validate a real WORK checkout.
- `Test-PF51-NativePatch.ps1`: Windows read-only test suite, source pin and git apply check.
- `tests/`: 42 tests: state/idempotency/fencing, original-custody evidence validation, SQLite `synchronous=FULL` and actual Linux Node `SIGKILL` at durable crash points; source-pinned synthetic git apply smoke test.

## Run on Windows WORK checkout

```powershell
cd R:\GitRepository\pas7std\evejs-coop-universe
.\scripts\pf51\Test-PF51-NativePatch.ps1 -ForkRoot 'C:\Games\EveCoop\upstream-evejs'
```

Or from the standalone ZIP root:

```powershell
node --test tests\pf51-startup-fence.test.cjs tests\pf51-sqlite-sigkill.test.cjs tests\pf51-patch-smoke.test.cjs
python build_patch.py --fork-root 'C:\Games\EveCoop\upstream-evejs'
git -C 'C:\Games\EveCoop\upstream-evejs' apply --check patches\PF51-native-startup-fence.patch
```

The patch is **intentionally not auto-applied**. No GitHub Actions, no Docker or volume access, no main merge, no PLAY changes. `EVEJS_COOP_PERSONAL_FLEET_MINING_STARTUP_FENCE` remains OFF, and PF-42 exclusion stays active.

## Safety and integration blockers

The upstream `start(args)` wrapper is **hard-blocked** if PF51 flag is enabled because the trusted startup bindings do not yet exist. This is deliberate; the injection entrypoint `createService({startupFence})` is for trusted in-process wiring/testing only. Do not inject arbitrary callbacks from client or RPC input.

Native runtime integrator MUST implement these callbacks against authoritative source, not test fixtures:

1. `readMiningLease(tx,systemID)` — original PF44 lease from the **same** `corporationRuntime` transaction, returning a validated `{systemID,state:'STARTING'|'ACTIVE',token}`.
2. `verifyOriginalPreflight(...)` — no native effect, checks original slot/actor/controller/cargo ownership and absence of unowned orphan records, **within the admission transaction**.
3. `verifyNativeStartup(...)` — independently inspects original native entities/controllers/modules/cargo, loaded+unloaded systems and startup manifests; returns one cryptographically bound record per exact slot. Hash shape validation alone **does not prove** the hashes originate from native authority.
4. `writersIntegrated()` — true only with real reciprocal fences for PF, WAR, Mining, Hauling and Exploration writers. This is currently NOT proven.
5. `createService({startupFence})` and original wrapper binding must be added in the authoritative fork, with actual GameStore/SQLite and two-client WORK E2E. Without such binding the flag must remain OFF.
6. Successful `VERIFIED` admission cannot start a fresh session: a later restart requires **explicit native handover protocol** to transition prior completed witness. No automatic TTL or recovery re-spawn.

**Even after passing 42/42 tests this does not mean NPC hire/assign/deploy/orders/dock is available.** The authoritative engine repository write path previously returned GitHub HTTP 403; no direct native fork changes are claimed here.