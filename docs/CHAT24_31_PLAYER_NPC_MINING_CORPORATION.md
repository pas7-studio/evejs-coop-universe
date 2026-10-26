# Chat 24 + Chat 31 — Player-owned NPC mining company

**Status 2026-10-26:** Stages A+B and C1 source-only CODE_READY in draft PR #287; original native stock mining tick is hooked behind a default-OFF flag, with a durable command journal and zero autonomous timers. **NOT deployed or live-verified:** stock GameStore SQLite, original client commands, actual ore/hauling/arrival, and two-client UI remain untested. Native wallets and ore remain authoritative; no duplicate stock, no second corporation registry.

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
- **C2 not implemented:** trusted native office and price quote callback adapters, title verifier injection in deployed station runtime, native chain conservation integration, client action API, sale and reprocessing consumption receipts. The feature remains **OFF**; source alone is not a live working corporate purchase.
- Read [CHAT24_31_ORIGINAL_PLAYER_ORE_TITLE.md](CHAT24_31_ORIGINAL_PLAYER_ORE_TITLE.md) for exact authority contracts, evidence and manual acceptance checks.

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
