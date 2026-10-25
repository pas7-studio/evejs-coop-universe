# COOP-024E stage 1 — Native post-raid wreck recovery (2026-10-25)

**Status: implemented + isolated tested; full native gameplay UNVERIFIED.** This is a deliberately **custody-safe** gameplay stage: a named NPC that has *actually* killed another native NPC can fly to its real wreck and confirm that real loot exists. No money, loot, hold, or salvage magically appears in its inventory.

This feature is stacked on [NPC squad PR #42](https://github.com/pas7-studio/evejs-coop-universe/pull/42), itself stacked on personal-goals PR #39. The broader intended economic cycle is documented in COOP-024E.

## Why it does not yet automatically collect goods

Pinned upstream EveJS `nativeNpcWreckService.transferNativeWreckItemToCharacterLocation` calls `grantItemToCharacterLocation()` **before** it deletes/decrements its separate `nativeNpcStore` wreck-item row. If the second durable operation fails, the destination can already own an extra item. It also transfers to an authenticated *character* inventory, not to an NPC ship's native cargo. Calling it from NPC gameplay would cross ownership models and can duplicate assets. No safe generic NPC cargo transfer or kill-based Crimewatch/loot-right adjudicator was verified in the pinned source. **Never call that upstream transfer method for automated NPCs.**

The next stage requires one authoritative NPC-native wreck-item debit + destination native cargo credit, a durable prepare/commit/failure journal with reconciliation, physically checked loot rights, native cargo capacity/type/unit validation and account/market settlement separately. Until then the movement and inspection service makes **zero** inventory/ISK writes.

## Implemented

- `coopNpcStockWreckProof.cjs`: verifies an *unnamed genuine stock EveJS mining fleet* miner or hauler as victim. Requires authoritative upstream `options.attackerEntity`, an exact named/pirate live native attacking ship, unique source link, native fleet membership, real physical wreck, no player ships and the pre-existing `isAuthorizedStockMiningRaid` permission. Doesn't manufacture a kill from the prior target lock.
- `coopNpcDestructionAttacker.cjs`: preserves existing named-NPC kill evidence, and conditionally checks the same rigorous stock-miner kill proof. Only on success records a recovery receipt; failure to persist a receipt never makes the native death execute again. Requires `EVEJS_COOP_NATIVE_WEAPON_EVIDENCE=1`, OFF by default.
- `coopNpcWreckClaims.cjs`: bounded, fsync+atomic-rename, versioned durable *kill proof receipt*, keyed by real wreck ID, victim entity, killer NPC pilot and actual native attacker ship. Refuses unknown source, conflicting owner, corrupt journal. Expires after 1 hour by default. Receipt **is not** transferable loot ownership and does not change wallet or cargo.
- `coopNpcWreckRecovery.cjs`: chooses only that same pilot's existing native ship and current, physically visible wreck, checks actual surviving `nativeNpcStore.listNativeWreckItemsForWreck`, no player ship, no live native battle/warp, correct system/source and bounded 2-order/tick budget. Issues **real** native `warpToEntity` and `orbit` to wreck as appropriate, and records inspection only when within 5 km. No cargo, ISK or XP.
- `coopVirtualWorldRuntime.cjs`: runs native wreck recovery **after** raid and tactical phases, **before** gate/patrol/civilian movement. Uses existing `npcNativeOrder("CIVILIAN", ...)` backed by the per-ship arbiter. A recovery ship in active approach is blocked from competing native gate/patrol/civilian orders. Emits bounded `living-npc-postraid-wreck-recovery` evidence tagged `transferStatus: NOT_IMPLEMENTED_NO_NATIVE_ATOMIC_CUSTODY`.
- `scripts/patch-evejs-coop.cjs`: registers all three new modules in the existing reversible overlay; no new upstream hook injection.

## Enable only for disposable World testing

Requires all flags (all OFF by default):

```
EVEJS_COOP_NPC_WRECK_RECOVERY=1
EVEJS_COOP_NATIVE_WEAPON_EVIDENCE=1
EVEJS_COOP_NPC_ORDER_ARBITER=1
```

World/materialization must be running with real NPCs and mining fleets. Explicit destruction attacker proof must be provided by the actual upstream destruction caller. If not provided, **no recovery receipt is created**. Do not fabricate attacker evidence or trust a virtual-world kill.

The persisted proof journal defaults to `/var/lib/evejs/coop-npc-wreck-claims.json` (customize using `EVEJS_COOP_NPC_WRECK_CLAIMS_FILE`). Back up disposable test files before testing. It does not change `evejs-data` until explicitly deployed and run.

## Evidence and remaining gaps

**17/17 isolated tests PASSED** against the committed source in a JavaScript V8 runtime with a small in-memory filesystem shim (11 journal/recovery tests + 6 stock-native-kill proof tests). Cases include durable receipt/restart, corruption, source spoofing, real wreck and contents, player protection, duplicate entity links, actual warp/orbit/inspection, stale wreck, combat preemption, retry cooldown and zero cargo/ISK grants.

**NOT run:** actual local `node --test` checkout, full upstream test baseline, real native two-client destroyed convoy with `attackerEntity` propagation, source-compatible full overlay install/rollback, native wreck rights/cargo conservation, performance test. Being able to navigate to a wreck is NOT evidence of an item transferred, salvage completed or trade settled.

## Next DoD before economic rewards

1. Capture real stock-miner destruction's `options.attackerEntity` and native fleet membership *at actual destruction*; if unavailable, author an audited source additive proof hook, never infer a killer from target locks.
2. Approve a native NPC-specific transfer primitive with both source/debit and destination/credit custody and crash/restart reconciliation that cannot duplicate goods on partial failure.
3. Add native capacity and loot-right checks; only then enable actual pickup and verify type/quantity conservation. Never use a player-character grant RPC to simulate NPC cargo.
4. Link verified native cargo to real station delivery via existing NPC depot/warehouse and real seeded market orders, with explicit settlement/ISK evidence. Current `coopNativeNpcMarket` balance ledger is *not a native player ISK wallet*.
5. Two live clients witness kill -> wreck -> approach -> legal pickup -> station -> verified sale and loss recovery, with fail-closed tests for disconnect, crash and concurrent looters.

**No merge, no CI, no Docker restart, no native data mutation or production flags turned on in this PR.**
