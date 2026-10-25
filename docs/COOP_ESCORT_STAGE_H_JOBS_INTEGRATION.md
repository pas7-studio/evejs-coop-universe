# COOP-051 — Stage H + Native NPC Job Market integration

Date: 2026-10-25. **Draft source integration; no real two-client/SQLite/Docker execution.** This branch is based on `feat/native-npc-job-market-v1-20261025` (PR #102) and ports the independent Stage H safety fixes from Draft PR #96 without changing main.

## Authoritative source chain

1. Real native NPC hauler has actual ore cargo, destination station, approved NPC corporate quote and **two independently signed real player participants**. The existing native Agent UI and EVEmail in PR #102 only collect discoverable interest/consent; no money or stock EVE mission is fabricated.
2. `coopEscortFlightGate.fundBeforeWarp` writes first durable native corporate escrow under the original manifest/contract. `coopEscortWarpFence.prepare` fsyncs an immutable `WARP_PREPARED` before the stock `warpToPoint` call; missing/unknown ACK blocks repeats, and true warp ACK is separately persisted with `confirm`.
3. Actual full cargo lands in the native station warehouse. `recordDelivered` is idempotent for **exact original terminal trip + full cargo** on lost fsync ACK; altered cargo or station is rejected. An independent durable delivery journal lists bounded `DELIVERED` flights without inventing events.
4. When `EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT=1`, only the original two native fleet participants who are physically present near the source hauler at terminal can receive the reserved corporate base wage, even with **zero pirate incidents**. This fee comes from the original native GameStore escrow and is exactly-once. This opt-in **does not** create a raid bonus.
5. With peaceful flag OFF the existing native verified pirate-wreck settlement still works. Stage H's `EVEJS_COOP_ESCORT_SETTLEMENT_REPLAY=1` rechecks durable delivered flights after a native late pirate event or startup. Before using any wallet transaction, it reads both native SETTLED and REFUNDED receipts; prior genuine payout returns `ALREADY_NATIVE_SETTLED` instead of crediting again. A peaceful delivery already paid before a late pirate incident must not pay twice.
6. The original `coopEscortNativeMount` participant cache remains an optimization only; after restart the verified native manifest, persisted signed quote and live real fleet are independently rechecked. No client-supplied contract or recipient list is authoritative.

## Concrete source changes

- Ported from Stage H PR #96: `coopEscortWarpFence.cjs`, `coopEscortFlightGate.cjs` delivery replay/scan, `coopEscortNativeBootstrap.cjs` bounded startup reconciliation, `coopConvoyOperations.cjs` real native late-pirate trigger, and original H regression suites.
- Combined overlapping `coopEscortNativeBinding.cjs`: preserves `settlePeacefulDelivery(manifestKey,scene)` from PR #102 and adds Stage H `reconcilePendingDeliveries` with durable wallet paid/refund preflight, including **no double pay after peaceful delivery**.
- Combined `coopNativeStationArrival.cjs`: retains H durable warp-before-physical-start proof while dispatching to optional PR #102 peaceful payout only after true warehouse delivery. No false terminal success on an unconfirmed physical warp.
- Combined `coopEscortRuntime.cjs`: retains original new `verifyService` and `settlePeacefulFlight` while adding the existing H file-journal enumeration behind `EVEJS_COOP_ESCORT_SETTLEMENT_REPLAY`.
- Existing reversible installer now registers `coopEscortWarpFence` as well as PR #102 Agent, notifications, selection, job board and peaceful payout. Stage H's additional suites added to `scripts/Run-NativeJob-Tests.ps1`.

## Code review/regression evidence

- Unified native binding: **16/16 V8 source-executed regression cases PASS**, including new explicit tests that a late pirate event after a successful peaceful payment returns `ALREADY_NATIVE_SETTLED` and the player wallet is not incremented again, and that peaceful payout remains default OFF.
- Existing restarted native participant recovery: **9/9 V8 source-executed cases PASS**.
- Existing persisted quote / missed EVEmail: **5/5 V8 source-executed cases PASS**.
- All **12 changed JavaScript files syntax PASS** in V8 (includes tests with imports stripped for syntax checking).
- Exact pinned upstream `agentMgrService.js` reversible agent patch (both previous and new hooks) after Stage H integration: patched classification, repeated install identical, **byte-exact restoration** verified.
- Full Node runner of newly imported Stage H tests, actual warp ACK in the physical native runtime, native GameStore better-sqlite3 transaction/credit, dual EVE client Agent dialogue, startup/terminal crash injection **NOT RUN**. No GitHub Actions; no populated `evejs-data` touched.

## Additional code review — native Agent consent idempotence

The original `coopWorldOpportunityBoard.interest` used one ambiguous status `ALREADY_INTERESTED_OR_WRITE_UNCERTAIN` for both a genuine existing actor signature and a lost file/directory fsync ACK. `coopNativeJobAgent` incorrectly accepted this ambiguous value and proceeded to volunteer/paid consent.

**Fixed:** If creating the interest receipt fails, the board re-reads the exact authenticated `characterID + eventID` receipt, requires the original `INTEREST_RECORDED` identity, and synchronizes both the original receipt **file** and its **parent directory** before returning `INTEREST_ALREADY_DURABLY_RECORDED`. Anything malformed, missing or unsyncable returns `INTEREST_WRITE_UNCERTAIN_NEEDS_REPAIR` and cannot proceed. The stock Agent Accept handler allows `INTEREST_RECORDED` or this specifically verified replay; the old ambiguous status is never considered valid.

- `tests/coop-native-job-agent-interest-replay.test.mjs`: 5 explicit source-executed V8 checks PASS (first/duplicate, fsync lost, mismatched actor, valid agent retry, uncertain retry fail closed).
- Existing `tests/coop-native-job-agent.test.mjs`: 21/21 source-executed V8 PASS after new status gate.
- The real file-based Node versions of these tests and the full native two-client game tests still need local execution.

## P0 gate before any financial rollout

- On operator-approved disposable EVEJS data clone run `scripts/Run-NativeJob-Tests.ps1 -CheckPinned` plus full original repo baseline.
- Physically test original NPC cargo in two separate actual EVE clients: real Agent EVEmail/Accept, signed quote, durable corporate debit, single physical warp after crash and restart, exact warehouse arrival, final settlement and two player wallet deltas.
- Inject crashes before/after warp journal fsync, delivery journal fsync and native two-credit commit; require one terminal GameStore status, with **no duplicate ISK, cargo, player reward or refunded corporation balance**.
- Do not enable simultaneously both recovery paths without tests. Verify a no-pirate peaceful delivery, a late verified pirate after an already-paid peace transaction, a late verified pirate with the peaceful flag OFF, and a destroyed hauler refunded only from an independently verified wreck.
- Preserve default-OFF flags `EVEJS_COOP_ESCORT_WARP_FENCE`, `EVEJS_COOP_ESCORT_SETTLEMENT_REPLAY`, `EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT` and all escrow authority toggles until live QA.
- Stage H #96 and Job Market #102 remain independently Draft. This integration branch is intended to be reviewed/reconciled before merging either into `main`.
