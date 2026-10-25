# Chat 13 — native PvP crime and combat consequence audit (2026-10-25)

## Provenance and state

Pinned upstream: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
Project baseline inspected: `bb3ff00dcf3605c5b6ff7bdf5bd01e4b47be1adb`.

Status **CODE_READY / LIVE_UNVERIFIED** for the attribution correction below, not a complete PvP gameplay implementation. Existing co-op player consequences are default-OFF unless `EVEJS_COOP_PLAYER_CONSEQUENCES=1`. No game, server restart, shared two-client PvP or payout transaction has been live tested by this chat.

## Native owners — don't invent substitutes

- `services/security/crimewatchState.js`: PvP weapon/criminal/suspect timers, security penalties, high-sec CONCORD response, illegal aggression and kill-right creation; includes low-sec capsule-specific handling.
- `services/bounty/killRightState.js`: kill-right ownership, activation, consumption and durability.
- `space/combat/killmailTracker.js`: native applied-damage attacker ledger, final attacker, killmail creation, kill-right consumption, NPC and player bounty payout.
- `services/bounty/bountyRuntime.js` and `services/bounty/playerBountyState.js`: native bounty award pools and player bounties.
- `services/insurance/insuranceRuntime.js`: actual player/corp insurance contracts, CONCORD exclusions and ship-loss payouts.
- `space/npc/nativeNpcWreckService.js` and `services/inventory/invBrokerService.js`: native NPC wreck, inventory grant/source debit, player loot transfer.
- `integration/coopNativeConsequences.cjs`: opt-in co-op player standing consequences, not Crimewatch, CONCORD, insurance or wallet.

## Corrected in the existing, already-installed module

`resolveVerifiedPlayerID(scene,attacker)` now requires that the attacker is a **physically present native ship or drone**, maps uniquely to a live Ballpark-ready session, and is admitted by the *existing* `coopSessionPresence.admission(..., nativeAuthority())` account, global-registry and active-ship checks. Drone credit requires a physical drone, its actual owner character, and native launching/controlling ship evidence. Unknown, ambiguous and detached attackers fail closed.

`noteMiningAggression` uses that native-authorized identity before a standing penalty.

`noteNativeWreck` requires a native NPC victim, stored native wreck (`sourceEntityID`, `launcherID`, system), physical wreck in the same native scene and explicit `options.attackerEntity` that maps to an authorized player. `killerCharacterID` is corroborative only: it cannot grant a kill alone and a mismatch blocks credit. Existing reserved-before-apply standing ledger still prevents replayed grants; duplicate status does not rerun financial effects.

The earlier optional `onMinerDefense` bonus inferred a successful rescue from `controller.currentTargetID` and a mining fleet membership match. Those values do not prove the NPC was firing at the miner **when destroyed**. The automatic call is removed; the exported function remains for a future *explicit authoritative defense witness*. This deliberately avoids a false standing benefit while true defense proof is unavailable.

No fake Crimewatch flag, security status, kill right, payout, NPC ship, item or wallet entry is created.

## Confirmed native-source race windows (central integration contracts)

### A. Bounty and killmail

`killmailTracker.recordKillmailFromDestruction` calls `resolveBountyPayout` **before** `createKillmailRecord`; a failure/ambiguous retry can payout twice. `playerBountyState.claimBountyPayout` consumes the victim's pools before the wallet credit; payout failure can lose a legitimate award. `bountyRuntime` has payout buckets/reference controls but must be analyzed together with wallet journal persistence and crash replay. A normal successful-case duplicate check is not enough.

**Chat 01 required hook/transaction:** integrate native kill identity (real victim ship/item ID + destruction event ID + exact attacker character + payout kind) into the native GameStore/wallet transaction boundary. Atomically lock/claim, write killmail, update any player-bounty pool, credit wallet once, and commit a durable receipt, or use an outbox backed by an idempotent wallet operation keyed on the same loss. After any ambiguous wallet result, **do not repeat credit** until reconciled. Never set bounty amount from client input or fabricate killmail data. Proposed flag `EVEJS_COOP_NATIVE_PVP_SETTLEMENT_GUARD=0` until safe native tests. Do not place a parallel ISK ledger in the co-op module.

### B. Insurance

`insuranceRuntime.handleShipDestroyed` checks `payoutLedgerByLossID` but `creditInsurancePayout` happens **before** the loss ledger is persisted. A crash/persistence failure between them can double-pay on replay. A reserve-before-credit file alone flips the bug into unpaid losses; it does not solve exactly-once.

**Chat 01 required transaction:** native ship loss ID must cover a genuinely destroyed ship, owner and contract. Native wallet credit and insurance loss receipt must be one atomic GameStore commit or recoverable idempotent outbox. Include CONCORD no-insurance loss, uninsured default payout, corp owner and item swap. Test crashing between every mutation; no extra credit on restart.

### C. Loot legality

`nativeNpcWreckService.transferNativeWreckItemToCharacterLocation` grants an item before deleting/decrementing its wreck source and has no direct Crimewatch adjudication in that helper. `invBrokerService._moveSourceItemToDestination` delegates to it. Existing `coopNativeLootQuarantine` blocks certain observed failed debits but does not prove lawful loot rights, theft suspect timers or transaction atomicity.

**Chats 01 + 12 required integration:** validate the *native* character, target wreck entitlement (including legal theft with proper native suspect consequences, where supported), cargo destination and actual source item before mutation. Native inventory transfer and source debit must be atomic/idempotent; no replay grants. This chat does **not** alter Chat 12's custody module or central inventory patches.

### D. Player-vs-player and NPC-vs-neutral

Keep `crimewatchState` the sole arbiter of legal war, criminal/suspect, CONCORD and security changes. Require explicit attacker identity from actual damage/destruction, not the last target/killmail correlation. Validate neutral, suspect, war target, low-sec capsule, CONCORD ship kill, drones, disconnect/reconnect and two independent characters. Do not turn passive evidence events into consequences.

## Tests and acceptance

- Executed 6 isolated, authored regression cases against **the exact changed module source** under injected native stubs; 6 PASS / 0 FAIL in the tool JS runtime. Earlier 9 explicit behavioral assertions also passed.
- `tests/coop-native-consequences-attribution.test.mjs` is a runnable Node `node --test` fixture for the checked-in module; the genuine pinned EveJS runtime and authorized client are not available to this chat. Node runner, overlay dry-run/roundtrip and Docker live gates **remain to be executed**.
- Real acceptance: two real client characters; player A attacks B or a neutral, compare native Crimewatch on both; legal war exception; CONCORD in high-sec; real victim loss, single killmail/kill right, one wallet payout/insurance (or correctly none), exactly one writable wreck/item; replay and reconnect after crash with no duplicate.
- No `main` push until remaining native transaction integration and operator gameplay gates are complete. Coordination with Chat 01 (central native hooks, wallet/GameStore), Chat 09 (applied damage), Chat 12 (wreck/loot custody) required.

## Manual code regression

```sh
node --test tests/coop-native-consequences.test.mjs tests/coop-native-consequences-attribution.test.mjs
```

Manual source checks after Chat 01 integration: pinned upstream overlay `--dry-run`, exact reversible `--check`, roundtrip; then operator-authorized two-client and crash recovery tests, preserving `evejs-data`.
