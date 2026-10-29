# Co-op loop — measured results (2026-10-30)

This page records what the co-op economy has **actually done** in the live agent world, with the
numbers and the commands that produce them. Nothing here is a claim without a record behind it.

## The loop, end to end

```
mine (native fleet, belt systems)
  -> haul to station (fleet hauling, drain)
  -> refine (station refinery, real recipe rows)
  -> manufacture (native blueprint + real hangar materials)
  -> freight: multi-stop lift -> gate crossing -> flight -> sale where it really pays
  -> home again, take another load (bounded, self-driving)
```

## Numbers (measured)

| What | Value | Where it comes from |
|---|---|---|
| Freight trips settled | **20 trips, 1 396 262 ISK, 220 119 units** | `coop-native-market/freight-ledger.jsonl` |
| Freight rows proven against settlements | `RECONCILED` | `scripts/freight-check.cjs`, printed by the ledger |
| Corporation treasury | **760 925 738.43 ISK** (722 134 486.21 at the start of this work) | `coop-native-market/corp-treasury/1000129.json` |
| Hold utilisation | 309 999 units in exactly 3 100 m3 (Impel), 543 746 in 5 500 m3 | live trip journals |
| Trip shape | 3-5 loading stops, 50-78 cargo lines | live trip journals |
| Station sales (historical, pre-freight) | 160 fills, 165 357 081 ISK | economy ledger |

Reproduce the balance sheet inside the container:

```bash
docker cp scripts/coop-economy-ledger.cjs evejs-agents-server-1:/app/server/_ledger.cjs
docker cp scripts/freight-check.cjs evejs-agents-server-1:/app/server/freight-check.cjs
docker exec evejs-agents-server-1 sh -c "cd /app/server && node _ledger.cjs"
```

## What is proven

- **A gate crossing both ways**, by the native adapter's own verdict (`SAME_NATIVE_SHIP_ARRIVED`),
  with the durable store and the identity link moving with the hull.
- **A real sale to a real buyer**: settlements of 44 104, 77 349, 560 000, 668 088, 1 027 563,
  1 490 464 and 5 224 110 ISK, each backed by `living-npc-sale-settlement`.
- **Multi-station loading**: one trip lifts at 3-5 stations before it crosses.
- **Demand-driven production**: the manufacturer builds for a buyer one gate away and records
  whose demand the job answers (`buyerSystemID` in the job file).
- **Self-driving cycle**: sale -> return -> replan -> load, bounded by `MAX_TRIPS`.
- **Honest failure**: every refusal that matters names itself (`STALLED_AT_STOP`,
  `HULL_NOT_IN_JOURNAL_SYSTEM`, `NO_IDENTITY_LINK`, `TOO_FAR_FROM_STATION`,
  `SALE_STOPPED:CALL_LIMIT`, `DEMAND_WITHOUT_BLUEPRINT`, ...).

## What is missing (and why)

1. **Blueprints for the demand that exists.** The corporation owns 4 blueprints (3 buildable);
   the buyer system carries 4 144 producible products worth 170 060 631 095 ISK that nobody here
   can make. Measured on the market database: `market_orders` holds **0 rows** — the seeded book
   is BUY-only (`seed_buy_orders`), so a blueprint **cannot be bought**. Crossing this ceiling
   needs a decision outside the loop: a seeded sell side, or an operator-granted copy.
2. **Raw material for more than one fleet cycle.** 498 596 Tritanium ≈ 2 M ISK at the origin
   station; four hulls exhaust it in a cycle, after which sales equal mining speed.
3. **A second demand system.** Every trip currently sells into Jita.
4. **Mining cannot deliver its own ore.** A miner fills its hold; the fleet and the drain move it.
5. **`DEMAND_WITHOUT_BLUEPRINT` has never fired live** - the manufacturer has always had work.
   The wiring and the pure computation are tested; the event itself is not claimed.
6. **The extraction gate is red** on `coopVirtualWorldRuntime.js` (5 153 lines, grown by other
   sessions' faction-war work, not by this one).
7. **No client-side gameplay proof.** Everything above is headless server behaviour; the owner's
   `World` and `Party` gates (real EVE client, two players) remain open.

## How to watch it

```bash
# what the fleet is doing right now
docker exec evejs-agents-server-1 sh -c 'for f in /var/lib/evejs/coop-native-market/distribution-run/*.json; \
  do node -e "const j=require(\"$f\");console.log(j.haulerID,j.phase,j.lastReason||\"\")"; done'

# where the money came from
docker exec evejs-agents-server-1 sh -c 'tail -5 /var/lib/evejs/coop-native-market/freight-ledger.jsonl'

# what the corporation could sell but cannot build
docker cp scripts/coop-demand-gap.cjs evejs-agents-server-1:/app/server/_gap.cjs
docker exec evejs-agents-server-1 sh -c "cd /app/server && node _gap.cjs --top 8"
```
