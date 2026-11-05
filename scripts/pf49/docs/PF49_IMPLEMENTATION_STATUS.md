# PF-49 — Native ALIFE-07 Mining Transaction Ownership Fence (CANDIDATE)

2026-11-05. Orchestration reference PR #350, engine target `pas7-studio/EveJS` @ `coop/pas7std`.

## What is coded

- `native/coopPersonalFleetMiningTxnGuard.js`: pure in-transaction validation of PF claims, WAR registry, active shutdown gate, matching PF-44 ACTIVE lease, and the exact pending PF-46 mining-cycle permit. Missing / corrupt / uncertain reads always reject; the guard performs **zero mutations**.
- `patches/PF49-native-mining-writer-transaction.patch`: native source modifications for original `coopNativeMiningAtomic.js` and `coopNativeCargoTransientIsolation.js`, plus the new guard file. **Default OFF**; only exact `EVEJS_COOP_PERSONAL_FLEET_NATIVE_MINING_WRITE_FENCE=1` alters mining-cycle admission.
- Declared `mining-cycle-pf` mixed transient cargo contract covers the extra read-only `corporationRuntime` table; on mixed transient cargo any attempt to mutate corporationRuntime in the mining cycle is denied. Existing ALIFE-07 and ALIFE-10 contracts remain unchanged when the flag is OFF.
- Original mining atomic transaction reads the lease/permit in the same `BEGIN IMMEDIATE` as original asteroid debit and original cargo credit. It calls a separate `finishMiningWrite()` callback only after original postcommit scene/cargo readback, to acknowledge the pending PF-46 permit after the SQLite receipt is verified by the trusted native authority.

## Honest limitations / not activated

This is a **patch candidate**. The native fork GitHub app returns 403 on creation, so no native commit/PR exists. The patch was `git apply --check --unidiff-zero` tested against isolated source excerpts, **not the full engine checkout**. The parser of the new guard module passes `node --check`; the entire patched native file has **not** been compiled/tested against your fork checkout.

The original PF-43/44/45 local packages are not present in GitHub. Consequently the source-ready new `createAtomicMiningSettler({readMiningLease,finishMiningWrite})` parameters have NO real native binding, and the opt-in mode deliberately refuses writes with `PF49_NATIVE_HANDOFF_NOT_WIRED`. The PF46 `beginWrite` must be invoked before entering the original miner transaction; `finishMiningWrite` must complete with PF46's `finishWrite` and verify the exact original mining receipt inside the authoritative GameStore. **Never use a stub/mock as a release binding.**

**PF-42 mutual exclusion remains ON; Personal Fleet remains OFF.** Mining shutdown, haul transfer, startup, shift orders, station arrival, exploration and other discovered writers are not all fenced. This one patch does not give safe coexistence, nor does it unlock PLAY or main merge.

## Pinned original source (exact Git blob SHA)

- `Code/server/src/space/coopNativeMiningAtomic.js`: `c2b962d1e546c5ec8de8e9db1167a391d5344721`
- `Code/server/src/space/coopNativeCargoTransientIsolation.js`: `5118edd6d3e4e6f549e98e0eee9144140b04c4fb`
- `Code/server/src/space/coopGameStoreAtomic.js`: inspected original bridge uses `BEGIN IMMEDIATE` and `synchronous=FULL` (`2b28b48145f3fbc989ce7346384487ee75e52280`). Not modified by this patch.

## Safe Windows workflow (local WORK checkout only)

From the orchestration PR branch, after fetching latest files:

```powershell
.\Test-PF49-NativePatch.ps1 -ForkRoot 'C:\Games\EveCoop\upstream-evejs'
```

This preflight checks exact branch, tracked files clean, expected Git blob SHA, target addition absent, and `git apply --check` **without changing files**. It will refuse a drifted fork and avoid destructive rebases. If the read-only preflight passes, a human/agent can review the patch and apply it to a separate disposable WORK checkout; do not apply directly to PLAY.

Run isolated tests:

```powershell
node --test tests/pf49-native-mining-txn-guard.test.cjs tests/pf49-sqlite-durability.test.cjs
```

## Next P0 steps

1. Recover and inspect local PF-43, PF-44 and PF-45 source, bind verified PF44 `readLease` and PF46 `finishWrite` to the **original** native adapter. Instrument `beginWrite` before first ALIFE-07 side effect.
2. Expand full native writer coverage, including ALIFE-08 startup, hauling, dispatch, NPC life, station recovery and Exploration. Keep separate verified receipts for each writer and do not release lease while a single permit is pending.
3. Run actual pinned fork JS source syntax, native gated tests, SQLite process SIGKILL before/after BEGIN/COMMIT, restart reconciliation with same entityID/cargoID, and WORK gameplay with two authenticated clients. Save exact SHAs and logs.
4. Only after all writer coverage is established, reconsider PF-42 restriction and build real hiring/deployment/RETURN_TO_BASE capability.