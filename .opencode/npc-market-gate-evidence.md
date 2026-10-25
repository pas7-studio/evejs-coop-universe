# NPC market gate — evidence log (test project evejs-npcmkt-test)

## Isolation (verified)
- Upstream `compose.yaml` pins the volume with an explicit `name: evejs-data`, so it is GLOBAL,
  not project-scoped. First attempt mounted the LIVE database; the market container refused to
  start ("The market database is currently in use") and nothing was written.
- Fix: override declares `volumes: evejs-data: name: evejs-data-npcmkt-test` plus re-published
  host ports 41110 / 15222 / 1443 / 16100-16102.
- Live world during the whole gate: `evejs-server-1` + `evejs-market-1` Up (healthy),
  market 1 006 304 orders, volume untouched.

## Test seed (own volume)
- Run 1: `--solar-system-id 30000144` -> 1 system, 5 stations, 96 760 rows.
- Run 2: `--solar-system-id 30000144 --solar-system-id 30000145` -> 2 systems, 10 stations,
  193 520 rows (needed because the live fleet works in 30000145, not in Perimeter).

## 6.1 Negative control — PASS
- `EVEJS_COOP_NATIVE_NPC_MARKET=1`, empty SELL/BUY allowlists, 10 minutes:
  126 events, zero market/NPC trade events. The flag alone cannot trade.

## Discovery so far
- Active fleet in the test world: 30000145 (New Caldari), `state=mining`, 2 miners + 1 hauler,
  2 loaded ore ships, 13 physical NPCs, ore growth observed.
- Ore type IDs observed in events: 1228, 17463, 17464 (quantities 3780 / delta 840 on a miner).

## Counterparty exists — no fabrication needed (read-only query)
- `seed_buy_orders` for 30000145: 96 760 rows, 19 352 distinct types.
- Our cargo type 1228 is really bought at 5 stations, 5 000 units each:
  best `station_id=60003724`, `price=4605.77`; runner-up `60000682` at 4588.46.
- Type 17463 is also bought (best 4 969.80 at 60014935).
- Consequence: `MAX_PRICE` must be >= 4606, so the sell checkpoint uses 5 000 (not the 1 000
  used in the negative control, where price did not matter).

## 6.2 Sell checkpoint — 0 events, and a real methodology trap

First run (`SELL_TYPES=1228`, `MAX_QTY=1`, `MAX_PRICE=5000`, `COOLDOWN_MS=60000`, 5 minutes):
**zero** `living-native-market-*` events.

Diagnosis (this invalidated my first interpretation and is worth keeping):

1. Added `EVEJS_COOP_NPC_MARKET_TRACE=1` to our overlay and installed it into the host Code
   checkout -> still zero trace events.
2. Root cause: the compose **server service runs the prebuilt image `evejs-local`; `./server/src`
   is NOT bind-mounted** (only `server/certs`). Editing the host checkout changes nothing inside
   a running container, so any evidence taken before an image rebuild describes the previous image.
3. The image was **not** stale for market code: `coopNativeNpcMarket.js` and
   `coopNativeIndustry.js` hashes inside `evejs-local` match the host checkout, so the 0-event run
   is valid evidence for the current overlay: the gate really skipped, and skips are silent.

Gate rule added: every evidence run must record the image id/creation time and the in-image hash
of `coopVirtualWorldRuntime.js`, and use an image built from the same revision as the checkout.

## 6.2b Skip diagnostics (opt-in, default OFF)

- Branch `feat/npc-market-trace-20261025` off `origin/main` 46af4e3:
  `EVEJS_COOP_NPC_MARKET_TRACE=1` emits one `living-native-market-trace` event per tick with
  counters `roleSkip / blockedSkip / busySkip / noStation / systemsNoStation`, the first busy
  sample (pilot, target, mode) and the closest real station gap in meters; pure exported helper
  `nearestStationMeters()` + 4 unit tests (26/26 targeted tests pass).
- Isolated image `evejs-npcmkt-local` built from the same host checkout (separate tag, so the live
  `evejs-local` image is untouched).
- Known NPC population in the test world (`coop-npc-links.json`): 45 links;
  `30000145` = miner x2 + hauler x1, so the role filter cannot be why every candidate is dropped.

## Next
1. Re-run the sell checkpoint on the isolated image with TRACE=1 and read the first trace event.
2. Report the exact skip counter/sample; never relax the gate to make a trade appear.

## Status
- Isolation: PASS
- 6.1 negative control: PASS
- 6.2 sell: PASS/FAIL pending trace (0 settled trades so far; cause now measurable)
- 6.3 buy, 6.4 restart: NOT STARTED
- Live world: unaffected

## 2026-10-25 (evening) - three silent failures found and fixed

1. **Installer dropped a module.** The rewrite of scripts/patch-evejs-coop.cjs
   lost coopNpcChatter, so Code/.../coopNpcChatter.js was never installed.
   The runtime threw Cannot find module ./coopNpcChatter inside the background
   phase: mining, haul, market and station arrival all stopped writing events
   while the container stayed healthy. Fixed the names array (74 modules) and
   added 	ests/coop-installer-module-coverage.test.mjs.
2. **Warp rejection reason discarded.** coopNativeStationArrival.start() threw
   away errorMsg from the native warp, so WARP_COMMAND_FAILED was
   unexplained. Now recorded as life-blocker.reason + haulerID.
3. **Reused volume does not re-seed the mining fleet.** After several restarts on
   the same disposable volume the stock EveJS mining startup slot is not seeded
   again (living-native-mining-startup-slot absent, industry reports
   NO_NATIVE_FLEET for Jita) and the durable restore path has nothing to
   revive, so the world looks alive but nothing mines. Gate rule: a delivery or
   market gate run must use a **fresh disposable volume** (down -v + re-seed).

Also recorded: the raid log line
[CoopLivingWorld] Native pirate raid {... "targetRole":"hauler"} fires in the
same window as a station-warp attempt, so "busy/fighting" must be treated as a
legitimate blocker (ALIFE P0 survival > P3 logistics), never as a bug.


## Clean-volume run (15:03-15:15) - chain stops BEFORE the gate

Fresh volume, market re-seeded (193 520 rows / 10 stations), delivery + ALIFE trace ON.

Facts:
- living-native-mining-startup-slot SEEDED appears (fresh volume fixes the
  'no fleet' state of reused volumes);
- living-native-industry 30000144 ACTIVE fleets[0] = {state:'mining',
  minerIDs:[...109,...110], haulerIDs:[...111]};
- but every miner has items: [] and oreQuantity: 0 for the whole 12 min, and
  every living-native-activity sample reports oreGrowth: 0;
- therefore cargo-loaded never happens and the station gate is never reached
  (no life-blocker, no station-warp-requested). The gate itself is fine.

Persistent-store probe (read-only, gamestore.sqlite):
- hauler 980000000111 exists, 	ransient:false, position ~2.2 AU from origin,
  mode:'STOP', profileID:'ore_mining_venture',
  **ehaviorProfileID:'npc_passive_idle'**;
- miners 109/110 are transient (not in 
pcEntities), as designed;
- 
pcCargo is empty ({}) and 
pcRuntimeControllers holds only per-ship
  rows - the mining *fleet record* lives in memory only.

Open question (next probe, not a guess): does the native mining controller
attach to these materialized hulls at all? Needed evidence per tick: miner
target rock, controller state and current ore, emitted by
coopNativeIndustry.snapshot() under EVEJS_COOP_ALIFE_TRACE=1.

Implication for ALIFE-1: the 'loaded' stage is not enough - the mechanism needs
an explicit PERCEIVE assertion that a fleet's miners are actually attached to a
real mining controller, otherwise the world reports state:'mining' while
producing nothing (same silent-blocker class as before, one stage earlier).
