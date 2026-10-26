"use strict";
// Rebuild the derived market summaries from the seed tables.
//
// seed_stock and seed_buy_orders are the source of truth, but the engine also
// keeps region_summaries / system_seed_summaries with precomputed best ask/bid.
// Those were only ever written by the original seed, so after any price sync the
// client kept showing (and filling at) the old inflated "sector average".
//
// Usage inside the server container:
//   node - < scripts/rebuild-market-summaries.cjs            # dry run
//   node - < scripts/rebuild-market-summaries.cjs --apply    # write

const path = require("path");
const fs = require("fs");
const Database = require("/app/server/node_modules/better-sqlite3");

const DB = process.env.EVEJS_MARKET_DB || "/var/lib/evejs/market/market.sqlite";
const apply = process.argv.includes("--apply");

function aggregate(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    let entry = map.get(key);
    if (!entry) {
      entry = {
        askPrice: Infinity, askStation: null, askQty: 0,
        bidPrice: 0, bidStation: null, bidQty: 0,
      };
      map.set(key, entry);
    }
    const price = Number(row.price);
    const qty = Number(row.quantity);
    if (row.side === "ask") {
      if (price < entry.askPrice) { entry.askPrice = price; entry.askStation = row.station_id; }
      entry.askQty += qty;
    } else {
      if (price > entry.bidPrice) { entry.bidPrice = price; entry.bidStation = row.station_id; }
      entry.bidQty += qty;
    }
  }
  return map;
}

function main() {
  const db = new Database(DB);
  const asks = db.prepare("SELECT station_id, solar_system_id, region_id, type_id, price, quantity FROM seed_stock WHERE price > 0 AND quantity > 0").all();
  const bids = db.prepare("SELECT station_id, solar_system_id, region_id, type_id, price, quantity FROM seed_buy_orders WHERE price > 0 AND quantity > 0").all();
  const all = asks.map((r) => Object.assign({ side: "ask" }, r)).concat(bids.map((r) => Object.assign({ side: "bid" }, r)));

  const regionMap = aggregate(all, (r) => r.region_id + ":" + r.type_id);
  const systemMap = aggregate(all, (r) => r.solar_system_id + ":" + r.type_id);

  const existing = {
    region: db.prepare("SELECT COUNT(*) c FROM region_summaries").get().c,
    system: db.prepare("SELECT COUNT(*) c FROM system_seed_summaries").get().c,
  };
  console.log("SEED asks=" + asks.length + " bids=" + bids.length);
  console.log("SUMMARY region=" + regionMap.size + " system=" + systemMap.size + " (was " + existing.region + "/" + existing.system + ")");

  const sample = [...regionMap.entries()].find(([k]) => k.endsWith(":1228"));
  if (sample) console.log("SAMPLE region scordite ask=" + sample[1].askPrice + " bid=" + sample[1].bidPrice);

  if (!apply) {
    console.log("DRY_RUN pass --apply to write");
    db.close();
    return;
  }

  const now = new Date().toISOString();
  const insRegion = db.prepare(
    "INSERT OR REPLACE INTO region_summaries (region_id,type_id,best_ask_price,total_ask_quantity,best_ask_station_id,best_bid_price,total_bid_quantity,best_bid_station_id,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  const insSystem = db.prepare(
    "INSERT OR REPLACE INTO system_seed_summaries (solar_system_id,type_id,best_ask_price,total_ask_quantity,best_ask_station_id,best_bid_price,total_bid_quantity,best_bid_station_id,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  );

  const write = db.transaction(() => {
    db.prepare("DELETE FROM region_summaries").run();
    db.prepare("DELETE FROM system_seed_summaries").run();
    for (const [key, v] of regionMap) {
      const [regionID, typeID] = key.split(":").map(Number);
      insRegion.run(
        regionID, typeID,
        Number.isFinite(v.askPrice) ? v.askPrice : null, v.askQty || null, v.askStation,
        v.bidPrice > 0 ? v.bidPrice : null, v.bidQty || null, v.bidStation,
        now,
      );
    }
    for (const [key, v] of systemMap) {
      const [systemID, typeID] = key.split(":").map(Number);
      insSystem.run(
        systemID, typeID,
        Number.isFinite(v.askPrice) ? v.askPrice : null, v.askQty || null, v.askStation,
        v.bidPrice > 0 ? v.bidPrice : null, v.bidQty || null, v.bidStation,
        now,
      );
    }
    // Trade history recorded against the old inflated prices would keep feeding
    // the "average price" display, so drop only the rows that are wildly off the
    // current anchor.
    const stale = db.prepare(
      "DELETE FROM price_history WHERE type_id IN (SELECT type_id FROM market_types WHERE base_price > 0) AND avg_price > (SELECT base_price * 3 FROM market_types m WHERE m.type_id = price_history.type_id)",
    ).run().changes;
    console.log("STALE_PRICE_HISTORY_REMOVED " + stale);
  });
  write();
  db.close();
  console.log("REBUILT region=" + regionMap.size + " system=" + systemMap.size);
}

main();
