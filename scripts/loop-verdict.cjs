"use strict";
// Reads the co-op event log (JSON lines) and states, stage by stage, whether the
// mining loop actually closed in the window the operator asked about:
//
//   mining   a native NPC mining cycle really happened
//   haul     ore really moved from a miner into a hauler (a load, not a guess)
//   deliver  the hauler really unloaded it at a real station (stationID > 0)
//   sale     the station really bought it (or why the sale was skipped)
//
// The point is the shape of the answer: every stage is either PROVEN with the
// event it came from, or MISSING/SKIPPED with the reason the runtime recorded.
// A stage is never inferred from an earlier stage.
//
//   node scripts/loop-verdict.cjs <events.jsonl> [--require-sale] [--since ISO]
const fs = require("node:fs");

const HAUL_LOAD = "living-hauler-loaded";
const HAUL_DELIVERED = "living-native-haul-delivered";
const STATION_DELIVERED = "living-npc-station-delivered";
const ALIFE_DELIVERY = "alife-native-delivery-settled";
const WAREHOUSE = "living-warehouse-committed";
const SALE_SOLD = "living-npc-station-sold";
const SALE_SKIPPED = "living-npc-station-sale-skipped";
const FLEET_STATE = "living-mining-fleet-state";
const CYCLE_ATTEMPT = "MINING_CYCLE_ATTEMPT";
const CYCLE_SETTLED = "living-mining-cycle-settled";

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function readEvents(text) {
  return String(text || "").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_error) { return null; }
  }).filter(Boolean);
}

function fleetOre(row) {
  const fleets = Array.isArray(row.fleets) ? row.fleets : [];
  return fleets.reduce((total, fleet) => total + (Array.isArray(fleet?.shipDetail?.ships) ? fleet.shipDetail.ships : [])
    .reduce((sum, ship) => sum + num(ship.quantity), 0), 0);
}

function verdict(rows, options = {}) {
  const requireSale = options.requireSale !== false;
  const since = options.since ? Date.parse(options.since) : 0;
  const window = rows.filter((row) => {
    const at = Date.parse(row.at);
    return !Number.isFinite(at) || !since || at >= since;
  });
  // The mining trace puts the specific name in `reason` and the transport name in
  // `event`; station events do the opposite. Match either, never a substring.
  const byName = (name) => window.filter((row) => String(row.event || "") === name || String(row.reason || "") === name);
  const stages = {};

  // Mining is proven by ore that actually left a rock inside a committed native
  // transaction. A cycle *attempt* and a fleet holding ore are inputs, so they are
  // reported as ATTEMPTED and the verdict refuses to call that mining.
  const settled = byName(CYCLE_SETTLED).filter((row) => num(row.quantity) > 0);
  const cycles = byName(CYCLE_ATTEMPT);
  const fleetWithOre = byName(FLEET_STATE).filter((row) => fleetOre(row) > 0);
  stages.mining = settled.length
    ? {status: "PROVEN", evidence: CYCLE_SETTLED, detail: "quantity=" + num(settled[settled.length - 1].quantity) + " rock=" + num(settled[settled.length - 1].beforeRock) + "->" + num(settled[settled.length - 1].afterRock)}
    : cycles.length
      ? {status: "ATTEMPTED", evidence: CYCLE_ATTEMPT + " x" + cycles.length, detail: "cycles ran but none settled ore (see MODULE_STOP_* for the refusal)"}
      : fleetWithOre.length
        ? {status: "ATTEMPTED", evidence: FLEET_STATE, detail: "fleet holds ore=" + fleetOre(fleetWithOre[fleetWithOre.length - 1]) + " but no settled cycle in this window"}
        : {status: "MISSING", evidence: "", detail: "no mining cycle and no fleet holding ore in this window"};

  const loads = byName(HAUL_LOAD).filter((row) => num(row.cargoQuantity) > 0 && num(row.haulerID) > 0);
  stages.haul = loads.length
    ? {status: "PROVEN", evidence: HAUL_LOAD, detail: "cargoQuantity=" + num(loads[loads.length - 1].cargoQuantity) + " hauler=" + num(loads[loads.length - 1].haulerID)}
    : {status: "MISSING", evidence: "", detail: "no hauler took ore (see living-haul-no-hauler for the per-hull reason)"};

  // Delivery has two legitimate producers: the station-arrival trip (the modern
  // path: stacks deposited at a real station, plus an alife delivery witness) and
  // the older crate unload. A station id of 0 is never a delivery either way.
  const delivered = byName(HAUL_DELIVERED).filter((row) => String(row.status || "").toUpperCase() === "DELIVERED" && num(row.stationID) > 0);
  const deposited = byName(STATION_DELIVERED).filter((row) => num(row.stationID) > 0 && num(row.stacks) > 0);
  const alifeDelivered = byName(ALIFE_DELIVERY).filter((row) => num(row.stationID) > 0);
  const warehoused = byName(WAREHOUSE);
  stages.deliver = deposited.length
    ? {status: "PROVEN", evidence: STATION_DELIVERED, detail: "station=" + num(deposited[deposited.length - 1].stationID) + " stacks=" + num(deposited[deposited.length - 1].stacks) + " ore=" + num(deposited[deposited.length - 1].oreQuantity)}
    : alifeDelivered.length
      ? {status: "PROVEN", evidence: ALIFE_DELIVERY, detail: "station=" + num(alifeDelivered[alifeDelivered.length - 1].stationID)}
      : delivered.length
        ? {status: "PROVEN", evidence: HAUL_DELIVERED, detail: "station=" + num(delivered[delivered.length - 1].stationID)}
        : warehoused.length
          ? {status: "PROVEN", evidence: WAREHOUSE, detail: "stacks=" + num(warehoused[warehoused.length - 1].stacks)}
          : {status: "MISSING", evidence: "", detail: "nothing reached a real station (stationID > 0)"};

  const sold = byName(SALE_SOLD);
  const skipped = byName(SALE_SKIPPED);
  if (sold.length) {
    const last = sold[sold.length - 1];
    stages.sale = {status: "PROVEN", evidence: SALE_SOLD, detail: "quantity=" + num(last.soldQuantity || last.quantity) + " revenue=" + num(last.revenue || last.proceeds)};
  } else if (skipped.length) {
    const last = skipped[skipped.length - 1];
    stages.sale = {status: "SKIPPED", evidence: SALE_SKIPPED, detail: String(last.status || "") + ":" + String(last.reason || "")};
  } else {
    stages.sale = {status: "MISSING", evidence: "", detail: "the station never reported a sale or a skip"};
  }

  const order = ["mining", "haul", "deliver"].concat(requireSale ? ["sale"] : []);
  const failed = order.find((stage) => stages[stage].status !== "PROVEN");
  return {stages, required: order, verdict: failed ? "FAIL:" + failed : "PASS"};
}

function format(result) {
  const lines = [];
  for (const stage of Object.keys(result.stages)) {
    const entry = result.stages[stage];
    lines.push(stage.toUpperCase().padEnd(8) + entry.status +
      (entry.evidence ? " via " + entry.evidence : "") + " - " + entry.detail);
  }
  lines.push("LOOP_VERDICT " + result.verdict);
  return lines.join("\n");
}

module.exports = {verdict, format, readEvents, fleetOre};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const file = argv.find((arg) => !arg.startsWith("--") && argv[argv.indexOf(arg) - 1] !== "--since");
  const at = argv.indexOf("--since");
  const options = {
    requireSale: !argv.includes("--no-require-sale"),
    since: at >= 0 ? argv[at + 1] : null,
  };
  const text = file && file !== "-" ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
  const result = verdict(readEvents(text), options);
  console.log(format(result));
  process.exit(result.verdict === "PASS" ? 0 : 1);
}
