# COOP-055 — Two-client real gameplay acceptance (NOT RUN)

**Run only against a disposable copy of the EveJS server/GameStore and isolated Rust market SQLite. Never use the protected `evejs-data` volume.** This is a required manual E2E gate before enabling A-Life native NPC market buying or seller notifications in a persistent world.

## Prerequisites

- Exactly pinned EveJS upstream `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` with reversible co-op overlay.
- Independent database copies, wallet/order snapshots saved before testing, no shared staging/production credentials.
- NPC trading corporation with verifiable wallet and physically present native trader; a real player-owned **sell** order with a single escrow stack; second player connected on a separate client.
- Explicit flags only inside this disposable environment:
  `EVEJS_COOP_ALIFE=1`, `EVEJS_COOP_ALIFE_ECONOMY=1`,
  `EVEJS_COOP_ALIFE_ECONOMY_AUTHORITY=1`,
  `EVEJS_COOP_ALIFE_ECONOMY_ACT=1`,
  `EVEJS_COOP_ALIFE_NATIVE_BUYER=1`,
  `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`,
  `EVEJS_COOP_NPC_BUY_PLAYER_ASK=1`,
  `EVEJS_COOP_RUST_NPC_CORP_BUY_PLAYER=1`,
  `EVEJS_COOP_NPC_BUY_NOTIFY=1`.
- Keep `EVEJS_COOP_NPC_BUY_RECOVERY_OPERATOR=0` until a trusted server-only operator authorizer is installed; never try to recover via a player slash command.

## Test matrix

| ID | Player A (seller) | Player B (observer) | Expected authoritative result |
|---|---|---|---|
| N01 | Places a genuine, fully escrowed sell order | Watches market and wallet | Rust order OPEN; GameStore marketEscrow has original item; neither user sees phantom payout |
| N02 | Remains online during native NPC purchase | Remains online in same station/system | Rust SETTLING→FILLED and one `coop_npc_corp_buy_history` witness; original item transfers to NPC hangar; buyer corporation pays **gross**; seller receives **gross minus native sales tax** |
| N03 | Sees `OnOwnOrdersChanged(Filled)` and `OnAccountChange` | Must receive neither A's Filled nor A's balance | Exactly one seller notification claim in `npcMarketFills`; notifications carry correct seller order, type and station |
| N04 | Refreshes market/transactions/wallet | Refreshes market | Native price history and player market transaction appear, with correct volume and single trade; wallets and physical goods agree |
| N05 | Stays online while same finalize ACK is replayed | Stays online | Rust history volume/order count, wallet balances, item ownership and both event counts **unchanged** |
| N06 | Disconnects *before* NPC fills order | Remains connected | No seller UI notification is claimed while A is offline; durable Rust/GameStore settlement still succeeds |
| N07 | Reconnects, refreshes own orders/wallet | Still online | Authoritative state is correct without inventing a payout; optional explicit notification retry can occur only after all proofs |
| N08 | Seller wallet changes legitimately after prior sale | Watches market | Any later notification uses **current native wallet**, never restores an old recorded balance |
| N09 | Is online during a deliberate client socket failure after durable notification claim | Unaffected | No double event, no repeated ISK/stock/history; client refresh is authoritative fallback |
| N10 | N/A | N/A | Corrupted/tampered owner, tax, history receipt, stale order or forced Rust timeout fails closed; no notice or second debit |
| N11 | N/A | N/A | Crash with journal PREPARED, Rust SETTLING, GameStore receipt missing: ordinary A-Life tick refuses automatic replay; operator action must be explicitly authorized |
| N12 | N/A | N/A | Crash after GameStore commit and Rust history finalize but before journal ACK: operator-only journal ACK with same claimKey; no second money/item move |

## Conservation assertions

For a **hypothetical** 20-unit sale at 1.25 ISK per unit with effective native sales tax 8%:

```
NPC corp:             -25.00 ISK
Seller player:        +23.00 ISK net
Native sales-tax sink: +2.00 ISK
Physical stock: 20 original items leave seller escrow,
                exactly 20 items enter NPC corporate hangar.
Rust price history: volume +20, order_count +1 exactly once.
```

Use the **actual** seller skill/location `marketRules` tax quote in real tests, not the illustrative 8% assumption.

## Evidence to capture

Before/after Rust `GetOrder`, `GetNpcCorpPlayerClaim`, `GetHistory`, GameStore `characters`, `corporationRuntime`, `items`, `marketEscrow`, `npcMarketFills` and coordinator journal. Capture both clients' event streams. Inspect for `sellerNotifyClaimedAt`; it is an **at-most-once send-attempt marker**, not proof that the client displayed the message.

**Go / No-Go:** all N01–N12 must pass on an isolated environment before live flags can be considered. This file defines scenarios; it does NOT claim they have been executed.
