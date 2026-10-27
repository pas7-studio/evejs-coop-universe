"use strict";
/**
 * Read-only mineral audit.
 *
 * The refinery now turns the corporation's ore into minerals in the station hangar
 * (living-npc-refined, 16 committed). Those minerals are the last leg of the loop: they
 * must become ISK. Selling them needs a real cargo move onto a ship, which the trader
 * then liquidates against seeded buy orders - it cannot be done by writing a fake order.
 *
 * This script only answers two questions, without mutating anything:
 *   - what mineral stock does the corporation really hold, and where;
 *   - what would the best seeded buy order on that station pay for it right now.
 *
 * Usage (inside the server container):
 *   node /app/scripts/coop-mineral-audit.cjs [--owner 1000129]
 */

const REFINE_TAG = /^coop-refine:v1:[0-9]+:[0-9]+:mineral:/;
const HANGAR = 4;

const pos = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// A mineral row is only real stock when it is the refinery's own output, owned by the
// corporation, sitting in a hangar. Anything else is not ours to sell.
function mineralRows(rows, { ownerID } = {}) {
  const owner = pos(ownerID);
  return (rows || []).filter((row) => {
    if (!row || typeof row !== "object") return false;
    if (owner && pos(row.ownerID) !== owner) return false;
    if (Number(row.locationID) < 1) return false;
    if (row.flagID !== undefined && Number(row.flagID) !== HANGAR) return false;
    if (!REFINE_TAG.test(String(row.customInfo || ""))) return false;
    return pos(row.typeID) > 0 && num(row.quantity) > 0;
  });
}

// The same rule the real trader uses: the best price on that station wins, seeded orders
// only, and only orders that still have volume left.
function bestSeededBuy(orders, { stationID, typeID } = {}) {
  const station = pos(stationID);
  const type = pos(typeID);
  const rows = (Array.isArray(orders) ? orders : []).filter((row) =>
    row && row.source === "seed" && pos(row.station_id) === station &&
    pos(row.type_id) === type && num(row.vol_remaining) >= 1 && num(row.price) > 0);
  if (!rows.length) return null;
  return rows.sort((left, right) =>
    num(right.price) - num(left.price) || num(right.vol_remaining) - num(left.vol_remaining))[0];
}

// The daemon answers a book of two sides (buys / sells); a mineral can only be
// sold into a real bid, so only the buy side is demand. Reading the wrong field
// once hid 23 real bids per type and made the whole region look empty.
function bookBuys(book) {
  return Array.isArray(book && book.buys) ? book.buys : [];
}

function groupByStationAndType(rows) {
  const out = new Map();
  for (const row of rows) {
    const stationID = pos(row.locationID);
    const typeID = pos(row.typeID);
    const key = stationID + ":" + typeID;
    const seen = out.get(key) || { stationID, typeID, quantity: 0, stacks: 0 };
    seen.quantity += num(row.quantity);
    seen.stacks += 1;
    out.set(key, seen);
  }
  return [...out.values()].sort((a, b) => a.stationID - b.stationID || b.quantity - a.quantity);
}

async function audit({ rows, ownerID, orders, regionForStation } = {}) {
  const minerals = mineralRows(rows, { ownerID });
  const groups = groupByStationAndType(minerals);
  const stations = [];
  for (const group of groups) {
    let best = null;
    let reason = null;
    try {
      const regionID = regionForStation(group.stationID);
      if (!regionID) reason = "STATION_REGION_UNAVAILABLE";
      else best = bestSeededBuy(await orders({ regionID, typeID: group.typeID }), group);
    } catch (error) {
      reason = String(error && error.message || error).slice(0, 80);
    }
    stations.push({...group,
      bestPrice: best ? num(best.price) : null,
      bestOrderID: best ? String(best.order_id || "") : null,
      // A bid only pays for its own remaining volume; the rest of the stack is
      // not sellable at that price and must never be counted as ISK.
      sellable: best ? Math.min(group.quantity, num(best.vol_remaining)) : 0,
      isk: best ? Math.round(num(best.price) * Math.min(group.quantity, num(best.vol_remaining)) * 100) / 100 : 0,
      status: best ? (num(best.vol_remaining) >= group.quantity ? "BUYER_FOUND" : "BUYER_DEPTH_LIMITED")
        : (reason || "NO_SEEDED_COUNTERPARTY")});
  }
  const isk = Math.round(stations.reduce((sum, row) => sum + row.isk, 0) * 100) / 100;
  const unsold = stations.filter((row) => row.status !== "BUYER_FOUND").length;
  return {status: !stations.length ? "NO_MINERAL_STOCK"
    : unsold ? "PARTIAL_BUYER" : "BUYERS_FOUND",
    stacks: minerals.length, stations, isk};
}

function format(report) {
  const lines = ["status=" + report.status + " stacks=" + report.stacks +
    " potential_isk=" + report.isk.toFixed(2)];
  for (const row of report.stations) {
    lines.push("  station=" + row.stationID + " type=" + row.typeID +
      " qty=" + row.quantity + " sellable=" + (row.sellable || 0) +
      " price=" + (row.bestPrice === null ? "-" : row.bestPrice) +
      " isk=" + row.isk.toFixed(2) + " " + row.status);
  }
  if (report.status === "NO_MINERAL_STOCK")
    lines.push("  no coop-refine mineral rows in a corporation hangar yet");
  return lines.join("\n");
}

module.exports = {REFINE_TAG, HANGAR, mineralRows, bookBuys, bestSeededBuy,
  groupByStationAndType, audit, format};

if (require.main === module) {
  const arg = process.argv.indexOf("--owner");
  const ownerID = arg > 0 ? pos(process.argv[arg + 1]) : 1000129;
  const items = require("/app/server/src/services/inventory/itemStore");
  const worldData = require("/app/server/src/space/worldData");
  const market = require("/app/server/src/services/market/marketDaemonClient").marketDaemonClient;
  const lines = items.listOwnedItems(ownerID, {locationID: undefined}) ||
    items.getAllItems?.() || [];
  const rows = Array.isArray(lines) ? lines : Object.values(lines);
  audit({
    rows, ownerID,
    regionForStation: (stationID) => pos(worldData.getStationByID(stationID)?.regionID),
    orders: async ({regionID, typeID}) =>
      bookBuys(await market.call("GetOrders", {region_id: regionID, type_id: typeID})),
  }).then((report) => { console.log(format(report)); })
    .catch((error) => {
      console.log("status=AUDIT_FAILED reason=" + String(error && error.message).slice(0, 120));
      process.exitCode = 1;
    });
}
