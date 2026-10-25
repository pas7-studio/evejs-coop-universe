# COOP-024E stage 5 — Native NPC ammo scarcity and real-stock witness

**Date:** 2026-10-25. **Status: source implementation and pinned-source patch verified; native combat gameplay NOT verified.** Stacked on [PR #52](https://github.com/pas7-studio/evejs-coop-universe/pull/52) → #49 → #46 → #45 → #42 → #39.

## Why this is necessary

At pinned upstream EveJS SHA `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, both:
- `server/src/space/modules/localCycleReloads.js` (native NPC turret/local-cycle reload)
- `server/src/space/combat/missiles/missileReloads.js` (native NPC missile reload)

have `canUseVirtualNativeNpcReloadReserve`: if no loose matching cargo stack exists, `queue...` can still schedule a **virtual reserve** and `complete...` can refill a loaded module with a **new native item** without spending a real cargo stack. This is intentionally supported by preexisting upstream parity tests, but it defeats player/NPC economic scarcity and the earned-ammo chain from PR #52.

## Implementation

- New `integration/coopNpcAmmoConservation.cjs`: **only** when `EVEJS_COOP_NPC_STRICT_AMMO=1` and entity is a real `kind:"ship",nativeNpc:true`, the upstream virtual reserve eligibility returns false. Default OFF: native NPC and player reload behavior remains precisely unchanged.
- Reversible pinned overlay `scripts/patch-evejs-coop.cjs`: one exact source-anchored guard in the **shared virtual-reserve eligibility function** in each of the two native files. Both initial queue and pending reload completion call this function; enabling strict mode while a virtual reload is in flight therefore also prevents a free refill at completion.
- **Real reserve stacks still work**: upstream source has `sourceStacks.length>0` as its normal debit path, writes an actual module-bound charge stack and refreshes real ship cargo. This patch does **not** alter that mechanism, its native type capacity, charging time, or actual player reloads.
- New `integration/coopNpcAmmoWitness.cjs`: per-World-tick, read-only, bounded observation of stored quantities for actual category-8 loaded charges linked to **existing category-7 native modules**, real named pilot, physical ship and unchanged owner. Emits `living-native-npc-ammo-debit` ONLY after the first baseline and a subsequent measured decrease in native store; never writes inventory or manufactures hits, kill proofs, ISK or ammo.
- Observer events explicitly say `observedShot:false` and `NATIVE_CARGO_DELTA_ONLY_NOT_AUTHORED_SHOT`. A change could be due to other inventory activity; the event is authoritative only about stock decrease, **not causal proof of a weapon firing**.
- The strict flag affects **all native NPC ships on that server**, not just one named pilot, and may change battle difficulty; activate **only** in an owner-approved disposable gameplay test with explicit rearm/seed order setup. Do not enable on existing production worlds without balance review.

## Feature flags, OFF by default

```
EVEJS_COOP_NPC_STRICT_AMMO=1
# Full earned-charge economy separately requires opt-in parent flags:
EVEJS_COOP_NPC_EARN_SPEND_REARM=1
EVEJS_COOP_NATIVE_NPC_MARKET=1
EVEJS_COOP_NPC_MARKET_BUY_TYPES=<real charge typeIDs>
EVEJS_COOP_NPC_REARM_CHARGE_TYPES=<compatible charge typeIDs>
```

The strict mode itself does not require market flags (it tests physical stock scarcity separately). No existing `evejs-data` is read or modified until an authorized deployment; neither the git branch nor these tests change Docker volumes.

## Test results

- **6/6** new strict-mode JS tests PASS using exact committed helper + patch script: default OFF, native-vs-player isolation, local/turret and missile exact reversible source anchors, repeat application, no virtual refill with empty stock, no unknown extra source patch.
- **9/9** new native ammo delta witness tests PASS: true native stock decrease, no repeat telemetry, no free cargo, module and pilot identity changes, physical ship death/removal, no writes, no false shot evidence.
- The actual **full pinned upstream** `localCycleReloads.js` (11,805 source bytes) and `missileReloads.js` (11,190 source bytes) were fetched from GitHub and transformed with the committed overlay helper in isolated V8. Both parse, reapply identically, rollback exactly to upstream content and classify as `PATCHED`.
- **Not completed:** native `node --test` in a pinned checkout, native gameStore persistence, actual turret/missile firing and damage events, true individual charge consumption on shot, effects on all ambient NPC fights, actual two-client view and game deployment. There is no claim of a 100% completed ammo-spend combat economy from these unit tests.

## Real gameplay acceptance gate

In a disposable pinned server, record one **real NPC turret/missile shot** and its actual damage/hit and native store before/after. Verify exactly one unit or correct charge quantity is debited per authoritative cycle, no free reload after zero cargo, no extra market buy after crash/restart, and that an NPC can buy one compatible seeded ammo stack with verified earned ledger funds and resume using its real fitted weapon. Test both native missile and local/turret cycles, cross-process faults, source depletion, empty stock, warp/battle interruption, and client-visible reload. If the current combat cycle does **not** actually debit a native charge, implement the cycle-level source debit against a proven fire event before calling combat economy complete; don't simulate a hit from a 30-second world tick.

**No main merge, live Docker restart, production feature enablement, CI, or existing `evejs-data` mutation.**
