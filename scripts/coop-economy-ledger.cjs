#!/usr/bin/env node
// Operator tool: one balance sheet for the co-op economy, read from durable records only.
//
// Why: every piece of the loop now runs on its own (mine -> haul -> refund -> build -> sell),
// but nothing states whether the books close. That is how three manufactured chipsets were
// once lost by a slot repair without anybody noticing: 13 produced, 8 sold, 2 held, 3 gone.
// This tool prints produced / sold / held per product and NAMES anything unexplained, so a
// silent loss can never hide inside a growing hangar again.
//
// It reads, never writes:
//   coop-native-refinery/*.json        ore consumed -> minerals produced
//   coop-native-industry/receipts/*    products produced (exactly once per job)
//   coop-native-market/reconciled/*    market fills, with price and quantity
//   coop-mineral-lift/receipts/*       lift sales, deduplicated by journal
//   the item store                     what is still physically held, per station
//
// Usage inside the server container:
//   docker exec evejs-agents-server-1 node /tmp/ledger.cjs
//   docker exec evejs-agents-server-1 node /tmp/ledger.cjs --json
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SERVER_ROOT = process.env.EVEJS_SERVER_ROOT || "/app/server";
const ROOT = "/var/lib/evejs";
const CORP = Number(process.env.EVEJS_COOP_FACTORY_CORP_ID || 1000129);
const json = process.argv.includes("--json");

const readDir = (dir) => {
  try { return fs.readdirSync(dir).filter((n) => n.endsWith(".json")); }
  catch (_error) { return []; }
};
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (_error) { return null; }
};
const add = (map, key, amount) => {
  const k = String(key);
  map[k] = (map[k] || 0) + Number(amount || 0);
};

const oreConsumed = {};      // oreTypeID -> units refined away
const mineralsOut = {};      // mineral typeID -> units produced by refining
const refineFees = {count: 0, isk: 0, stations: {}};
for (const name of readDir(path.join(ROOT, "coop-native-refinery"))) {
  const row = readJson(path.join(ROOT, "coop-native-refinery", name));
  if (!row || String(row.phase || row.status) !== "COMMITTED") continue;
  add(oreConsumed, row.oreTypeID, row.consumeQuantity);
  for (const out of row.outputs || []) add(mineralsOut, out.typeID, out.quantity);
  refineFees.count += 1;
  refineFees.isk += Number(row.iskCost || 0);
  refineFees.stations[String(row.stationID)] = (refineFees.stations[String(row.stationID)] || 0) + 1;
}

const produced = {};         // productTypeID -> units produced by manufacturing
const jobs = {count: 0, runs: 0};
for (const name of readDir(path.join(ROOT, "coop-native-industry", "receipts"))) {
  const row = readJson(path.join(ROOT, "coop-native-industry", "receipts", name));
  if (!row || String(row.status) !== "PRODUCED") continue;
  add(produced, row.productTypeID, row.quantity);
  jobs.count += 1;
  jobs.runs += Number(row.runs || 0);
}

// A sale is counted once per journal: both the market reconciler and the lift tool write a
// receipt for the same fill, and counting twice would invent goods that were never made.
const sold = {};
const revenue = {isk: 0, fills: 0, byStation: {}, byType: {}};
const seen = new Set();
const saleFiles = [
  ...readDir(path.join(ROOT, "coop-native-market", "reconciled")).map((n) => path.join(ROOT, "coop-native-market", "reconciled", n)),
  ...readDir(path.join(ROOT, "coop-mineral-lift", "receipts")).map((n) => path.join(ROOT, "coop-mineral-lift", "receipts", n)),
];
for (const file of saleFiles) {
  const row = readJson(file);
  if (!row) continue;
  const state = String(row.phase || row.status || "");
  if (!["SETTLED", "SOLD"].includes(state)) continue;
  const id = String(row.journalID || row.receiptID || path.basename(file));
  if (seen.has(id)) continue;
  seen.add(id);
  const quantity = Number(row.quantity || 0);
  const price = Number(row.price || 0);
  add(sold, row.typeID, quantity);
  revenue.fills += 1;
  revenue.isk += quantity * price;
  add(revenue.byStation, row.stationID, quantity * price);
  add(revenue.byType, row.typeID, quantity * price);
}

const held = {};             // typeID -> units physically in the corporation's hangars
const heldByStation = {};
const items = require(path.join(SERVER_ROOT, "src/services/inventory/itemStore"));
let stationsScanned = [];
try {
  const world = require(path.join(SERVER_ROOT, "src/space/worldData"));
  const all = typeof world.listStations === "function" ? world.listStations() : [];
  stationsScanned = all.map((s) => Number(s.stationID || s.itemID || s)).filter(Boolean);
} catch (_error) { stationsScanned = []; }
// The fleet's own hangars are known by the stations that ever appear in a durable receipt.
for (const source of [sold, undefined]) void source;
for (const station of new Set([
  ...stationsScanned,
  ...Object.keys(revenue.byStation).map(Number),
  ...Object.keys(refineFees.stations).map(Number),
  60000682, 60014935, 60000688, 60003724, 60003334,
])) {
  let rows = [];
  try {
    const answer = items.listOwnedItems(CORP, { locationID: station });
    rows = Array.isArray(answer) ? answer : (answer && Array.isArray(answer.data) ? answer.data : []);
  } catch (_error) { continue; }
  for (const row of rows) {
    if (Number(row.flagID) !== 4 || !(Number(row.quantity) > 0)) continue;
    const typeID = Number(row.typeID);
    if (!typeID) continue;
    add(held, typeID, row.quantity);
    heldByStation[typeID] = heldByStation[typeID] || {};
    add(heldByStation[typeID], station, row.quantity);
  }
}

// Products are the only things with no other explanation: every unit produced must be sold
// or still held. Ore enters the world by MINING and minerals by REFINING, so those types are
// tracked as flow (refined away, produced, held), never as a produce/sell balance.
const conversionTypes = new Set([...Object.keys(oreConsumed), ...Object.keys(mineralsOut)]);
const productTypes = new Set([
  ...Object.keys(produced),
  ...Object.keys(sold).filter((t) => !conversionTypes.has(t)),
].filter((t) => !conversionTypes.has(t)));
const unexplained = {};
for (const typeID of productTypes) {
  const delta = (produced[typeID] || 0) - (sold[typeID] || 0) - (held[typeID] || 0);
  if (delta !== 0) unexplained[typeID] = delta;
}

let treasury = null;
const treasuryRow = readJson(path.join(ROOT, "coop-native-market", "corp-treasury", String(CORP) + ".json"));
if (treasuryRow) treasury = Number(treasuryRow.afterISK !== undefined ? treasuryRow.afterISK : treasuryRow.balance);

const report = {
  corpID: CORP,
  oreConsumed, mineralsOut, refineFees,
  produced, jobs, sold, revenue, held, heldByStation, unexplained, treasury,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const fmt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const top = (map, n = 6) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
console.log("CO-OP ECONOMY LEDGER  (corp " + CORP + ")");
console.log("treasury            " + (treasury === null ? "unreadable" : fmt(treasury) + " ISK"));
console.log("refinery            " + refineFees.count + " operations, " + fmt(refineFees.isk) + " ISK of station fees");
console.log("manufacturing       " + jobs.count + " jobs, " + fmt(jobs.runs) + " runs");
console.log("sales               " + revenue.fills + " fills, " + fmt(revenue.isk) + " ISK");
// Freight is where most of the corporation's goods now leave the building, and its money
// used to live only in a pilot balance and a treasury sweep. One append-only row per settled
// sale keeps it visible where the capital is accounted.
let freight = { rows: 0, isk: 0, units: 0, unknown: 0, routes: new Map() };
try {
  const file = path.join(process.env.EVEJS_COOP_NPC_MARKET_ROOT ||
    process.env.EVEJS_COOP_NPC_MARKET_DIR || "/var/lib/evejs/coop-native-market",
    "freight-ledger.jsonl");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    freight.rows += 1;
    freight.isk += Number(row.isk) || 0;
    freight.units += Number(row.units) || 0;
    if (row.iskUnknown === true) freight.unknown += 1;
    const route = String(row.fromSystemID || 0) + "->" + String(row.toSystemID || 0);
    const current = freight.routes.get(route) || { isk: 0, trips: 0 };
    current.isk += Number(row.isk) || 0;
    current.trips += 1;
    freight.routes.set(route, current);
  }
} catch (_error) { /* no freight ledger yet is a valid state */ }
console.log("freight             " + freight.rows + " trips, " + fmt(freight.isk) + " ISK, " +
  freight.units + " units" + (freight.unknown ? " (" + freight.unknown + " without a captured price)" : ""));
for (const [route, row] of [...freight.routes.entries()].sort((a, b) => b[1].isk - a[1].isk).slice(0, 4))
  console.log("  " + route + "  " + row.trips + " trips, " + fmt(row.isk) + " ISK");
console.log("");
console.log("ORE REFINED");
for (const [typeID, units] of top(oreConsumed)) console.log("  " + typeID + "  " + fmt(units) + " units refined away");
console.log("MINERALS FROM REFINING");
for (const [typeID, units] of top(mineralsOut)) console.log("  " + typeID + "  +" + fmt(units));
console.log("PRODUCTS PRODUCED");
for (const [typeID, units] of top(produced)) {
  console.log("  " + typeID + "  produced " + fmt(units) + "  sold " + fmt(sold[typeID] || 0) +
    "  held " + fmt(held[typeID] || 0) + "  isk " + fmt(revenue.byType[typeID] || 0));
}
console.log("STILL HELD (top by units)");
for (const [typeID, units] of top(held)) {
  const where = top(heldByStation[typeID] || {}, 2).map(([s, q]) => s + ":" + fmt(q)).join(" ");
  console.log("  " + typeID + "  " + fmt(units) + "  " + where);
}
console.log("");
if (Object.keys(unexplained).length) {
  console.log("UNEXPLAINED (produced - sold - held): " + JSON.stringify(unexplained));
  process.exit(1);
}
console.log("BALANCED  every produced unit is either sold or physically held");
process.exit(0);
