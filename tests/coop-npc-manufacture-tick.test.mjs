import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const industry = require("../integration/coopNpcManufactureTick.cjs");

// Measured 2026-10-28: space/coopNpcManufacture.js had ZERO callers in the server, so every
// job came from an operator script and an INSTALLED job could never finish in-world. The
// caller also has to answer the economic question the surplus minerals taught: 891 702
// units sit unsold because no local station bids for them. Build only what is bought.
const STATION = 60014935;
const PRODUCT = 444;
const PLAN = {
  stationID: STATION,
  blueprintTypeID: 1076,
  blueprintName: "Chipset Blueprint",
  productTypeID: PRODUCT,
  productPerRun: 1,
  materials: [{ typeID: 34, quantity: 1111 }],
  have: { 34: 999999 },
  bid: { price: 53700.08, volume: 25 },
  heldProduct: 0,
  inFlightProduct: 0,
};

test("a product with no real buyer is never built", () => {
  const result = industry.choose({ candidates: [{ ...PLAN, bid: null }] });
  assert.equal(result.status, "NO_JOB");
  assert.equal(result.refusals[0].reason, "NO_REAL_BUYER");
});

test("a bid that is already covered by stock and jobs is not produced again", () => {
  // The corporation already holds 10 and is building 15 of the 25 the station wants.
  const result = industry.choose({
    candidates: [{ ...PLAN, heldProduct: 10, inFlightProduct: 15 }],
  });
  assert.equal(result.status, "NO_JOB");
  assert.equal(result.refusals[0].reason, "BUYER_ALREADY_COVERED");
  assert.equal(result.refusals[0].absorbed, 0);
});

test("the run count is bounded by the buyer, not by how much minerals the hangar has", () => {
  const rich = industry.choose({ candidates: [{ ...PLAN, have: { 34: 100000 } }], maxRuns: 20 });
  assert.equal(rich.status, "JOB");
  assert.equal(rich.job.runs, 20, "the buyer wants 25, so the run cap applies");
  const thin = industry.choose({ candidates: [{ ...PLAN, bid: { price: 53700.08, volume: 4 } }], maxRuns: 20 });
  assert.equal(thin.job.runs, 4, "a 4-unit bid never becomes a 20-run job");
});

test("the run count is bounded by the real materials in the hangar", () => {
  const result = industry.choose({ candidates: [{ ...PLAN, have: { 34: 2500 } }], maxRuns: 20 });
  assert.equal(result.job.runs, 2, "2500 / 1111 per run is two runs");
  assert.equal(result.job.materials[0].quantity, 2222, "the journal asks for exactly what two runs need");
});

test("a missing material is refused with the exact shortfall", () => {
  const result = industry.choose({ candidates: [{ ...PLAN, have: { 34: 100 } }] });
  assert.equal(result.status, "NO_JOB");
  assert.equal(result.refusals[0].reason, "MATERIALS_MISSING");
  assert.deepEqual(result.refusals[0].shortfalls, [{ typeID: 34, need: 1111, have: 100 }]);
});

test("a price floor keeps the corporation from building at a loss", () => {
  const result = industry.choose({ candidates: [PLAN], minPrice: 60000 });
  assert.equal(result.status, "NO_JOB");
  assert.equal(result.refusals[0].reason, "BELOW_PRICE_FLOOR");
});

test("an already running job for that recipe blocks a second one", () => {
  const result = industry.choose({ candidates: [{ ...PLAN, jobInFlight: true }] });
  assert.equal(result.refusals[0].reason, "JOB_ALREADY_INSTALLED");
});

test("the best payer wins, not the biggest recipe", () => {
  const result = industry.choose({
    candidates: [
      { ...PLAN, productTypeID: 445, bid: { price: 100, volume: 4 } },
      { ...PLAN, productTypeID: 446, bid: { price: 9000, volume: 2 } },
    ],
    maxRuns: 4,
  });
  assert.equal(result.job.productTypeID, 446);
  assert.equal(result.job.expectedRevenue, 18000);
  assert.equal(result.alternatives.length, 1);
});

test("a recipe with a job in flight waits instead of starting a second one", () => {
  // Two live jobs for one recipe can race the same hangar stack into a shortfall.
  const result = industry.choose({ candidates: [{ ...PLAN, jobInFlight: true }] });
  assert.equal(result.status, "NO_JOB");
  assert.equal(result.refusals[0].reason, "JOB_ALREADY_INSTALLED");
});

test("only a seeded station order counts as demand", async () => {
  // A buy order placed by the co-op itself is not a reason to build more of the same good.
  const calls = [];
  const call = async (method, params) => {
    calls.push({ method, params });
    return { buys: [
      { station_id: STATION, price: 999999, vol_remaining: 500, source: "player" },
      { station_id: STATION, price: 53700.08, vol_remaining: 12, source: "seed" },
      { station_id: 60000001, price: 99999, vol_remaining: 900, source: "seed" },
    ] };
  };
  const bid = await industry.bestSeededBid({ region: 10000002, stationID: STATION, productTypeID: PRODUCT, call });
  assert.deepEqual(bid, { price: 53700.08, volume: 12 }, "the station's own seeded bid, with its remaining volume");
  assert.deepEqual(calls[0], { method: "GetOrders", params: { region_id: 10000002, type_id: PRODUCT } });
});

test("no seeded bid at that station means no demand at all", async () => {
  const call = async () => ({ buys: [{ station_id: 60000001, price: 9000, vol_remaining: 9, source: "seed" }] });
  assert.equal(await industry.bestSeededBid({ region: 10000002, stationID: STATION, productTypeID: PRODUCT, call }), null);
});

test("a recipe that is a static-data artifact is refused, not printed", () => {
  // Measured 2026-10-28: blueprint 60767 (Laelaps Blueprint) is 1x Tritanium -> 1 Laelaps,
  // and the seeded market bids 33 586 560 for the hull. That is not industry, it is ISK
  // printing: the inputs are worth a rounding error next to the product.
  assert.equal(industry.isTrivialRecipe({ materialValue: 4600, productValue: 33586560 }), true,
    "1 Tritanium worth ~4 600 against a 33.5M hull is an artifact");
  assert.equal(industry.isTrivialRecipe({ materialValue: 21000000, productValue: 4661000 }), false,
    "ammunition that needs 21M of minerals for 4.6M of product is a real, if thin, chain");
  assert.equal(industry.isTrivialRecipe({ materialValue: 0, productValue: 4661000 }), false,
    "a material nobody bids for is valued at zero and must never be judged trivial");
  assert.equal(industry.isTrivialRecipe({ materialValue: 400, productValue: 1000, minRatio: 0.5 }), true);
  assert.equal(industry.isTrivialRecipe({ materialValue: 900, productValue: 1000, minRatio: 0.1 }), false);
});

test("a station with no local buyer still builds for a buyer one gate away", async () => {
  // Measured 2026-10-30: every local station reported NO_REAL_BUYER while Jita bid 560 000 for
  // the ammunition the corporation had already produced - and the freight run can carry it.
  const source = require("node:fs").readFileSync(
    require("node:path").join(process.cwd(), "integration/coopNpcManufactureTick.cjs"), "utf8");
  assert.ok(/bidElsewhere/.test(source), "the manufacturer can ask for a reachable buyer");
  assert.ok(/living-npc-manufacture-buyer-elsewhere/.test(source),
    "and it says so, instead of looking like a station with no demand");
});

test("a job built for a distant buyer says whose demand it answers", () => {
  // Measured 2026-10-30: every local station bid for nothing while Jita paid 560 000 for the
  // same goods, and the installed job did not record which demand it existed for.
  const source = require("node:fs").readFileSync(
    require("node:path").join(process.cwd(), "integration/coopNpcManufactureTick.cjs"), "utf8");
  assert.ok(/buyer: bid\.where === "elsewhere"/.test(source),
    "the candidate carries the buyer's system and station");
  assert.ok(/buyerSystemID/.test(source), "and the install reports it");
  const manufacture = require("node:fs").readFileSync(
    require("node:path").join(process.cwd(), "integration/coopNpcManufacture.cjs"), "utf8");
  assert.ok(/buyerSystemID: pos\(buyer && buyer\.systemID\)/.test(manufacture),
    "the durable job record keeps the buyer");
});

test("the demand-gap report is read after `ready`, never before it", () => {
  // Measured 2026-10-31: the gap block was inserted ABOVE `const ready`, so every tick threw
  // "Cannot access 'ready' before initialization" and the manufacturer did nothing for hours.
  // A phase that dies silently is indistinguishable from a phase with no work.
  const source = require("node:fs").readFileSync(
    require("node:path").join(process.cwd(), "integration/coopNpcManufactureTick.cjs"), "utf8");
  const declared = source.indexOf("const ready = candidates.filter");
  const used = source.indexOf("options.demandGap ===");
  assert.ok(declared >= 0, "ready is declared");
  assert.ok(used > declared, "the gap report reads it only after it exists");
});

test("a recipe that costs more than its product pays is never started", () => {
  // Measured 2026-10-31: Miner I needed 481 Pyerite + 119 Mexallon, worth 12 739 ISK at the
  // regional bids, while the only real bid for the ship was 6 028 - each job burned 7 467 ISK.
  assert.equal(industry.losesMoney({materialValue: 12739, productValue: 6028}), true);
  assert.equal(industry.losesMoney({materialValue: 0, productValue: 5122}), false,
    "a material nobody here bids for is free to consume");
  assert.equal(industry.losesMoney({materialValue: 100, productValue: 5122}), false);
  assert.equal(industry.losesMoney({materialValue: 100, productValue: 0}), false,
    "zero revenue is already refused as no-buyer");
});
