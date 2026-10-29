#!/usr/bin/env node
// Operator tool: what the corporation COULD sell, and what it cannot make.
//
// The loop now mines, refines, builds, flies and sells. Measured 2026-10-30 the freight hulls
// filled their holds (310 000 - 543 000 units a trip) and the corporation owns exactly three
// blueprints - so the binding constraint stopped being ships and became WHAT IT CAN PRODUCE.
//
// This prints, read-only:
//   - the top seeded demand in the buyer system (volume x price, per product);
//   - which of those products the corporation can already build (blueprint owned);
//   - the gap: demand it cannot answer, which is the shopping list for the next purchase.
//
// Inside the server container:
//   docker exec evejs-agents-server-1 node /tmp/gap.cjs [--system 30000142] [--top 12]
"use strict";
process.env.EVEJS_SERVER_ROOT = process.env.EVEJS_SERVER_ROOT || "/app/server";
const path = require("node:path");
const S = path.join(process.env.EVEJS_SERVER_ROOT, "src");
const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const systemID = Number(arg("system", 30000142));
const top = Math.max(1, Number(arg("top", 12)));
// Seeded books carry artifacts: a 92 billion ISK hardener, a PLEX stack, blueprint crates.
// They are demand nobody can answer, and letting them top the list hides the answerable part.
const maxPrice = Math.max(0, Number(arg("max-price", process.env.EVEJS_COOP_NPC_MARKET_MAX_PRICE || 50000000)));
// Categories a real industry can produce here: ships, modules, charges, drones, subsystems.
const PRODUCIBLE = new Set([6, 7, 8, 18, 32]);
const corpID = Number(process.env.EVEJS_COOP_FACTORY_CORP_ID || 1000129);

const items = require(path.join(S, "services/inventory/itemStore"));
const inventory = require(path.join(S, "services/inventory/itemTypeRegistry"));
const manufacture = require(path.join(S, "space/coopNpcManufacture"));
const B = require("better-sqlite3");
const db = new B(process.env.EVEJS_MARKET_DB || "/var/lib/evejs/market/market.sqlite",
  {readonly: true, fileMustExist: true});

const rows = items.listOwnedItems(corpID, {locationID: undefined});
const owned = Array.isArray(rows) ? rows : (rows && rows.data) || [];
const blueprints = [...new Set(owned.filter((r) => Number(r.quantity) === -1 && Number(r.typeID) > 0)
  .map((r) => Number(r.typeID)))];
const buildable = new Map();
for (const bp of blueprints) {
  let plan = null;
  try { plan = manufacture.recipe(bp, 1); } catch (_error) { plan = null; }
  if (plan && plan.status === "READY") buildable.set(Number(plan.productTypeID),
    {blueprintTypeID: bp, name: plan.productName, perRun: plan.productPerRun});
}

const demand = db.prepare("select type_id, sum(quantity) as volume, max(price) as price, " +
  "count(distinct station_id) as stations from seed_buy_orders where solar_system_id=? " +
  "and quantity>0 group by type_id").all(systemID);
const ranked = demand.filter((row) => {
  const meta = inventory.resolveItemByTypeID(Number(row.type_id)) || {};
  if (!PRODUCIBLE.has(Number(meta.categoryID))) return false;
  return Number(row.price) <= maxPrice;
}).map((row) => {
  const typeID = Number(row.type_id);
  const meta = inventory.resolveItemByTypeID(typeID) || {};
  return {typeID, name: meta.name || String(typeID), volume: Number(row.volume) || 0,
    price: Number(row.price) || 0, value: (Number(row.volume) || 0) * (Number(row.price) || 0),
    canBuild: buildable.has(typeID)};
}).sort((a, b) => b.value - a.value);

console.log("DEMAND " + systemID + " top " + top + " by value");
for (const row of ranked.slice(0, top)) {
  console.log((row.canBuild ? "  BUILDABLE " : "  GAP       ") + row.name + " (" + row.typeID +
    ") " + row.volume + " x " + row.price + " = " + Math.round(row.value) + " ISK");
}
const gap = ranked.filter((row) => !row.canBuild);
const gapValue = gap.reduce((sum, row) => sum + row.value, 0);
console.log("BLUEPRINTS " + blueprints.length + " owned, " + buildable.size + " buildable");
console.log("GAP_VALUE " + Math.round(gapValue) + " ISK across " + gap.length + " products nobody here can make");
db.close();
