"use strict";
// One-time price sync with the live EVE Online market (public ESI).
//
// Why: the seeded market should start from real New Eden prices once, and from
// then on the co-op internal economy (orders, NPC traders, production) moves
// them. Nothing here invents a price: every anchor comes from ESI's public
// /markets/prices/ feed, and each station keeps its own relative spread because
// only a per-type factor is applied.
//
// Safety: read-only unless --apply is passed; a timestamped copy of the SQLite
// file is written next to it before any UPDATE; everything happens in one
// transaction; rows without a real anchor are left untouched.
//
// Usage (inside the server container, which has better-sqlite3):
//   node sync-market-prices-esi.cjs --db /var/lib/evejs/market/market.sqlite --apply
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DB = "/var/lib/evejs/market/market.sqlite";
const ESI_URL = "https://esi.evetech.net/latest/markets/prices/?datasource=tranquility";
// Station prices are anchored to the real average, keeping only a mild local
// spread: the seeded per-station deviations are wildly out of scale, so they are
// clamped instead of being trusted as a multiplier.
const MIN_SPREAD = 0.7;
const MAX_SPREAD = 1.4;
// A deterministic per-(station,type) jitter keeps the board from looking like
// one flat number per type, without inventing prices: it only nudges the real
// average by a few percent and is stable across runs.
const JITTER = 0.06;

function hashJitter(stationID, typeID) {
  let hash = 2166136261;
  const text = String(stationID) + ":" + String(typeID);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 2000) / 1000 - 1; // -1..1
  return 1 + unit * JITTER;
}

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

async function fetchEsiPrices() {
  const response = await fetch(ESI_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("ESI responded " + response.status);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("ESI payload is not an array");
  // average_price is the honest market anchor; adjusted_price is the fallback
  // for types CCP lists but does not trade, so coverage reaches every type ESI
  // publishes a price for.
  const prices = new Map();
  let averaged = 0;
  let adjusted = 0;
  for (const row of rows) {
    const typeID = Number(row && row.type_id) || 0;
    if (!(typeID > 0)) continue;
    const average = Number(row && row.average_price) || 0;
    const fallback = Number(row && row.adjusted_price) || 0;
    if (average > 0) { prices.set(typeID, average); averaged += 1; }
    else if (fallback > 0) { prices.set(typeID, fallback); adjusted += 1; }
  }
  prices.averaged = averaged;
  prices.adjusted = adjusted;
  return prices;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function main() {
  const argv = process.argv.slice(2);
  const dbPath = argValue(argv, "--db", DEFAULT_DB);
  const apply = argv.includes("--apply");
  if (!fs.existsSync(dbPath)) throw new Error("market database not found: " + dbPath);

  const Database = require("better-sqlite3");
  const prices = await fetchEsiPrices();
  console.log(`ESI anchors: ${prices.size} types (${prices.averaged} average, ${prices.adjusted} adjusted fallback)`);

  const db = new Database(dbPath, { readonly: !apply });
  const typeRows = db.prepare("SELECT type_id, base_price FROM market_types").all();
  const stockRows = db.prepare(
    "SELECT type_id, price, quantity FROM seed_stock WHERE price > 0",
  ).all();

  const byType = new Map();
  for (const row of stockRows) {
    const typeID = Number(row.type_id);
    if (!byType.has(typeID)) byType.set(typeID, []);
    byType.get(typeID).push(Number(row.price));
  }

  // typeID -> { real, stationFactor } where stationFactor scales the real average
  // by this station's own deviation from the type median, clamped.
  const anchors = new Map();
  let anchored = 0;
  let skipped = 0;
  for (const [typeID, values] of byType) {
    const real = prices.get(typeID);
    if (!(real > 0)) { skipped += 1; continue; }
    const current = median(values);
    if (!(current > 0)) { skipped += 1; continue; }
    anchors.set(typeID, { real, current });
    anchored += 1;
  }

  const sample = [...anchors.entries()].slice(0, 5).map(([typeID, row]) =>
    `${typeID}: ${Math.round(row.current)} -> ${Math.round(row.real)}`);
  console.log(`anchored types: ${anchored}, without anchor: ${skipped}`);
  console.log("sample factors: " + sample.join(", "));

  if (!apply) {
    console.log("dry run: pass --apply to write prices");
    db.close();
    return;
  }

  const backupPath = path.join(path.dirname(dbPath), "backups", `market-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(dbPath, backupPath);
  console.log("backup: " + backupPath);

  const updateStock = db.prepare(
    "UPDATE seed_stock SET price = ?, price_version = price_version + 1, updated_at = ? WHERE station_id = ? AND type_id = ? AND price > 0",
  );
  const updateType = db.prepare("UPDATE market_types SET base_price = ? WHERE type_id = ?");
  const now = new Date().toISOString();

  let stockUpdates = 0;
  let typeUpdates = 0;
  const run = db.transaction(() => {
    const stationRows = db.prepare("SELECT station_id, type_id, price FROM seed_stock WHERE price > 0").all();
    for (const row of stationRows) {
      const anchor = anchors.get(Number(row.type_id));
      if (!anchor) continue;
      const deviation = Number(row.price) / anchor.current;
      const spread = Math.min(MAX_SPREAD, Math.max(MIN_SPREAD, deviation));
      const nextPrice = Math.max(
        1,
        Math.round(anchor.real * spread * hashJitter(Number(row.station_id), Number(row.type_id)) * 100) / 100,
      );
      stockUpdates += updateStock.run(nextPrice, now, Number(row.station_id), Number(row.type_id)).changes;
    }
    for (const row of typeRows) {
      const typeID = Number(row.type_id);
      const real = prices.get(typeID);
      if (real > 0) typeUpdates += updateType.run(real, typeID).changes;
    }
  });
  run();
  db.close();

  console.log(`updated seed_stock rows: ${stockUpdates}`);
  console.log(`updated market_types base prices: ${typeUpdates}`);
  console.log("note: prices now sit at the real ESI average with a clamped local spread");
}

main().catch((error) => {
  console.error("price sync failed: " + String(error && error.message || error));
  process.exit(1);
});
