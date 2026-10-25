# COOP-024E stage 4 — Earned native market money pays for real NPC weapon charges

**Date:** 2026-10-25. **Status:** implemented in a draft stacked branch, isolated tests only. **No live server/gameplay proof.**

Parent chain: [PR #49](https://github.com/pas7-studio/evejs-coop-universe/pull/49) (source-authenticated wreck loot -> real station -> seeded market sale) → #46 → #45 → #42 → #39.

## What a player should see

A named physical NPC pirate who **actually** sold native recovered loot through a seeded market bid has a nonzero **NPC market ledger** balance. Once it is near an actual same-system station, it can select a real existing fitted native module lacking a loaded charge, buy an **allowlisted** SDE charge type compatible with that module from a real seeded station sell order, and bind the **very same native cargo row** to that existing fitted module. The pinned native `npcEquipment.getNpcLoadedChargeForModule` reads the `cargo.moduleID` relationship, so this is not a cosmetic virtual upgrade.

- No free charge spawn, fake NPC inventory, synthetic weapon/module or fabricated ISK.
- Seed buy market order stock genuinely decreases; NPC market ledger balance genuinely decreases; native cargo contains the purchased charge; binding to the existing module **creates zero additional cargo entries**.
- Purchasing is OFF until the role is an NPC pirate, previous loot-commerce flags are enabled and `EVEJS_COOP_NPC_EARN_SPEND_REARM=1`. The normal trader/hauler market remains unchanged. Purchases use the existing `coopNativeNpcMarket` asynchronous `GetOrders` / `AdjustSeedStock` / ack / durable market journal and volume limits.
- There must be a real fitted, online, category-7 native module, a compatible native SDE category-8 charge, and **no charge already assigned to that module**. There is no rearm/fitting of synthetic hull-only weapons, player-controlled ships, or combat-active NPCs.
- Purchase ID/provenance is durable: market code retains a `root/purchases/<cargoID>.json` receipt *after verified RPC ack, cargo write and ledger settlement*. Contains exact pilot, ship, system, type, qty, seed market order and station. If receipt persistence fails after ACK, the existing market `RPC_ACK` transaction remains for recovery; no second market RPC is issued.
- The native cargo is bound to a real module by updating **that same native cargo row's `moduleID`**, validating native store afterwards and refreshing `ship.nativeCargoItems` / `ship.fittedItems`. A final check delegates to pinned `npcEquipment.getNpcLoadedChargeForModule`; if it cannot see the bought charge, success is NOT reported.
- Stale `rearm-locks/<cargoID>.lock` files block automatic concurrent loading for that cargo until operator inspection. No manual lock is silently stolen. The source-first market custody fence continues to protect ambiguous RPC outcomes.

## Explicit limitations

1. **Not a player wallet:** NPC money is from the project's validated `coopNativeNpcMarket` ledger, **not** a native EveJS character wallet. No fabricated wallet credit or authorization through a fake player session.
2. **No automatic full ship repair or new hull:** pinned `repairService` works with docked player sessions and account wallets, not an authenticated physical native NPC. This branch does not spoof a player or heal the ship from ledger digits.
3. **No unauthorized loot stealing:** pinned `crimewatchState` is keyed to characters, not NPC pilot hulls; the current loot-right gate from PR #46 remains. A hostile pirate cannot freely loot a victim without verified native rights.
4. **Not confirmed live weapons cycle:** the native charge is persisted and fed to the existing weapon accessor, but actual damage, ammo consumption and client-visible reload effects are not confirmed in full EveJS. Existing NPC hull weapons without fitted modules are excluded.
5. **Purchase receipt is fail-closed evidence, not an atomic cross-store escrow transaction.** Market RPC/journal and filesystem receipt use the existing baseline market mechanisms; full power-fault and multi-process native market account reconciliation remain necessary. A lost receipt after power loss prevents automatic loading; it must never mint stock.
6. The NPC must already be physically at an actual station where a **seeded sell order** exists for a charge type explicitly allowed in both buy and rearm lists. There is no teleport or invented seller.

## Flags (OFF by default)

```
EVEJS_COOP_NATIVE_NPC_MARKET=1
EVEJS_COOP_NPC_LOOT_COMMERCE=1
EVEJS_COOP_NPC_WRECK_TRANSFER=1
EVEJS_COOP_NPC_ORDER_ARBITER=1
EVEJS_COOP_NPC_EARN_SPEND_REARM=1
EVEJS_COOP_NPC_MARKET_BUY_TYPES=<real charge typeIDs>
EVEJS_COOP_NPC_REARM_CHARGE_TYPES=<same compatible native charge typeIDs>
# Optional; persistent and writable for seed market and rearm receipt:
EVEJS_COOP_NPC_MARKET_ROOT=/var/lib/evejs/coop-native-market
```

Additional World/materialization/native raids and original wreck flags from PR #49 and its parents remain required for the **entire** kill-to-rearm chain.

## Test evidence and remaining acceptance

- **11/11** new native rearm tests PASS (real source receipt; existing native module; same item ID and quantity; no free stock; incompatible charges; wrong station; player/combat exclusion; stale lock; failure of native cargo update).
- **15/15** native market baseline + new purchase receipt fault-recovery tests PASS. The new tests verify a receipt created **only after an actual seed sell RPC**, and recovery from a simulated post-ACK receipt write failure without repeating `AdjustSeedStock`.
- **2/2** new cross-module market → native rearm tests PASS: sell existing real inventory, earn 60 NPC-ledger ISK, spend 20 on 5 real seed market charges, and bind the same purchased cargo ID to an existing module; a restart does not buy a second stack.
- **28/28 tests PASS in the isolated JavaScript V8/filesystem simulation** against the exact committed module source/test bodies. This is not a pinned full EveJS `node --test` or dual-client gameplay run. All existing previous-stage tests and actual market daemon fault injection should be run before merging.

### Live DoD

In an owner-approved disposable EveJS volume with legitimate NPC loot rights and a real seeded charge sell order, verify: source-proven NPC kill → wreck → pickup → station → sale → positive NPC ledger → seeded charge buy → real charge row bound to existing weapon → visible weapon use; prove after each step that native item count and ledger balance are conserved. Run disconnect/crash and concurrent market-service tests. Do not modify existing `evejs-data` or restart live Docker without explicit approval.

**No main merge, native deployment, player-facing finished-gameplay claim, or Docker/`evejs-data` mutation.**
