# LW-04B — Source-backed A-Life native manufacturing admission

Status: **admission implemented**; native live manufacturing **BLOCKED by design** until verified live GameStore/ItemStore/Rust binding adapters are developed, code reviewed and tested. The shipped `coopNpcNativeEconomyDirector` and `coopNpcIndustryNativeBindings` declare `supportsLiveRuntime:false` and are NOT implicitly upgraded.

## Changes

- The existing `observeAlifeEconomy()` single-flight read of the **same** 30-second world tick submits `decideNativeEconomy()` original `MANUFACTURE`, `COMPLETE_JOB`, `LIST_OUTPUT` intents to `coopAlifeNativeManufacturingRuntime`, only with explicit opt-in. No new interval, worker or virtual stock/wallet.
- Admission requires native source and decision timestamps/IDs, exact named NPC link, original owner/role/station/system, physical hull/controller and source station proximity, no player presence, warp or attack. The actor is rechecked by the existing `coopAlifeNativeEconomyAct` across awaits.
- One intent per owner+station per tick; max four stations per tick; original source actor and product types are checked. The original native director's station journal and SQLite locks remain solely authoritative. Unknown/replayed outcome cannot authorize a new transaction.
- Required flags: `EVEJS_COOP_ALIFE`, `EVEJS_COOP_ALIFE_ECONOMY`, `EVEJS_COOP_ALIFE_ECONOMY_AUTHORITY`, `EVEJS_COOP_ALIFE_ECONOMY_ACT`, `EVEJS_COOP_NATIVE_NPC_ECONOMY`, `EVEJS_COOP_NATIVE_ATOMIC_ROWS`, all `1`. Standalone `EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER=1` or legacy `EVEJS_COOP_NATIVE_NPC_MARKET=1` blocks dispatch to avoid parallel writers.
- Production has **no live director resolver** yet; even all flags set return `LIVE_NATIVE_MANUFACTURING_BINDINGS_NOT_AVAILABLE` without touching native inventory or ISK. Only an explicitly injected director with `mode:NATIVE_AUTHORITIES_ONLY`, `supportsLiveRuntime:true` and `tick` may be admitted. Current offline/manual director is rejected.
- The original native industry CJS helper imports now load after deployment as `.js` in the pinned source overlay, without enabling their native mutation.
- `alife-native-manufacturing-admission` probe records BLOCKED/evaluated decisions; it **never calls an admission decision a settled native sale**.

## Acceptance

Run `pwsh -File scripts/Run-LW04B-Manufacturing-Gates.ps1` against the full checkout. It runs five source tests, including the existing manual native director state machine and original ACT gates. An additional twelve native Node/SQLite/Rust + two-client scenarios in `tests/scenarios/lw04-native-manufacturing-e2e.json` remain `NOT_RUN`; no source smoke PASS is substitute.

No Docker or protected `evejs-data` mutations. Do not set financial flags as part of this PR.

## Next LW-04C dependencies

1. Design a real original native industry live binding for `createNativeIndustryBindings`, read/reconcile original GameStore transactions and ItemStore cache, prove one-writer SQLite WAL and on-disk crash state. Do not reuse offline-exclusive adapter on a running server.
2. Build an original Rust NPC sell-order adapter using the same source escrow, order, fill and wallet receipts; prove operationID idempotency across lost ACK.
3. Only after full native/2-client evidence, supply that verified adapter to `createRuntimeAlifeManufacturing`, activate explicit flags in a disposable environment and prove the twice-repeated mine → haul → refine → BPO → market → buy → ammo depletion loop.
