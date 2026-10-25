# EveJS Stage J — Native Salvage, Rescue Contracts & A-Life Integration

## Implemented in source (Draft, flags OFF)

Source: pinned EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`; target branch based on latest main overlay. **Not deployed, no populated world writes.**

- `coopSalvageDeathAtomic.cjs` and `scripts/coop-salvage-death-native-patch.cjs`: replace unsafe cargo *copy* on real NPC death with source `npcCargo` debit and `npcWreckItems` credit in ONE actual `coopAtomicNativeRows` SQLite transaction. Every native wreck stack retains `sourceCargoID`; real loot is separate. A post-commit error will not delete paid-for salvage wreck. Reversible overlay refuses drift; exact pinned native file patch/remove equivalence checked.
- `coopSalvageProvenance.cjs`: fsynced immutable original manifest / destroyed-hauler / unique sourceCargoID / native wreckItemID provenance witness. No invented loot; original source cannot also remain on NPC ship or original warehouse.
- `coopSalvageNativeTransfer.cjs`: genuine TWO-STEP physical transfer. Pickup requires authenticated player with real nearby EVE ship (within 2.5 km of actual native wreck); atomic SQLite debit of exact `npcWreckItems` source and credit of physical `items` to player's ship cargo; `corporationRuntime.coopSalvageMoves` row is written in SAME transaction with `PLAYER_CARGO` state. Delivery requires same authenticated player and original cargo ship docked at real original station; *same itemID* moved from player to NPC corporate stock and receipt becomes `DELIVERED` in second single SQLite transaction. Replays verify receipt; duplicates / forged `customInfo` denied. Source-tagged stock EveJS non-atomic pickup specifically disabled when atomic salvage is enabled.
- `coopSalvageNativeOffers.cjs`: original manifest, one genuine native hauler-loss witness, two real EVE volunteers -> deterministic NPC-funded quote. No arbitrary offer from client.
- `coopSalvageNativeConsent.cjs`: two independent EVE player acceptances, each fsynced, bound to quote & corporation.
- `coopSalvageNativeRewards.cjs`: actual NPC corporation native SQLite wallet escrow; guarded two-player payout ONLY if *all* original cargo source IDs have matching native stock items and an authentic transaction-owned `DELIVERED` receipt. Atomic wallet credits, no replay. Timed unused escrow refund only while all original wreck items remain and no pickup was attempted.
- `coopSalvageGameAuthority.cjs`, `coopSalvageGameMount.cjs`, `coopWorldOpportunityBoard.cjs`: server-authorized commands, real native itemStore/wallet/fleet/scene/ship/station dependencies. Commands below are default OFF.
- `coopSalvageAtomicCustody.cjs`: audit gate requiring independently replayable dual-ledger native stock custody before declaring recovered.
- `coopEscortRescueNavigation.cjs`: original source-tagged wreck identification required before telling a player salvage navigation is meaningful.
- `scripts/patch-evejs-coop.cjs`: integrated with original reversible pinned installer. **Must preserve all new main features.**

## In-game player workflow

```
/events list
/events info <convoy-event-id>
/events salvage offer <convoy-event-id> <original-cargo-id>
/events salvage accept <convoy-event-id> <original-cargo-id>    # pilot A
/events salvage accept <convoy-event-id> <original-cargo-id>    # pilot B
/events rescue <convoy-event-id>                               # fly to wreck
/events salvage pickup <convoy-event-id> <original-cargo-id>    # within 2.5km
# fly and dock SAME player ship at original station
/events salvage deliver <convoy-event-id> <original-cargo-id>
# all surviving original stacks delivered -> native wallet pays both
/events salvage refund <convoy-event-id> <original-cargo-id>    # ONLY if unused and deadline
```

The cargo ID in OFFER/ACCEPT is a source selector, NOT the award amount; quote covers **all** surviving source-stamped stacks. Prices: default 5 ISK per original surviving unit, rounded to an even total, 1,000,000 ISK cap. Both pilots split actual corporate escrow 50/50.

## Flags (OFF by default)

```
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_SALVAGE_NATIVE_DEATH=1
EVEJS_COOP_SALVAGE_PROVENANCE=1
EVEJS_COOP_SALVAGE_GAME=1
EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER=1
EVEJS_COOP_SALVAGE_CONSENT=1
EVEJS_COOP_SALVAGE_REWARDS=1
```

The base escort/board/manifest authority features must also be enabled in an **isolated disposable test world**. Never enable these in populated `evejs-data` before all gates pass.

## Regression and safety gates

Authored Node 22 tests:
```sh
node --test tests/coop-salvage-*.test.mjs
node --test tests/coop-escort-*.test.mjs
node scripts/patch-evejs-coop.cjs --code-path <PINNED_EVEJS_CODE> --dry-run
```

Critical two-client native acceptance:
1. Real NPC hauler with original cargo enters battle and is destroyed; native wreck has exact `sourceCargoID`, source hauler has **zero** original cargo, no extra copy in warehouse or player.
2. Both connected native EVE players separately accept the single verifiable quote; NPC corporate wallet debits exact price once.
3. Commander/player flies physically to wreck: distant pickup rejected; at 2.5 km original item moves once from wreck to real player ship; client inventory and stock EVE Destiny notifications reflect it.
4. Delivery while in space or at wrong station blocked. Same ship docks original destination station, same itemID becomes NPC corporate stock; compare GameStore and itemStore actual reads.
5. Reward until **every** original sourceCargoID is delivered blocked; after full delivery both real character wallets receive exactly half from corporate escrow.
6. Repeat after restart, duplicate login, split stack, induced crash before/after SQLite COMMIT: no free ISK, duplicate stock, or lost source; read-back receipts determine truth.
7. Unused escrow refund after deadline, original wreck contents unchanged, zero player movement. Started or partially rescued escrow must **not** auto-refund.
8. Verify rollback of overlay `--remove` restores original pinned upstream source without erasing main features.

### Current validation limits

- Isolated V8 source-mock checks for two-stage transfer and real wallet escrow have passed. JS syntax checks passed on touched files, including exact original pinned death-hook + revert. **Full current-branch Node test runner and real two-client E2E are not confirmed**.
- **A-Life NPC salvage competitors**: the existing `coopNpcWreckRecovery` moves native NPC hulls to real wrecks, and `coopNpcWreckCustody` has source-first custody journal. But an authentic competing NPC salvage transfer into its cargo via an atomic native transaction and subsequent physical warehouse receipt is **not yet wired for these rescue offers**. Do not claim competitive recovery is deployed.
- **Post-rescue player reputation**: native wallet-confirmed salvage payouts exist; existing `/events history` currently reads the escort payout journal, not all salvage payouts. Extend as separate audited history before calling the feature complete.
- Integration with open #96 on native Escort crash/replay and any concurrent `main` changes remains a merge gate.
- Native inventory notifications and real dock transitions need proof in the pinned server; if itemStore/movement caches fail to reflect transaction, fail closed and repair instead of pretending success.
