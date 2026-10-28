#!/usr/bin/env node
// Operator tool: what the corporation should ship to Jita right now, and what it pays.
//
// It uses the live seeded book (seed_buy_orders) and the real hangar stacks, then hands both
// to space/coopNpcDistribution.js - the pure decision - and prints the trip or the refusals.
// It moves nothing: cross-system transfer is opt-in and needs live QA.
//
// Inside the server container:
//   docker exec evejs-agents-server-1 node /tmp/dist.cjs
//   docker exec evejs-agents-server-1 node /tmp/dist.cjs --json
"use strict";

process.env.EVEJS_SERVER_ROOT = process.env.EVEJS_SERVER_ROOT || "/app/server";
const path = require("node:path");
const S = path.join(process.env.EVEJS_SERVER_ROOT, "src");
const json = process.argv.includes("--json");
const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  const v = i >= 0 ? process.argv[i + 1] : null;
  return v && !v.startsWith("--") ? v : fallback;
};

const fromSystem = Number(arg("from", 30000145));
const toSystem = Number(arg("to", 30000142));
const toStation = Number(arg("station", 60003760));
const capacityM3 = Number(arg("capacity", process.env.EVEJS_COOP_DISTRIBUTION_CAPACITY_M3 || 62000));

const lib = require("/app/server/node_modules/better-sqlite3");
const db = new lib(process.env.EVEJS_MARKET_DB || "/var/lib/evejs/market/market.sqlite",
  { readonly: true, fileMustExist: true });
const items = require(path.join(S, "services/inventory/itemStore"));
const inventory = require(path.join(S, "services/inventory/itemTypeRegistry"));
const { plan } = require(path.join(S, "space/coopNpcDistribution"));

const bidsAt = (systemID, stationID = 0) => {
  const rows = stationID
    ? db.prepare("select type_id, price, quantity from seed_buy_orders where solar_system_id=? and station_id=? and quantity>0").all(systemID, stationID)
    : db.prepare("select type_id, price, quantity from seed_buy_orders where solar_system_id=? and quantity>0").all(systemID);
  const out = {};
  for (const row of rows) {
    const typeID = Number(row.type_id);
    const cur = out[typeID] || { price: 0, volume: 0 };
    if (Number(row.price) > cur.price) cur.price = Number(row.price);
    cur.volume += Number(row.quantity);
    out[typeID] = cur;
  }
  return out;
};

// Every station the corporation actually holds stock at, discovered from the store itself.
const world = require(path.join(S, "space/worldData"));
let stations = [];
try {
  const all = typeof world.listStations === "function" ? world.listStations() : [];
  stations = all.map((s) => Number(s.stationID || s.itemID || s)).filter(Boolean);
} catch (_error) { stations = []; }
const stacks = [];
for (const stationID of [...new Set([...stations, 60000682, 60014935, 60000688, 60003724, 60003334])]) {
  let rows = [];
  try {
    const answer = items.listOwnedItems(Number(process.env.EVEJS_COOP_FACTORY_CORP_ID || 1000129),
      { locationID: stationID });
    rows = Array.isArray(answer) ? answer : (answer && Array.isArray(answer.data) ? answer.data : []);
  } catch (_error) { continue; }
  for (const row of rows) {
    if (Number(row.flagID) !== 4 || !(Number(row.quantity) > 0)) continue;
    const typeID = Number(row.typeID);
    const meta = inventory.resolveItemByTypeID(typeID) || {};
    stacks.push({ stationID, typeID, quantity: Number(row.quantity),
      m3PerUnit: Number(meta.volume) || 0 });
  }
}

const answer = plan({
  stacks,
  destination: { systemID: toSystem, stationID: toStation, bids: bidsAt(toSystem, toStation) },
  local: { stationID: 0, bids: bidsAt(fromSystem) },
  capacityM3,
  minIsk: Number(arg("min", process.env.EVEJS_COOP_DISTRIBUTION_MIN_ISK || 200000)),
});

if (json) {
  console.log(JSON.stringify({ fromSystem, toSystem, toStation, capacityM3, answer }, null, 2));
  process.exit(answer.status === "TRIP" ? 0 : 2);
}

const fmt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const nameOf = (t) => { try { const r = inventory.resolveItemByTypeID(t) || {}; return String(r.name || r.typeName || t); } catch (_e) { return String(t); } };
console.log("DISTRIBUTION " + fromSystem + " -> " + toSystem + " (station " + toStation + ", hold " + fmt(capacityM3) + " m3)");
console.log("stacks scanned " + stacks.length + "  status " + answer.status);
if (answer.status !== "TRIP") {
  const reasons = {};
  for (const r of answer.refusals) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  console.log("refusals " + JSON.stringify(reasons));
  process.exit(2);
}
const t = answer.trip;
console.log("TRIP  " + nameOf(t.typeID) + " x" + fmt(t.quantity) + " from " + t.stationID +
  " -> " + t.destinationStationID);
console.log("      price " + fmt(t.price) + " vs local " + fmt(t.localPrice) +
  "   expected " + fmt(t.expectedISK) + " ISK   hold used " + fmt(t.m3) + " m3" +
  "   left behind " + fmt(t.remaining));
console.log("runner-up trips " + answer.trips.slice(1, 4).map((x) => nameOf(x.typeID) + " " + fmt(x.expectedISK)).join(", "));
process.exit(0);
