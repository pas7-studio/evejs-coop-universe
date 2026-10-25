# COOP-024B/D — Persisted NPC intentions that issue real native scouting orders

**2026-10-25; status: IMPLEMENTED_UNVERIFIED.** This is an incremental, opt-in NPC-on-NPC gameplay change stacked upon draft [PR #32](https://github.com/pas7-studio/evejs-coop-universe/pull/32) (native opportunity planner) and draft [PR #36](https://github.com/pas7-studio/evejs-coop-universe/pull/36) (shared command arbiter). The broader [COOP-024 design PR #29](https://github.com/pas7-studio/evejs-coop-universe/pull/29) remains the scope authority.

## Player-visible intent, not scripted profit

A genuine **named pirate NPC** with a live native EveJS ship now selects one *physical noncombat activity* when no profitable/authorized raid is underway:

- `SCOUT_GATE` -> navigate to real native stargate(s) first, then actual asteroid belts or stations.
- `WATCH_BELT` -> navigate to real asteroid belts first and observe likely traffic; gate(s) are fallback.
- `LAY_LOW` -> navigate only towards an existing real station. **Not** a repair, dock, heal, market trade, disappearance or invulnerability.
- `HUNT` -> only after an existing native raid director has **actually issued a successful native warp/attack** or has an active documented native raid lease. It does not issue extra combat orders.

`coopNpcPersonalGoals.cjs` persists per-pilot intent, reason, last change, cooldown (120 seconds), system and number of successfully observed native noncombat orders, using a bounded, versioned, atomic-rename+fsync JSON journal; incompatible saves are rejected rather than overwritten. A stable pilot ID influences a slight personal scouting preference, **without rolling random spawns**. A dangerous/rejected raid may override the current intention; normal reevaluation is hysteretic, so the 30-second world tick does not cause rapid oscillation.

The goal engine **does not invent ISK, corporate membership, standing, ship fitting, cargo, scan results, repair, or off-grid target locations**. Persisted `SCOUT_GATE`/ `WATCH_BELT` is an intended destination, not proof of arrival. Only successful synchronous native warp/orbit commands from the existing civilian director increment the goal's `nativeOrdersObserved`; completed movement still requires client/live physics evidence.

## Native integration

- `coopVirtualWorldRuntime.cjs` enables personal intentions only with `EVEJS_COOP_NPC_PERSONAL_GOALS=1` **AND** `EVEJS_COOP_NPC_CAPSULEER_AGENCY=1`; both are OFF by default. Existing `EVEJS_COOP_NPC_RAIDS`, materialization, physical scene and stock mining fleet prerequisites still apply.
- In `advanceNativeRaids`, existing `isAuthorizedStockMiningRaid` + source-bounded `coopNpcHuntPolicy` determine eligible opportunities. The world collects per-pirate outcomes; after the real native raid result, it updates `HUNT`, `WATCH_BELT`, `SCOUT_GATE` or `LAY_LOW`. Invalid persisted goals fail **before** native raid issuing.
- In `advanceNativeCivilianOrders`, only correctly linked physical `nativeNpc === true` pirates receive the `routeOverrides` for noncombat intentions. The pirate's actual *economy role remains pirate*; neither target legitimacy nor market/wallet behavior is overwritten.
- `coopCivilianOrders.cjs` takes a small optional `options.routeOverrides[pilotID]`. Its waypoints are from `coopNpcTopology.waypoints(scene)`, which reads the real native scene static entities. Explicit type ordering fixes the old sorting trap: watching an asteroid belt actually prioritizes a belt rather than a stargate.
- `coopNpcOrderArbiter` from PR #36 still owns the actual native warp/attack command path when enabled; ongoing raid/tactics/gate leases block conflicting civilian routes. No new native hook, no invented ship movement.
- `living-npc-personal-goal` read-only telemetry reports the first/changed plan; the actual native route success remains evidenced by existing civilian route output and the persisted `lastNativeOrder`. Neither is weapon damage proof.

## Initial acceptance and test evidence

- **10/10 isolated tests PASS** for durable personal intentions: per-pilot preference, restart, assessment fallback, danger override, unconfirmed attack denial, cooldown, actual accepted order ledger, data corruption and pilot cap.
- **6/6 isolated route tests PASS**: native waypoint target for scout/watch/station-only, legacy role preserved, role switch resets route, no fictional station, failed warp not counted and native warp/position safety. These use an isolated mock native scene and real warp/orbit callback surfaces.
- **16/16 total isolated tests passed** on Node.js 22.16.0 (local sandbox). The GitHub files for the **goal module and both new test files** are byte-identical to locally tested copies by Git blob SHA. The route director file was separately updated and source-checked for the same behavior; **a full pinned native checkout regression remains required**.
- No live 2-client acceptance, confirmed NPC ship tracking, scanner legality, actual loot/ISK conservation, native market orders, native combat damage or full overlay roundtrip test has been performed in this development session. Do not mistake this for gameplay DONE.

## Remaining implementation gates

1. Run entire local test baseline plus pinned upstream overlay --check/dry-run/roundtrip on a disposable copy; ensure legacy OFF mode unchanged.
2. Confirm real named pirates are physically materialized by World and visibly move through actual gate/belt routes. Verify decisions persist and do not overwrite active native combat.
3. Implement and audit personal goal/career selection for non-pirate NPCs: earning via **actual** cargo, repair via supported native service, salvage via actual wreck custody, escort via real fleet controllers, markets via escrowed stock and real wallets.
4. Integrate post-restart native active-controller proof into arbiter, and resolve conflicting existing PR #32/#36 before attempting main merge. No release until those are reconciled.
5. Do not activate NPC attacks on human players without source-audited sensors, native Crimewatch/legal gates, fairness/counterplay and two-client tests. Existing raids still target only genuine NPC mining fleets.

**No main merge, no deployment, no CI, no Docker container restart and no mutation of `evejs-data` in this change.**
