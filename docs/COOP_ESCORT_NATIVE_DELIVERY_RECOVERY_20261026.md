# COOP-058 — Recover the original native Escort terminal trip after restart

**Status:** experimental/default OFF; **source-implemented on a branch based on `main`**, not live-deployed. Date: 2026-10-26.

## Verified defect in merged COOP-057

EveJS can recover the original NPC's `sessionlessWarpIngress` from COOP-057's durable physical snapshot, but `fleet.coopStationArrival` is an in-process structure that disappears when the process exits. Before COOP-058, `checkReturn` could respond `NO_ACTIVE_TRIP`, or choose the predeparture retry path, instead of delivering the same original native cargo at the source-verified destination.

Reconstructing a route from a client instruction, elapsed time or a new cargo manifest would duplicate side effects. This patch does **not** create a new NPC job, cargo, warp or ISK reservation.

## Exact fail-closed recovery

`EVEJS_COOP_ESCORT_NATIVE_DELIVERY_RECOVERY=1` (OFF by default) enables an additional check **before** the predeparture retry branch. It only considers a native NPC already in a real server-side `sessionlessWarpIngress`, when the fleet has exactly one original durable hauler and no active arrival trip or ambiguous warp ACK. `createStationArrival.resumeNativeDelivery(scene,fleet,now)` independently proves:

1. All original strict paid Escort, original-native-motion recovery, and immutable ingress snapshot authorities are enabled.
2. Actual native scene, durable NPC entity object, real in-progress original physical warp, original fleet/hauler, system and original booking all match.
3. Original source cargo are positive and unique, all from the same real fleet, and match the `coopEscortWarpFence` **`WARP_ACK_CONFIRMED`** source and original native flight. Original funded-flight and the original departure two-player receipt are rechecked through the existing trusted `recoverNativeMotion` path, including the current **native corporate wallet still RESERVED** gate.
4. A separately fsynced and reread immutable original ingress snapshot matches contract, corporation, station, exact cargo IDs, source/target coordinates, original `startTimeMs`, `travelCompleteAtMs`, and `completeAtMs`. Ingress must still be physically active; no expired trip may be projected forward from a guessed timer.
5. Only after those checks, an in-memory pointer to `coopStationArrival` is reconstructed with **the original** cargo IDs, manifest key, fleet, station, NPC, and original start timestamp; the trusted existing `tick` continues physical arrival, dwell, original warehouse debits, full native manifest verification and original settlement process. A stale `coopStationNoCargo` hint is cleared **only after** original native cargo was independently proven.

The reconstructed pointer is **not a source of custody or payment authority**. Cargo ownership still transfers only via the real original native warehouse and original manifest verification. No new `warpToPoint`, `fundBeforeWarp`, `manifest.prepare`, bank reservation or generated checkpoints are called.

## Stock scheduler verification

Original pinned `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` `npcSceneActivity.getSceneActivityState` was source-executed with actual `sessionlessWarpIngress.completeAtMs`. Without connected sessions, a cold scene sleeps until the original completion deadline, then wakes: `sleep-until-deadline` → `deadline-due`. With two EVE player sessions, the original scene stays active: `sessions-present`. **No scheduler patch was added**; a duplicate scheduler could double-wake NPCs. No-player cold sleep means intermediate escort attendance might not be visible; this never entitles either pilot to payment.

## Regressions

- `tests/coop-escort-native-route-recovery.test.mjs`: **43/43 isolated V8 source-executed PASS**, including 14 new resume/warehouse tests: original cargo, stale A-Life hint, true native arrival, dwell, warehouse, manifest proof, one simulated terminal settlement, rejected source, wrong fleet, expired warp, corrupted snapshot and fail-closed default OFF.
- `tests/coop-escort-stage-i-predeparture.test.mjs`: **24/24 isolated V8 PASS**; native predeparture and original warp fences remain in effect.
- `tests/coop-escort-native-cold-scene-wake.test.mjs`: three pinned-source-only Node tests added to the local runner. Independently source-executed original pinned EveJS helper: original no-player completion deadline and two-session activity PASS. With no local pinned Code checkout the local test file **skips** instead of claiming a stock runtime PASS.
- Run on original Windows checkout: `./scripts/Run-NativeJob-Tests.ps1 -CheckPinned`.
- `tests/scenarios/coop-049-native-agent-opportunities.json`: JOB-UI-34..37 added; **37** actual two-client E2E scenarios, **NOT_RUN**.

## Unresolved release gates

- Full real two-EVE-client Docker crash+restart, an unchanged original native ingress restored within 6–30s, a real original cargo warehouse delivery, and atomic native GameStore corporate/character wallet deltas are still **NOT_RUN**.
- A crash after actual stock ingress already expired is not recoverable through this path; do not backdate, rewind, teleport or fabricate a second checkpoint.
- A fully committed native cargo delivery **without settlement** can leave a real reserved corporate escrow pending if the two pilots were absent or terminal service proof was not available. This patch does not fabricate successful payout or issue an unproven refund. A separate, original-full-manifest-and-player-presence-verified **peaceful settlement replay** is needed; the existing raid reconciliation is not a substitute.
- Do not enable on live `evejs-data` until source checkout/pinned patch uninstall, full `node --test`, two real clients, original inventory custody and complete wallet ledger E2E pass. Keep the PR as Draft until then.
