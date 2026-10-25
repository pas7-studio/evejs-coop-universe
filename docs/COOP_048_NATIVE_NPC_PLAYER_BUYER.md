# COOP-048 — Native NPC Corporation Buys a Player's Physical Market Goods

**Status:** Draft / default OFF / **not live-registered**. Stacked on COOP-047 PR #111. Pinned upstream EveJS `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Real upstream contracts verified

- The canonical player sell order is a Rust `market_orders` row with `source="player"`, `bid=0`, `is_corp=0` and `vol_remaining`.
- The seller's actual GameStore item is kept at `MARKET_ESCROW_LOCATION_BASE + orderID` (`9200000000 + orderID`), together with a persisted `marketEscrow` sell record for the player.
- The legacy market handler **moves escrow items before** calling Rust `FillOrder` and then separately credits seller ISK. That is not atomic. We **do not call** that path from an NPC corp buyer.
- Previous COOP-035 and COOP-047 solve the **opposite trade direction**: a player buys from an NPC seller. Neither authorizes NPC buying from player orders.

## Implementation

1. `rust/coop_npc_corp_buy_player.rs`: New, separately gated Rust `ClaimNpcCorpPlayerSell`, `GetNpcCorpPlayerClaim`, `FinalizeNpcCorpPlayerSell`. The claim persists a unique `npc-corpbuy:<32 hex>` and immutable seller/corp/quantity/price/fill ID in the Rust SQLite DB, then moves the original player sell order `OPEN -> SETTLING`. Competing fills may not modify the claimed order. Finalize sets `vol_remaining=0`, `FILLED` and marks the fill finalized atomically within **Rust**. Idempotent restart uses the same claim key.
2. `integration/coopNpcCorporateBuyerAtomic.cjs`: After verified Rust claim, one **GameStore** transaction over `corporationRuntime`, `characters`, `items`, `marketEscrow`, and `npcMarketFills` transfers a real existing player escrow stack to the NPC corporation's physical station hangar, debits corporation wallet division `1000`, credits seller wallet, deletes the exact escrow row and persists `corp-buy\u001f<fillID>`. Source owner, type, station, location, full quantity and seller's original itemID must match.
3. `integration/coopNpcBuyerCoordinator.cjs`: Gated, manual A-Life integration boundary, **no new timer**. Requires trusted NPC trader at the matching station, authoritative stock and wallet evidence, verified affordable Rust ask, and a per-owner/order **fsync-backed write-ahead journal** containing the randomly generated claim key before any RPC. Re-checks the player's live Rust order and NPC actor after async reads. Lost RPC ACK or restart resumes **the identical claim**, never a second paid operation.
4. `scripts/coop-rust-npc-corp-buy-patch.cjs`: Pinned and reversible Rust RPC overlay, after COOP-034/035/047 dependencies. Explicit only; does not modify any local EveJS by itself.

## Invariants and limits

- First physical purchase path supports **one fully escrowed player sell stack**, quantity equals the **entire remaining** Rust order, and the seller must be a player, not a seed order or another NPC corporation.
- Multiple player escrow stacks, partial quantities, changed Rust market price, missing evidence or a corporation unable to preserve its protected cash reserve **fail closed**.
- No new item is minted; the existing exact `itemID` changes owner and station location once. Buyer debit == seller credit. This initial protocol records gross transfers **without the normal player sales-tax routing**. Do not claim full economic tax parity until the existing fee/structure owner source is integrated and verified.
- Rust and GameStore use different SQLite databases; there is **no global atomic transaction** between them. Crash recovery relies on durable claim/receipt/finalize identities and explicit quarantine of unknown outcomes.
- Committed GameStore receipt remains a valid idempotency barrier even if the buyer later consumes or moves the physical item, provided the receipt's immutable identity matches.
- The coordinator's `readProof` and `getOrder` are native-authority dependencies, **not yet wired** to a live `coopVirtualWorldRuntime` tick. The writer does not call a player session and does not override stock market settlement.
- A full native player sell order's broker fees may already have been paid on listing; sales tax remains deliberately unhandled in this first audited slice. The game must not enable the feature until fiscal parity is established.

## Tests / acceptance

- `tests/coop-npc-corp-buyer.test.mjs`: **15/15 PASS** in isolated V8 with deterministic rollback: native wallet custody, player sale, reboot/replay, lost ACK, foreign escrow, reserve, concurrency, fake Rust evidence.
- `tests/coop-npc-buyer-coordinator.test.mjs`: **10/10 PASS** in isolated V8 with simulated durable file journal and native price/actor proof.
- `tests/coop-rust-npc-corp-buy-patch.test.mjs`: **5/5 PASS** in isolated V8 including LF/CRLF overlay reversal and dependency gates.
- `tests/coop-npc-corp-buyer-real-sqlite.test.mjs`: **5 actual Node SQLite tests ADDED / NOT_RUN**. This environment did not run the user repository's real Node/SQLite worker.
- `tests/scenarios/coop-048-native-npc-player-buyer.json`: **8 real Rust/GameStore/two-client gameplay scenarios, all NOT_RUN**.

Run the full local gate on your disposable pinned EveJS checkout:
```powershell
pwsh -File scripts/Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests
```

After COOP-034/035/047 Rust overlays on a **disposable copy**, inspect the new overlay:
```powershell
node scripts/coop-rust-npc-corp-buy-patch.cjs --code-path C:\\Games\\EveCoop\\disposable-upstream\\Code --dry-run
```

**Do not enable** `EVEJS_COOP_RUST_NPC_CORP_BUY_PLAYER`, `EVEJS_COOP_NPC_BUY_PLAYER_ASK`, or live A-Life ACT until the pinned Rust daemon actually compiles and the real buyer receipt/stock/market/tax acceptance gates pass. Do not run patches against protected `evejs-data`.

## Next native work

Connect the source-backed `readProof`/Rust `GetOrder` adapter and corporation/character identity verification to `coopVirtualWorldRuntime.cjs` through a single A-Life tick, then prove two-client purchases and 100+ cycles without stock/ISK duplication. After that, add the more complex multi-item or partial player-sell escrow settlement and real tax flows.
