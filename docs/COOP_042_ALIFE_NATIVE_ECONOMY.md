# COOP-042 — Native economic A-Life: one world tick, observable decisions, real evidence

**Status:** integrated PERCEIVE + DECIDE, default OFF, no new autonomous economy writer. Native market / industry P0 transaction implementations remain separate gated work (COOP-033/034/035). This PR intentionally leaves ACT/SETTLE untouched until the postponed isolated local runtime acceptance.

## What changes

A-Life no longer has to treat native production, logistics and trade as unrelated periodic activities. The existing 30-second `coopVirtualWorldRuntime.cjs` tick now optionally runs `observeAlifeEconomy` after native-depot observations. It reuses real scene/controller/owner/cargo/station readings, chooses deterministic economic intents, and emits the same `coopRuntimeProbe` evidence used by ALIFE news. There is **no second scheduler**. The 5-second combat loop remains unaffected.

The opt-in flags are `EVEJS_COOP_ALIFE=1` plus `EVEJS_COOP_ALIFE_ECONOMY=1`. Neither flag enables any wallet, refinery, item mint, Rust order, NPC ship action or production job. The exported observer explicitly reports `supportsNativeMutation:false`. Legacy NPC native-market/industry flags remain their own authorities.

The planner distinguishes:

| Real condition / priority | A-Life outcome | Authority for future ACT/SETTLE |
|---|---|---|
| Actual damage/target engagement | YIELD_SURVIVAL | existing tactics/order arbiter |
| Warp or committed controller order | YIELD_COMMITTED | native ship controller |
| Cargo ore physically on named hauler | HAUL; when truly at native station, DELIVER | native haul, ore receipt |
| Named miner bound to existing hull | MINE (observation only) | real native mining fleet |
| Real ammunition inspector reports empty | RESUPPLY | existing native ammo/rearm flow |
| Native manufactured item, not yet listed | LIST_OUTPUT | COOP-034 physical escrow + Rust |
| Native elapsed READY job | COMPLETE_JOB | COOP-032F/C real industry |
| Genuine product shortage, actual minerals, free BPO/factory | MANUFACTURE | COOP-033/032E quote + debit |
| Real ore at station + missing minerals | REFINE | existing native refinery |
| Missing manufacturing minerals | BUY_SUPPLIES | real NPC market buyer with ISK debit |
| No authoritative stock/ISK/job/market proof | Named blocker | never fabricate resources |

Intent arbitration: at most one intent per native physical actor per 30-second tick, at most 12 intents by default, one shared station-resource intent per type of operation, deterministic pilot order, no ship with player controller, stale or duplicated identities rejected. Survival and committed native orders preempt economics. Intents are **descriptions of needed work, not proof that native work happened**. No production order is issued by the new observer.

The A-Life event envelope has `pilotID`, `entityID`, `systemID`, `stage`, `reason`, `stationID`, `resource`, `intentID`, `nativeMutation:false` and `proof:NATIVE_READ_ONLY`. Blocked sensor reads, missing linked pilots and absent stations also produce named blockers. Identical intent/blocker notifications are rate-limited to once per five minutes. Optional ALIFE news tells players that NPC **plans** to act; it never claims a confirmed trade or successful shipment.

## Native sensors (strict trust boundaries)

`coopAlifeEconomySensor.cjs` verifies:
- Existing EveJS physical scene and its `systemID`, exact named pilot/ship link, real native NPC ship and controller IDs, native store owner/system match, no player session on the ship.
- Real physical cargo rows with matching native owner and positive/nonnegative integer quantities. Ore is category 25, ammunition category 8. No virtual ore balance is used.
- Real SDE station in the same solar system, and physical ship/station positions. The station arrival gate checks actual distance including radii and does **not** mark a hauler delivered when it is 1.27 AU away.
- Actual ship HP and existing COOP native ammunition inspector. If HP, owner, cargo or ammo evidence cannot be verified, the observer produces a blocker or an UNVERIFIED ammo state rather than optimistic health or unlimited ammunition.

**Important pending source:** `readStationEconomy` is deliberately `()=>null` in the runtime hook at this stage. Industry / market snapshots must later be supplied by a read-only **authoritative source adapter** over GameStore and Rust — checking item ownership, station, active jobs, product stock, escrow, corporation ISK and unique native consumption receipts. Until that is done, the trader's production intents report `NATIVE_FACTORY_MARKET_PROOF_REQUIRED`. This is expected, not a silent success.

## Automated tests and manual scenarios

Run only against a **disposable checkout**, not a live Docker volume:

~~~sh
node --test tests/coop-alife-native-economy.test.mjs tests/coop-alife-economy-sensor.test.mjs tests/coop-alife-economy-wiring.test.mjs
~~~

The new tests cover deterministic priority, station resource contention, real cargo versus virtual cargo, no phantom manufacturing, stock-dependent REFINE/MANUFACTURE/LIST decisions, actual ammo exhaustion, unknown health/owner, default OFF, repeat suppression and overlay loading.

A machine-readable acceptance manifest, `tests/scenarios/alife-native-economy-e2e.json`, defines **22 LOCAL_E2E / NOT_RUN** cases with step-by-step setup, expected outcomes and required native evidence. This includes complete mine → haul → refine → job → escrow → player purchase → NPC replenishment, missing blueprint, two concurrent buyers, lost RPC, failed SQLite commit, Rust replays, over-distance station arrival, real ammo depletion, survival-vs-economy preemption and post-restart conservation.

**The 22 scenarios are explicitly NOT RUN.** They cannot be marked PASS by unit mocks. Record each with the actual itemID, cargoID, jobID, orderID, receiptID and before/after ISK and item counts, using the existing gameplay report template. No hidden auto-fixtures may mint currency/items just to green the test.

## Next implementation after this slice

1. Build an authoritative readStationEconomy adapter (GameStore + Rust) and verify consistent stock / ISK / job readings without writes.
2. Send only chosen intents through the existing `coopNpcOrderBridge` (for physical ship orders) or COOP-033/034/035 transaction authorities (for value transfer), with durable idempotency and no independent scheduler.
3. Add real consumer receipts from native NPC ammo purchases and consumption, and finite replenishment goals; forbid unlimited ISK, free ammo and unbacked market stock.
4. Run the 22-scenario local acceptance pack with full Rust, better-sqlite3 persistence worker, two clients and restart faults. Only after the outcome is verified, enable the native ACT/SETTLE gates.

## Safety

Do not enable COOP-034/035 Rust activation or NPC corporate buyer flags on live data until cargo/worker/client gates pass. This PR modifies code and test manifests only; it must not change live `main`, Docker volumes, market tables, game inventories or `evejs-data`.
