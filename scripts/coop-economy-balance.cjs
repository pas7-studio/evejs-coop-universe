"use strict";
/**
 * Read-only economy balance.
 *
 * The loop is proven, but a loop can only be self-sustaining if what the fleets
 * produce is what the world really buys. This answers exactly that, with no writes:
 *
 *   - the corporation's own hangar stock per station and type (ore + minerals);
 *   - the seeded BIDS that station still has left for that exact type;
 *   - how much of the stock can turn into ISK right now, and how much cannot.
 *
 * A station with demand 0 can never pay, no matter how the code behaves, so it is
 * reported as a real dead end instead of being hidden inside an aggregate.
 *
 * Usage (inside the server container):
 *   node /app/scripts/coop-economy-balance.cjs [--owner 1000129] [--limit 12]
 */

const HANGAR = 4;
const pos = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const qtyOf = (row) =>
  Number(row && row.singleton) === 1 ? 1
    : pos(row && (row.quantity !== undefined ? row.quantity : row.stacksize));

// Stock is only what this owner really holds in a hangar for sale.
function stockByStation(rows, {ownerID} = {}) {
  const owner = pos(ownerID);
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    if (owner && pos(row.ownerID) !== owner) continue;
    if (Number(row.flagID === undefined ? HANGAR : row.flagID) !== HANGAR) continue;
    const stationID = pos(row.locationID);
    const typeID = pos(row.typeID);
    const quantity = qtyOf(row);
    if (!stationID || !typeID || !quantity) continue;
    const key = stationID + ":" + typeID;
    const at = groups.get(key) || {stationID, typeID, quantity: 0, stacks: 0};
    at.quantity += quantity;
    at.stacks += 1;
    groups.set(key, at);
  }
  return [...groups.values()].sort((left, right) =>
    right.quantity - left.quantity || left.stationID - right.stationID ||
    left.typeID - right.typeID);
}

// A seeded bid only pays for what it still has left, and only on its own station.
function localDemand(buys, {stationID, typeID} = {}) {
  const station = pos(stationID);
  const type = pos(typeID);
  const rows = (Array.isArray(buys) ? buys : []).filter((row) =>
    row && String(row.source || "").toLowerCase() === "seed" &&
    pos(row.station_id) === station && pos(row.type_id) === type &&
    num(row.vol_remaining) >= 1 && num(row.price) > 0);
  if (!rows.length) return {units: 0, bestPrice: null, isk: 0, orders: 0};
  const units = rows.reduce((sum, row) => sum + Math.floor(num(row.vol_remaining)), 0);
  const best = rows.sort((left, right) =>
    num(right.price) - num(left.price) || num(right.vol_remaining) - num(left.vol_remaining))[0];
  return {units, bestPrice: num(best.price), orders: rows.length,
    isk: Math.round(num(best.price) * units * 100) / 100};
}

function balance({stock = [], demand = {}} = {}) {
  const rows = (Array.isArray(stock) ? stock : []).map((row) => {
    const found = demand[row.stationID + ":" + row.typeID] ||
      {units: 0, bestPrice: null, isk: 0, orders: 0};
    const sellable = Math.min(row.quantity, found.units);
    return {...row, demandUnits: found.units, bestPrice: found.bestPrice,
      demandOrders: found.orders, sellable,
      isk: found.bestPrice === null ? 0 : Math.round(found.bestPrice * sellable * 100) / 100,
      status: found.units === 0 ? "NO_BUYER_ON_THIS_STATION"
        : sellable < row.quantity ? "DEMAND_LIMITED" : "SELLABLE"};
  });
  const totals = rows.reduce((sum, row) => ({
    stock: sum.stock + row.quantity,
    sellable: sum.sellable + row.sellable,
    isk: Math.round((sum.isk + row.isk) * 100) / 100,
    stranded: sum.stranded + (row.quantity - row.sellable),
  }), {stock: 0, sellable: 0, isk: 0, stranded: 0});
  const status = !rows.length ? "NO_STOCK"
    : totals.sellable === 0 ? "NO_DEMAND_AT_ALL"
      : totals.stranded > 0 ? "PARTIAL_DEMAND" : "FULLY_SELLABLE";
  return {status, rows, totals};
}

function format(report) {
  const lines = ["status=" + report.status +
    " stock=" + report.totals.stock + " sellable=" + report.totals.sellable +
    " stranded=" + report.totals.stranded + " potential_isk=" + report.totals.isk.toFixed(2)];
  for (const row of report.rows) {
    lines.push("  station=" + row.stationID + " type=" + row.typeID +
      " stock=" + row.quantity + " stacks=" + row.stacks +
      " demand=" + row.demandUnits + " price=" + (row.bestPrice === null ? "-" : row.bestPrice) +
      " isk=" + row.isk.toFixed(2) + " " + row.status);
  }
  return lines.join("\n");
}

async function audit({items, market, getStation, ownerID, limit = 12} = {}) {
  const answer = items.listOwnedItems(ownerID, {locationID: undefined});
  const rows = Array.isArray(answer) ? answer : (Array.isArray(answer && answer.data) ? answer.data : []);
  const stock = stockByStation(rows, {ownerID});
  const demand = {};
  for (const row of stock) {
    const station = getStation(row.stationID) || {};
    const regionID = pos(station.regionID);
    if (!regionID) continue;
    try {
      const book = await market.call("GetOrders", {region_id: regionID, type_id: row.typeID});
      demand[row.stationID + ":" + row.typeID] =
        localDemand(Array.isArray(book && book.buys) ? book.buys : [],
          {stationID: row.stationID, typeID: row.typeID});
    } catch (_error) {
      // An unreadable book is not demand; it is simply unknown and stays at zero.
    }
  }
  const report = balance({stock, demand});
  report.rows = report.rows.slice(0, Math.max(1, limit));
  return report;
}

// The same file runs from the repository and from inside the server container,
// where the services live under /app/server/src.
const load = (relative) => {
  try {
    return require(relative);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      return require("/app/server/src/" + relative.replace(/^\.\.\//, ""));
    }
    throw error;
  }
};

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    const arg = (name, fallback) => {
      const at = argv.indexOf("--" + name);
      return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
    };
    const ownerID = pos(arg("owner", 1000129));
    const limit = Math.max(1, Number(arg("limit", 12)));
    const report = await audit({
      items: load("../services/inventory/itemStore"),
      market: load("../services/market/marketDaemonClient").marketDaemonClient,
      getStation: load("../space/worldData").getStationByID,
      ownerID, limit});
    console.log(format(report));
  })().catch((error) => {
    console.log("status=ERROR " + String(error && error.message || error).slice(0, 160));
    process.exit(1);
  });
}

module.exports = {HANGAR, stockByStation, localDemand, balance, format, audit};
