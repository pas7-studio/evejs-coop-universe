# NPC trader: the owner's market-maker bands

Owner rule, 2026-11-05: *"with 50-200 billion, buy everything — even what nobody buys — at 70-90 %
of the market, and try to resell at 105-140 %."*

## 1. What exists (measured, not assumed)

| fact | measurement (2026-11-05) |
|---|---|
| purchases an NPC ever made from a player | **0** (`NPC_PLAYER_PURCHASE_SETTLED` count in `coop-events.jsonl`) |
| player sell orders on the The Forge book | **0** for types 34/35/36/444 — the book holds only `source:"seed"` asks plus one buy order per type |
| richest wallet in the world | **0.3 B ISK** (the owner's own character `Raih1488`) |
| richest NPC corporate wallet | **~5 M ISK** (`Serpentis Corporation`, `Caldari Navy`, `Federation Navy`, `True Power`, `Malakim Zealots`) |
| the buyer chain's code | complete adapters exist: `coopNpcBuyerNativeBindings`, `coopNpcBuyerCoordinator`, `coopNpcCorporateBuyerAtomic` — but **no driver** puts them on a tick, and the A-Life buyer path is blocked by design while `EVEJS_COOP_NATIVE_NPC_MARKET=1` runs (`PARALLEL_NATIVE_MARKET_WRITER_ENABLED`) |

So the 50-200 B bankroll the rule assumes **does not exist anywhere in this world today**. It is
either earned by the trader or endowed by the owner (see §4) — it cannot silently appear.

## 2. The bands (`space/coopNpcMarketMakerBands.js`, fork `fcc57c8`)

Pure policy — no order is placed, no wallet is touched, every refusal names its reason.

| band | rule |
|---|---|
| **buy** | lift only attested, open, **player-sold** asks priced **≤ 90 %** of the reference price |
| **bid** | price the types **nobody sells** first at **70 %** of the reference (this is the liquidity the owner asked for) |
| **sell** | our own stock goes on the book at **140 %**, with a hard **105 % floor** it may never cross |

Guards on every planning call:

* one lot per type per tick, capped in units (default 50), so a merciless "buy everything" cannot
  eat a whole stack in one tick;
* per-tick spend budget + a cash reserve that is never spent (default 10 M ISK);
* a lot is refused when the resale floor cannot clear the demanded gross spread (8 % default) —
  buying at 90 % and only getting 105 % back is 16.7 %, which passes; a thinner band does not;
* cheapest offers first, so the same ISK buys the most goods;
* bad money or a bad reference refuses instead of guessing.

## 3. Executors it plugs into (already in the fork)

* **buy a player's ask**: `coopNpcCorporateBuyerAtomic.purchaseOnce` — real ISK from the corporate
  wallet, real item transfer, Rust claim `npc-corpbuy:<uuid>`, whole-ask only (hence
  `wholeStackOnly` in `coopNpcBuyerLots`).
* **list our own stock**: the native NPC seller path (`space/coopNativeNpcMarket.js`).
* **bid on a dead type**: a native buy order from the corporation — the remaining piece; a buy order
  needs escrow from the same wallet, so it must be placed through the same GameStore/Rust writer, not
  a bare `PlaceOrder`.

## 4. The bankroll question (owner decision, not a code decision)

The rule needs a treasury. Three honest options:

1. **Earn it** — the trader starts from the ~5 M ISK an NPC corp really holds and compounds at the
   16-40 % spread. Slow, but nothing is invented.
2. **Owner endowment** — a one-time, explicitly logged transfer into the trader corporation's wallet
   (`OWNER_ENDOWMENT` in the corp wallet journal + its own coop event). This *is* new ISK in the
   world, so it must be a deliberate owner act with its own confirm, never a side effect of a tick.
3. **Stock-backed** — move the seeded market's stock value to the trader and let it earn by selling;
   the bankroll equals what buyers actually pay, so it cannot exceed the stock.

Until the owner picks one, the trader can operate with what a real NPC corp holds; the bands and the
executors do not change either way.

## 5. Live state (2026-11-05, after `fc62484`)

```
{"event":"space.trader-maker","status":"TRADER_MAKER_NO_BARGAIN","mode":"LIVE","hub":60003760,
 "buyerCorpID":1000035,"cashCents":486700000,"typesRead":10,"typesWithPlayerAsks":0}
```

The driver runs on every living-world tick, reads the real book for the configured types and the
corporation's real wallet (**4 867 000 ISK**, Caldari Navy), and refuses to invent anything: with no
player ask on the book there is nothing to buy and it says so.

Two measured defects were fixed on the way and are worth remembering:

* a real market `order_id` is a **64-bit integer** (e.g. `"2257714186837032994"`) and does not fit a
  JS number — numeric validation silently dropped **every** seed ask, so the driver reported "0
  references" while the book plainly had them. Order ids are carried as decimal strings now;
* the market maker buys as a **corporation**, not as a ship actor, so its phase must not require the
  NPC bridge/identity registry: it was returning early for exactly that reason.

Still open: the relist side (bought stock sits in the corporation's hangar until the native NPC
seller lists it) and the buy-order placement for the 70 % bid band.

## 6. The owner's endowment (applied 2026-11-05)

Owner statement: *"I wanted to give the traders that much because I cannot sell my own things — this
is my way to play, have fun and earn; it is not my fault the economy here is complex and we have not
implemented it yet."*

`space/coopTraderEndowment.js` credits the trading corporation **once**, through the same native
corporate wallet API every other ISK movement uses, with a durable receipt and a loud coop event:

```
{"event":"space.trader-endowment","status":"ENDOWED","reason":"OWNER_ENDOWMENT",
 "corporationID":1000035,"amountISK":50000000000,
 "beforeISK":4867000,"afterISK":50004867000}
```

This is the **only** place in the fork that puts new ISK into the world. It is one-shot: the receipt
(`/var/lib/evejs/coop-trader-endowment.json`) makes every later run answer `ALREADY_ENDOWED`, a
corrupt receipt blocks instead of re-endowing, and no receipt is written for money that did not move.
To change the amount later: stop the server, delete the receipt, set
`EVEJS_COOP_TRADER_ENDOWMENT_ISK`, start it again — an owner act, by hand, by design.

The trader already reads his goods: it collects the type ids of every open **player** sell escrow at
the hub from the GameStore and buys exactly those (up to 24 book reads a tick), so no fixed list of
"interesting" goods is needed. Limits live in compose: 3 buys per tick, 2 B ISK per tick,
1 000 000 units per lot, 1 M ISK reserve.

## 6b. The public book is seeded stock only (measured 2026-11-05)

`externalservices/market-server/src/state.rs` builds `get_order_book` from `seed_stock` alone, so a
**real player order never appears in `GetOrders`** — not his sell orders, not even the two buy orders
he really has (proved: two `marketEscrow` rows, zero of them in the book). That is the deeper reason
"my things do not sell": there is nothing of his on the visible book at all, and no NPC could have
found his asks there either.

The trader therefore reads the player's asks from the **GameStore escrow authority**
(`marketEscrow`, the same rows the atomic buyer validates before it pays), while the seed book stays
the source of the **reference price**. Escrow prices are stored in ISK and converted to cents; order
ids stay decimal text.

## 7. The resale half (live)

`space/coopNpcTraderRelist.js` puts what the trader bought back on the book at **140 %** of the
cheapest seed ask, never below **105 %**, and never with a bare `PlaceOrder`:

```
ReserveNpcSellOrder  ->  one atomic GameStore txn (items + marketEscrow, escrow at 9200000000+orderID)
                     ->  ActivateNpcSellOrder
```

* provenance is the trade: only a `SETTLED` row in the maker's journal (its own `itemID`) may be
  listed, the stack must still be whole (`stacksize === quantity`, singleton 0, flag 4) and owned by
  the corporation at the hub;
* the operation id is a pure function of the stack (`npc-trade:<sha256 prefix>`), so a retry after a
  crash is idempotent instead of creating a second order for one stack;
* the escrow row records `coopSource: NATIVE_TRADE` and the exact price in cents;
* three listings per tick, and an ambiguous native outcome stops the tick.

## 7b. Bids are live and visible (2026-11-05)

Measured on the running play stack after the fixes below — real maker bids in the public book, at the
hub, inside the owner's band:

| type | hub ask | bids | % of ask |
|---|---|---|---|
| 34 (Tritanium) | 3.93 | 3, 3 | 76 % |
| 35 (Pyerite) | 16.03 | 14, 14 | 87 % |
| 37 (Isogen) | 187 | 142, 138 | 76 %, 74 % |
| 444 | 3 500 | 2 905, 2 495 | 83 %, 71 % |

Each bid carries **1 000 units** of depth and is paid for by the endowed corporation, with the money
reserved in the maker's own ledger before the order exists.

Three defects stood between "the code exists" and "the owner can sell into a bid":

1. the Rust book filtered real bids with `AND source = 'player'`, so **every** NPC bid was invisible
   even though `GetOrder` showed it open (orders 39-43);
2. a maker bid had `quantity 1` (the quote defaulted to one unit), so the book had no depth;
3. the tick quoted `station 0` whenever the caller named no station (the mining think hook passes a
   fleet record with none), so the reference was the **region median** — a 16.03 ISK hub ask became a
   20 ISK reference and the bid landed at 99 % of the market. The hub now comes from
   `EVEJS_COOP_MARKET_MAKER_STATION_ID` / `EVEJS_COOP_TRADER_STATION_ID` when a caller is silent.

Also fixed: an order that the daemon no longer has open (cancelled outside the runtime, filled, expired
there) now **releases both its money and its type** in the same tick. Before, 36 cancelled bids kept
five types "held" for the whole 3 h TTL and the book stayed empty with no way back.

## 8. How to prove a purchase

1. Put a sell order of your own on the book in **Jita 4-4** at ≤ 90 % of the seed ask — e.g. 50
   Tritanium at **≤ 3.53 ISK** while the seed ask is 3.93 ISK (any type, any stack up to 1 000 000
   units: the trader discovers the type from your escrow).
2. Within one living-world tick expect `space.trader-maker` with `status: TRADER_MAKER_SETTLED` and
   `executions[0].settled: true`, your wallet credited, the corporation's debited and the goods in
   its hangar.
3. Evidence: `space.teleport.delivery`-style records are not enough here — the buy must show
   `NPC_PLAYER_PURCHASE_SETTLED` with a `fillID`/`itemID`, the seller's wallet credited, the
   corporation's debited, and the item physically in the corporation's hangar. Anything less is
   `UNVERIFIED`.

## 9. 2026-11-06: the executor that really pays (`COOP-LIFT`)

Owner rule that day: *"make the NPCs buy the asks if they are a reasonable price — I asked for this
long ago."* The first honest finding is why it never happened:

| measured | evidence |
|---|---|
| the pinned market daemon has **no claim RPC at all** | `externalservices/market-server/src/rpc.rs` dispatch list: `StartupCheck`, `Health`, `GetManifest`, `GetDiagnostics`, `GetRegion*`, `GetSystem*`, `GetStation*`, `GetOrders`, `GetOrder`, `PlaceOrder`, `ModifyOrder`, `CancelOrder`, `CancelStationOrders`, `FillOrder`, `AdjustSeedStock`, `RecordTrade`, `SweepExpiredOrders`, `GetOrderEvents`, `RebuildRegionSummaries`. `ClaimNpcCorpPlayerSell` / `FinalizeNpcCorpPlayerSell` / `GetNpcCorpPlayerClaim` answer `unsupported market RPC method`. So `coopNpcCorporateBuyerAtomic.purchaseOnce` — the executor the maker was wired to — could never settle anything. |
| `ReserveNpcSellOrder` / `ActivateNpcSellOrder` are **also absent** | same list. The relist half (§7) and the industry/salvage NPC sale paths call them and cannot list until the daemon implements them. |
| the maker never had the seller | `readPlayerAsks` (runtime) returned the escrow price and quantity but not `ownerId`, so `lot.sellerOwnerID` was `0` and the buyer would have been asked to pay character 0. |
| `FillOrder` alone does **not** pay | measured on the owner's own order 281 (109 500 000 ISK, 1 unit): the order went `filled`, the maker's bid at the same price stayed `open`, the seller's wallet did not move. A naive "NPC buys your ask" = minted ISK and a lost item. |

### The executor

`space/coopNpcPlayerAskLift.js` supplies the missing authority and leaves the money where it already
lives — the audited COOP-048 transaction:

1. the receipt key is a **deterministic** function of the claim key (`deriveFillID`), so a retry lands
   on the same row and never on a second wallet transaction;
2. the book row (`GetOrder`) and the physical escrow (`marketEscrow` + the one item stack) must name
   the same order, owner, type, station, quantity and **exact price in cents**;
3. a durable `LIFT_FILL_ISSUED` marker is written **before** the book changes;
4. `FillOrder` closes the whole remaining quantity and the exact ACK is verified field by field;
5. `atomicSettle` (unchanged) debits the corporation, credits the seller net of the real native tax,
   moves the stack and writes the `NATIVE_NPC_BUY_COMMITTED` receipt.

Crash windows: marker without a fill → the row is still open, the next call fills it; fill without a
settlement → the next call finds **our** marker and settles exactly once; a row somebody else closed
with no marker of ours → `NPC_LIFT_FOREIGN_FILL`, nothing is paid.

### The band

The buy ceiling is now a number, not a constant: `EVEJS_COOP_TRADER_BUY_MAX_PCT` (`1` = at or below
the real ask of that type, anything above 1 refused), and `EVEJS_COOP_TRADER_MIN_PROFIT_BPS` (`300`,
because 100 % buy against the 105 % resale floor is a 5 % gross gap). Defaults keep the original
bargain-only 90 %/800 bps behaviour. A lot is also **never truncated**: the settlement pays for one
whole escrow stack, so an ask bigger than the lot cap is skipped as `LOT_REQUIRES_PARTIAL_SETTLEMENT`
instead of being shrunk and then failing.

The maker's journal now separates two outcomes that used to look identical: `BLOCKED` means the
executor did nothing at all (no claim, no fill, no money) and is retried up to 3 times, while a
throw stays `PREPARED` and is never retried by the scheduler.

The reference price also had a dead end: `bookFor` only looked at asks **at the hub**, and the seeded
stock for a junk type often sits at another station in The Forge, so the type was skipped entirely.
The cheapest real ask anywhere in the region is still a real market price; the hub stays authoritative
when it has one, and every candidate reports `referenceScope: "HUB" | "REGION"`.

### Tests

`tests/coop-npc-player-ask-lift.test.mjs` (10) and three new cases in
`tests/coop-npc-trader-maker.test.mjs`: the money conservation, the double-pay guard, the crash
resume, the foreign fill, the price-authority disagreement, the ceiling, the ACK lie, the disabled
flag, the market-price band, the bounded retry and the partial-lot skip.

### Still open (measured, not guessed)

* the daemon needs `ReserveNpcSellOrder` / `ActivateNpcSellOrder` before the trader can relist what
  it buys (§7) or the industry/salvage NPCs can sell theirs;
* the claim RPCs remain the cleaner long-term authority for `COOP-048`; the lift path is what works
  today and `purchaseAsk` stays available for the day they exist.

## 10. Live proof, 2026-11-06 (play stack, corp 1000035, hub Jita 4-4)

The owner's 23 open asks were on the book; the trader corporation bought **22 of them** at its own
configured band (≤ the real ask) and paid him from its real wallet:

| measurement | value |
|---|---|
| committed receipts (`NATIVE_NPC_BUY_COMMITTED`) | **22**, every one with `buyerBefore - buyerAfter === grossCents` and `sellerAfter - sellerBefore === netCents` — **0 conservation violations** |
| gross spent by the corporation | **1 231 691 000 ISK** |
| native transaction tax | **55 179 756.8 ISK** |
| net credited to the seller (`Raih1488`, 140000005) | **1 176 511 243.2 ISK** |
| seller balance | 756 929 709.48 → **1 933 440 952.68 ISK** |
| corporation cash | 50 004 867 000 → **48 773 176 000 ISK** |
| goods | every purchased module is now owned by 1000035 at 60003760, flag 4 |
| asks left | 1 (order 281, the one my own `FillOrder` experiment had closed; its stale escrow row was removed after proving the item was back in the hangar) |

Each purchase is `space.trader-maker` with `status: TRADER_MAKER_SETTLED` and
`executions[].settled: true` plus a `fillID`; the settlement is the COOP-048 receipt keyed by
`corp-buy<SEP><fillID>`.

### The seven defects that sat between "wired" and "pays"

Found in this order, each one measured on the live stack, each one fixed and pinned by a test:

1. the daemon has no claim RPC (`ClaimNpcCorpPlayerSell` …) → the executor was replaced by COOP-LIFT;
2. the escrow row has **no price** (custody only) → the price comes from the book row;
3. a player ask costs **more than 1 M ISK** and the settlement capped a unit at 1 M → ceiling is now
   1 B ISK per unit, 1 B ISK per trade;
4. the order id is **decimal text** and `pos()` refused it → a text id is accepted when it round-trips
   through a safe integer, a 64-bit id is refused rather than truncated;
5. the book row has **no seller** → the seller comes from the escrow row, and a disagreement between
   the two authorities drops the offer;
6. `GetOrder` **splits** the order (identity on top, `row` nested) → both readers flatten it;
7. `corporationRuntime` and the `corporations` record are **keyed rows without an embedded id**, and
   the owner's goods are **singletons** (`quantity -1`, `stacksize 1`) → both are accepted, with the
   keyed read as the identity and a singleton as exactly one unit.

Two operational lessons are now in the code: a native row key contains `\u001f`, so it is read
through the atomic bridge (a JSON path read turns the separator into nesting), and a claim the
executor already started is **resumed with the same claim key** (bounded, six attempts) instead of
being fenced for ever — the deterministic fill id is what makes that safe.
