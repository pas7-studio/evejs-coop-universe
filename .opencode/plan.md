# NPC courier dispatch ג€” working plan (COOP-024)

Design: `docs/NPC_COURIER_CONTRACTS.md`. Status: phase 1 only (pure core).

## Done
- `integration/coopCourierDispatch.cjs` ג€” evaluateContract / selectHull /
  planRoute / piracyOpportunity, no mutation.
- `tests/coop-courier-dispatch.test.mjs` ג€” 11 passing cases.
- ROADMAP COOP-024 (PARTIAL), design doc.

## Next (needs owner go/no-go because it mutates state)
1. Read-only discovery pass: log what the live server sees for the owner's
   real contract (`REFUSED_*` / `NEEDS_GATE_TRAVEL` / `ELIGIBLE`), no writes.
   Cheapest proof that the record shape assumptions are right.
2. Session-less native accept adapter: mirror `acceptCourier` with explicit
   owner/wallet refs, only for a durable registered NPC, halt + journal on any
   ambiguous result.
3. Same-system flight: undock, warp, dock, `completeCourierContract` with the
   NPC as acceptor.
4. Only then: gate travel, then piracy with a real native attack order.

## Open questions for the owner
- Which hull counts as "large" for him: Bestower-class industrial (~4.8k m3)
  or a freighter (~435k m3)? Freighter is a much slower target and a bigger
  loss when interdicted.
- Collateral: does he want NPC couriers to accept collateral-bearing
  contracts (NPC must hold real ISK) or reward-only?
- Is a destroyed courier allowed to lose the package permanently (native
  failure) or must the package always survive?

## 2026-10-26 handoff (context limit reached)

Done and committed: dispatch core, identity gate, settlement chain, session-less
accept/complete bridge, flight state machine, 7 seeded courier characters
(140000100-140000106, Charon in Jita with 465000 m3).

Next, in a fresh session:
1. Live experiment: spawn a native NPC ship with
   `ownerIDOverride = 140000100` via nativeNpcService, warp it to 60015262,
   dock through the NPC arrival path, and check the package item follows.
2. Only if that passes: wire the driver, enable EVEJS_COOP_COURIER_DISPATCH for
   one contract (the owner's 980000000), watch accept -> fly -> complete.
3. Keep the concurrency cap at 3 and every env gate OFF by default.

## 2026-10-26 (owner said "דמעמגטי") - the last piece, precisely

The modules are ready and tested (49 tests) but the server never calls them.
Nothing has been flown, and no contract has been touched.

Hook point identified: `integration/coopVirtualWorldRuntime.cjs`, inside
`start()` there is `timer=setInterval(() => { ... safeNpcPhase("virtual-travel",
...) ... })`. A courier phase belongs there, wrapped in `safeNpcPhase` and gated
by `EVEJS_COOP_COURIER_DISPATCH === "1"` (default OFF).

What that phase must do, in order, with no shortcuts:
1. `contractRuntimeState.listContractRecords()` -> outstanding courier contracts
   (`type === 3`, `status === 0`, `acceptorID === 0`).
2. Pick an idle seeded courier (140000100-140000106) whose character station and
   hangar ship match the contract origin; refuse otherwise.
3. `coopCourierNativeAccept.accept(...)` with the live runtime; on AMBIGUOUS stop
   and journal, never retry.
4. Drive `coopCourierFlight` + `coopCourierFlightDriver` one step per tick
   (undock -> warp -> arrive -> dock), cap 3 concurrent.
5. `coopCourierNativeAccept.complete(...)` only when the package is at the
   destination.

Verification for each step: telemetry events plus the client's contract window.
Until that exists, the honest status is: implemented, never flown.
