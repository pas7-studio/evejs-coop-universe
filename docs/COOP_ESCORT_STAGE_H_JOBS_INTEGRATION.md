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

## COOP-053 — Source escort participation is mandatory, not just station camping

P0 code review found that the prior peaceful Escort fee checked both ships only at the warehouse terminal. A pilot could wait at the destination and collect half of the real corporate escrow without ever accompanying the real NPC's departure.

**Implemented as an additional default-OFF economic authority gate:**

- `integration/coopEscortDepartureWitness.cjs`: fsyncs an immutable server-owned original `manifestKey + contractID + NPC hauler + corporation + native NPC fleet + player fleet + two authentic character IDs + two real ship IDs` before the NPC can start its paid peaceful warp. Require both player ships within 150 km of the real source NPC, one unique online session per pilot, and the **actual native duo fleet/accepted quote**. No client-supplied payout or source witness. On crash replay, re-fsync the original immutable journal; corrupted, symlinked, hardlinked or unreadable records cannot authorize warp or payout.
- **Additional no-orphan preflight:** after reading real native paid acceptance but **before** `manifest.prepare`, compare each original signed character/ship with exactly one live session and physical source NPC position. An off-grid pilot now stops departure with **zero** persisted manifest, **zero** corporate escrow and **zero** NPC warp. The durable witness still independently verifies the same facts after manifest creation and before funding.
- `integration/coopNativeStationArrival.cjs`: when peaceful payout is enabled, insist on `EVEJS_COOP_ESCORT_DEPARTURE_WITNESS=1` and the Stage E witness provider **before any ISK debit**; invoke the trust gate before `fundBeforeWarp` and before durable warp intent/physical movement. Missing pilot => **0** corporate ISK debited and **0** NPC warps.
- `integration/coopEscortRuntime.cjs`: even direct internal calls to `fundBeforeWarp` must read and verify the original durable source witness under peaceful payout flag; the terminal `verifyService` demands it *plus* independent native fleet, valid original NPC, two authentic current player sessions and original 150 km terminal on-grid proof. Existing pirate/wreck settlement path remains unchanged if peaceful payout is OFF.
- `integration/coopEscortNativeBinding.cjs`: exposes a trusted source-witness writer only in native Stage E and with both peaceful/witness flags enabled; no chat API and no arbitrary wallet mutation.
- `scripts/patch-evejs-coop.cjs`: deploys the new module with the pinned reversible overlay. All new source witnesses are written to the server's original protected `root/escort-departure-witness` directory, not to the stock EVE mission journal.
- Test sources: `tests/coop-escort-departure-witness.test.mjs` (**15/15 source-executed V8 PASS**, including corrupted/symlink/hardlink and fsync), `tests/coop-escort-route-attendance-gate.test.mjs` (**9/9 V8 PASS**, direct wallet bypass blocked) and extended `tests/coop-escort-station-predeparture-gate.test.mjs` (**15/15 V8 PASS**, native station flow), all in `scripts/Run-NativeJob-Tests.ps1`.
- Three additional real-client scenarios `JOB-UI-16` through `JOB-UI-18` in `tests/scenarios/coop-049-native-agent-opportunities.json`: **NOT_RUN**.

**Limit:** This proves native on-grid departure AND terminal presence, not uninterrupted escorting through every warp leg. A future Stage I route-history journal should sample genuine transit/proximity and combat assistance before calculating contribution-weighted payout. Do not describe a two-point witness as continuous real-time supervision.

**Operational requirement:** `EVEJS_COOP_ESCORT_DEPARTURE_WITNESS=1` is required **in addition to** `EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT=1`. Both remain OFF until disposable native two-client + real GameStore wallet E2E. The new source witness **does not** permit a second funded trip on lost warp ACK, and no free ISK is created.

## COOP-054 — Stage I native route attendance (new, experimental)

The strict optional `EVEJS_COOP_ESCORT_ROUTE_WITNESS=1` adds two authoritative native position checkpoints between **verified source** and **verified warehouse terminal**. The original Stage H departure receipt includes physical NPC source coordinates. `coopNativeStationArrival.tick` invokes only a trusted Stage E sampler for the original active **FUNDED** flight and same authenticated two-player native fleet. The sampler records two immutable file+directory-fsynced positions at 20–45% and 55–85% of source-to-station distance, at least 500 ms apart, with both original player ships within **10 km** of the real NPC at each checkpoint. The independent original terminal/escrow check verifies *both* immutable receipts before peaceful payout. Default flag **OFF**; Stage H source and terminal attendance remain active and unchanged when it is OFF.

The midroute witness is **not continuous escort history**; tests must verify real native warp exposes both windows. With current possible ~250ms warp ingress, a tick-only observer might not see enough positions. Do **not** enable strict Stage I money gating in a live world until two-client local tracing confirms observable true intermediate native position samples. If insufficient, add a native movement projection hook rather than fabricate timing-based evidence. A real NPC can still deliver cargo while an ineligible escort is not paid.

- `integration/coopEscortRouteWitness.cjs` and runtime/binding/station adapters committed on PR #117; installer and Windows test runner registered.
- `tests/coop-escort-route-witness.test.mjs`: **20/20 source-executed V8 PASS** (AFK origin/destination, native duo/fleet, restart, wrong original ship, corruption, symlink/hardlink, lost fsync and strict OFF).
- `tests/coop-escort-route-attendance-gate.test.mjs`: **12/12 source-executed V8 PASS** (including Stage I strict gate).
- `tests/coop-escort-station-predeparture-gate.test.mjs`: **17/17 source-executed V8 PASS**, including real trusted station-tick observer dispatch.
- Full Node test suite, actual native two-client warp, GameStore SQLite and persistent wallet delta remain **NOT_RUN**. See `docs/COOP_ESCORT_STAGE_I_ROUTE_ATTENDANCE.md`.

## P0 gate before any financial rollout

- On operator-approved disposable EVEJS data clone run `scripts/Run-NativeJob-Tests.ps1 -CheckPinned` plus full original repo baseline.
- Physically test original NPC cargo in two separate actual EVE clients: real Agent EVEmail/Accept, signed quote, durable corporate debit, single physical warp after crash and restart, exact warehouse arrival, final settlement and two player wallet deltas.
- Inject crashes before/after warp journal fsync, delivery journal fsync and native two-credit commit; require one terminal GameStore status, with **no duplicate ISK, cargo, player reward or refunded corporation balance**.
- Do not enable simultaneously both recovery paths without tests. Verify a no-pirate peaceful delivery, a late verified pirate after an already-paid peace transaction, a late verified pirate with the peaceful flag OFF, and a destroyed hauler refunded only from an independently verified wreck.
- Preserve default-OFF flags `EVEJS_COOP_ESCORT_WARP_FENCE`, `EVEJS_COOP_ESCORT_SETTLEMENT_REPLAY`, `EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT` and all escrow authority toggles until live QA.
- Stage H #96 and Job Market #102 remain independently Draft. This integration branch is intended to be reviewed/reconciled before merging either into `main`.
