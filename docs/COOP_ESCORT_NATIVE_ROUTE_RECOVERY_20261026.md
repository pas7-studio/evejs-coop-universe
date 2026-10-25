# COOP-056 — Read-only native Escort ingress recovery

**Status:** implemented behind a separate default-OFF flag; source-executed regression checks PASS; 2 real EVE clients, actual server restart, native SQLite wallet and original pinned deployment **NOT_RUN**. Date: 2026-10-26. Follow-up to merged PR #129 (Stage I), without retroactively changing live `evejs-data`.

## P0 problem

Stage I registers the original NPC convoy inside an in-memory `activeNativeEscortWarps` map only after durable real `WARP_ACK_CONFIRMED`. A process restart clears that registry even if a real `sessionlessWarpIngress` is subsequently restored by the original EveJS scene. Strict route attendance cannot simply resume from an arbitrary ship ID, and a second warp or corporate escrow reservation would duplicate side effects.

## Default-OFF solution

With `EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY=1`, a native movement callback for an *unregistered* real NPC may attempt **read-only** reattachment, but only when the original ship already has a genuine current `sessionlessWarpIngress` (duration 6–30s; observed scene time within original ingress). It verifies ALL of:

- Same real scene object and still-durable nontransient NPC item ID, system and original stock cargo, positive cargo quantity, one original mining fleet, unique native cargo IDs, no extra module rows.
- Original protected `escort-native-warp-fence` source scan returns the exact same cargo/hauler/fleet, a matching original `WARP_ACK_CONFIRMED`, then independently reads the original full fence booking.
- The original `escort-flight-gate` manifest has phase `FUNDED`, the same contract/corporation/station/NPC/fleet IDs and, critically, the original wallet is **currently** `NATIVE_PREFUNDED_BOOKING_VERIFIED` (the corporation escrow is still real `RESERVED`, not already settled or refunded).
- The original durable source on-grid two-player receipt has its file AND directory re-fsynced and reread, and matches original contract and characters. A lost ACK, corrupt receipt or altered original source cannot be substituted.
- The currently observed native ingress source vector matches that receipt's real NPC departure coordinates (<=1m), the genuine native warp destination equals the original canonical station + the existing 750m landing offset (<=1m), and the original ingress has not finished.
- After reattachment, every genuine physics callback must still contain **the identical ingress object and original native NPC**, unchanged canonical station, valid durable native hauler, same ingress origin/destination, and active original time window. Each Stage I checkpoint independently rechecks real native fleet, real participating player ships and current reserved wallet.

On failure return an explicit reason and produce **zero** additional warp commands, escrow reservations, contract creations, fake waypoint samples or player payouts. The recovered registry is an *observer handle only*; it does not reconstruct station delivery or dispatch a new NPC order.

## Flags / rollback

`EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY=1`: new, **OFF by default**. It has an effect only when the existing strict Stage I features `EVEJS_COOP_ESCORT_NATIVE_WARP_OBSERVER=1`, `EVEJS_COOP_ESCORT_ROUTE_WITNESS=1`, `EVEJS_COOP_ESCORT_DEPARTURE_WITNESS=1`, paid peaceful Escort and all original native wallet/manifest/warp authority flags are enabled. Turn the new flag back OFF for immediate rollback; it never creates writes beyond the original witness file/directory fsync required to establish durable evidence. No changes to current `main` until PR merge.

## Regression evidence

- `tests/coop-escort-native-route-recovery.test.mjs`: **20/20 source-executed V8 PASS**, including genuine reattachment, unchanged native object+ingress, valid WARP_ACK and source, lost ACK, spent flight, origin/target mismatch, foreign/duplicate cargo, wrong fleet, malformed source coordinates, transient NPC and proof-disabled behavior.
- `tests/coop-escort-departure-witness.test.mjs`: **18/18 V8 PASS** including new durable post-crash receipt fsync+re-read and corruption.
- `tests/coop-escort-route-attendance-gate.test.mjs`: **17/17 V8 PASS**, including the crucial independent live corporate escrow reservation check before a new checkpoint or recovered source may be trusted.
- `tests/coop-escort-stage-i-predeparture.test.mjs`: baseline original source stage tests; full original Node suite and actual native clients **NOT_RUN**.
- Windows runner: `./scripts/Run-NativeJob-Tests.ps1 -CheckPinned`, using original pinned EveJS Code checkout; scenario JSON `tests/scenarios/coop-049-native-agent-opportunities.json` now includes JOB-UI-27–29 (all **NOT_RUN**).

## Known blocker / no-go

The original `sessionlessWarpIngress` may NOT be persisted across a process restart by stock EveJS; the server restart can also take longer than the 6–30 second ingress. **This mechanism intentionally DOES NOT fabricate or rewind that missing physical history.** If the stock engine cannot restore the original ingress, this feature cannot recover midroute evidence and will fail closed. The correct follow-up is a validated native persistence or explicit operator cancellation/refund workflow based on genuinely provable terminal failure, NOT a time-based or client-provided waypoint. Do not enable paid strict recovery in a live economy until a true two-client process restart and wallet-delta E2E proves this distinction.
