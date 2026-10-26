# Chat 24 + Chat 31 — Player-owned NPC mining company

**Status 2026-10-26:** first native financing slice implemented, **not wired to the live server**, no in-client UI and no physical mining gameplay evidence. Default OFF. Native EveJS wallets and physical ore remain authoritative; the player company cannot mint its own ore or ISK. This is a new player corporation business, **not** a second corporation registry.

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

**Isolated test result:** 15/15 PASS on Node (transaction mock, not real GameStore SQLite, Docker or client). A real native GameStore rollback/replay test and restart after every wallet write are required before opting in.

## Stage B — physical dispatch and safety (next PR)

- Bind the existing native mining slot runtime to an explicitly funded contract by original native fleet ID, miner and hauler entity IDs. **Never change `ownerID` on the hull to impersonate the player corporation**.
- Add a registered `PLAYER_MINING_COMPANY` order intent to the *existing* arbiter — no side scheduler. Check exact live entity/controller and incoming threat before sending any native orders.
- Bind each selected pilot to a role: MINE, HAUL, ESCORT, HOLD, RETREAT or RETURN. Physical approach and cargo capacity must be witnessed before completion.
- Order ACK is **not** completion. Persist dispatched/accepted/observed/blocked state with explicit blocker reason. NPC retreat wins over ongoing mining, including after restart.
- Handle contract exhaustion by releasing the fleet **only after** native cargo and wallet reconciliation; never release a paid active shift on timeout alone.

## Stage C — corporate ore ownership and shared warehouse

- Extend the existing original-item title-transfer path to NPC-employer-to-player-corp, with native `items` + `corporationRuntime` transaction and a durable receipt for the **same itemID and original cargoID**. Do not copy a depot quantity.
- A genuine shared player hangar is the **native rented corporate office**, with divisions 115–121 and independent QUERY/TAKE rights; no extra virtual storage.
- Each cargoID can end at most one place: miner, hauler, wreck, employer warehouse, player warehouse, reserved industry or market escrow. Cross-feature reconciliation blocks duplicate titles.
- Decide contract economics explicitly: wage-only service (NPC keeps ore), output purchase (player pays for delivered ore), or owner-supplied ships and ore rights. For V1 use **paid service + separately priced original ore delivery**, so corporate and NPC ownership remain auditable.

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
