import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const fork = process.env.EVEJS_FORK_ROOT.trim();
const sp = (n) => join(fork, "Code/server/src/space", n);

const Route = require(sp("coopEconomyRouteComparison.js"));
const Hauler = require(sp("coopEconomyHaulerReservation.js"));
const Run = require(sp("coopEconomyDistributionRun.js"));
const Unload = require(sp("coopEconomyUnload.js"));
const Disruption = require(sp("coopEconomyRouteDisruption.js"));
const Carrier = require(sp("coopEconomyCarrierChoice.js"));

const cargo = { typeID: "35", quantity: 10, m3PerUnit: 2, valueCents: 50 };

test("IE-044 route: a destination without a buyer or an unverified gate is refused", () => {
  const result = Route.chooseRoute({
    cargo,
    routes: [
      { routeID: "r1", destinationID: "d1", verified: true, m3Capacity: 100, timeSeconds: 60, riskScore: 1, costCents: 20, buyerOrders: [{ priceCents: 5, quantity: 10 }] },
      { routeID: "r2", destinationID: "d2", verified: false, m3Capacity: 100, timeSeconds: 20, riskScore: 0, costCents: 1, buyerOrders: [{ priceCents: 99, quantity: 10 }] },
      { routeID: "r3", destinationID: "d3", verified: true, m3Capacity: 100, timeSeconds: 20, riskScore: 0, costCents: 1, buyerOrders: [] },
      { routeID: "r4", destinationID: "d4", verified: true, m3Capacity: 5, timeSeconds: 20, riskScore: 0, costCents: 1, buyerOrders: [{ priceCents: 99, quantity: 10 }] },
    ],
  });
  assert.equal(result.code, "ROUTE_SELECTED");
  assert.equal(result.routeID, "r1", "the profitable, reachable route wins even at a higher risk");
  assert.equal(result.revenueCents, 50);
  assert.equal(result.costCents, 20);
  assert.equal(result.profitCents, 30);
  assert.deepEqual(
    result.rejected.map((r) => r.reason).sort(),
    ["INSUFFICIENT_CAPACITY", "NO_BUYER", "UNVERIFIED_ROUTE"],
  );
  assert.equal(Route.chooseRoute({ cargo, routes: [] }).code, "NO_VIABLE_ROUTE");
});

test("IE-044 route: revenue stops at the cargo actually carried", () => {
  const result = Route.chooseRoute({
    cargo: { typeID: "35", quantity: 6, m3PerUnit: 1, valueCents: 10 },
    routes: [
      { routeID: "r1", destinationID: "d1", verified: true, m3Capacity: 100, timeSeconds: 10, riskScore: 0, costCents: 5, buyerOrders: [{ priceCents: 10, quantity: 4 }, { priceCents: 10, quantity: 4 }] },
    ],
  });
  assert.equal(result.revenueCents, 60, "only six units can be sold, not eight");
  assert.equal(result.profitCents, 55);
});

test("IE-045 hauler: one reservation per hull and cargo, and a frozen hull is never reassigned", () => {
  const pool = Hauler.createHaulerPool();
  assert.equal(pool.register({ hullID: "h1", capacityM3: 100 }).code, "REGISTERED");
  assert.equal(pool.register({ hullID: "h2", capacityM3: 10 }).code, "REGISTERED");
  assert.equal(pool.reserve({ runID: "r1", hullID: "h1", volumeM3: 50, cargoIDs: ["c1"] }).code, "RESERVED");
  assert.equal(pool.reserve({ runID: "r1", hullID: "h1", volumeM3: 50, cargoIDs: ["c1"] }).code, "ALREADY_RESERVED");
  assert.equal(pool.reserve({ runID: "r2", hullID: "h1", volumeM3: 10, cargoIDs: ["c2"] }).code, "HULL_RESERVED");
  assert.equal(pool.reserve({ runID: "r3", hullID: "h2", volumeM3: 50, cargoIDs: ["c3"] }).code, "INSUFFICIENT_CAPACITY");
  assert.equal(pool.reserve({ runID: "r4", hullID: "h2", volumeM3: 5, cargoIDs: ["c1"] }).code, "CARGO_ALREADY_LOADED");
  assert.equal(pool.reserve({ runID: "r5", hullID: "ghost", volumeM3: 1, cargoIDs: [] }).code, "UNKNOWN_HULL");

  assert.equal(pool.freeze({ hullID: "h1", reason: "disconnect" }).code, "FROZEN");
  assert.equal(pool.reserve({ runID: "r6", hullID: "h1", volumeM3: 1, cargoIDs: [] }).code, "HULL_FROZEN");
  assert.equal(pool.reconcile({ hullID: "h1", evidence: "" }).code, "EVIDENCE_REQUIRED");
  assert.equal(pool.reserve({ runID: "r6", hullID: "h1", volumeM3: 1, cargoIDs: [] }).code, "HULL_FROZEN");
  assert.equal(pool.reconcile({ hullID: "h1", evidence: "hull readback matches" }).code, "RECONCILED");
  assert.equal(pool.release("r1"), true);
  assert.equal(pool.hullOf("r1"), null);
  assert.equal(pool.reserve({ runID: "r7", hullID: "h1", volumeM3: 1, cargoIDs: [] }).code, "RESERVED");
});

test("IE-046 run: PLAN -> LOAD -> CROSS -> SELL is the only path and it keeps one hull", () => {
  const d = Run.createDistributor();
  assert.equal(d.start({ runID: "r1", hullID: "h1", cargoID: "c1", quantity: 10 }).code, "STARTED");
  assert.equal(d.advance({ runID: "r1", to: "CROSS" }).code, "INVALID_TRANSITION", "no skipping LOAD");
  assert.equal(d.advance({ runID: "r1", to: "LOAD" }).code, "ADVANCED");
  assert.equal(d.advance({ runID: "r1", to: "CROSS" }).code, "RECEIPT_REQUIRED", "a crossing needs a gate receipt");
  assert.equal(d.advance({ runID: "r1", to: "CROSS", receiptID: "gate-1" }).code, "ADVANCED");
  assert.equal(d.advance({ runID: "r1", to: "SELL" }).code, "RECEIPT_REQUIRED");
  assert.equal(d.advance({ runID: "r1", to: "SELL", receiptID: "sale-1" }).code, "ADVANCED");

  // the crash-after-crossing case: a restart reattaches to the same hull and cargo, it never clones one
  const restarted = d.start({ runID: "r1", hullID: "h9", cargoID: "c9", quantity: 10 });
  assert.equal(restarted.code, "ALREADY_STARTED");
  assert.equal(restarted.hullID, "h1");
  const resumed = d.resume("r1");
  assert.equal(resumed.hullID, "h1");
  assert.equal(resumed.cargoID, "c1");
  assert.equal(resumed.quantity, 10);
  assert.equal(resumed.stage, "SELL");
  assert.equal(d.advance({ runID: "ghost", to: "LOAD" }).code, "UNKNOWN_RUN");
});

test("IE-047 unload: nothing is sold from 10km out or from an empty hull", () => {
  const p = { deposit: () => ({ receiptID: "dep-1" }) };
  const station = { stationID: "s1", dockRangeMeters: 2500 };
  const base = { cargo: { ownerID: "corp-a", typeID: "35", quantity: 10 }, orders: [{ priceCents: 5, quantity: 4 }], unloadPort: p };
  assert.equal(Unload.unload({ ...base, station: { ...station, distanceMeters: 10000 } }).code, "NOT_AT_STATION");
  assert.equal(
    Unload.unload({ ...base, cargo: { ...base.cargo, quantity: 0 }, station: { ...station, distanceMeters: 10 } }).code,
    "EMPTY_HULL",
  );
  const ok = Unload.unload({ ...base, station: { ...station, distanceMeters: 100 } });
  assert.equal(ok.code, "UNLOADED");
  assert.deepEqual(ok.sold, { quantity: 4, cents: 20 });
  assert.deepEqual(ok.remaining, { ownerID: "corp-a", typeID: "35", quantity: 6 }, "the remainder keeps owner and exact quantity");
  assert.equal(Unload.unload({ ...base, station: { ...station, distanceMeters: 0 }, unloadPort: {} }).code, "NATIVE_AUTHORITY_UNAVAILABLE");
  assert.equal(
    Unload.unload({ ...base, station: { ...station, distanceMeters: 0 }, unloadPort: { deposit: () => ({}) } }).code,
    "UNLOAD_UNKNOWN",
  );
});

test("IE-048 disruption: lost cargo is not recreated and a timeout never teleports", () => {
  assert.deepEqual(Disruption.classifyDisruption({ evidence: { destroyed: true } }), {
    state: "LOST",
    code: "CARGO_LOST",
    recreateCargo: false,
  });
  assert.equal(Disruption.classifyDisruption({ evidence: { hullPresent: false, cargoPresent: true } }).state, "STRANDED");
  assert.equal(Disruption.classifyDisruption({ evidence: { hullPresent: true, cargoPresent: false } }).state, "ATTACKED");
  const uncertain = Disruption.classifyDisruption({ evidence: { hullPresent: true, cargoPresent: true, lastPingTick: 1, tick: 100, timeoutTicks: 10 } });
  assert.equal(uncertain.state, "UNCERTAIN");
  assert.equal(uncertain.teleport, false);
  assert.equal(Disruption.classifyDisruption({ evidence: { hullPresent: true, cargoPresent: true, lastPingTick: 99, tick: 100, timeoutTicks: 10 } }).state, "NOMINAL");
  assert.equal(Disruption.replan({ state: "UNCERTAIN", fleet: [{ hullID: "h1", available: true }] }).code, "RECONCILE_REQUIRED");
  assert.equal(Disruption.replan({ state: "STRANDED", fleet: [] }).code, "NO_SHIP");
  const replanned = Disruption.replan({ state: "STRANDED", fleet: [{ hullID: "h2", available: true }, { hullID: "h1", available: true }] });
  assert.equal(replanned.hullID, "h1", "the replan picks a real, deterministically sorted hull");
});

test("IE-049 carrier: a funded cheaper external option wins and an unpaid contract is refused", () => {
  const internal = { hullID: "h1", capacityM3: 100, etaSeconds: 600, riskScore: 1, costCents: 50, available: true };
  const external = { contractID: "c1", priceCents: 20, etaSeconds: 300, funded: true };
  assert.equal(Carrier.chooseCarrier({ internal, external, maxEtaSeconds: 1000 }).choice, "EXTERNAL");
  assert.equal(Carrier.chooseCarrier({ internal, external: { ...external, funded: false }, maxEtaSeconds: 1000 }).code, "UNPAID_CONTRACT");
  assert.equal(
    Carrier.chooseCarrier({ internal: { ...internal, available: false }, external: { ...external, etaSeconds: 9000 }, maxEtaSeconds: 1000 }).code,
    "IMPOSSIBLE_ETA",
  );
  const internalWins = Carrier.chooseCarrier({ internal: { ...internal, costCents: 10 }, external: { ...external, priceCents: 20 }, maxEtaSeconds: 1000 });
  assert.equal(internalWins.choice, "INTERNAL");
  assert.equal(internalWins.hullID, "h1");
  assert.equal(Carrier.chooseCarrier({ internal: { ...internal, available: false }, maxEtaSeconds: 1000 }).code, "NO_CARRIER");
  assert.equal(Carrier.chooseCarrier({ internal, external, maxEtaSeconds: 0 }).code, "INVALID_LIMIT");
});

// WAVE2-REGRESSION
test("IE-047 unload: an order line that overflows a safe integer is refused", () => {
  const r = Unload.unload({
    cargo: { ownerID: "corp-a", typeID: "35", quantity: 10 },
    station: { stationID: "s1", dockRangeMeters: 2500, distanceMeters: 10 },
    orders: [{ priceCents: Number.MAX_SAFE_INTEGER, quantity: 9 }, { priceCents: Number.MAX_SAFE_INTEGER, quantity: 9 }],
    unloadPort: { deposit: () => ({ receiptID: "dep-1" }) },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "INVALID_ORDER", "money that does not fit in a safe integer is not money");
  assert.equal(Unload.unload({
    cargo: { ownerID: "corp-a", typeID: "35", quantity: 10 },
    station: { stationID: "s1", dockRangeMeters: 2500, distanceMeters: 10 },
    orders: [{ priceCents: 5, quantity: 0 }],
    unloadPort: { deposit: () => ({ receiptID: "dep-1" }) },
  }).sold.quantity, 0, "a zero-quantity order sells nothing and debits nothing");
});
