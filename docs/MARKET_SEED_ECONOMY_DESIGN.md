# Market seed and economy design (proposal, 2026-10-29)

**Status: DESIGN ONLY. No code, no seed rebuild, no play-stack restart approved.**
Triggered by a read-only audit of the live database
`/var/lib/evejs/market/market.sqlite` (26 stations, 3 systems: Jita 30000142,
New Caldari 30000145, Manifest 30100032; 19 352 types; 503 152 seed rows per
side) on 2026-10-29.

## 1. Audit result the design must fix

| Check | Result |
| --- | --- |
| Same station, `bid > ask` | 0 / 503 087 (per-station spread is sound) |
| Same system, `max(bid) > min(ask)` | 38 294 / 58 054 pairs (66%), avg **+22.9%**, max **+52.6%** |
| Client-visible `system_seed_summaries.best_bid >= best_ask` | 38 339 / 58 056 |
| Types priced 10x–1000x off `price_history` average | 4 478 (plus 3 150 types >= 1000x) |

Four independent causes, all present at once:

1. **Two price generators in one database.** Synthetic v1
   (`basePrice x (1+8%) ± jitter`, same-station ratio ~0.85–0.88) mixed with the
   v2 TQ snapshot import (ratio ~0.97). Visible as `seed_stock.price_version`
   up to 8 vs `seed_buy_orders.price_version` up to 5 — the two sides were
   rebuilt and repriced independently.
2. **The bid is pegged to its own station's ask, while the ask disperses 2x+
   across 26 stations of one system.** Cheap ask on station A plus the highest
   bid on station B is a zero-effort profit inside one system.
3. **Uniform depth: 5 000 units of every type on every station.** The cheap ask
   never runs out, nothing competes, and the snapshot is frozen forever — in
   TQ such a spread is consumed in seconds.
4. **No invariant anywhere.** Neither `market-seed`, `market-seederv2` nor the
   Rust daemon refuses or reports `bid >= ask`, so the summaries publish the
   arbitrage straight to the client.

## 2. Hard invariants (must hold after every build and every mutation)

Let `best_ask(sys,type) = min(seed_stock.price)`,
`best_bid(sys,type) = max(seed_buy_orders.price)` over live rows.

- `INV-1` per station: `bid_station <= ask_station x (1 - spread_station)`.
- `INV-2` per system: `best_bid <= best_ask x (1 - min_spread(type))`.
- `INV-3` fee floor: `min_spread(type) >= 2 x fee_rate + min_margin`, so an
  intra-system round trip is always `net < 0` (`fee_rate` = broker/order fee,
  `min_margin` = 2%). Cross-system routes stay profitable but pay hauling time
  and gate risk.
- `INV-4` one source per scope: every row records `price_source`
  (`tq-snapshot:<date>` | `synthetic:<base>` | `npc-mm:<version>`), and a scope
  never mixes sources.
- `INV-5` depth is real: seeded quantity = real top-of-book volume, clamped,
  never a global constant.
- `INV-6` mutations are guarded: `AdjustSeedStock(new_price)` is rejected when
  it would break `INV-1/INV-2`, with a `coop-events.jsonl` event.

Suggested `min_spread`: ore/ice 4%, minerals 6%, modules/ammo 10%, ships 12%,
blueprints/SKINs/implants 20%. Station jitter stays <= 3% (well under half a
spread), so dispersion can never invert a book by itself.

## 3. One price ladder (deterministic, computed offline)

```
anchor(type)            = median of real TQ avg_price over N=7..30 days,
                          fallback SDE basePrice, else no row at all
demand_index(sys)       = f(coop economy state) in [0.5, 2.0]
station_factor(st)      = 1 ± jitter (<= 3%), cosmetic only
mid(st)      = anchor(type) x demand_index(sys) x station_factor(st)
ask(st)      = mid x (1 + spread_sell/2)
bid(st)      = mid x (1 - spread_buy/2)
```

Because `bid` and `ask` share the same `mid(st)` and `spread_sell+spread_buy
>= min_spread`, `INV-2` holds by construction, not by patching. `demand_index`
is the only economy input and comes from the existing per-system
`ore/goods/demand/losses` ledger — no new state store.

## 4. Depth, restock and sinks (this is what makes it interesting)

- **Seeded rows are real inventory owned by the station's NPC market owner**,
  not an infinite shop. Quantity = real snapshot volume, clamped to
  `[1, cap(type)]`; types with no real order get **no** seed row and are
  quoted only by the NPC market maker.
- **Restock is world activity, not a timer.** The existing ALIFE08 loop
  (miner -> hauler -> station) delivers ore and goods into station inventory;
  a station with no haulers simply runs dry and its price rises until someone
  (player or NPC) hauls in. That links belt activity to prices.
- **Sinks are real demand**: NPC industry (`coopNativeIndustry`) consumes ore
  and goods, faction-war logistics consume ammo/repair, and the loss ledger
  creates hull/module demand. Stock falls -> price rises -> players and NPC
  traders are pulled there.

## 5. Price discovery (no frozen arbitrage, no runaway)

- Trade impact curve, bounded: `±0.15%` per 1 000 units traded, hard cap
  `±30%` from anchor per 24 h.
- Mean reversion toward anchor: 5%/hour when untouched (no permanent freeze).
- **NPC market maker** quotes both sides around `anchor` under the same
  invariants and re-quotes within 30 s of being crossed. The maker — not a
  hand-tuned constant — is what removes a stale gap, so `INV-2` still holds
  if the maker is disabled.
- Honest history: `price_history` only records real fills. The current
  30 fabricated days must be dropped or clearly marked, otherwise the
  in-client chart lies.

## 6. Gameplay that falls out of this

- **Route trading with cost**: intentional 8–15% regional gaps between Jita
  (import hub), New Caldari (demand) and Manifest (remote/war), paid for with
  time, cargo and gate risk in faction-war systems.
- **War economics**: campaign systems lose ammo/repair supply and ship hulls
  (loss ledger), so prices spike and hauling becomes a paid profession.
- **Mining profitability varies by system**: ore anchored to real prices,
  industrial demand concentrated around the industry station.
- **NPC contracts priced off dislocation**: courier/industrial job payouts
  scale with the local price gap, so NPCs pay for exactly the hauling the
  market needs.

## 7. Gates and migration (staged, no big-bang)

1. `scripts/market-spread-audit.cjs` — read-only audit of a live/copied DB,
   prints the INV-1/INV-2/INV-3 counts (the table in §1 is its first output).
2. Seeder validation step that **fails the build** on any INV violation, plus
   `price_source` per row and `INV-4` source-mixing rejection.
3. Rebuild with **v2 only** (no synthetic rows mixed in) for the 3 systems;
   real volumes for depth; drop the fabricated history.
4. Anchor ladder + `demand_index` wiring to the coop economy ledger.
5. Daemon guard for `AdjustSeedStock`/new price (`INV-6`) + event.
6. NPC market maker behind an env flag, default OFF, then default ON after
   a measured window.
7. Regression tests in this repo: fixture-DB build must print 0 inversions;
   a "no risk-free loop" case asserts `net < 0` after fees for the worst
   previously-inverted pairs.

Steps 3 and 6 require an `evejs-market` restart, i.e. an owner restart window
on the play stack. Steps 1–2 and 7 are offline and safe to land first.

## 8. Executed reseed, 2026-10-29 (owner-approved market restart)

Real TQ prices only: EVE Ref snapshot `market-orders-latest.v3.csv.bz2`,
published `2026-10-28T19:49:54Z`, order timestamps 19:40–19:45Z. Built with the
existing `tools/market-seederv2` (no code changes), config kept **outside** the
fork, output written to a temporary path first.

- `order_filter = market_scope_with_npc`, market scope = Jita 30000142,
  New Caldari 30000145, Manifest 30100032 → NPC station stock universe-wide
  (5 210 station rows, 40 regions), live market scope in those 3 systems.
- Real depth: quantity now comes from the snapshot (e.g. Tritanium 686 757 916
  units at Jita 4-4), not a constant 5 000.
- `price_history` is empty — no fabricated 30-day chart.
- Invariant pass (`normalize_market_seed.py`, min_spread 5.6%): 1 195 bid rows
  clamped so no system crosses; result **0 crossed pairs**, 0 crossed stations,
  0 crossed summary rows (was 403 crossed / 16 529 pairs in the raw import and
  38 294 / 58 054 in the replaced database).

Measured before → after (system-level `max(bid) > min(ask)`):

| Database | crossed pairs | share | avg excess |
| --- | --- | --- | --- |
| replaced (v1 synthetic, 26 stations) | 38 294 / 58 054 | 66.0% | +22.9% |
| raw v2 TQ import (3 882 stations) | 403 / 16 529 | 2.4% | +29.3% |
| deployed after invariant pass | 0 / 16 529 | 0% | — |

Deployment: market service stopped, old `market.sqlite` backed up as
`market.sqlite.bak-<epoch>` inside the `evejs-data` volume, new file copied and
`chown 1000:1000`, stale `-wal`/`-shm` removed, market started, `/health` 200,
`/v1/orders/10000002/34` serves real Jita prices (ask 3.93, 686M units).

Not done yet (still steps 2–7 above): `price_source` column, seeder build-fail
gate, anchor/`demand_index` ladder, daemon mutation guard, NPC market maker,
regression tests. The market is currently a correct **static** snapshot: it
cannot be arbitraged inside a station or system, but it also does not react to
world activity yet.

### 8.1 Differentiated depth (same restart window)

The raw snapshot put 39.1 B units into `seed_stock` (686 757 916 units of
Tritanium in one station). Depth is now classed, reduced only, with a
deterministic 0.55–1.00 per-row factor and a per-row ISK value cap:

| class | cap per station row |
| --- | --- |
| Material / ore / minerals (cat 4) | 5 000 000 |
| Charge / ammo (cat 8) | 2 000 000 |
| Commodity (17) / Reaction (23) | 200 000 / 250 000 |
| Drone (18) | 2 000 |
| Module (7) | 250 |
| Ship (6) / Structure module (66) | 5 |
| Blueprint (9) / Subsystem (32) | 3 |
| Implant (20) | 2 |
| SKIN (91) / Structure (65) | 1 |
| no category rule | price tier 100 ISK…100 M ISK → 5 M…1 unit |

Result at Jita 4-4: Tritanium 4 000 000, Pyerite 3 300 000, Antimatter Charge L
17 061, Damage Control II 21, Raven 3, SKINs and implants 1–2. Totals:
`seed_stock` 39.1 B → 317 M units, `seed_buy_orders` 5.1 B → 734 M units.
`initial_quantity`/`vol_entered` were aligned with the new `quantity` so the
client shows a clean order book.

### 8.2 Faction sectors (same window)

Controller faction per system comes from SDE `solarSystems.factionID`;
CONCORD/neutral hub systems (Jita is 500006 in the SDE) inherit the dominant
empire faction of their region, so Jita behaves as Caldari space. Type faction
comes from name keywords (Caldari/Federation/Republic/Imperial, Guristas, Angel,
Sansha, Blood Raider, Serpentis, Sisters of EVE, Mordu, Triglavian, EDENCOM,
CONCORD, Syndicate, Deathless): 9 556 types tagged.

Multipliers are applied to price and depth together on both sides, so the
station spread ratio is preserved:

| relation | price | depth |
| --- | --- | --- |
| own faction space | ×0.85 | ×2.5 |
| rival empire | ×1.12 | ×0.6 |
| pirate gear in empire | ×1.25 | ×0.4 |
| pirate gear in pirate space | ×1.15 | ×0.5 |
| other faction (SoE/ORE/Trig/EDENCOM…) abroad | ×1.15 | ×0.5 |
| neutral/unclaimed | ×1.00 | ×1.0 |

Result: 33 657 stock rows and 26 484 buy rows rescaled; 350 bids re-clamped by
the invariant pass; 0 crossed pairs. Jita (Caldari space) now sells a Caldari
Navy X-Large Shield Booster at 175 950 000 ISK (2 units) versus 207 000 000
before, while Tritanium and other neutral goods are unchanged.

### 8.3 Deployment status of both stacks (2026-10-29)

| stack | DB | notes |
| --- | --- | --- |
| `evejs` (owner play) | reseeded 2026-10-28T20:31Z | image rebuilt from fork `5b31acb`; `market` + `server` recreated; `[CoopNativeMarket] Cannot find module` gone |
| `evejs-agents` (work) | reseeded 2026-10-29T20:40Z | market container only; previous synthetic DB kept as `market.sqlite.bak-1793220055` |

Both daemons answer with the same book (`/v1/orders/10000002/34` → 3.93,
4 000 000 units at station 60003760). The agents stack had been running the old
synthetic seed (100 ISK x 5 000) until this swap; its tests that assumed the
flat v1 prices may now need review.
