# Co-op handoff (2026-11-06, fork tip `a461abe`)

## 2026-11-06 — NPC corporations really buy the owner's asks (`a461abe`)

Owner rule: *"make the NPCs buy the asks if they are a reasonable price — I asked for this long ago."*
The blocker was measured, not guessed:

* the pinned market daemon has **no claim RPC**: `externalservices/market-server/src/rpc.rs` has no
  `ClaimNpcCorpPlayerSell` / `FinalizeNpcCorpPlayerSell` / `GetNpcCorpPlayerClaim`, so
  `coopNpcCorporateBuyerAtomic.purchaseOnce` — the executor the maker was wired to — could never
  settle anything;
* `ReserveNpcSellOrder` / `ActivateNpcSellOrder` are missing too, so the relist half and every
  NPC sale through `coopNpcPendingMarketEscrow` are dead until the daemon implements them;
* `readPlayerAsks` never returned the seller, so `lot.sellerOwnerID` was **0**;
* `FillOrder` on a player ask closes it and pays nobody (measured on order 281: bid stayed open,
  wallet unchanged).

New `space/coopNpcPlayerAskLift.js` (COOP-LIFT) is the executor that pays: deterministic fill id
from the claim key → book/escrow/exact-price agreement → durable `LIFT_FILL_ISSUED` marker →
`FillOrder` with exact ACK verification → the **unchanged** COOP-048 `atomicSettle` (real corporate
ISK, real native tax, real item move, durable receipt). Crash between fill and payment resumes
exactly once; a row somebody else closed is never paid.

Band: `EVEJS_COOP_TRADER_BUY_MAX_PCT=1` (at or below the real ask), `EVEJS_COOP_TRADER_MIN_PROFIT_BPS=300`,
`EVEJS_COOP_NPC_BUY_PLAYER_ASK=1` — all three are in `Code/compose.coop-probe.yaml`. Lots are never
truncated (whole escrow stack only) and a `BLOCKED` executor answer is retried 3× then fenced.

Evidence: `tests/coop-npc-player-ask-lift.test.mjs` (13) + 16 trader-maker cases + the full suite.
**Verified live on the play stack 2026-11-06**: 22 of his 23 asks were bought at the configured band,
gross 1 231 691 000 ISK, native tax 55 179 756.8, net to him 1 176 511 243.2 (wallet
756 929 709.48 → 1 933 440 952.68), every module now in 1000035's hangar at 60003760, 22 committed
receipts with zero conservation violations. Seven defects were found and fixed in that order; the
whole list is `docs/NPC_MARKET_MAKER.md` §10.

**The resale half now works too** (fork `7e0f4bf`, `8faa1c0`, `ce16e43`): the daemon implements
`ReserveNpcSellOrder` / `ActivateNpcSellOrder` / `GetNpcSellOrder` (pending → escrow → open, idempotent
by operation id, `market_orders.operation_id` + `source_item_id` added by migration), the relist
ceiling is 1 B ISK instead of 1 M, singletons are accepted, and the trader's own asks never set the
reference. Verified live: **22 of 22** bought modules are listed on the book at 140 % of the market,
each with a real `marketEscrow` sell row for the corporation and the module physically in that escrow
container (`docs/NPC_MARKET_MAKER.md` §11).

**The buy-back half is closed too** (fork `0f749ed`): the daemon implements `ClaimNpcSellOrder` /
`FinalizeNpcSellOrder` / `GetNpcSellClaim` (open → settling → filled, one buyer per order, fill id
derived from the order so a retry is idempotent, a settling order is off the book), the settlement
accepts the third provenance `npc-trade:` (singleton module or whole bought stack, escrow
`NATIVE_TRADE`, receipt `NATIVE_TRADE`), the 1 M ISK ceilings are 1 B, the `corporationRuntime` row is
accepted without an embedded id, and the price tolerance is a thousandth of a cent instead of 1e-7
(a real 139 M ISK module with cents used to be refused). Play-stack flags
`EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT` / `_PROOF` were never on; they are now.
Live: the Rust state machine walked end to end on a synthetic order of its own (claim, idempotent
re-claim, finalize, idempotent finalize, foreign buyer refused, wrong order refused, book empty), and
a read-only probe says **22 of 22** real listings pass every guard `buyFromOrder` applies
(`docs/NPC_MARKET_MAKER.md` §12).

Still open: the owner's own click. Buying a `coop-npc` ask needs a real authenticated, docked session
— the session guard is exactly what must not be faked — so the last step is his market window.
Total cost of the 22 listings is 2 036 202 000 ISK against his 1 933 440 953 ISK: he can take 21.

**The ammo "loss" was not a loss** (2026-11-06, from the audit log and the durable receipts). Two
`living-item-audit` rows name the whole path of the rocket batch: `removeInventoryItem` by
`coopNpcMineralLift.js:259` (lifted out of the hangar) and `removeNativeCargo` by
`coopNativeNpcMarket.js:147 applyAck` (the native market ack consumed the cargo because the stack was
SOLD). The durable receipts agree: `/var/lib/evejs/coop-native-market/receipts` holds **2 SETTLED
receipts for type 215 (1 000 Iron Charge S, 4 940 ISK)** and **3 for type 2514 (700 Inferno Rockets,
4 529 ISK)** — 264 receipts in total, every one SETTLED. What is left of the charges (478) is still
owned by NPC corporation 98000001 in a fitted/charge location, loaded onto fleet ships and partly
fired under `EVEJS_COOP_NPC_STRICT_AMMO=1`. My earlier "vanished with no event" reading was wrong:
the audit did capture it, the caller names are in `coop-events.jsonl` (292 audit rows, every one with
a caller), and the sale is receipted. `EVEJS_COOP_ITEM_AUDIT` stays ON — it is what answered the
question. So the old handoff items "prove the ammunition sale end to end" and "two ammo batches
disappeared" are both **closed**.

**The owner's market window really renders the NPC asks**: `buildOrderRowset` on the live book
returns a real `Rowset` (price / volRemaining / typeID / range / orderID) with 3 asks for 23803,
3 for 21472, 1 for 4959, and the handler's access filter only hides `source: "coop-corporation"`
rows, never `coop-npc`.

Still parked: 10 manufactured Caldari Shuttles (type 672, 5 000 m³ each) at 60000682. The blueprint
chooser now refuses a product that cannot fit the hold (`WILL_NOT_FIT_THE_HOLD`), so no new ones are
built; the ten that exist are inert stock and the market-sell loop retries type 672 every cycle with
`NO_REAL_NATIVE_CARGO`. Options, all operator-level: leave them, sell them at the factory station, or
repackage them (a packaged shuttle is 2 500 m³ and would fit the 3 100 m³ hold — that needs a native
repackaging step the fleet does not have yet).

**The refinery was dead for a day and is alive again** (fork `df86231`, `e76e66a`, `df53bba`). It had
been `BLOCKED` since 2026-11-05 14:05 with 10 778 `living-npc-refinery-blocked` events, so no ore had
become minerals for a day. Three independent defects, each fatal on its own:

1. `payFee` returned the bare `OPERATION_ALREADY_COMMITTED` status when a charge was already reserved,
   so the refinery asked for a fee it had already paid and never moved;
2. a charge reserved AND debited whose receipt file was lost (a crash in between) could never be
   proved paid. The durable commitment ledger is now the authority: the receipt is rebuilt from it,
   and only when `balanceBefore - amount === balanceAfter`;
3. the charge was keyed by the ore stack alone while the refine runs per (item, quantity), so any
   stack whose quantity changed after the payment could never pay again; and `reserve()` treated a
   `REFUSED` row (written when the spend scope was exhausted) as a commitment, so raising the ceiling
   changed nothing.

Also: the fee budget is a LIFETIME cap, and 5 M ISK bought ~260 refines before it was exhausted at
4 990 915.62. The play stack's ceiling is 50 M ISK now (`EVEJS_COOP_REFINERY_SPEND_LIMIT_ISK` and the
budget file, `setBy operator:m003-refinery-fee-budget-20261106`); the corporation's own wallet still
bounds it from below.

Measured right after the deploy: **72 stacks refined in 58 s, 0 blocked**, 2 312 370 units of ore
(types 1228, 1230, 17463, 17464, 17470, 17471) turned into minerals, 392 295.86 ISK of real station
fees paid, wallet 46 478 850.22 → 45 528 194.67. `living-coop-loop-phase refinery REFINED`.

**After the host restart (2026-11-06 17:10 local):** Docker Desktop and the whole play stack were
down; both were brought back (`Docker Desktop.exe`, then `Start-Play-Stack.ps1 -Action Up`) and the
stack is healthy again (`evejs-server-1` / `evejs-market-1` up, SSH banner on 55470 OK). The refinery
fix survives the restart: **96 more stacks refined, 0 blocked**, 2 442 927 units of ore, fee budget
7 461 904.02 of 50 000 000 spent. Nothing was recreated; the volumes were reused.

**The world was late on its own timer and is much better now** (fork `6e0a823`, `5a9d848`). The
event-loop monitor had been reporting a 467 ms median delay all day (p90 1 994 ms, p99 7 487 ms,
worst **62 916 ms**), which is what a client feels as a frozen server. The cause was measured, not
guessed: the dungeon table holds **8 674 instances**, and `dungeonRuntimeState.mutateState`
deep-clones and re-normalizes the whole table unless the caller promises its mutator REPLACES whole
records. Two hot mutators did exactly that but never promised it, so every site creation, every
expiry and every lifecycle change paid it - and sites expire on every world tick.

Measured on the live table: deep clone **1 533 ms cold / 431 ms warm**, shallow copy **0.26 ms**.
The three mutators (`createInstance`, `tickRuntime` expiry, `setLifecycleState`) now replace their
records and take the documented fast path, the same one the universe seeder already used.

After the deploy (16 samples, 12 min): p50 446 ms, p90 **939 ms** (was 1 994), worst **1 706 ms**
(was 62 916), RSS **2.91 GB** (was 3.65 GB). The median did not move, and the next target is known
and measured: `gameStore.read("dungeonRuntimeState", "/")` inside `applyPersistedDiff` costs
**428 ms** for the first read after any write, so every mutation still pays it. Fixing that means
changing what the diff compares against - correctness-sensitive, so it stays a separate task.

Also closed in the same pass: the ammo "loss" (sold, receipted) and the client rendering check are
in the blocks above; `state/NOW.md` is still the 2026-11-04 snapshot and needs a republish.

**ALIFE status, 2026-11-06 15:15Z** (fork `78e6a32`). Alive and working: 5 547 life events in the
sampled window, **31 settled trades** (a `TRADE_SETTLED` about every minute), 1 delivery, 100 fleet
pilots across 5 systems (Perimeter 23 + 36, Tama 15, Sasta 13, Jita 13) with miners, haulers,
patrols, traders and pirates, 31 systems carrying ore/goods/demand/security/losses, the refinery
back from the dead, manufacturing running (`BUYER_ELSEWHERE` is the manufacturer deciding to build
for the Jita buyer one gate away - informational, not a refusal).

One real defect is open and now instrumented: **fleet 960004610 (system 30000144) was parked for
two days** - `HAUL_MINER_NOT_PHYSICALLY_ATTESTED:miner_needs_repair` / `:fleet_needs_repair` from
2026-11-04 19:27 to 2026-11-06 15:03 (639 attestation events, 9 344 `living-haul-empty-retry`),
and nothing in the engine clears `coopHaulNeedsOperatorRepair`. The history starts with 1 378
`HAUL_SOURCE_CARGO_IDENTITY_CONFLICT` events (04.11 19:27-21:05), so a cargo-identity conflict
parked the fleet and the flag was never resolved. The event stream never said WHICH failure set it,
so the attestation event now carries `repairReason` (the stored reason string); the next occurrence
names the real cause. The flag did not survive the 15:10 restart - the fleet is not blocked right
now - but the class of bug (a doubt with no way back) is still there and is the next thing to fix:
an evidence-based repair for every reason that can be proven resolved, not only the readback one.

**The two-day parked haul fleet: root cause found and fixed** (fork `e5c6134`, `2038a0a`). The heal
for the readback doubt was in the engine all along and could never fire, because the stored reason
was `ALIFE10_ALIFE10_POSTCOMMIT_CUSTODY_READBACK_FAILED:destination_rows=0:cargo=980200450759` -
the caller prefixes `ALIFE10_` onto a reason that already carries it - while the matcher expected
exactly one prefix (`/^ALIFE10_POSTCOMMIT_.../`). So the doubt it was written for was invisible to
it, and fleet 960004610 stayed parked from 2026-11-04 19:27 until a restart.

Three changes:
* the caller no longer doubles the prefix;
* the matcher accepts any number of prefixes, so a flag already stored in the doubled shape heals;
* a second, independent way back was added for the other doubt that parked the same fleet
  (`HAUL_SOURCE_CARGO_IDENTITY_CONFLICT`, 1 378 events): every cargo row must now name the miner as
  its entity and owner, be durable, carry a positive quantity, be ore, and have a globally unique
  cargoID - the same clauses the conflict was raised from. `healCustodyRepair` is the single entry
  point and `living-haul-repair-healed` names which proof fired.

Verified after the deploy: the fleet loaded cargo (`living-mining-blocker TICK_loaded` at
16:00:56Z) and there has been no `living-haul-custody-blocked` event since. Tests: 14 in the two
heal suites, 103 across the haul suites, 0 failures; `AUDIT_OK`.

**Event loop, measured properly** (fork `2bdf38f`). The monitor only reports a sample when the
delay is at least 250 ms, so the numbers are about STALLS, not about the loop being busy: ~1 stall
per minute (2 547 in 44 h), median 446 ms, p90 1 994 ms, worst 62 916 ms before the three dungeon
fixes. After them: no stall above ~1.3-1.7 s in any measured window, RSS 3.65 GB -> 2.92 GB.

The last fix removed the per-mutation whole-table read: `applyPersistedDiff` called
`repo.read("dungeonRuntimeState", "/")` (428 ms warm, 1 533 ms cold, measured) to find out which
rows changed, while the module already held that exact table in memory (`loadState()` is
`cache.state`, rebuilt after every write, and nothing else writes this table). `mutateState` now
passes its own base; the initial load and `writeState` still re-read, so the path without in-memory
state keeps its proof. Verified after the deploy: 8 684 instances, all active, expiry range sane, no
expired-but-present rows - the diff still writes exactly the changed rows.

What remains is the world tick itself (~380-450 ms for 46 phases), not a single hot spot; further
work there means profiling the phases, which is a separate project. Full suite after all of it:
7 674 tests, 7 579 pass, 0 fail.

**Telemetry was the biggest self-inflicted stall** (fork `f04bf21`). `EVEJS_COOP_MEMORY_METRICS=1`
samples once a minute, and it answered four registry questions by DEEP-CLONING the registries:
`getStateSnapshot()` for the dungeon (1 669 ms for 8 796 instances), `listNativeEntities()` 432 ms,
`listNativeControllers()` 863 ms, `listNativeWrecks()` 10 ms - **~2.97 s of blocked event loop every
60 s**, for numbers nobody reads in that instant. The sampler now uses counters that walk the live
cache: 0.67 / 0.64 / 0.03 / 0.76 ms, every value identical (verified side by side on the live table).

**The missile freeze (client, not server).** The owner's client hung dead at 2026-11-06 17:44:24 while
firing six Cruise Missile Launchers; the server kept sending updates throughout, so the server was
fine. The server log shows `[DestinyAuthority] Repaired owner_missile_lifecycle` **every second**
during the flight, with the ceiling being lowered each time. The engine's own comment explains why:
with six launchers the missile lifecycle stamps compound ~12 per tick, and the hard cap
(`ownerCriticalCeilingStamp`) forces them back to near the current session stamp so the client's
`_current_time` cannot run ahead of wall clock - which is exactly what the 2026-11-04 movement fix
(`f9d7b92`) had to trade against. **No blind patch was applied**: the lead constant is used in ~40
places and the cap is load-bearing. Next reproduction needs the missile trace
(`logs/space-missile-debug.log`, gated by log level >= 2) to capture the exact batch that wedges the
client.

Open performance picture after the fix: the current window still shows p50 ~1.36 s and a 8.6 s worst
stall, with RSS climbing to 4.5 GB while **every registry is stable** (8 559 entities, 8 797 dungeon
instances, 428 wrecks) - that is heap churn, not a leak. Per-phase retained memory is ~46 MB
(universe-sites) at the top, ~150 MB in total, so the heap is world state, not phases. Profiling the
46-phase tick is the next real performance task.

**The heap ceiling was the stall amplifier** (fork `a03a801`, compose only). The process's V8
old-space limit was **4 288 MB** while the live world heap reached ~5 GB, so the worst stalls
coincided with heap 4.4-5.0 GB and every registry flat - back-to-back GC, not a leak. The host has
96 GB and the container has no cgroup memory limit, so the play stack runs with
`--max-old-space-size=6144` (a ceiling, not a reservation; the limit reported inside the container is
now 6 336 MB).

Measured after the restart (9 samples, 6 min): p50 **813 ms**, p90 **1 422 ms**, worst **1 422 ms**,
RSS **2.82 GB** - against p50 1 289 ms, p90 5 043 ms, worst 8 592 ms and RSS 5.4 GB in the same
shape of window before it.

**The 22 listed modules are now the cheapest offer on the book** (fork `4a66dbf`, repair applied live
2026-11-06 18:52). The daemon gained `RepriceNpcSellOrder` (price only; operation id, item, escrow and
quantity untouched) and the relist gained `repriceOnce` (re-proves the escrow, calls the RPC, verifies
the returned price, and moves the escrow's `coopTradePriceCents` with it). Only the MARKET container was
recreated, so the owner's session was not dropped.

Applied to all 22: 139 202 000 -> **98 435 700** for 23803 (cost 90 460 000, seed ask 99 430 000),
126 868 000 -> 89 713 800 for 21472, and so on; `repriced=22 kept=0 blocked=0`. Verified on the book:
the corporation's three 23803 orders now sit BELOW the seed ask, i.e. they are the best offer, and all
22 escrow rows carry the new price.

Caveat: the SERVER container still runs the pre-fix image (it was not recreated, to keep the owner's
session), so the new relist rule (undercut 99 %, cost+5 % floor) and `repriceOnce` take effect only on
the next server restart. The repair above already fixed the stock that was on the book.

**Militia "kicked out again" was a client-session gap, not a leave** (fork `7ec6b7c`, 2026-11-06 19:10).
Measured on the live play stack: the enlistment row is `ACTIVE` for 140000005 / 500001, the character
record carries `warFactionID 500001`, and `GetCorpFactionalWarStatus` answers `facwarCorporationActive(1)`.
No code path wrote `LEFT`. What was missing is the client's own copy: the login `SessionChange` was
logged with 17 keys and **no `warfactionid`**, because a pilot who logs in already in space takes
`characterState`'s initial-space path, which filters the change down to the stock
`INITIAL_SPACE_CHARACTER_SESSION_CHANGE_KEYS` list. `enlistmentChecks.pyj CurrentlyInSameFaction()` is
`factionID == session.warfactionid`, so the FW window showed an ACTIVE enlistment as "not enlisted".
`warfactionid` is now on that list and is sent even when unchanged on the login selection;
`facWarMgr.GetSolarSystemLPs` (the one unhandled method on the live client, WARN 18:32) now answers 0
instead of null, which used to break the LP-donation arithmetic.

Live repair without a restart: admin `militia_sync` pushed `warfactionid` into the running session at
19:08:52 (`sessionPushed: true`, `previous: 500001`). The code fix takes effect for every future login
after ONE server-container restart, which has not been done yet (the owner's client was logged in).

**VERIFIED LIVE 2026-11-06 19:18** (owner: "I am back in the faction, all good"): after the server
restart onto image `evejs-local` built from fork `7ec6b7c`, the login `SessionChange` was logged with
22 changes and **`warfactionid` is among them** (`19:18:22 OUT SessionChange 22 changes → charid,
corpid, ..., warfactionid, ...`). The FW window then answered `GetMyCharacterRankInfo`, `GetStats_Character`
and `GetStats_FactionInfo` with no `Unhandled method` warning, i.e. `GetSolarSystemLPs` is covered too.
Both militia fixes (login session key + per-system LP answer) are now deployed on the play stack.

**World-tick waste measured with a live V8 profile** (fork `ea8eaec`, 2026-11-06 19:40). The inspector
was opened on the RUNNING server with `kill -USR1 7` and driven over CDP from inside the container
(no restart, no code change, loopback only; it is closed again with `process._debugEnd()`).
120 s at 500 us sampling, plus in-process timings of the same modules:

| waste | measured | fix |
|---|---|---|
| `getSceneActivityState` | 2.14 s self + 0.97 s memo closure per 120 s; 0.0079 ms/call of which the stargate scan is 0.0079 ms | stargate SELECTION cached per scene (`space/npc/sceneStargateIndex.js`), timestamps still live |
| `nativeNpcStore.entityIndexFor` | one cold `listNativeModulesForEntity` = 45.7 ms for ZERO rows (deep clone of the whole table; every module/cargo write clears the index) | index reads `rawCollection`; `cachedRowsForEntity` still clones each returned row |
| `runtime.logMovementDebug` | 165 ms self per 120 s with verbose debug OFF (20-field JSON + 5 vector summaries per movement event) | early return before building anything |

Also measured and NOT yet changed: `peekNativeCargo()` 6.4 ms (16 988 rows, `Object.values`+sort) and
`peekNativeEntities()` 4.4 ms (8 544 rows) on every read-cache rebuild, and the cache is invalidated by
EVERY native write - the prime suspect for combat-time stalls, needs a rebuild-frequency measurement
first. No stall >= 120 ms occurred during the 120 s window (the owner was docked and idle), so the
1.5 s combat stalls still have no captured stack: capture one with the same profiler during a fight.

The three fixes above are committed and BUILT into `evejs-local`, but the running server container
still has the previous image (the owner was in game). They take effect on the next server restart.

**A fourth world-tick waste, and a stall recorder that is already armed** (fork `b4a747f`, 2026-11-06 19:55).
Live cache snapshot through the inspector: `cargoBuilds` went 820 -> 850 in 60 s while the owner was
docked, i.e. exactly the 2 s TTL, and every rebuild paid `peekNativeCargo()` 6.4 ms (16 988 rows,
`Object.values` + full sort) plus `peekNativeEntities()` 4.4 ms (8 544 rows) plus one shallow copy per
row. Neither sort is load-bearing: the cache indexes rows into Maps by owner/cargoID/system+fleet, and
the only caller that takes `hits[0]`/`matches[0]` (`coopHaulCargoAdoption`) does so only when exactly
ONE row matches. Both enumerations are now unsorted, and the cache snapshot counts `invalidations` so
the combat-time rebuild rate is measurable. Gate note: the comment had to be trimmed - `stockChars`
has a hard 66 500 budget and the first version landed at 66 527 (`AUDIT_REGRESSION`).

**Stall recorder is running on the play stack right now** (no restart, `kill -USR1 7` + CDP):
`/tmp/stall-watch.cjs` inside `evejs-server-1`, 240 minutes, 60 s windows, writes every main-thread
gap >= 200 ms to `/var/lib/evejs/coop-stall-watch.jsonl` with the frame it was stuck in and the frame
it returned in. As of 19:55 the file holds only its start line: no stall >= 200 ms while the owner is
docked, so the combat freeze still needs his fight. Read that file BEFORE any restart (it lives in the
data volume, the watcher process itself does not survive a container recreate).

**Allocation profile: the server makes 2.3-5 GB of garbage per MINUTE while idle** (2026-11-06 20:20).
Method: `HeapProfiler.startSampling` over CDP against the running process, 60 s windows, 32 KB
sampling, builtins charged to their nearest user frame (`/tmp/heap-sampling-attributed.cjs` inside the
container). Two more fixes followed from it:

* `dungeonUniverseRuntime.listActiveRandomAllocatedInstances` listed ALL 8 491 universe-seeded
  instances (5.3 ms: walk, Map, sort) once per family per band only to filter them by a candidate
  system set it already held (402 + 298 + 189 MB/min). It now hands the candidates to the list:
  ~1.5 ms per call, and the `getSecurityBand()` filter visits a few hundred rows instead of 8 491
  (fork `d4371e5`).
* `npcSceneActivity.getSceneCrimewatchDeadlineMs` re-required the crimewatch module with a fresh
  `path.join()` on every scheduler call - 69 MB/min charged to `node:path` alone. Resolved once, with
  a failed resolve still retried (fork `914befb`).

Still on the table, by measured MB/min: `cloneValue` 197 (nativeNpcStore deep clones),
`liveFittingState.buildShipResourceState` + `readShipBaseAttributeMap` 260 (per-tick ship resource
state), the read cache's own shallow copies 266, `npcService.ruleAppliesToSystem` 132,
`coopGameStoreAtomic.get` 100, `wormholeRuntimeState.cloneRuntimeState` 93, structure tick 103.
`logMovementDebug` 28 is already fixed and waiting for the restart.

**Six perf fixes are committed and built but NOT deployed**: the running server container still has
the image from 19:14 (the owner was in game). One restart activates: stargate index, entityIndexFor
raw read, movement-debug early return, unsorted peek enumerations, narrowed universe plan, crimewatch
require hoist.

## Current state

**The fork had been left on a detached HEAD** (156 commits ahead of `coop/pas7std`,
reachable only from HEAD). Re-attached with `git checkout -B coop/pas7std`. Never
work detached here again.

**In-space teleports reach the pilot now** (`1b5cb47`, measured 2026-11-05): the micro jump
drive resolved correctly server-side (type 4383 → effect `microJumpDrive` 4921, 12 000 ms,
100 km) and the ship really moved, but the pilot's copy of `SetBallPosition` went out on the raw
destiny stamp, which the client destiny ticker discards as "too old" (`destiny/net/client/_ticker.pyj`).
New `space/coopOwnerTeleport.js` sends the owner a lead-stamped copy (`PILOT_WARP_ACTIVATION_DELAY_
DESTINY_TICKS` = 4, the same lead the pilot warp corrections use), excludes the owner from the raw
watcher broadcast, keeps the watchers-only path for unready sessions and writes a
`space.teleport.delivery` record per teleport. **Not yet seen in a live client**: verify with the
record + the overview-distance trick in `docs/TELEPORT_DELIVERY.md` §4/§5. One stock line, budget
65 488 ≤ 65 500 (not raised).

**Incident 2026-11-05 23:26 UTC:** a recursive `grep` over the 245 MB backup sqlite inside the
running server container was OOM-killed and took `evejs-server-1` down; it came back healthy by
itself and the client had to relog. Never recursive-grep `/var/lib/evejs` inside that container.

**Anomaly rats now answer a sniper** (`5ff9f9a`): the owner's friend cleared one of our x2.5
anomalies from 150 km and felt nothing. Two causes: the site-defence director was gated by
`EVEJS_COOP_PVE_SITE_DEFENSE`, which was **absent** from `Code/compose.coop-probe.yaml` (so anomaly
defenders had no response at all — retaliation flag only covers named NPCs), and even with it on the
far rule was a fixed 250 km, so a 150 km sniper got a plain attack order (burn at subwarp speed,
never fire). "Far" is now the hull's own lock range: a defender that cannot lock the attacker gets a
**real native warp to him** and the attack order only after the same physical hull is out of warp and
inside reach; a hull that really shoots 150 km stays put. Same rule in `coopNpcTactics`. The director
also falls back to the verified damage witness when the controller recorded no aggressor. Events:
`NATIVE_SITE_DEFENSE_WARP_ISSUED` → `NATIVE_SITE_DEFENSE_ORDER_ACCEPTED`; how to verify:
`docs/PVE_SITE_DEFENSE.md`.

**Trader market maker is live** (`1750f34`, `fc62484`): every living-world tick reads the real
book for `EVEJS_COOP_TRADER_TYPES`, takes the cheapest **seed** ask as the reference price, plans one
small lot per type at **≤ 90 %**, and in live mode lifts ONE whole player ask through the atomic
corporate buyer (real wallet, Rust claim, write-ahead journal; an ambiguous outcome is never retried).
Corporation **1000035** (Caldari Navy, **4 867 000 ISK**), hub Jita 4-4, mode LIVE. Evidence:
`space.trader-maker` events every tick with `TRADER_MAKER_NO_BARGAIN` only because **no player ask
exists on the book** — the moment one is placed at ≤ 90 % of the seed ask it gets bought. No mint:
`money()` refuses to read an unreadable wallet as zero. Still open: relisting the bought stock
(native NPC seller), the 70 % buy-order bid band, and a wider type list.

Committed on the branch but **not deployed to the play stack** (one restart ships
all of it):

- **Site warehouses/depots/caches hold real loot** (`10ebb37`): they were ambient
  scenery with NO inventory row at all, so "open cargo" was always empty. Filled once
  from the site's own `lootProfiles` into the structure's own itemID. Live proof on the
  work stack: a Sleeper Warehouse gained 4 real items. Switch
  `EVEJS_COOP_SITE_LOOT_STRUCTURES=1`. Details: `docs/SITE_LOOT_STRUCTURES.md`.
- **Gate warps land inside jump range** (`445f390`): the client's 10 km default for a
  gate was treated as an explicit surface offset, so the ship landed ~11 km from the
  gate edge (measured `distToTargetEdge=11009/11315`). Only a request above 10 km is an
  explicit "warp to within X" now.
- Site batteries really shoot: `space/coopSiteSentries.js` (decision),
  `coopSiteSentrySpawn.js` (one native sentry per battery), `coopSiteSentryFire.js`
  (the type's own damage vector through the native damage path). Measured over 4
  real systems: 12 batteries -> 9 resolve (Angel/Sansha/Serpentis/Guristas), 3 are
  Sleeper batteries that stay inert (no Sleeper sentry type in this build). Native
  damage path proven live: ship shield 725 -> 706.679975. Switch
  `EVEJS_COOP_SITE_SENTRIES=1`, set in both compose files. Details:
  `docs/SITE_SENTRIES.md`.
- **Lags (measured, not guessed)**: CPU profile in `docs/LAG_PROFILE_20261105.md`.
  The haul-block storm is suppressed (`8fe1892`, 13 440 events/hour -> 1/min) and its
  O(n^2) cargo scan is gone; a stale miner cargo copy is now repaired instead of
  blocking the ore loop for ever (`e2d259a`, clause `cached_quantity_differs`);
  market-maker state is one process-owned document (`fcae8c0`) with a reconcile that
  refunded 3 368 leaked reservations and took the document 12 MB -> 566 KB
  (`2d1b27d`, `5eabcdd`); the virtual-world save is coalesced (`0cec93c`); the
  per-scene deadline scan is memoised per sim stamp (`8114ec8`).
- **A deployable is never swept away as an empty can** (`8fe1892`): the owner's Mobile
  Tractor Unit was deleted right after "collect all" moved its loot out.
- Campaign LP row is truthful now (`progress_interval 1`, amount 0, real militia
  issuer) instead of the raw `UI/Campaigns/RewardsPerNumberContributions`
  placeholders.
- The P2P env invariants moved out of the stock market service into
  `space/coopPlayerMarketEnvGuards.js` (same errors, same order); stock-char
  budget ratcheted 67 500 -> 65 500 (measured 65 315).
- A war side fields four hulls by default (was three), raised by
  `EVEJS_COOP_WAR_SIDE_SIZE` (1..8), per tick by `EVEJS_COOP_WAR_SIDE_TICK` (1..6).
- **Client launch is documented and verifiable**: `docs/CLIENT_LAUNCH.md` plus
  `scripts/Test-ClientLaunch.ps1` (read-only; `RESULT: PASS` only for a real `Play.bat`
  launch). The owner's "overview window does not appear at login" was a client started
  outside `Play.bat`: without `noconsole` a log write during window creation raises
  `IOError: [Errno 9] Bad file descriptor` and aborts it.

## FOUR THINGS STILL OPEN (in priority order, with the exact next step)

1. **NPC buyers actually buying.** Everything exists and nothing is on:
   `space/coopNpcCorporateBuyerAtomic.js` buys ONE whole verified player ask with real
   ISK from the corporation wallet and a real item transfer (gated by
   `EVEJS_COOP_NPC_BUY_PLAYER_ASK=1`, absent on the play stack);
   `space/coopNpcBuyerCoordinator.js` is the durable-claim wrapper ("Not registered on the
   live timer"); `space/coopNpcBuyerLots.js` is the owner's demand rule (no fixed
   allowlist, small lots, cash reserve, capped premium, `wholeStackOnly: true` for this
   executor). Next: register the coordinator on the economy tick, feed it the lots plan,
   then prove ONE live purchase (journal SETTLED, player wallet credited, corp wallet
   debited, item in corp). Never mint ISK to make it work.
2. **Jobs on the Agency Job Board** (owner chose this window). Measured: 10 941 agents
   exist across divisions 18/22-29/37 and **zero mission offers**, so
   `journal.GetMyAgentJournalDetails` is empty and the Job Board has nothing to show. The
   client flags all default ON, so this is purely server content: offer career-agent
   missions per path (Explorer / Industrialist / Enforcer / Soldier of Fortune) bound to
   our dungeon templates, and pay on completion (SP/ISK/LP/standing through
   `applyMissionStandingChanges`).
3. **ISK for war participation.** The mechanism is installed
   (`coopWarKillMerit.setBountyPayer` -> `coopWarBounty.pay` -> `coopWarTreasury` PAYOUT,
   which releases a HELD escrow only), and it pays nothing because the militia factions hold
   0 ISK. Needs a real funding source for the faction wallet (its own market income), never
   a minted balance.
4. **Remaining lag hot spots.** Baseline and method in `docs/LAG_PROFILE_20261105.md`; fixed
   so far: haul storm, market-maker document, world save, scene deadline memo. Still hot:
   other synchronous JSON writers on tick paths (`coop-economy.json`,
   `coop-courier-flights.json`, the gameStore flush) and GC pressure (heap ~2.7 GB, the
   15 310-row cargo table being cloned). Measure again before changing anything.

## NEXT (owner actions)
1. **Restart window** for the play stack: rebuild `evejs-local` from the fork tip,
   then `scripts/Start-Play-Stack.ps1 -Action Up`.
2. **Stand in a site afterwards**: expect
   `[CoopLivingWorld] site sentries in <system>: battery <id> -> <type> #<id>`,
   `[CoopLivingWorld] site loot structures in <system>: #<id> <name> N item(s) from
   <profile>`, `coop-site-sentry-fired` and `coop-site-loot-structure-filled` in
   `coop-events.jsonl`, then damage and loot on the client. Until that exists the
   sentries and the warehouse loot are NOT verified in game.
3. **Launch the client through `Play.bat` and run the verifier** before reporting any
   client-side symptom.
4. **Name the jobs window** (Agency -> Careers, a career agent in station, or
   Agency -> Job Board) before any Explorer/Soldier-of-Fortune/industry job
   content is written; the three windows take different payloads.

# Historical handoff (2026-11-03 -> 04)

## Committed in the fork (`pas7-studio/EveJS`, branch `coop/pas7std`, tip)
All are committed but **NOT deployed** — the play stack has not been restarted.
- `b229dc3` Military Campaigns page served from the live war state (tests 8/8).
- `3544a1b` MTU scoop returns the haul to ship cargo (overflow to a can).
- `fc630f1` Fleet invite dissolves a solo leftover fleet instead of refusing.
- `5a6db18` Militia briefing "Decline" (action 9) no longer leaves the militia.
- `43fe233` Admin action `militia_restore` clears the re-enlistment cooldown on the
  real faction-war atomic row (only `cooldownUntil`), enlist stays the normal path.
- `ad5e96f` `Handle_Add`/`Handle_MultiAdd` warn with an exact reason
  (NO_BOUND_CONTEXT / SOURCE_ITEM_NOT_FOUND / SOURCE_ITEM_UNRESOLVED) instead of
  dropping a transfer silently; MTU activation sets `component_activate=[true,null]`
  on the live deployable and broadcasts the slim item immediately.
- `35e9380` `onlineStatus.GetInitialState` returns a DBRowDescriptor whose columns
  are real `(name, DBType)` marshal tuples (contactID I4, online BOOL). The old plain
  column strings made the C constructor raise
  `UnmarshalError: new style getargs format but argument is not a tuple`.
- `176e0fd` `overviewPresetMgr.GetStoredPreset` returns the profile as a `wstring`
  (the client parses text), fixing `TypeError: must be unicode, not str` in
  `OverviewWindow.OnOverviewPresetLoaded` / `_DoBallsAdded`.
- `98f1cdf` onlineStatus payload moved to `onlineStatusPayload.js` (no store
  dependency); `tests/coop-onlinestatus-rowset.test.mjs` 2/2 asserts the typed
  tuple columns and the rowset shape.
- `e78711b` **combat anomaly tuning** (`space/coopSiteTuning.js`): for combat
  families `getSpawnProfile` multiplies `slotsPerSystem` x2, `targetSystems` /
  `targetSystemRatio` x1.5, and shifts `difficultyRange` up one tier, so harder
  templates (more waves, tougher hulls) are eligible. `coopUniverseSites` seeds up
  to 24 visited systems per pass and samples 24 systems per band. Kill switch
  `EVEJS_COOP_SITE_TUNING=0`; knobs `EVEJS_COOP_SITE_DENSITY/COVERAGE/DIFFICULTY_SHIFT`.
  Tests `tests/coop-site-tuning.test.mjs` 3/3. Mining/gas untouched.

## Confirmed evidence worth keeping
- Owner 140000005, corp 98000001, faction 500001, Megathron Navy Issue
  `9988400124002`, system 30001390 (Pakkonen). Friend 140000107.
- Enlistment record: status LEFT, `leftAt 1793735429495`, `cooldownUntil 1793821829495`,
  rank 0 — caused by the briefing-decline bug. Friend has no enlistment record.
- Loot drag failure: `[InvBroker] Add itemID=… source=…` with no store record for the
  container/items; `Handle_Add` used to return null with no log.
- Overview/onlineStatus errors are in the client log: `must be unicode, not str` and
  `new style getargs format but argument is not a tuple`.
- Drone counter: server emits one `OnDroneStateChange` per launched drone; the client
  `michelle.OnDroneStateChange(itemID, ownerID, controllerID, activityState, typeID,
  controllerOwnerID, targetID)` drops a drone when `charid != ownerID AND shipid !=
  controllerID`; `SetState` builds `stateByDroneID` from `bag.droneState` (filtered by
  `controllerID > 0`). Not yet pinned why only 1 of 5 shows.
- Logout: in space the client calls `GetMenuService().SafeLogoff()`; the server answers
  `[]` and `_completeInstantSafeLogoff` sends `OnSafeLogoffTimerStarted(now + 1 s)` then
  `OnSafeLogoffActivated`. The client timer is `logoffTime - blue.os.GetSimTime() + SEC`.
  The 10 s the owner sees is not yet explained by the server constant alone.
- Warp: gate target uses `resolveStargateWarpTarget` with
  `WARP_EXIT_VARIANCE_RADIUS_METERS = 2500` and a random 1..2500 stop distance. The
  reported ~10 km landing is not explained by these constants yet.

## Career portal does not open (root cause found 2026-11-04)
Client trace (server log, 23:10:23-24, character 140000005) after
`eve_public.career.goal.api.GetDefinitionsRequest` and `GetAllRequest` both
answered 200:
`careerPortalWnd.load_data_async → on_data_load_success → construct_career_portal
→ circleView → activityView.LoadActivities → activityNode.ApplyAttributes →
circleNode.PrepareUI → ConstructFrame → UpdateDashedCircle` and then
`EXCEPTION #107 ... ZeroDivisionError: float division by zero`.

Cause: `activityNode.UpdateDashedCircle` does
`len(completedGoals) / float(len(goals))`. `activities` come from the client's
static `careerGoalsConst.CAREER_PATH_GROUPS` (10 explorer, 9 industrialist,
10 enforcer, 10 soldier-of-fortune activity IDs), and each node asks
`get_goals_in_group(career, group_id)`. Our `CAREER_GOAL_DEFINITION_STUBS`
send no `ui_annotations`, so `GoalDefinition.from_proto` gets
`group_id = None`; the four definitions become only `career_path_goal_definition`
and every static activity group has zero goals → division by zero.

Fix: `coopCareerGoals` must emit one definition per static activity annotation
(key `'group'`, values `CareerAgentMissions`, `Scanning`, `Hacking`,
`AdvancedHacking`, `Wormholes`, `GasSites`, `CombatSites`, `Navigation`,
`AdvancedNavigation`, `ProjectDiscovery`; `IndustrialistCareerAgentsMissions`,
`Market`, `Salvage`, `ResourceHarvesting`, `Refining`, `Manufacturing`,
`DistributionAgent`, `MiningAgent`, `Research`; `CareerAgentMissions`,
`SecurityAgent`, `AbyssalDeadspace`, `Combat`, `Bounties`, `CombatSites`,
`EpicArc`, `Market`, `Standings`, `LoyaltyPoints`; `CareerAgentMissions`,
`Social`, `ElectronicWarfare`, `Combat`, `PvP`, `CapacitorWarfare`,
`FactionWarfare`, `Support`, `Destruction`, `Duels`) plus one career-path goal
per career, with `career` 1/2/3/4, `target` 1, `threat` 1, `career_points` > 0,
`order`, and `subtype`. `GetAll` must return a progress row for every emitted
goal. Other annotation keys: `'subtype'`, `'order'`, `'duration'`,
`'auraTextID'`, `'agencyLinkTextID'`, `'agencyScreen'`, `'videoID'`.

## Drones: done in code, needs one live launch (fork 60296b9 + 762aaf7)
The drone window reads 1/5 because the client counts
`michelle.stateByDroneID` minus the drone bay, and it rebuilds that dictionary
wholesale from `SetState(bag.droneState)`. Two server-side holes are now closed:
- `launchDronesForSession` was completely silent (no log, no event) and only wrote
  errors into the RPC response; it now logs `[Drone] Launch char/ship/requested/
  launched/active/bandwidth/ids`, warns with the exact reason for every refusal, and
  re-emits `OnDroneStateChange` for every controlled drone after a successful burst.
- `movementSceneRefresh.sendStateRefresh` (STATE_RESET) sent a visible-entity snapshot
  that could predate the launch and wipe the newer notifications; it now re-syncs the
  authoritative drone state right after the reset (`set-state.drone-resync`).
The wire shape, launch telemetry and the re-sync live in `space/coopDroneStateSync.js`
(`tests/coop-drone-state-sync.test.mjs` 3/3).

## Client tracebacks: read them locally, not from guesses
The launcher keeps the client's own console output under
`C:\Games\EveCoop\upstream-evejs\Code\_local\diagnostics\`: `evejs-client-stdout-<id>.log`
(full Python tracebacks with the exact client file/line, `session` locals and timestamps) and
`evejs-client-crash-<id>.txt` (launch/exit metadata). Grep the stdout log for `EXCEPTION #`,
`Traceback`, `Exception:`. Three bugs were root-caused from it on 2026-11-04:
`util.Rowset` (contractProxy state, 0e890d2), byte-str owner names in cfg.eveowners
(overview PrimeDisplayName, 17e3c78 + faaefa4 for pilots outside our corp, proven by
'IS 'SaSaNyah' = a [RAIH] pilot) and Loot All aborting on one item that did not fit
(MultiAdd NotEnoughCargoSpace available 0.8175 volume 388, ddf6bbb).
Related, same client path: 14 more overview failures were
`'NoneType' object is not iterable` in the same `ExtractLocalizedTags`, i.e. the slim item
yielded NO name at all (ownerID not yet in cfg.eveowners). If that survives the name fixes,
the next step is to prime owner rows for every pilot in the bubble instead of waiting for the
client to ask.

## Still open
1. Loot: confirm a real wreck/can drag now logs a reason; if the source is still
   unresolvable, materialize scene loot as real items (needs the new warn line live).
2. Overview: load a profile in the client to confirm the unicode error is gone.
3. Drone counter: exception #79 in the client log proves the SERVER refused extra launches
   with "Maximum active drones already in space." at 22:58:38 - so it counted five drones
   while the window showed 1/5. The display loss is the SetState rebuild (fixed by the
   resync); after deploy, launch five and read `[Drone] Launch ... launched=5 active=5/5`.
4. Logout: shipped in 7d99164, needs one live logoff to confirm no countdown.
5. 77 km pilot-distance desync; death loot scattered - the loot half is the flag bug
   (106f79f) plus Loot All aborting (ddf6bbb); the 77 km number still needs the owner's
   subject (distance between what).
6. "Изменения принадлежности" card: exception #83/#84 is a jobboard card crash in
   `jobboard/client/features/agent_missions/job.py subtitle -> _epic_arc ->
   epicArcController.GetActiveMission -> _GetAgent` returning None, then
   `IsAgentStandingSufficientToUse(None)` -> `'NoneType' has no attribute 'factionID'`.
   So cfg.agents does not contain an epic-arc start agent. Still needs one live `GetAgents`
   dump (or the owner's screenshot) to know which agent id is missing.
   Two FX crashes are client-side and need a two-client repro: `AttributeError: Activate`
   is `effects.GateActivity.Start -> gateBall.Activate()` on a raw `_destiny.ClientBall`
   (the FX reached a session before that stargate had a Python space object - we broadcast
   the observer gate flash in completeStargateJump), and `AttributeError: RemoveMissileImpact`
   is the client's own missile controller (`eveSpaceObject/missile.pyj`). `IndexError` in
   Project Discovery results is also client-side until the PD payload exists.
7. Warp landing for heavy hulls (~4 km): `WARP_COMPLETION_DISTANCE_MAX_METERS = 1` in
   runtime.js, so the server lands on the target; measure the real client value first.
8. After deploy: `militia_restore` for 140000005, then enlist both pilots into Caldari.

## Deploy procedure (only with the owner's explicit window)
Full per-commit checklist: [`docs/PENDING_VERIFICATION_20261104.md`](../docs/PENDING_VERIFICATION_20261104.md)
(21 commits, each with the exact observation that makes it PASS).
`cd C:\Games\EveCoop\upstream-evejs\Code; docker build -t evejs-local .` then
`docker compose -f compose.yaml -f compose.coop-probe.yaml -p evejs up -d --force-recreate server`.
Play stack only. Never restart it unasked.

## Owner fittings (2026-11-05): 15 Typhoon Fleet Issue builds, no restart
Hull `32311` (PG 13000, CPU 660, 8 high / 5 med / 7 low, 3 large rigs, cal 400,
drone bay 200 m3 / 125 Mbit). All 15 validated before creation with a local script
(sum of dogma attrs 30/50/1153 per fit vs the hull) — every fit is legal.
Saved fittings ids `1665..1679`, names `TFI ...` (AC Brawler Armor, AC Armor Buffer,
Arty + HML Sniper, Dual AC Shield Kite, Hail Brawler T2, Cruise Sniper, Torpedo
Brawler, Rapid Heavy Shield, Heavy Missile Kite, Torpedo Armor Fleet, Active Armor
Rep, Drone Boat, Nano Kite, Shield Buffer Fleet, Max Gyro T2).
**Recipe for "builds I can simulate" without a new admin action:** grant N hulls
(`give_item` with an explicit `stationID` — the bridge refuses while the character is
UNDOCKED), `give_fit` each with `stationID`, `save_fitting` each, then `remove_item`
each hull. `remove_item` does NOT delete the fitted children: 328 orphan items stayed
with `locationID` = the removed hull and had to be deleted in batches of 60
(`admin_batch` caps at 64 actions). Verify with a read-only sqlite script before
calling it done.

**2026-11-05 follow-up: 5 more TFI fittings (ids 1680..1684)** — Torpedo Shield
Brawler, Torpedo Dual Prop, Smartbomb Brick, Passive Shield Regen, Neut Brawler.
Owner asked "where are my previous builds" — nothing had been deleted: the store
holds 45 fittings for 140000005 (Talos 10 + NAGIB-1, Algos 5, Vexor 5, Venture 2,
Megathron 2, TFI 20). A new fitting only appears in the Fitting window after the
window is reopened; it is not a lost fitting.

**2026-11-05, high-tier set (ids 1685..1689):** RF AC Machariel-lite (5x 800mm AC II,
4x Republic Fleet Gyrostabilizer, T2 Burst Aerator), Deadspace Shield Torp (4x Torpedo
II, Gist A-Type Large SB, DG multispec, CN BCS), Faction Arty Sniper (3x 1400mm II +
2x HML II), Faction Cruise Fleet (6x Cruise II, 3x CN BCS), Armor Brick T2 (Imp Navy
1600mm plate, 2x EANM II, 3x Trimark II). 25 TFI fittings total, all PG/CPU/cal legal.

## M003 industrial economy (L9-A) merged into main and the fork — 2026-11-05
The owner's «масштабний ALIFE 2.0 десь у гілках» *is* the M003 branch, not a PR:
engine `mission/003-industrial-economy` (131 ahead of `coop/pas7std`) + this repo's
`origin/mission-003-industrial-economy` (53 ahead of `main`). PR #350 is a different,
explicitly-incomplete Personal Fleet contract.
**92 of the branch's 120 "new" files already existed on `coop/pas7std` byte-identical**, so the
real delta was 6 new modules + 1 tool + 8 modified modules (+21 Doc files).
Merged: fork `c96dc66`, repo `b8811574` (fast-forwarded; both checkouts now carry it).
Conflicts 1 + 3. Adaptations:
- `coopNpcRefineryTick.js`: branch file + main's note-suppression window (48 dup records/2 min);
- `docs/coop-flags.json` regenerated (`FLAGS_OK 527/527`), not hand-merged;
- `coopVirtualWorldRuntime.js` hit the 4 100-line ratchet (4 107) → sale-refusal wiring moved to
  `coopVirtualWorldRuntime.pure.js` (4 097);
- `integration/coopNpcMarketMakerBands.js` shim was missing on main → `SHIMS_OK` now;
- engine fixes found by the branch's own suites: `trip.demand` per type (3 stacks → 10 000 not
  30 000), factory reserve as one budget per (station,type) instead of per row (shipped nothing
  with 20 000 reserved), same overwrite in the LOAD step of `coopDistributionRun`.
Gates: `AUDIT_OK` (560 modules, 65 488 chars, 0 drift), `FLAGS_OK`, `SHIMS_OK`, 257 + 15 + 31
checks green.
**NOT deployed**: the play stack still runs the old image. `EVEJS_COOP_NPC_REFINERY=0` stays off.
Docs: `docs/M003_INDUSTRIAL_ECONOMY_MERGE.md`; engine evidence `Doc/L9A-*`, checker
`Doc/tools/verify-l9a-world.js`.

**M003 merge follow-up (same day):** the merge exposed an overlay-spec with two tails — the branch
pushed 87 names AFTER `module.exports` unguarded, so the installer carried 539 entries for 524
modules (15 duplicates) and four pinned overlay tests failed. Fixed in `76c4a871`: one guarded list
before the export, plus nine modules that existed in `integration/` but were never listed, and eight
listed modules with no `integration/` copy at all (site sentries, loot structures, militia session,
war rewards, NPC buyer lots, owner teleport). `installer.names` == `integration/` == 533 names;
`FLAGS_OK 529/529`, `SHIMS_OK`, `AUDIT_OK`.
Engine follow-up `4a47a95`: a liquidating leg wrote a journal with no `trip`, which the branch's own
validator rejects — the run reported LIQUIDATING and `read()` said INVALID.
Two fixtures adapted to the stricter contracts (refinery budget file, sale-attempt row).
Known-red, pre-existing and NOT from this merge: `coop-native-haul-transfer-physical`
«forged/corrupt original cargo fields» (fails at `ed18182a` too).

## M003 deployed and verified — 2026-11-05 11:59Z
Image rebuilt from fork `4a47a95`, play stack recreated; container files md5-identical to the
checkout. Proven live: healthy stack, **0** module errors, telemetry growing, 16 maker bids ×
1000 units (prices 3–2 905), distribution journal reads `OK`.
Not exercised: `EVEJS_COOP_NPC_REFINERY=0` and `EVEJS_COOP_DISTRIBUTION_RUN` commented out
(deliberate), and `space.trader-maker` has **no player sell escrow** → 211 `TRADER_MAKER_NO_BARGAIN`,
cash unchanged at 5 000 486 700 000 cents. The owner still has to place one sell order below the
hub ask for the buyer path to settle anything.
Agent-stack proof (distribution enabled there only, `compose/compose.agents.yaml`): no exceptions,
75 distribution events, but sales came back `NO_SEEDED_COUNTERPARTY` at station 60000682 while the
seeded buyers are at 60003760; two hulls stuck `RETURN_NO_GATE:NO_RECIPROCAL_GATE`, sale-attempts 0.
Lag on the new image: median 1293 ms per `living-world-phase-cycle` (max 3196 ms), one freeze per
cycle, heap 92.5% of the 4288 MB limit; telemetry writes ruled out; `native-faction-war-opening`
worst 687 ms; 21 phase names still unclassified. The tick is sync by design, so the fix is less work
per cycle, not awaiting between phases.
Also fixed: `tests/coop-native-haul-transfer-physical` no longer pins the refusal the engine
deliberately removed (fork e2d259a): store-row corruption still refuses, a stale display copy is
rebuilt from the durable row. That test was the last red in the economy/market/native sweep.

**2026-11-05 13:0x-13:3xZ — the economy actually trades (owner: «ти сам роби що треба»).**
Turned on deliberately, with the numbers written in `compose.coop-probe.yaml`:
`EVEJS_COOP_DISTRIBUTION_RUN=1`, `EVEJS_COOP_DISTRIBUTION=1`, `EVEJS_COOP_CORP_TREASURY_SWEEP=1`.
Three blockers found and fixed while watching:
1. the crossing ticker is the other half of the distribution switch — without it hull 980000093319
   re-planned the same home crossing every 56 s for six beats (fork `90b6930`);
2. a per-beat sale budget was treated as a verdict, so a hull that had sold 12 times parked for
   `BLOCKED_RETRY_MS` (30 min) with cargo aboard; it now continues when the beat really sold
   something, while a beat of pure refusals still ends BLOCKED after MAX_SELL_CALLS (`4f8d397`);
3. the treasury sweep only lived inside the refinery path, so pilot earnings never reached the
   corporation; `EVEJS_COOP_CORP_TREASURY_SWEEP=1` runs the same authority without refining (`c2f05c0`).
Live result: 16 settled sales into the Jita 4-4 seeded bid, hull sold 137 717 → 0 units and cycled
to a new trip, corp 1000129 went 961.48 → **2 573 865.16 ISK** (sweeps of 1 422 807.39 and
1 150 096.29), bid order 4257714186837032994 fell 4 000 000 → 3 743 714 units, `sale-attempts/`
carries the L9-A identity rows.
Also fixed: `POSTCOMMIT_CUSTODY_READBACK_FAILED` parked a mining fleet until restart three times
(12:15Z, 12:44Z, 13:14Z). The clause naming showed `destination_rows=0` — a cache-visibility read,
not corruption — so `healReadbackRepair()` now clears the flag on miner, hauler and fleet when
exactly one row with that cargoID exists, and leaves a missing/duplicated row to an operator (`d0d27b7`).
Still open: the trader maker has nothing to buy without a player sell escrow (owner declined to
trade for now), lag unchanged (median 1.29 s per phase cycle), and the refinery stays off.

**2026-11-05 13:35-14:35Z — the industrial half is switched on (owner: «дороблюй щоб все працювало»).**
Four blockers, each measured before it was changed:
1. a phase computed its status and threw it away — `EVEJS_COOP_NPC_REFINERY=1` ran four minutes with
   zero events. The beat now writes `living-coop-loop-phase {phase,status}` once per change
   (fork `e4f3416`, `70a1026`);
2. the refinery had no budget and had been frozen since the 2026-11-02 252 058.47 ISK incident. It
   now pays only inside `refinery-budget.json` (limit 5 000 000 ISK) **and** under
   `EVEJS_COOP_REFINERY_SPEND_LIMIT_ISK`, from a wallet funded by 16 settled sales. Live: 168
   warehouse-tagged stacks refined at 60000682; the corporation's ore became **443 383 429 ISK of
   minerals at the seeded bids** (41.7 M Tritanium, 2.6 M Pyerite, plus Scordite/Veldspar grades);
3. the treasury swept every pilot to zero, and the trader pays for a blueprint from the PILOT's
   balance. `EVEJS_COOP_TREASURY_KEEP_ISK=500000` keeps a bounded float (default 0 = old behaviour);
4. `factoryStation()` derives home from blueprint receipts, which a copy in transit rewrites to
   `MOVED` — the factory is pinned with `EVEJS_COOP_INDUSTRY_STATION=60000358`.
Production flags (compose: `Code/compose.coop-probe.yaml`): manufacture 1 / runs 5, blueprint shop
trip 1, blueprint purchase 1 (cap 500 000, budget 5 000 000), input import trip 1, runs 1,
`LIFT_ANY_TYPE=1`, sell list led by 672 Caldari Shuttle, 207 Mjolnir Heavy Missile, 215 Iron Charge S
and 1816 Inferno Auto-Targeting Light Missile — the products the seeded book really bids for.
Two engine fixes came out of the first live beats: capital is bought at the buyer's station on BOTH
sell paths (`purchaseCapital()`, one attempt per trip, only a settled `TRADE_SETTLED` counts,
`b2eeb1f`/`ce2e453`), and `factorySupply` no longer plans inputs for a recipe the manufacturer will
refuse `NO_MARGIN` (it bought 20 Mexallon per beat for a Merlin that costs 409 000 ISK of inputs and
bids 97 240). Live status at 14:28Z: manufacturer running every beat, factory correctly refusing the
one loss-making blueprint it owns, hull cycling PLAN → LOAD → CROSS → SELL → RETURN; the capital
purchase is armed for the next sell stop. Still open: the first settled blueprint purchase + job
completion + sale of a manufactured good, the ammo line (needs Nocxium imported), and lag.

**2026-11-05 14:28-15:12Z — first goods produced, and three freight defects fixed on the way.**
Live chain on the play stack: `living-distribution-blueprint TRADE_SETTLED` (14:30Z, a Caldari
Shuttle copy bought at a loading stop) → `living-npc-manufacture-installed` (14:34Z, 967, 5 runs,
13 890 Tritanium taken) → `living-npc-manufactured` (14:47Z, **5 × 672 in the hangar**, real
singleton ship rows) → the same copies ride home and are stowed at the factory (`STOWED:…` 15:11Z).
Fixes forced by the live beats: capital is now bought at the buyer's station on both sell paths
(`b2eeb1f`, `ce2e453`); `factorySupply` no longer plans inputs for a recipe the manufacturer refuses
`NO_MARGIN` (`ce2e453`); a settlement restarts the sale budget and a beat of PENDING polls is
"waiting", not "stopped" (`98a4c3e`); and a hold carrying only what the market cannot buy goes home
instead of polling for ever (`aa601b8`). Jobs run at `EVEJS_COOP_INDUSTRY_TIME_SCALE=0.02`
(10 minutes per 5-run job) and the one installed at native pace was accelerated by rewriting its
completion time; the grant/receipt/cargo all still happened inside the server.
Counts at 15:12Z: 58 market trades, 238 refinery operations, 1 manufactured batch, treasury sweeps
continuing (142 267.39 ISK at 15:06Z), corp wallet funded by sales.

**2026-11-05 16:00-18:00Z — ammo line live, and three freight defects found by it.**
`BOUGHT:1130` 16:26Z (Iron Charge S, 20 000 ISK) after exactly one `COOLDOWN` park; `STOWED` 16:31Z;
job installed 16:34Z; `living-npc-manufactured` 500x215 16:39Z; a second line (2515 Inferno Rocket)
bought and built the same way. Fixes that made it possible: `choose()` refuses a product that cannot
fit the carrying hull (`WILL_NOT_FIT_THE_HOLD`), a retryable purchase answer parks the hull at the
station for a bounded wait instead of burning the trip's only attempt, `sellOnArrival` reports
`WORLD_NOT_READY` while the runtime has not wired its identity registry (every BLOCKED sale of the
session was within a minute of a restart), the sale budget bounds a beat instead of the trip,
`planLift` loads by value density (the ammo was being squeezed out by older ore stacks), a lift that
cannot prove the hold now restores the hangar stack, and a blueprint is never freight (the copies
were the densest cargo in the hangar and every trip sold them).
OPEN, needs the next session: (1) the first two ammo batches (500x215, 200x2514) left the hangar
with no sale event, no cargo row and no job that took them — `EVEJS_COOP_ITEM_AUDIT=1` is ON on the
play stack and emits `living-item-audit {op,typeID,quantity,caller}` at every item-row removal,
decrement and native-cargo removal, so the next batch names the caller; (2) the factory station is
now pinned to 60000682 (where the copies are stowed and 18 M Tritanium sits) but that station holds
zero Pyerite, so ammunition stalls on `MATERIALS_MISSING 35:28/0` until the input import trip buys
Pyerite at Jita 4-4 — watch `IMPORTING_INPUTS` and the `35` rows at 60000682; (3) 10 manufactured
Caldari Shuttles still cannot fit the 3 100 m3 hold (5 000 m3 each) and need a freighter or an
operator decision. Counts at 18:00Z: 84 settled trades, 238 refinery ops, 3 manufactured batches.

---
## HANDOFF 2026-11-05 18:55Z (owner went to play)

**Play stack is up and the client is launched correctly.** Relay public port is **55470** (ProtonVPN
re-forwarded; the old 35386 is dead). Verified with `Start-Play-Stack.ps1 -Action Status`
(`ssh banner on 55470 : OK`) and `Test-ClientLaunch.ps1` (`RESULT: PASS` - one exefile.exe, noconsole,
launcher parent Play.bat, 5 H2 gateway requests).

### Not finished (next session, in priority order)
1. **Prove the ammunition sale end to end.** The line works up to production (blueprint bought ->
   carried home -> stowed -> job installed -> `living-npc-manufactured` 500x215 and 200x2514). The
   last mile is unproven: an ammo stack has never been recorded as `living-native-market-trade`
   (settled by type so far: 34, 35, 36 only).
2. **Two early ammo batches disappeared from the hangar** (500x215, 200x2514) between 16:46 and
   17:06 with no sale event, no cargo row and no job that took them. `EVEJS_COOP_ITEM_AUDIT=1` is ON
   on the play stack (`living-item-audit {op,typeID,quantity,caller}` on every item-row removal,
   decrement and native-cargo removal) - the next batch names the caller. NOTE: out-of-process
   probes of the store can lag the running server, so a stale read is NOT proof of loss; the durable
   receipts in `coop-native-market/purchases/*.json` and `coop-native-industry/receipts/*.json` are.
3. **Pyerite import.** The factory at 60000682 holds 18 M Tritanium and zero Pyerite. The import now
   runs first (before capital) and bought 360 Pyerite into the hull's hold at Jita 4-4 (receipts
   980200419877-980). It still has to be stowed at home and consumed by a job. Watch
   `SUPPLIED:35xNN` -> stow -> `living-npc-manufacture-installed`.
4. **10 manufactured Caldari Shuttles cannot be sold**: 5 000 m3 each against a 3 100 m3 hold. Needs
   a bigger freighter hull or an operator decision. The blueprint chooser now refuses any product
   that cannot fit, so no new ships will be built.
5. **Trader maker** still `TRADER_MAKER_NO_BARGAIN` (needs a player sell escrow only the owner can
   create) and the phase cycle lag (~1.3 s median) is unsolved.
6. **Turn `EVEJS_COOP_ITEM_AUDIT` back to 0** once the ammo loss is explained (it costs one event per
   removal).

### What is verified working right now
Refinery inside a durable budget (238 ops, ore -> 443 383 429 ISK of minerals at seeded bids), sales
(84+ settled trades into Jita 4-4), treasury sweep with a 500 000 ISK pilot float (corp 1000129
funded by those sales), capital purchases (`BOUGHT:1130`, `11870`, `2515`, `1817`), stow at home,
manufacture (3+ batches), and the four freight fixes made today: cycle-safe sale budget, dense-first
loading, lift rollback on a failed cargo write, and blueprints never sold as freight.
