# COOP-049 — A-Life Native NPC Buyer Wiring

**Status: Draft; default OFF.** Stacked on COOP-048 PR #115, then #111/#109/#108/#101. This patch integrates the **existing** 30-second A-Life tick with the COOP-048 native Rust/GameStore corporate buyer. No second economy timer, new wallet, virtual item mint or synthetic market book.

## What was previously missing

The COOP-048 coordinator could buy from a physical player sell order, but `coopVirtualWorldRuntime.cjs` still passed `readStationEconomy:()=>null`. Consequently A-Life had no verified factory or SDE material shortage to issue `BUY_SUPPLIES`; the buyer was never reached by native gameplay.

## COOP-049 implementation

1. Ported **read-only** station authority from PR #98 (`coopAlifeStationAuthority.cjs`, its native runtime reader, owner-scope brain/sensor safeguards), and integrated into the existing `observeAlifeEconomy` loop. The module reads **actual** original BPO, SDE recipe, owned station hangar stock, industry jobs, corporate wallet and Rust order book. Never invokes an industry install, creates a corporation row or writes a wallet to observe.
2. Derived **concrete** `materialNeeds` per chosen product: `typeID`, `required` SDE materials, `available` native owned stock, `shortage=required-available`. A-Life's trader intent `BUY_SUPPLIES` is dispatched only when the end product is **actually short** and native WIP capacity is available. Satisfied product targets and full WIP must not trigger endless material purchases.
3. `coopAlifeNativeBuyerDispatch.cjs` validates the exact owner-scoped pilot, station, native SDE material proof, read-only A-Life intent ID and `BUY_SUPPLIES` resource; limits actions to **one** corporate purchase per station and at most two per master tick.
4. `coopAlifeNativeBuyerRuntime.cjs` independently re-reads actual physical NPC ship/controller, same native corporation owner and station, range (10 km), attack/warp/player presence before calling the buyer. The live actor is rechecked through the **existing** COOP-048 coordinator before it sends a Rust claim.
5. `coopNpcBuyerNativeBindings.cjs` adapts real read-only GameStore `corporations/corporationRuntime/characters`, ItemStore, SDE shortage and Rust `GetOrders/GetOrder` into an attested proof. It requires **one actual player-owned source stack** in the matching marketEscrow, validates the seller's character and the corporation's existing cash, and compares the before/after physical item and wallet snapshot after async market reading. It delegates every paid write to the already-built COOP-048 `createNpcCorporateBuyer` (5-table atomic settlement).
6. The pinned `scripts/patch-evejs-coop.cjs` now includes all needed 043–049 modules; relative require paths handle both repository `.cjs` and deployed EveJS `.js` filenames. Deployment remains a **manual reversible** overlay, not applied to anyone's running server here.
7. The old seed NPC-market trader can alter the same native pilot. **If `EVEJS_COOP_NATIVE_NPC_MARKET=1`, this new buyer refuses ACT** until unified actor arbitration is proven. This avoids two market writers in the same 30-second tick.

## Opt-in flag matrix — do NOT enable before native acceptance

All are explicit prerequisites:
- `EVEJS_COOP_ALIFE=1`, `EVEJS_COOP_ALIFE_ECONOMY=1`, `EVEJS_COOP_ALIFE_ECONOMY_AUTHORITY=1`
- `EVEJS_COOP_ALIFE_ECONOMY_ACT=1`, `EVEJS_COOP_ALIFE_NATIVE_BUYER=1`
- `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`, `EVEJS_COOP_NPC_BUY_PLAYER_ASK=1`
- `EVEJS_COOP_RUST_NPC_CORP_BUY_PLAYER=1` inside the Rust daemon
- `EVEJS_COOP_ALIFE_ECONOMY_PRODUCTS`: explicitly bounded JSON configured against real SDE recipes/BPOs.

The default spend limits are 10000 cents per unit, 100000 cents per buyer tick and 10000 cents minimum protected corporation cash reserve; settings have strict upper bounds. These are **policy limits**, not artificial ISK credits.

## Evidence obtained

The following were run against exact source returned from this branch using isolated JavaScript execution and deterministic virtual FS/native authority mocks:

- COOP-049 A-Life buyer dispatch: **11/11 PASS**.
- COOP-049 physical actor runtime: **9/9 PASS**.
- COOP-049 native GameStore/Rust buyer bindings (including simulated five-table ledger and lost ACK): **7/7 PASS**.
- COOP-049 pinned source/wiring contract: **7/7 PASS**.
- `.cjs` development vs deployed `.js` dependency graph: **11/11 PASS**.
- Ported PR #98 station authority, owner isolation, runtime and wiring: **24/24 + 12/12 + 8/8 + 7/7 PASS**.
- Additional A-Life no-unnecessary-buy safety checks: **3/3 PASS**.

Total: **99/99 isolated/targeted checks PASS**. This is **not** a `node --test` run of the complete repository, Rust compilation, real SQLite native market transaction, or two-client E2E. Those have **NOT_RUN** status; do not describe COOP-049 as tested in gameplay.

`tests/scenarios/coop-049-alife-native-buyer-e2e.json`: **11** new local gameplay cases, all `NOT_RUN`. Also ported the **30** original COOP-043 A-Life native acceptance cases from PR #98 into the scenario manifest. The combined local gate is:

```powershell
pwsh -File scripts/Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests
```

## Remaining P0 blockers

- Compile and run Rust COOP-034/035/047/048 claim/finalize patches in a disposable checkout; audit the actual database schema and JSON RPC types. The Rust patches on stacked PRs have **not been compiled** in this task.
- Run Node `node:sqlite` cases and the full A-Life test runner using the user's **local source tree**; run real native two-client / market/restart / physical industry acceptance and compare all item/ISK receipts.
- Validate existing player sell-order broker fee/tax/structure-owner parity. The COOP-048 buyer currently transfers gross ISK without the ordinary seller sales tax; this must be reconciled before enabling live trade.
- A crashed process can leave COOP-048 coordinator's `.lock` file; **do not auto-delete it**. Reconcile the persisted `PREPARED` journal with Rust and GameStore first, then have an operator clear the stale lock only after verifying no active writer.
- Ported PR #98 owner/station authority source is duplicated here to close the dependency chain. **Reconcile against PR #98 before merging to main** to avoid losing newer changes or double-registering the same reader.
- Full support for player asks spanning multiple physical escrow stacks and bounded partial **player-to-NPC** purchases remains blocked. This first live wiring only targets a fully verified, single-stack, full-remaining-quantity player ask.
- The original `evejs-data` Docker volume must stay unchanged throughout isolated native acceptance.

## Acceptance conservation rules

A purchase is successful **only** if: Rust OPEN→SETTLING→FILLED references the *same durable claimKey*; GameStore corporate cash delta equals the player's credit (minus explicitly accounted fees when implemented); the original player `itemID` moves once into the purchasing NPC corporation's native hangar; the exact escrow is removed; the canonical receipt prevents any second debit after RPC ACK loss; a fresh A-Life snapshot sees the increased station material stock and reduces its shortage; future native industry consumes real materials with no synthetic replenishment.
