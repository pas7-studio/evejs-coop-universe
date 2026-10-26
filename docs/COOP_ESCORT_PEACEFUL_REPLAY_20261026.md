# COOP-059 — Close pending peaceful Escort payment, exactly once

**Implementation status:** complete for pre-E2E code work; feature flag **OFF** by default. Date: 2026-10-26. Actual pinned EveJS Windows/Docker two-client GameStore E2E **NOT_RUN**.

## The final missing payout path

The original peaceful payout already uses `nativeFunds.settleAtomic` to consume **one genuine RESERVED corporate escrow** and issue exactly two original-character native wallet credits in a durable atomic transaction. Its previous `verifyService` required the two real players to remain connected and physically near the original NPC at the time the wallet call was attempted. If server crashed between actual native warehouse delivery and payout ACK, the original `DELIVERED` flight was durable but the live scene/pilots might be gone. Replaying the wallet credit without attendance evidence would be unsafe; refusing it permanently strands original reserved ISK.

## What COOP-059 implements

1. `integration/coopEscortTerminalAttendance.cjs`: **server-owned immutable original station duo receipt**. It can be written only by the trusted native station code AFTER actual native full-manifest warehouse proof and BEFORE final flight delivery receipt. Checks original native real stock station, actual original NPC, the *same* two character IDs and original player ship IDs from fsynced source departure, both original mid-route checkpoints, the same original native player fleet authorization, exactly one genuine current session per original character, and real on-grid positions <=150km from both original NPC and stock station. Records original source timestamp, both route checkpoint timestamps, native cargo IDs, ship positions and exact original contract, fleet, corporation, station and wage. Exclusive-create (wx), file+directory fsync, no overwrites, hardlink/symlink/corruption detection and original-file re-fsync on replay. It performs NO native wallet operation and cannot invent player presence after completion.
2. `integration/coopNativeStationArrival.cjs` invokes `recordTerminalAttendance` after all original native cargo have been physically deposited and a real full-manifest warehouse proof exists, but before `recordDelivered`. Failed/absent pilot proof cannot block native cargo delivery or generate a synthetic entitlement. `terminalAttendanceStatus` is included in original terminal diagnostics.
3. `integration/coopEscortRuntime.cjs`: when `EVEJS_COOP_ESCORT_PEACEFUL_REPLAY=1` and strict Stage I route flag is ON, **BOTH initial payout AND replay** require the SAME verified immutable source departure + two original midroute checkpoints + terminal two-pilot attendance receipt. Payout still separately checks original `DELIVERED` flight, original warehouse custody, active original **RESERVED** corporate escrow and an exact original dual-credit `GameStore` result. Live on-grid sessions cannot bypass a lost terminal fsync receipt.
4. Native `reconcilePeacefulDeliveries` enumerates **only fsynced original DELIVERED flight journals**, at most 32 in one scan. It never accepts a player-supplied contract, client command, ad-hoc terminal signature or predicted route. It calls the same original guarded `peaceful.settle` with no synthetic scene. After an unknown atomic wallet ACK, the underlying authority reads durable `verifySettlement` and returns `ALREADY_NATIVE_PAID`, never crediting the two wallets again. Paid receipts must include correct original 2 credits, company/contract identity, exact amount and `escrowConsumed`. Missing proof => pending/unpaid; refunded/spent escrow => blocked; no automatic refund or fake warehouse.
5. `coopEscortNativeBinding` exposes this only through the trusted server-authority install and `coopEscortNativeBootstrap` performs an opt-in one-time scan after native GameStore and full flight/escrow readers are available. No public RPC, mission chat grant or client control is introduced.
6. Pinned installer and Windows runner include the new module/tests. `EVEJS_COOP_ESCORT_PEACEFUL_REPLAY=1` is **OFF by default** and requires the existing real native atomic wallet, paid Escort, genuine source+route attendance and warehouse gates.

## Regresions completed in isolated JavaScript source execution

- `tests/coop-escort-terminal-attendance.test.mjs` — **16/16 PASS**: two original ships, true stock station, disconnect-after-proof, wrong/duplicate pilot sessions, AFK distance, contract/source/route/warehouse tampering, failed fsync, corrupt or hardlinked journal, immutable replay, flag OFF.
- `tests/coop-escort-peaceful-durable-replay.test.mjs` — **13/13 PASS**: offline after original delivery, one dual-wallet credit, two safe restarts, lost atomic ACK, already-paid original wallet, absent terminal/source/route, spent original escrow, not-delivered flight, source-only flight scanner, strict no-bypass live scene, invalid scanning options, flag OFF.
- `tests/coop-escort-route-attendance-gate.test.mjs` — **17/17 PASS** after updating existing mocked module wiring.
- `tests/coop-escort-stage-i-predeparture.test.mjs` — **24/24 PASS**. These are isolated source executions using controlled services/FS, **NOT** the original actual Node and GameStore execution.
- Local full pinned Node suite and two-client physical native E2E **NOT_RUN**. Run `./scripts/Run-NativeJob-Tests.ps1 -CheckPinned` from original Windows checkout. `tests/scenarios/coop-049-native-agent-opportunities.json` now contains four more genuine-client scenarios JOB-UI-38 to -41, all **NOT_RUN**.

## Remaining operational rule — NOT a missing implementation

If the original two pilots **were not actually present at terminal delivery**, or if their terminal proof was lost/corrupt, the server must not infer that they performed the service. It leaves the original corporate reserve pending for authenticated operator repair with external authoritative evidence, not a fraudulent automated payout. This is intentionally fail-closed and not a reason to create more gameplay code before the next local test.

**Go/no-go:** Do NOT turn the new flag ON for live `evejs-data` until pinned install/uninstall QA, real two-client on-grid route, crash after warehouse before payout, native GameStore corporation and both character balance comparison, lost-ACK replay and corrupt-proof denial succeed. Main remains untouched until PR review/merge.


## COOP-059 P0 QA follow-up — bounded backlog paging (2026-10-26)

Source audit found that the original `listDelivered({maxTrips:32})` rejected a
valid 33rd completed flight with `FLIGHT_SCAN_RESULT_CAP_EXCEEDED`; the one-time
bootstrap then never reached any previously unpaid flight in that backlog.

The follow-up adds a strict, lexicographic `afterKey` **server-internal**
cursor for immutable native journal filenames, preserving the 32-trip payment
batch. **Every file is still inspected and replay-validated before a single
page is returned.** A corrupt, missing or symlinked original journal refuses
the entire candidate page; invalid cursors refuse all payouts. Bootstrap
repeats up to 16 pages (512 disk journal cap). No wallet, cargo, route or
client-facing path is modified; all feature flags stay OFF by default.

Regression additions: 35 real fsynced source flight journals, no skipped or
duplicated page IDs, an invalid cursor, a corrupt 35th journal poisoning the
first page, and a pure-runtime next-page/no-second-payment test. GitHub CI now
runs these and original SQLite funds/terminal attendance tests on Node 22.

**Still NOT_RUN** here: actual CI result, pinned Windows overlay check, and
the two-authenticated-client live GameStore/SQLite crash E2E. Review source,
obtain green CI, then run those physical acceptance gates on disposable data
before enabling Escort payments.
