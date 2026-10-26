# LW-04C3A — Original Rust NPC factory sell custody

**Status:** Source-integrated *manual-only* NPC production listing and read-only
recovery. **This is NOT a real completed NPC sale or wallet settlement.**
Stacked on #210 → #207 → #193. No flags enabled, no new daemon or wallet
writer, no independent market scheduler.

## Existing source authorities reused

1. The original `coopNpcNativeEconomyDirector` holds the authoritative
   fsynced `npc-manufacture:<uuid>` journal and transitions
   `DELIVERED → LIST_UNKNOWN` **before** calling native market.listOnce.
2. The existing `coopNpcPendingMarketEscrow` issues Rust
   `ReserveNpcSellOrder` (original operation idempotency),
   atomically moves the exact original produced ItemStore item plus
   `marketEscrow` row through the existing GameStore single writer, then
   `ActivateNpcSellOrder` and readback `GetNpcSellOrder`. It is never
   replaced by stock PlaceOrder or a forged player session.
3. New `coopNpcIndustryOriginalRustSell` checks the unique owner/station
   journal, existing `ORIGINAL_DELIVERY_ATTESTED` GameStore/ItemStore source,
   physical hangar quantity and native NPC seller before directing ONE
   listing step via the existing durable director. Only a verified
   `LISTED` plus exact Rust/ItemStore/escrow readback is success.
4. `observe()` performs only `GetNpcSellOrder` and original
   GameStore/ItemStore readback. If a previous RPC ACK is lost, the director
   stays `LIST_UNKNOWN` and the result is
   `OPERATOR_RECONCILIATION_REQUIRED` — **never an automatic second
   Reserve, Activate or new order ID**.
5. Original seller ISK credit and buyer ItemStore delivery **are not
   implemented here**. Rust `filled` or `vol_remaining < quantity`
   requires a separately audited original fill/settlement implementation;
   the custody reader blocks instead of fabricating wallet receipts.

## Feature gates

Requires the three manual original manufacturing flags plus
`EVEJS_COOP_NATIVE_NPC_ECONOMY=1` and
`EVEJS_COOP_NATIVE_NPC_MARKET_PENDING=1`. All default OFF.
`EVEJS_COOP_ALIFE_ECONOMY_ACT=1`, independent NPC market or economy
scheduler are forbidden in manual proof mode.

The existing Rust methods named above are **required contracts**, not
confirmed live-server support. This PR does not ship an upstream Rust
daemon patch and does not claim those RPCs exist on the pinned native
server. A real disposable Rust compatibility test is mandatory.

## Source tests

`tests/coop-npc-industry-original-rust-sell.test.mjs` calls the
**actual existing** `coopNpcPendingMarketEscrow.cjs` implementation
against an isolated original GameStore row transaction model and mocked
Rust method replies. This exercises real pending reservation, item/escrow
atomic mutation, activation, lost ACK, and no replay. It is **not**
a Rust daemon integration test.

Local source gate:

```powershell
pwsh -File scripts/Run-LW04C3-Rust-Sell-Gates.ps1
```

All twelve physical native scenarios in
`tests/scenarios/lw04c3-rust-npc-sell-e2e.json` remain `NOT_RUN`.
Do not run destructive fixtures against protected `evejs-data`.

## Next financial completion stage

- Identify and verify the original Rust NPC seller fill/settlement protocol,
  original GameStore seller wallet and buyer inventory settlement transaction.
- Add the original sell side fill journal + zero-double-credit readback
  *before* integrating `SOLD` into A-Life.
- Verify actual Node/SQLite/Rust and two authenticated clients, including
  crash after Rust COMMIT/ACK loss and partial fills.
