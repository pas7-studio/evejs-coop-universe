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

## 5. How to prove it live (once the driver is wired)

1. Put a sell order of your own on the book at ≤ 90 % of the reference (or wait for a cheap ask).
2. Expect one small lot bought, then the same goods relisted by the trader at 140 %.
3. Evidence: `space.teleport.delivery`-style records are not enough here — the buy must show
   `NPC_PLAYER_PURCHASE_SETTLED` with a `fillID`/`itemID`, the seller's wallet credited, the
   corporation's debited, and the item physically in the corporation's hangar. Anything less is
   `UNVERIFIED`.
