# Chat 24 + Chat 31 — Player-owned NPC mining company

**Status 2026-10-26:** Stages A+B, C1 and C2 read-only bindings source-only CODE_READY in draft PR #287; original native stock mining tick is hooked behind a default-OFF flag, with a durable command journal and zero autonomous timers. **NOT deployed or live-verified:** stock GameStore SQLite, original client commands, actual ore/hauling/arrival, and two-client UI remain untested. Native wallets and ore remain authoritative; no duplicate stock, no second corporation registry.

## Gameplay loop (target)

1. A player creates/joins a real EveJS corporation. Native CEO/director or a correctly delegated role controls hiring, wallet spend and selected corporation hangar divisions. The second human can be an officer, miner, guard or hauler without automatically acquiring wallet/asset TAKE rights.
2. The corporation offers a **paid NPC mining shift** for an existing native NPC mining fleet. It can later hire additional vetted fleets within bounded physical spawn capacity; no simulated extra hull counts. A quoted shift includes miner count, hauler count, term, ISK cost and expected logistics.
3. A single A-Life order owner assigns physically present miners and haulers, with escort/defense intent sharing the same NPC order arbiter. Emergency retreat overrides mine/haul; a pirate attack interrupts work. NPC miners consume **finite native asteroids**, obtain original native cargo identities, haulers transfer the exact existing cargoIDs.
4. Cargo arrives through native station/docking proof into the correct owner's real itemStore warehouse. The player's corporation **does not acquire title merely by paying wages**; transfer from the original NPC employer to the player corporation must be a separate original-item native transaction (or explicit delivery settlement). No virtual ore counter doubles as a physical item.
5. CEO or delegated trader sells actual itemStore-owned ore via native station market and receives corporate ISK minus native taxes/fees. Reprocessing and industry reuse native jobs, original materials and real corporation wallet. There are no invented seed buy orders.
6. Payroll, repairs, fuel, ammo and losses are real native wallet outflows. Corporate finance shows revenue, expenses, pending payroll, delivered ore, unsold inventory and realized P&L derived from native transactions and original custody receipts; do not add another cash ledger.
7. Restart preserves the same hulls, cargoIDs, contract receipts and native wallet state. Unknown settlement ACK fails closed; no auto duplicate wages, ore or market proceeds.

## Existing reusable code

| Authority | Existing module |
| --- | --- |
| Player corporation, director + wallet TAKE + hangar rights | `coopPlayerCorporationAccess.cjs` and native corpRegistryRuntime |
| Durable NPC miners/haulers, slot identity, restart recovery | `coopNativeMiningFleetDurable.cjs`, `coopNativeMiningAtomic.cjs` |
| A-Life intentions and command arbitration | `coopNpcOrderArbiter.cjs`, `coopNpcOrderBridge.cjs` |
| Same original cargoID, source/target proof | `coopNativeHaulCargo.cjs`, `coopNativeHaulTransferAtomic.cjs` |
| Arrival, station inventory and receipt | `coopNativeWarehouse.cjs`, `coopNativeStationOreSettlement.cjs` |
| Native corp-to-corp title and money patterns | `coopNpcOriginalWarehouseTitleTransfer.cjs`, `coopNpcCorporateSettlement.cjs` |
| Existing native market and NPC spending | `coopNativeNpcMarket.cjs`, `coopNpcCorporateBuyerAtomic.cjs` |

## Stage A — first PR: corporate ISK-funded mining shift

`integration/coopPlayerMiningCompany.cjs` adds `createPlayerMiningCompany({gameStore,access,getFleet,verifyNativeFleet,verifyNpcCorporation,quoteWage,enabled,...})`.

- `hire(...)` only accepts a verified **existing** miner/hauler fleet owned by the actual NPC employer corporation, with a server-authoritative wage quote (integer cents).
- Native player corp access must pass **member + industry + wallet division 1000 TAKE** checks, including a second check inside the native transaction.
- A **single native GameStore atomic transaction** moves ISK from player corporation wallet division 1000 to the actual NPC employer corporation division 1000 and writes the shift receipt. No money goes to an imaginary NPC character.
- Both corporation wallet journals and the shift receipt carry the same unique operation ID; replay with the same contract is a no-op, changed parameters or a corrupted receipt fails closed.
- A fleet cannot be concurrently funded under a second shift, and the source owner cannot go negative.
- Receipt is explicitly **FUNDED**, not **ACTIVE**, **MINING** or **DELIVERED**: a native transaction does not claim the physical fleet has obeyed an order.
- Caller must bind `enabled: () => coopFlags.on("EVEJS_COOP_PLAYER_NPC_MINING_COMPANY")` in the later server adapter. In this PR there is **no server adapter or overlay registration**; feature is off even if an environment variable is set.

No new GitHub CI and no automatic deployment. Test locally:

```powershell
node --test tests/coop-player-mining-company.test.mjs
```

**Isolated funding test result:** 15/15 PASS on Node (transaction mock, not real GameStore SQLite, Docker or client). A real native GameStore rollback/replay test and restart after every wallet write are required before opting in.

## Stage B — stock fleet command integration (implemented source / not gameplay accepted)

- `coopPlayerMiningShiftOrders.cjs` records strict authenticated `MINE | HAUL | HOLD | RETREAT` directives with monotonic sequence, native original GameStore shift index and ISSUING-before-native-call journal fence.
- `coopPlayerMiningFleetTick.cjs` verifies the *same* startup native miner+hauler hull/controller/owner from native store and original scene, exact original cargoID for HAUL, and passes through state mutations to the actual original fleetRecord.
- `scripts/coop-player-mining-shift-native-patch.cjs` injects one reversible, default-OFF hook into the pinned original `miningNpcOperations.tickMiningFleet` **after** native aggression/response handling but before the normal hauling phase. No second timer, no scripted ore credit. The hook reuses native `startHaulCycle`, `deactivateMiningModulesForFleet` and `retreatFleetToOrigin`.
- Native combat/panic outranks peaceful commands. Loaded/hauling/haulereturn remains in the native custody pipeline until completion. RETREAT is only an attempted warp, not proof of arrival.
- A failed/unknown native call is fenced as `DISPATCH_UNKNOWN` and never blindly retried. A recorded `NATIVE_REQUESTED` is not a proven delivery, landing or mining cycle.
- The action entrypoint `createAdapter().assign` is a trusted server-side API: **not exposed in stock corporation/agent client UI yet**.
- Local isolated command/hook/adapter and funding tests: **39/39 PASS**, with an in-memory atomic transaction mock. Actual pinned source hook anchor confirmed by read-only inspection of `gameboys84/EveJS@c3ea396b`; no installed overlay `--check`, Docker native kill/restart or client gameplay gate has passed.

## Stage B2 — in-client command and full native shift verification (pending)

- Integrate the trusted assign endpoint into stock NPC agent or corporation UI with live authenticated session, exact corp role and selected native fleet; no slash-command-only release.
- Verify GameStore/SQLite original native corp wallets, native miner effect shutdown, original hauler warp, native controller/fleet state after forced restart and ambiguous lost ACK on a disposable world.
- Add role-specific safety and escort allocation with the existing arbitration authority, not a second combat scheduler.

## Stage C — corporate ore ownership and shared warehouse (C1 implemented in source)

- **Stage C1 implemented** in `coopPlayerMiningOreTitle.cjs`: original tagged NPC warehouse itemID/cargoID, verified post-shift source receipt, native player corporation office divisions 115-121, wallet TAKE/QUERY and atomic item title + both corp wallets + receipt in one original GameStore transaction. No new item mint or shadow wallet.
- **Stage C1 warehouse audit seam implemented**: `coopNativeWarehouse` provides read-only `getReceipt` and optional strict `verifyTransferredTitle`; the source-only `createPlayerMiningOreAudit` checks title receipt, both ISK journals, item owner and exact native office. `coopNativeStationArrival` accepts the optional trusted callback.
- **C1 isolated local tests:** combined CH24+31 suite **61/61 PASS**. Real GameStore SQLite and deployed warehouse audit binding still **NOT_RUN**. Stage B now polls via native read-only `gameStore.read`, not a `BEGIN IMMEDIATE` transaction per mining tick.
- **C2 read-only native bindings implemented in source:** original active office, authentic corporation and docked membership, original native item/wallet title audit and guarded station-arrival mount. **Still pending:** seller-authorized native quote, client action API, native chain conservation, sale and reprocessing consumption receipts. The feature remains **OFF**; source alone is not a live working corporate purchase.
- Read [CHAT24_31_ORIGINAL_PLAYER_ORE_TITLE.md](CHAT24_31_ORIGINAL_PLAYER_ORE_TITLE.md) for exact authority contracts, evidence and manual acceptance checks.

## Stage D1 — in-game native Agent control (source implementation)

- Existing native agentMgr dialogue now shows a **verified already-funded** player-owned NPC fleet to an authenticated player corp member through real stock SDE station agents. Original missions, paid convoy and militia agent contacts have precedence.
- Industry managers see wage details and can press the actual native **Accept** button to queue the existing `MINE` order with original GameStore command CAS. Members with no industry role see only `View`, without finance details. Multiple matching fleets refuse implicit selection.
- The Agent uses the original startup native fleet, real corp access and an already-mounted scene. The feature does **not** create an agent, ship, mission, extra salary or ore and is **OFF** by default.
- Critical durable SQLite fix: explicitly register `coopPlayerMiningShift`, `coopPlayerMiningFleet` and `coopPlayerMiningOreTitle` in the pinned `corporationRuntime` row group map, so ordinary stock flush cannot regroup atomic source-key rows. New reversible native patch has been tested against the exact pinned source.
- Regression source results: **18/18** isolated Agent JS cases, **6/6** agent+SQLite patch cases; pinned Agent source and SQLite source both exact reversible after source transformation. Full Node/SQLite and two-client runtime remains **NOT_RUN**.
- Next: Stage D2 **server-authorized in-Agent hire** has been added in source (see below); remaining are multi-fleet selection, separate in-game HOLD/HAUL/RETREAT controls, native market sale, wage-cycle expiry/recovery and two-person acceptance.

See [CHAT24_31_NATIVE_MINING_AGENT.md](CHAT24_31_NATIVE_MINING_AGENT.md).

## Stage D2 — authentic operator-priced native NPC hiring via Agent (source implemented)

- The **same original NPC Agent** now offers exactly one physically verified uncontracted startup mining fleet. Its wage comes only from an **explicit server-owned NPC employer tariff policy**; a native market quote is not a wage approval.
- Native **View** previews three paid cycles, real miner/hauler counts and total ISK; the exact quote is bound to the same authenticated live session for 120 seconds. **Accept** revalidates original NPC ownership, corporation industry + wallet access, unchanged rate, uncontracted fleet and approval before invoking Stage A's true `corporationRuntime` atomic wallet-funded hire. The client cannot choose amount or operationID.
- Deterministic SHA-256 operation identity plus native fleet uniqueness gate prevents repeated payroll for a double-click; unknown commits fail closed and are never auto-retried. After hiring, reopening the Agent shows the existing funded fleet control flow from D1. All flags OFF by default.
- The server-owned policy file `$EVEJS_DATA_ROOT/coop-npc-mining/wage-policy.json` must be explicitly provisioned by the operator, otherwise **no hire offer**. No player wallet, ore, hull, fake mission or salary is fabricated.
- Evidence: **18/18** isolated JS wage-policy/payment regressions, **10/10** Agent hiring integrations, existing **17/17** D1 Agent regressions. They are not original deployed SQLite or EVE client gameplay tests.
- Read [CHAT24_31_NATIVE_MINING_HIRING.md](CHAT24_31_NATIVE_MINING_HIRING.md) for tariff example, source boundaries, flags and release criteria. Still pending: actual two-client UI confirmation, native SQLite crash/restart E2E, multi-fleet selection, HOLD/HAUL/RETREAT controls, payroll exhaustion, native market sale and realized profits.

## Stage D3 — native multi-fleet and MINE/HOLD/HAUL/RETREAT Agent selector (source implemented)

- The stock Agent **View Mission** previews a server-selected real fleet and safe order, **Request Mission** browses funded fleet/order pairs, **Accept** queues the exact session-selected original command using durable native GameStore CAS. No new client or mission identifiers; the unusual stock button labels are explained to the player.
- Existing original `coopPlayerMiningShiftOrders` now prevents commands from overwriting unreconciled `HAUL`/`RETREAT`, blocks dangerous immediate cargo transit switches, and requires physically enforced `coop-hold` before MINE resume.
- Menu candidates read the verified original NPC phase through `coopPlayerMiningFleetTick.inspect`. Cargo transit offers deferred HOLD only; aggression gives native RETREAT; pending/unknown command state offers no new mutations.
- Each View session pin expires in 120 seconds and is consumed on Accept, with renewed station, corporate manager, original fleet, command revision and scene proof. This is **source-only**, OFF by default behind `EVEJS_COOP_PLAYER_NPC_MINING_ORDERS_UI`.
- Evidence: **23/23** isolated menu scenarios, **8/8** Agent integration scenarios, **22/22** Stage B commands, plus **17/17** D1 and **10/10** D2 Agent regressions. Real client UX and SQLite are still untested.
- See [CHAT24_31_NATIVE_MINING_FLEET_ORDERS.md](CHAT24_31_NATIVE_MINING_FLEET_ORDERS.md). Next: independent original HAUL/RETREAT completion reconciliation, corporate ore sale/realized ISK profits, payroll cycles and fully observed two-client gameplay.

## Stage E1 — real native HAUL/RETREAT completion proof (source implemented)

- **HAUL** is no longer considered complete merely when stock `lastHauledAtMs` advances: before first native haul, persist the original miner cargoID/type/quantity manifest with the `ISSUING` transaction. Clear `NATIVE_REQUESTED` only when every captured cargoID is absent from original miners/haulers, is in a fsynced native warehouse `COMMITTED` receipt, and is still the same tagged original `itemID` at the NPC employer's station.
- **RETREAT** captures the original physical warp origin and at least one hull visibly away from that origin before requesting the stock warp. All authentic original NPC hulls must later be at that origin, no longer in warp, before the atomically committed `ORIGINAL_FLEET_WARP_ARRIVED` proof.
- Both paths write exactly one `NATIVE_COMPLETED` command with original GameStore CAS; repeated original ticks cannot replay either original native cargo trip or warp. Agent D3 offers `MINE` only after this receipt and safe native state.
- **Still pending:** a real original seller-authorized market offer, transfer/sale after completion, corporate wallet revenue and payroll-cycle P&L; the completion evidence requires NPC warehouse title to remain intact until confirmation.
- Gate `EVEJS_COOP_PLAYER_NPC_MINING_COMPLETION` remains OFF by default. New source-only regression results: **17/17** physical oracle, **14/14** CAS, **22/22** Stage B, **26/26** Agent selector. The full original SQLite/client test is **NOT_RUN**.
- See [CHAT24_31_PHYSICAL_MINING_COMPLETION.md](CHAT24_31_PHYSICAL_MINING_COMPLETION.md) for safety and acceptance.

## Stage E2A — native market blocker and actual mining-corp cost account (source implemented)

- Confirmed the exact pinned stock EveJS market rejects `useCorp=true` and its SELL flow requires **character-owned personal station-hangar** stock. Existing P2P market settlement intentionally asserts `is_corp=false`; it cannot be reused to pretend an original corporation-owned ore stack has been sold.
- **Implemented read-only** `coopPlayerMiningMarketReadiness`: one funded shift, genuine original fleet index, **both** real wage wallet journals, all server-enumerated original `coopPlayerMiningOreTitle` receipts and reciprocal wallet purchases, physically present tagged original ore itemIDs in player corporate office with canTake/office/wallet roles.
- Manager-only actual Agent status now shows scoped verified corporate ISK **cash outflow**; `realizedRevenueCents` and `netProfitCents` deliberately remain **null**, and no corporate market order or wallet credit occurs. Missing evidence blocks, not zeroes.
- **15/15** isolated original market-readiness scenarios and **19/19** Agent regressions PASS. No actual corporate native SELL runtime or Rust/SQLite E2E exists yet. The `EVEJS_COOP_PLAYER_NPC_MINING_MARKET_READ` flag remains default OFF.
- See [CHAT24_31_NATIVE_CORPORATE_ORE_MARKET.md](CHAT24_31_NATIVE_CORPORATE_ORE_MARKET.md) for the precise pinned market incompatibility and the next corporate escrow, Rust claim, wallet settlement and crash/recovery gates.

## Stage E2B1 — original corporation-owned SELL custody primitive (source implemented)

- Added original source-bound `coopPlayerMiningCorporateSellCustody`: one actual native `items + corporationRuntime + marketEscrow` transaction moves **the same original ore itemID** into the real `9,200,000,000 + orderID` SELL escrow location without changing its corporate owner. Writes authenticated `isCorp:true` escrow and persistent `coopPlayerMiningCorpSell\u001fcargoID` receipt.
- An original native Rust corporate SELL must first exist in **`PREPARED_UNPUBLISHED`** state with no fill and binding source quote. This Rust state is **NOT implemented upstream**, so this isolated writer remains **NOT LIVE**; already-open orders are rejected to avoid unbacked fills.
- A native `CANCELLED/EXPIRED` and **zero-fill** witness permits the original item to return to the same corporate office in one transaction. Unknown commits and partial fills fail closed; no duplicate cargo, synthetic ore or fake ISK credit.
- Registered `coopPlayerMiningCorpSell` in the reversible pinned native SQLite group mapping, plus a default-OFF feature flag. **20/20** isolated escrow/return tests and exact pinned SQLite row-group roundtrip PASS. Actual Rust corporate order publication and corporate settlement remain future engineering.
- See [CHAT24_31_CORPORATE_SELL_ESCROW.md](CHAT24_31_CORPORATE_SELL_ESCROW.md) for source contract, tests and next actual native `PrepareCorpSell → escrow → PublishCorpSell → ClaimFill` requirements.

## Stage E2B2 — private original Rust corporate SELL preparation + GameStore proof

- Added a **reversible, pinned Rust market-server extension** with `PrepareCorpSell`, `GetCorpSell` and `VerifyCorpSellEscrow`. The prepared corporate order is **not open or matchable**; it is uniquely bound to the real ore `itemID`, `cargoID`, corporation, station, quantity, price and source operation. Original `PlaceOrder` is guarded against source `coop-corporation`.
- Rust itself opens original GameStore SQLite in **read-only mode** and checks the exact original corporate SELL receipt, item owner/location/provenance, and genuine `marketEscrow` order row before exposing a successful proof. A client `verifiedNative` boolean is never accepted as a substitute for the physical SQLite evidence.
- The original Node bridge performs: authorized original corporation and price → private Rust prepare → independent Rust get → E2B1 atomic GameStore cargo escrow → independent Rust GameStore audit. Unknown outcomes fail closed without retry or ISK credit.
- **`PublishCorpSell` intentionally refuses** after its read-only verification. Live original Rust full/partial claims, corporate buyer debit and seller-wallet/tax settlement have not been built. Enabling early order matching would produce unbacked trades.
- Evidence: **9/9** isolated bridge tests, **10/10** Rust source installer safety tests, pinned Rust state/rpc patch install-uninstall exact roundtrip; actual Rust compiler, SQLite process and two EVE clients **NOT_RUN**.
- See [CHAT24_31_RUST_CORPORATE_SELL_PREPARE.md](CHAT24_31_RUST_CORPORATE_SELL_PREPARE.md) for secure configuration, manual commands, remaining settlement acceptance and rollback.

## Stage E2B3 — original Rust partial/full claim and atomic corporate wallet settlement (source implemented)

- Added private original Rust `ClaimCorpFill` / `GetCorpFillClaim` with a unique `orderID+cycle` and exclusive `state='settling'` lock; only originally published, verified corporation-owned orders are eligible. Stock personal/NPC market rules remain separate.
- Added source-only native GameStore **five-table atomic** settlement for real buyer character debits, real seller corporation Wallet Division 1000 credits, verified taxes/broker fees, and physical original itemID/quantity conservation for full and partial ore sales. Every cycle writes immutable `coopPlayerMiningCorpFillorderID:cycle` and original escrow/source quantity updates.
- Partial fills retain the exact source itemID and cargo marker in corporate escrow, allocate one new buyer itemID using the native ItemStore allocator and record its source ID. Full fills transfer the same original itemID. Unknown native COMMIT is not automatically retried.
- Durable corporate fill receipts are supported by pinned reversible SQLite row-group patch. Evidence: **14/14** isolated JS settlement scenarios PASS, **14/14** Rust source/installer tests after scope review, plus reversible source and row-group roundtrips. **Real Rust/Cargo/SQLite/gameplay NOT_RUN.**
- **NOT YET LIVE:** Rust `FinalizeCorpFill` / `ReleaseCorpFill`, fully proven native fee source and safe `PublishCorpSell` are still absent. All economy flags remain default OFF, and current stock gameplay cannot call this bridge.
- See [CHAT24_31_CORPORATE_FILL_SETTLEMENT.md](CHAT24_31_CORPORATE_FILL_SETTLEMENT.md) for the remaining E2B4 acceptance gates.

## Stage E2B4 — original Rust claim finalization + wallet/ore receipt release (source implemented)

- Added `FinalizeCorpFill` and `ReleaseCorpFill` private Rust RPCs. They **independently read the real original GameStore SQLite** to verify the exact durable corporate fill receipt, buyer wallet debit, corporate Wallet Division 1000 revenue and tax/fee journal entries, physical delivered item, original cargo provenance and remaining corporate escrow quantity before the Rust order is finalized/unlocked.
- The Rust order remains `settling` between the two original transactions; `ReleaseCorpFill` only reopens an order with positive remaining volume, otherwise marks it `filled`. Lost RPC ACKs can be inspected with read-only `GetCorpFillClaim` for `claimed/finalized/released` states; repeats cannot reissue a GameStore payment.
- Added a default-OFF server-only native orchestration `coopPlayerMiningCorporateFillLifecycle`, which requires a genuine separately verified orderbook match; no public endpoint, synthetic buyer, second market or timer.
- Source evidence: **20/20** Rust source/patch tests, **14/14** native atomic settlement tests, **11/11** lifecycle interface tests; original E2A/E2B1/E2B2 regressions **44/44** PASS. Pinned Rust reversible patch and SQLite receipt row-group roundtrip PASS; **real Cargo/SQLite/2-client E2E NOT_RUN**.
- `PublishCorpSell` still **FAILS CLOSED**. Trusted native buyer matching, verified native fee/tax authority, safe publication and cancelled/partially unsold return remain incomplete; no real in-game ISK sale occurred.
- See [CHAT24_31_CORPORATE_FILL_FINALIZATION.md](CHAT24_31_CORPORATE_FILL_FINALIZATION.md) for exact source identity checks, restart recovery, flags and release gates.

## Stage D — native sale, profit and 2-player gameplay

- Authorized manager chooses native sell order, or approved physical station buyer; sale must be escrow-backed and use stock fees, taxes and market settlement.
- Dashboard: employee shifts, role/status, hauler manifests, original corporation hangar stock, actual corp wallet balances and realized transactions.
- Full in-client interactions through native corporation/station/agent UI (no chat-console-only administration). Two players share corporate view, but roles remain independent.
- Manual real-world gate: physical asteroids depleted; original miner -> hauler cargoID; native arrival; stock item transferred to player corp without duplication; market debit/credit; wage and fee ledger; game restart and both authenticated clients see the same ownership. Include attacks, retreat, hull destruction, insufficient ISK, permission revocation, double-click, lost ACK and concurrent operations.

## Architectural fences

1. One native wallet and one native itemStore, not virtual balances or duplicated ore.
2. A player corporation is a native corp ID; fleet ID never implies corporate ownership.
3. Contract finance and native ship activity are separate authorities. `FUNDED` is not `WORK_PERFORMED`.
4. Every mutation requires an original native source witness, idempotency key, and recovery path. Unknown RPC state goes to operator review.
5. Preserve all default-off flags and the pinned overlay rules in `AGENTS.md`; never turn this on during a real-world test before native writer verification.
