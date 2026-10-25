# P0 Escort: unified native paid acceptance and runtime

Draft: 2026-10-25. Operator game world, Docker, EVE clients, main and evejs-data unchanged.

## Purpose

This integration branch reconciles finance PR #86/#91 with the event and volunteer PR #81/#89/#92. The native station director has ONE route incorporating the real corporation escrow, prewarp in-game notifications and an explicit fixed-price two-player acceptance. There is no virtual ISK fallback.

## Gameplay flow

1. Real in-scene nontransient NPC cargo and hauler are discovered by the native station route. PREPARING /events is persisted with a stable identity based on the original native cargoID, not a retry timestamp.
2. The server-only native price bootstrap gets actual NPC corporation division-1000 available balance from the stock corpWalletState service. It checks original cargo and emits a durable fixed contract quote only if the operator configured a positive, even, bounded EVEJS_COOP_ESCORT_REWARD_ISK and the real NPC wallet has funds.
3. The two distinct real pilots each choose /events interest <id> and /events volunteer <id>. They must be in the same stock EVE fleet, both connected with real ships in the same system. This is voluntary interest, not spending permission.
4. Through /events info <id>, the pilots see the exact total native NPC quote and the split. Both explicitly run /events accept <id>. The server writes two separately fsynced per-character approvals binding the event, amount, source cargo and the actual native fleet, then a once-only dual-acceptance receipt. No money moves through chat.
5. Prewarp director requires BOTH volunteer and paid acceptance receipts, before preparing a source-derived departure manifest. The independent native runtime still cross-checks the price, source manifest, real EVE sessions, same native fleet, true NPC hauler and real NPC corporation. The quote expiration is checked before the FIRST actual corporate debit, never as a condition to auditing a completed flight.
6. Once native corporate GameStore/SQLite escrow is RESERVED, the actual native warpToPoint may be commanded. Lost ACK fences future attempts; no automatic rewarp or second debit. Event closure after warp is retryable without replaying ISK.
7. A full physical station arrival with ALL true cargo/itemStore warehouse receipts is required for DELIVERED. One authoritative native pirate wreck and actual two-player combat participation is required for the atomic dual native-wallet payout. Duplicate settlement is rejected.
8. An actual unique, zero-stock native hauler wreck in the authoritative outcome journal can constitute a refund loss witness. Missing/unknown wreck, ambiguous source, wrong target, already delivered stock and uncertain money outcomes deny automated corporate refunds. The independent Stage A REFUND_PREPARED journal is crash fenced.
9. Audited PAID / REFUNDED history may only be updated by independently verified native wallet/incident proof. A player chat response cannot invent earned ISK or reputation.

## Files

- integration/coopEscortPricedOffers.cjs: server quote, immutable price, two separate explicit player accepts, pair proof and restart-safe read.
- integration/coopEscortNativeBootstrap.cjs: real stock EveJS session/fleet/scene, native NPC warehouse and corporate wallet, source loss verifier. Lazy mount, default OFF.
- integration/coopEscortNativeMount.cjs: exact approved manifest and quote expiry before first corporate debit.
- integration/coopNativeStationArrival.cjs: reconciled physical prewarp events and native wallet route binding, both approval gates, confirmed warp and honest delivery+settlement status.
- integration/coopWorldOpportunityBoard.cjs: existing native event/EVEmail/volunteer/history, plus /events accept and exact price display.
- scripts/patch-evejs-coop.cjs: union of source module names and the reversible native /events /alerts hook; no fork/upstream source distributed.
- tests/coop-escort-native-priced-acceptance.test.mjs, tests/coop-escort-native-bootstrap-failure.test.mjs and updated station/native-mount tests.

## Actual tests performed this session

- 12/12 isolated V8 tests on actual priced-offer source: genuine offer, two price acceptances, restart replay, source identity, expired new reservation, default OFF.
- 9/9 isolated V8 checks on the reconciled real station source: no voluntary crew, voluntary-only, both accepted, one manifest, one corporate reserve and one physical warp.
- 6/6 V8 source checks for the true native hauler wreck/refund precondition.
- 13/13 latest modified integration/installer/test source files parse.
- PR #91 previously showed 12/12 isolated native binding and 6/6 native provider checks; PR #92 10/10 board source checks plus 8/8 station checks. These are isolated source checks, NOT live gameplay.
- 11 new official priced-acceptance tests plus 6 genuine-wreck tests and revised station/native-mount tests committed, but the full official Node 22 runner and pinned better-sqlite3 worker have NOT RUN here.

## Critical remaining blockers BEFORE any paid gameplay release

- Confirm real pinned GameStore/SQLite worker and crash recovery on approved disposable backup data. Never delete or reset evejs-data.
- Make settlement order-independent: when the real pirate is killed AFTER physical delivery, schedule a trusted second settlement attempt without repeated money debits.
- Persist and reconcile unknown native warp ACK across process restart. The current in-process fence cannot by itself prove a warp did or did not occur after reboot.
- Preserve durable historical warehouse provenance for reputation after native manufacturing consumes or moves stock.
- Full real two-EVE-client acceptance with actual NPC combat, alerts, fleet, cargo, both actual character wallets and NPC corporation wallet before/after.
- Execute pinned reversible installer --check, --dry-run and byte-identical remove/reapply; no remote CI, no upstream hand edits.
- Review the concurrent PR stacks and keep all new feature flags OFF. No claims of gameplay PASS from source-shaped unit checks.

## Optional configuration (DO NOT turn on in the populated world yet)

EVEJS_COOP_OPPORTUNITY_BOARD=1
EVEJS_COOP_OPPORTUNITY_MAIL=1
EVEJS_COOP_EVENT_VOLUNTEERS=1
EVEJS_COOP_ESCORT_PAID_ACCEPT=1
EVEJS_COOP_ESCORT_REWARD_ISK=20000
EVEJS_COOP_ESCORT_RUNTIME_MOUNT=1
EVEJS_COOP_NATIVE_HAUL_MANIFEST=1
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_NATIVE_ESCORT_WALLET=1
EVEJS_COOP_ESCORT_CONTRACTS=1
EVEJS_COOP_ESCORT_ROUTE_GATE=1
EVEJS_COOP_ESCORT_REFUNDS=1 (only after full loss proof acceptance)
EVEJS_COOP_ESCORT_REPUTATION=1

The amount is an operator-set reward policy funded by the existing native NPC corporation wallet, not a free money mint.
