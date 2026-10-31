# Handoff — server performance (2026-11-01)

## Goal
Stop the owner's world from feeling laggy: the tick must stay near 30 s, and the
HTTP/gRPC surface (26002/26003) must keep answering while a player is in space.

## Measured facts (play stack, 2026-10-31 ~20:50 UTC)
- Tick period 6–218 s instead of 30 s; process ~480% CPU on 11 threads.
- `/health`, `/`, `/status` on 26002 and 26003 never answer; 11+ healthcheck curls
  stuck inside the container. Game ports 26000/443 work.
- Hot phases (measured by gaps between consecutive event lines):
  `living-native-materialization-attempt` 39–43 s,
  `living-native-durable-slot` up to 75 s,
  `coop-player-prey-eligibility` 48 s,
  `universe-sites` p95 45 s (not dominant in the last window).

## Fixed already (fork, image `6d15d4b`)
1. `546936f` — existence checks called `runtime.ensureScene(system)`, which BUILDS a
   whole solar system (belts, gates, 40k asteroid records) just to answer "does this
   ship exist". Called once per stored identity link, every tick. Replaced with
   `findNativeShip()` in `space/coopVirtualWorldRuntime.js` (loaded scene answers
   directly, unloaded one from `npc/nativeNpcStore`). Three call sites.
2. `a2ec062` — `allowsPlayerPrey()` emitted a `coop-player-prey-decision` event with a
   synchronous `appendFileSync` for every attacker × player pair, every tick. Now one
   event per (attacker, target, verdict, reason).
3. `5345aca` — `EVEJS_COOP_PLAYER_PREY_DEBUG` was pinned to `1` in `Code/compose.yaml`
   (per-pair JSON dump into the container log). Now `0`.

None of it is live on the play stack yet: it needs one restart window.

## Next steps (in order)
1. Restart the play stack with the owner's consent, then re-measure with the two
   probes kept in `%TEMP%\opencode`: `stall-probe.cjs` (event-loop stalls) and
   `log-gaps.mjs` (stalls named by the log line before them).
2. If `living-native-durable-slot` is still huge: `space/coopNativeMiningFleetDurable.js`
   restores slots (entities, modules, cargo) — make it incremental (one slot per tick)
   and cache the per-slot signature instead of re-reading store rows.
3. `space/coopUniverseSites.js` `reconcile()` — split per system across ticks; it is
   called with the whole `visitedSystems` set.
4. Re-enable `EVEJS_COOP_PERF_METRICS` samples: `coop-perf-sample` events stopped on
   2026-10-30T22:26 although `enabled()` returns true in a fresh process, so the
   in-server 60 s timer is not emitting. Fixing that gives per-phase timings for free.

## Done (2026-11-01): more 350mm Carbide Railgun I for sale, no restart
Type `14280` (SDE name "350mm Carbide Railgun I", market group 566). Stock was 1 at
station `60003760` (Jita IV-4), where the owner is docked.
**Live seeded-stock path — reusable, needs no server or market restart:**
`POST http://127.0.0.1:40110/v1/admin/seed-stock/adjust` with
`{station_id, type_id, delta_quantity|new_quantity, new_price?, reason}`.
The market daemon (Rust) applies it in a transaction, invalidates the scope caches and
refreshes the summaries, so it is still real seeded stock — not an invented player order.
It only UPDATES an existing `seed_stock` row; a new station needs the offline seeder
(`scripts/Bootstrap-Coop-Market.ps1`, which takes the `.market.lock` and therefore a
market stop). Verify with `GET /v1/orders/{region_id}/{type_id}`.
Result: 100 units at 704,900 ISK, `source: seed`, confirmed in the order book.
Whole 350mm hybrid line then stocked the same way at 60003760 (region 10000002):
14280 Carbide 100, 14282 Scout 50, 14284 Compressed Coil 50, 14286 Prototype
Gauss 50, 12354 Railgun I 50, 12356 Railgun II 50.

**Why the client can still show the old quantity** (`eve/client/script/ui/services/
marketsvc.pyj`, `RefreshOrderCache`): the client keeps `orderCache[typeID]` and after
calling `GetOrders` it compares `GetCachedMethodCallVersion` with its stored version;
if the version matches it DISCARDS the fresh payload. The server only rebuilds that
version inside `buildCachedMethodCallResult` (i.e. when GetOrders is actually served),
so a market window opened before an out-of-band change keeps its copy until that type
is re-selected. `CACHE_INTERVAL = 300` is defined but unused — there is no timer.
The client's Quantity column is `volRemaining` (`market/quote.pyj GetQuantity`).

**Known cosmetic defect of the live adjust path:** `adjust_seed_stock` updates
`seed_stock.quantity` but not `initial_quantity`, and the seed sell row maps
`vol_entered = initial_quantity` (`state.rs query_order_book_rows_with_connection`),
so an adjusted row reads "remaining 100 / entered 1". Harmless for quantity display,
wrong for anything showing `volEntered`; a reseed sets it correctly.

## Owner's Talos: 10 ready fits (2026-11-01, Jita IV-4 60003760)
Granted 10 Talos hulls (4308) via `admin_batch` (10x `give_item`) and fitted each in
one `admin_batch` of 10x `give_fit` with an explicit `itemID` (omitting `itemID` makes
`giveFit` reuse the OLDEST docked hull of that type — never do that for a batch).
Every hull verified 8 high / 4 mid / 5 low / 3 rig + drones + ammo:
695 Rail Sniper T1 (350mm I, Iron/Lead, 4x Tracking Computer, 3x Locus)
696 Rail Sniper T2 (350mm II, Spike, MFS II, DC II, 3x TC II/Sensor)
697 Blaster Brawler T1 (Neutron I, Antimatter, scram/web/cap booster, 1600 plate)
698 Blaster Brawler T2 (Neutron II, Void, MFS II, 1600 plate)
699 Shield Kiter (350mm Prototype Gauss, 50MN MWD, disruptor, 2x LSE, 3x extender rig)
700 Armor Buffer (350mm Compressed Coil, 1600 plate, 2x multispec membrane, 3x Trimark)
701 Active Armor PvE (350mm Scout, MAR II, cap rechargers, 2x aux nano pump)
702 Drone Support (Electron I, 2x DDA I, 2 Hammerhead + 1 Hobgoblin)
703 Anti-Tackle (350mm I, Lead, 2x TE I, 3x Metastasis, 5x Warrior)
704 Null Blaster Kite (Ion II, Null, 50MN MWD, disruptor, web)
Item IDs are `9988400120695..9988400120704`. Ship names are still the default "Talos";
there is no admin rename action, the owner renames them in the client.

**2026-11-01: rename_item added** (fork `d730d47`): `coopAdminBridgeActions.renameItem`
uses `itemStore.updateInventoryItem({itemName})` (the primitive behind
`invBroker.SetLabel`) and pushes `OnCfgDataChanged/evelocations` to the live session.
Whitelisted as `rename_item`, exposed as MCP `admin_rename_item` (also usable as a
batch action). Needs one play-stack restart to be live there; proven on `evejs-agents`.

**Also granted 2026-11-01: 5 Algos + 5 Vexor, all fitted and verified.**
Algos `...120928..120932`: Rail (125mm I, Iron S), Blaster (Light Neutron, Antimatter S),
Drone (2x DDA I, 5 Hobgoblin), MWD Tackle (5MN MWD, disruptor, web, 5 Warrior),
Anti-Frigate (150mm I, 2x TE I, 3x Metastasis). Each 5 high / 3 med / 3 low / 3 small rig.
Vexor `...120933..120937`: Rail (200mm I), Blaster (Heavy Neutron, 800mm plate + MAR),
Drone (3x DDA I, 5 Hammerhead + 5 Hobgoblin), Shield Kite (250mm I, 50MN MWD, 2x MSE),
Armor Buffer (Heavy Ion, 800mm plate, 2x multispec, 3x Trimark). Each 4 high / 4 med / 5 low / 3 rig.
Algos 32872, Vexor 626; drone limits: Algos 60 m3 bay, Vexor 125 m3 / 75 Mbit.

Planned labels for `admin_rename_item`: 695 "T1 Rail Sniper", 696 "T2 Rail Sniper",
697 "T1 Blaster Brawler", 698 "T2 Blaster Brawler", 699 "Shield Kiter",
700 "Armor Buffer", 701 "Armor PvE Rep", 702 "Drone Support", 703 "Anti-Tackle",
704 "Null Kiter"; 928 "Algos Rail", 929 "Algos Blaster", 930 "Algos Drone",
931 "Algos MWD Tackle", 932 "Algos Anti-Frig"; 933 "Vexor Rail", 934 "Vexor Blaster",
935 "Vexor Drone", 936 "Vexor Shield Kite", 937 "Vexor Armor".

## Traps
- `docker cp` over `/var/lib/evejs/gameStore/gamestore.sqlite` makes the file
  root-owned; the server then logs `sync flush FAILED ... readonly database` and loses
  every write. Fix: stop, `chown 1000:1000` on the volume, delete stale `-wal`/`-shm`.
- The play stack is being recreated by something outside this session (19:58, 20:07,
  21:54, 20:44) — check that before blaming a measurement.
- Never measure during boot: 50 s stalls in the first 2 minutes are startup, not lag.
