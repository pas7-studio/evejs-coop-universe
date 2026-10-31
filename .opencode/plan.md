# Plan — next legs of the co-op economy (2026-10-31)

State: see `.opencode/state.md`. This file is the working spec for the next changes.

## Done and live

1. Shopping trip for inputs (`mode: "import"`): empty/roomy hull → seller → `SUPPLY` buys
   through the native trader → home → unload only `importTypes` into the hangar.
2. Payroll pays from the real corporation wallet (`coopCorpWallet`, `corporationRuntimeState`)
   with a `debit: PENDING → DONE` marker; the `corporations` table is NOT allowlisted.
3. Margin gates: `losesMoney` refuses a recipe whose inputs are worth more than the product;
   the blueprint chooser values `unitCostOf`, `buildable`, `profit`, `runsAtStation` (factory).

## Next: a blueprint SHOPPING trip (`mode: "blueprint"`)

Why: the factory owns 785/1076/28339/60767. The only product with real demand is Miner I,
which loses 7 467 ISK per unit, so the margin gate now refuses it and the factory is idle.
The measured profitable candidate is:

    Reinforced Bulkheads I blueprint (1334) at Jita 60003760, ask 175 000 ISK
    recipe: 6 944 Tritanium per unit (no inputs)   product 1333
    bid: 242 units x 5 122 ISK in The Forge        potential profit ~1 064 524 ISK

Tritanium has no bid in The Forge at all (`seed_buy_orders` type 34 only in region 10001004),
so our own refined ore is free input: building is profit, hauling the ore is not.

The blueprint is sold in Jita, the factory (60000682, New Caldari) holds the Trit, so the
corporation must BUY IT AWAY AND CARRY IT HOME — the mirror image of the input shopping trip.

### Design (reuse what already works)

1. `coopLoopTick.distributionRunAuthorities.blueprintPlan({haulerID})` (env
   `EVEJS_COOP_BLUEPRINT_SHOP_TRIP=1`, default OFF):
   - `home = factoryStation()`; reachable systems = hull system + 1 hop + home system;
   - ask rows: `seed_stock` at those systems where the type is category 9 and price <= cap;
     recipe via the cached `blueprintRecipe()` (a station quotes thousands);
   - product bid in the home system + neighbours; `unitCost` = Σ material × local bid;
     `runs` = how many units the FACTORY hangar can feed; `profit = (bid - unitCost) *
     min(runs, bidVolume) - ask`; keep the best `profit > 0`;
   - require a reciprocal gate (`coopNpcGateTravel.connectedGates`) when the seller is remote;
   - return `{status:"OK", trip:{mode:"blueprint", blueprintTypeID, fromStationID/SystemID =
     seller, toStationID/SystemID = seller, homeStationID/homeSystemID, gate, typeID:
     blueprintTypeID, quantity:0, expectedIsk:0, items:[{stationID: seller}]}}`.
2. `coopDistributionRun` PLAN: after `planImport()` returns nothing, try `planBlueprint()`;
   the journal write is the same shape (mode, importTypes → [blueprintTypeID]).
3. `SUPPLY` handler: `state.mode === "blueprint"` → `authorities.buyBlueprint({haulerID,
   stationID, systemID})` instead of `buyInputs`; `bought.status === "TRADE_SETTLED"` is
   success, then `RETURN` home.
4. Home: `stow` already moves category 9 into the hangar at the loading stop, and
   `adoptHeldBlueprints` turns the held copy into a `SEEDED` receipt at the same station —
   which is exactly where the Trit is.
5. Tests: a blueprint trip crosses to the seller, buys once, returns, and stops on refusal;
   a normal trip and an input trip stay unchanged.

### Guard rails

- Never buy a blueprint whose `profit <= 0` (the margin gate is the whole point).
- One blueprint trip at a time (same lock idea as inputs).
- A blueprint must be `ALREADY_OWNED`-free: skip types the corporation already has.
- The purchase still needs a pilot whose earned balance covers the ask: payroll funds it.

## Known repair case (do not "fix" by guessing)

`coop-pilot-006` has a `RPC_CALLING` journal for 1 959 Pyerite sold into order
4257714186837032995. `reconcileJournals` answers `MARKET_ORDER_NOT_FILLED`, but the order row
shows 825 007 units traded since it was issued, so no single fill can be attributed. Hull
980000000002 stays blocked (`UNRESOLVED_MARKET_JOURNAL`): repeating a possibly completed fill
would sell the same cargo twice. Needs an operator decision, not code.
