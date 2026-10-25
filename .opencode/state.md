# State — ALIFE economy loop CLOSED, 2026-10-25 evening (session 2)

## Milestone: first real ore delivery by NPCs, no player involved
`living-npc-station-delivered` at 19:40:10Z, fleet 1, **station 60014935, stacks 2,
oreQuantity 30 597**, chosen by the resolver with `chosenRevenue 50 867 500 ISK`
(filled 10 000 of 30 597). Chain proven end to end:
mine (cargo on miners) → `living-hauler-loaded` → hold 45 s → resolver CHOSEN →
**warp accepted** → physical arrival → warehouse deposit → fleet state `mining` again,
miners refilled to 12 492 + 10 924 within 4 minutes. Loop repeats.

## Bugs found and FIXED this session (all pushed)
1. `scripts/coop-native-station-arrival-patch.cjs` — the `loaded` branch fell through to
   the native `haulereturn` transition immediately after `routeFromHaul`, so the state
   machine never waited for the physical trip and `checkReturn` reported
   `ROUTE_NOT_STARTED` forever (`haulereturn` with no trip never becomes terminal).
   Now: stay `loaded` while the trip is in flight, resume mining only on
   `DELIVERED`/`NO_CARGO`; `checkReturn` returns terminal `NO_ACTIVE_TRIP` for the
   self-healing case.
2. `integration/coopNativeStationArrival.cjs` — the director used
   `space/runtime.warpToPoint(session, …)`, which a **sessionless durable hauler can
   never satisfy**; every trip died with `WARP_COMMAND_FAILED`. Now uses
   `npc/npcRuntime.warpToPoint(entityID, …)` (the one stock mining uses) and emits
   `living-npc-station-warp-rejected {errorMsg, ackKeys}` instead of swallowing it.
3. `scripts/coop-market-catalog-patch.cjs` — removing the hook on a **pristine**
   `marketProxyService.js` threw, so after `git checkout` the installer refused to
   install anything (`ANCHOR_MISMATCH`). Removal is now idempotent. This is why the
   "always checkout first" advice sometimes bricked the install.
4. Merge fallout: `coop-alife-order-authority.test.mjs` (stale `advanceNativeAmmoSupply()`
   signature) and `coop-alife-native-resupply-wiring.test.mjs` (neighbour-pair assertion
   conflicting with COOP-043's station-authority entries) — both updated to assert the
   real module list / signatures.
5. `integration/coopMiningTrace.cjs` wrote `at` (number) into the event, overwriting the
   ISO timestamp of every `living-mining-blocker` row → now `atMs`.
6. New diagnostics: `MINER_NOT_IN_SCENE_OR_WARPING` (showed miners were alive in `WARP`,
   not missing) and per-module `active` / `activeTarget` in `living-mining-fleet-state`
   (proved the modules really cycle).

## Integrated from origin/main (27 commits, `4c315ba`)
ALIFE-02 native resupply act (`coopAlifeNativeResupplyBridge`), COOP-043 station
authority, COOP-044/045 industry + demand integrity, COOP-046 market policies,
COOP-047 partial fills, COOP-048 player-market buyer, escort tactics. Note:
`alifeOrderArbitrationEnabled()` now treats `EVEJS_COOP_ALIFE=1` as the master switch,
so the live world runs with order arbitration on even though
`EVEJS_COOP_NPC_ORDER_ARBITER` is unset. All the sub-features stay behind their own
flags. The new resupply act is **OFF** here (`EVEJS_COOP_ALIFE_NATIVE_RESUPPLY_ACT`,
`EVEJS_COOP_NPC_AMMO_SUPPLY`, `EVEJS_COOP_NPC_STRICT_AMMO` unset) — review note:
`coopNpcAmmoSupply.tick(..., observeOnly)` sets its 180 s lease *before* the
`observeOnly` return, so MONITOR_ONLY deliberately fences ammo-exhausted pirates out of
patrols/raids; the only honest exit from that fence is the PLANNED intent from
`coopAlifeEconomy`, so do not enable the act without the economy observer running.

## Next link of the loop: ore in the warehouse is not ISK yet
`living-economy-destination` proves the money exists (`revenue 50 867 500`), but the
delivered cargo is now warehouse stock, while `advanceNativeMarket()` only trades
**native cargo on ships** (`listNativeCargoForEntity`) behind
`EVEJS_COOP_NATIVE_NPC_MARKET=1` + `EVEJS_COOP_NPC_MARKET_SELL_TYPES`. Decide the
settlement shape before enabling:
- (a) sell the hauler's cargo at the station *before* the warehouse deposit, or
- (b) teach the warehouse to hand stock to the native market trader and credit ISK.
Prefer (b) if the depot already has a committed ledger, else (a) with a durable journal.
Perimeter (30000144) still reports `HOLD_NO_BUYER` for its Veldspar — honest, not a bug.

## Deploy loop (unchanged, but safer now)
`git checkout -- marketProxyService.js miningNpcOperations.js` in
`C:\Games\EveCoop\upstream-evejs` → `node scripts/patch-evejs-coop.cjs --code-path …` →
`--check` = `OVERLAY_OK` (129 modules) → `docker build -t evejs-local .` →
`docker compose -p evejs -f compose.yaml -f compose.coop-probe.yaml up -d`.

## Merchant pricing (added after the closed loop, OFF by default)
`integration/coopNpcSellPricing.cjs` — pure policy, 10 tests: a stack starts at the best
real bid on its station, the asking floor steps down `stepPct` every
`stepIntervalMs` while unsold, hard floor `floorPct`, and a sale resets it. The guarded
trader now (a) picks the **highest-priced** matching SEED order instead of the first
row the daemon returned (real bug: a seller must take the best bid) and (b) refuses a
bid below the policy floor with `PRICE_BELOW_FLOOR` (no `FillOrder`, cargo untouched).
Telemetry `living-npc-sell-policy`. Flags: `EVEJS_COOP_NPC_SELL_PRICING`,
`..._STEP_INTERVAL_MS=120000`, `..._STEP_PCT=0.05`, `..._FLOOR_PCT=0.55`.

## Patcher is finally re-installable (this was blocking every deploy)
`classifyFile` treated "cannot REMOVE a hook from a pristine file" as drift, and the
git-HEAD fallback died on `maxBuffer` for `runtime.js`, so after any `git checkout`
the installer refused with `ANCHOR_MISMATCH`/`DRIFTED`. Now: removal is idempotent in
`coop-market-catalog-patch`, classification falls back to `git show HEAD:Code/<file>`
with a 64 MB buffer and reports PRISTINE/PATCHED/DRIFTED honestly. Result: 32 native
files revert cleanly and reinstall to `OVERLAY_OK` with **147 overlay modules**.
Helper command used: revert every spec file with `git checkout --` (32 paths).

## Still open: delivered ore is warehouse stock, not a sellable stack
`advanceNativeMarket()` only sees native cargo **on ships**, so ore delivered to the
warehouse can never be sold. Two honest options, pick one before enabling
`EVEJS_COOP_NATIVE_NPC_MARKET`:
- (a) sell at the station **before** the warehouse deposit: the hauler is physically
  within 10 km, cargo is real, the guarded trader settles into the NPC ledger, and only
  the remainder is deposited;
- (b) teach the warehouse to hand committed stock to the trader (needs its own journal).
(a) is the smaller, more player-like change and needs no new storage semantics.

## Watch
- Mining still has a slow phase right after a restart (miners ~10 min to fill), but it
  now recovers by itself after each delivery.
- Pre-existing failures, unrelated: `coop-escort-station-predeparture-gate.test.mjs`
  (2/7) and `coop-escort-flight-stage-c.test.mjs` (`ESCORT_PREPARING_SOURCE_UNAVAILABLE`).
