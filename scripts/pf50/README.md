# EveJS PF-50 — original native hauling ownership fence (candidate)

**INERT until manually reviewed, applied to a disposable WORK fork, and bound to actual native PF44/PF46 authorities.** Not deployed, not gameplay-ready. No CI, no PLAY changes.

**Source:** `pas7-studio/EveJS` `coop/pas7std` (`coopNativeHaulTransferAtomic.js` Git blob `da3f31e6b87663483b324fc0676c913ac9815f88`). PF-49 must be applied first in WORK source; its original Mining/Isolation changes remain a prerequisite.

## Included

- `native/coopPersonalFleetHaulTxnGuard.js` — pure read-only `corporationRuntime` ownership check in original atomic cargo transaction, covering miner + hauler, PF claims, WAR, active PF44 lease, active PF46 shutdown gate and specific `PENDING` haul-transfer permit.
- `patches/PF50-native-haul-writer.patch` — changes original `coopNativeHaulTransferAtomic.js`, registers `haul-transfer-pf` mixed-transient contract in `coopNativeCargoTransientIsolation.js`, creates native guard. Only exact `EVEJS_COOP_PERSONAL_FLEET_NATIVE_HAUL_WRITE_FENCE=1` enters new path. OFF follows stock path.
- `Test-PF50-NativePatch.ps1` — read-only branch/source/patch verification; **does not apply or deploy**.
- `tests/` — negative guard tests, SQLite `BEGIN IMMEDIATE` rollback/reopen, synthetically pinned patch smoke.

## Local test

```powershell
node --test .\tests\pf50-guard.test.cjs .\tests\pf50-sqlite.test.cjs
node .\tests\patch-smoke.cjs
.\Test-PF50-NativePatch.ps1 -ForkRoot 'C:\Games\EveCoop\upstream-evejs'
```

WARNING: `Test-PF50-NativePatch.ps1` preflight is intended only after PF-49 source patch has already been applied to the disposable WORK checkout; if it cannot verify the required baseline it rejects. Node tests in this package are not evidence of live engine or real two-player gameplay.

## Safety

The `beginHaulWrite` callback must reserve PF46 `PENDING` **before** the original native partial cargoID allocation. `assertHaulWriteAuthorized` must use that same GameStore's serializable SQLite transaction. `finishHaulWrite` may ACK **only after** original native cargo and receipt readback. Failed/unknown commits/ACK must never automatically retry cargo movement. An active PF42 exclusion must remain until *all* Mining, Hauling, Exploration and WAR writers have reciprocal ownership integration.

**Known blocker:** Original PF43/44/45 implementations and the exact PF46 callback wiring are absent from the accessible GitHub source. GitHub 403 prevents committing to the authoritative `pas7-studio/EveJS` repo. This patch does not invent lease source, allow gameplay, or release Mining ownership.