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

## 7. How to prove a purchase

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
