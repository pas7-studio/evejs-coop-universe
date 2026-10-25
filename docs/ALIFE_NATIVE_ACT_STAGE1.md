# ALIFE-02 — Unified Native Economy + Controlled Resupply ACT

**Status: IMPLEMENTED_UNVERIFIED / all new feature flags default OFF.** Stacked on COOP-043 PR #98. Reuses prior COOP-048 PR #99 shared-order improvements and strict native intent/result reconciliation. No native stock, NPC cash, factories, Rust markets, player inventory, production worker or game Docker volume changed.

## Integrated ownership (one tick)

One existing 30-second coopVirtualWorldRuntime tick remains authoritative:
- **PERCEIVE:** COOP-043 reads real itemStore/GameStore/SDE quote and Rust market GetOrders for exact owner/station/product. Up to eight bounded corporate-station snapshots per tick; snapshots are read-only and can be temporarily blocked.
- **DECIDE:** Existing coopAlifeEconomy decides physical NPC MINE, HAUL, RESUPPLY and factory/market intentions. These are not completed actions.
- **ACT (first safe slice):** New optional EVEJS_COOP_ALIFE_NATIVE_RESUPPLY_ACT=1 enables only native resupply movement. A pre-action scarcity pass uses the **existing** coopNpcAmmoSupply.tick with observeOnly:true; it never issues orders but maintains depletion exclusion leases. The existing native order bridge handles real RETREAT WARP/ORBIT after the read-only controller and fitting checks.
- **Emergency priority:** after scarcity pass, genuine current combat threat, low physical HP or recent native aggressor allows an existing ammo retreat order without waiting for a Rust market snapshot. These remain subject to real native ship/controller, cargo, station and scramble gates.
- **Normal planning:** only a fresh exact RESUPPLY A-Life intent for the same physical named pilot, hull, system and native station can dispatch the existing ammo supply director; active combat or low HP is handled by emergency flow. No new timer or alternative order authority.
- **RECORD:** only accepted native order actions emit alife-native-act-order with intentID and proof=NATIVE_ORDER_ACCEPTED, nativeAction and cargoCredited:false / iskCredited:false. A warp request never claims arrival, purchase, fitted ammo, or market settlement.
- **SETTLE:** not expanded by this PR. Existing native purchase and rearm actors remain authoritative and their real receipts are separately correlated by scripts/alife-audit.cjs --reconcile. All ore/refinery/industry/market ACT routing remains deferred, not incorrectly marked DONE.

## Required opt-in (all exact string "1")

1. EVEJS_COOP_VIRTUAL_WORLD
2. EVEJS_COOP_ALIFE
3. EVEJS_COOP_ALIFE_ECONOMY
4. EVEJS_COOP_NPC_STRICT_AMMO
5. EVEJS_COOP_NPC_AMMO_SUPPLY
6. EVEJS_COOP_ALIFE_NATIVE_RESUPPLY_ACT (new)

All existing independent NPC materialization / headless world and native order flags keep their own requirements. The ALIFE master flag implies existing native order arbitration. The old EVEJS_COOP_NPC_ORDER_ARBITER remains supported for legacy configurations but is NOT separately required when ALIFE=1. Do NOT turn these flags on in any live world until local native tests pass.

COOP-043 authoritative station read requires additional COOP-043 station flags and a validated product allowlist; this is independent from the RESUPPLY ACT gate. Faults must not permit free ammo, extra native money or unverified station movement.

## Safety invariants

- A native NPC with genuinely exhausted fitted weapons remains excluded from new raids **even without a usable A-Life station intent**. The 30-second monitor-only pass retains native scarcity leases.
- One decision can grant only a planned action to the matching NPC; no cross-system or player-controlled hulls. The native ammo director re-verifies actual fitting, inventory and current controller immediately before issuing the native order.
- The native arbiter and native ammo director's cooldown still prevent conflicting/replayed orders. An operator must separately verify durable ownership after restart.
- SURVIVAL takes precedence; no slow Rust GetOrders wait can starve a genuine combat escape. It cannot mint or auto-issue ammunition.
- No background scheduler, item or ISK grant, synthetic NPC, free ammunition, player wallet, market API or new manufactured output exists here.

## Automated and manual QA

PowerShell on a **disposable** local checkout:

    pwsh -File scripts/Run-Alife-Economy-Tests.ps1

Runner includes source/decision/authority/wiring tests, COOP-043 station adapters, COOP-048 exact native outcome receipts, ammo supply and new native ACT scenarios.

Automated source cases specifically cover forged/stale/wrong-owner plans, default OFF, emergency controller priority, short/native ammo, missing/invalid station, no orders on read-only monitor, duplicate cooldown and an integrated mocked actual native ammo director warp. These unit/source mocks do **not** establish client gameplay.

Original COOP-043 economic manifest: 28 local scenarios NOT_RUN.
Original COOP-048 authority manifest: 8 local scenarios NOT_RUN.
New ALIFE-02 native ACT manifest: 7 local scenarios NOT_RUN.

Total currently defined for this stacked chain: **43 manual E2E scenarios, zero accepted**. Run physical ship/controller native movement in Perimeter (30000144) first, record cargo IDs, station distance/warp, two-client observations, SQLite receipts and restart faults. Do not invent passes from source mocks.

## Merge order / concurrent PRs

1. Merge/review COOP-043 PR #98 (read-only station authority) first after local tests.
2. Merge this stacked integration PR (contains COOP-048 changes from #99 plus ALIFE-02 ACT) after #98. Avoid independently merging #99 over the same runtime without patch reconciliation. Old #99 should be closed as superseded only after combined changes land.
3. COOP-047 PR #97 is an independent ammo crash-safety dependency for enabling advanced native fire/production loops; do not enable experimental ammunition production before its local crash gate passes.

**NOT DONE:** manufacturing, order placement, full economic ACT/SETTLE, live market contracts, exact two-client arrival and native gameplay loop. The work is an opt-in, guarded first execution bridge, not the complete living economy.
