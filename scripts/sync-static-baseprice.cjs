"use strict";
// Align the static per-type reference price (`basePrice`) with the real market
// price we already synced from public ESI.
//
// Why: the EVE client shows a cargo "estimated price" as quantity * basePrice.
// CCP ships that number inside the client's static data, so it is wildly out of
// date (Scordite 4 994 while the market says 15.98). The server never sends a
// price for an item, so the only place we can fix it is the static table the
// server itself hands out.
//
// Default scope is minerals (category 4) and asteroid ore (category 25), which
// is what a cargo hold shows. `--all` widens it to every type that has a real
// ESI anchor, which also makes killmail loss value, repair cost, contraband
// fines, reprocessing and the character asset total realistic.
//
// Usage inside the server container:
//   node - < scripts/sync-static-baseprice.cjs                  # dry run, ore
//   node - < scripts/sync-static-baseprice.cjs --all            # dry run, all
//   node - < scripts/sync-static-baseprice.cjs --apply --all    # write + backup

const fs = require("fs");
const path = require("path");

const Database = require("/app/server/node_modules/better-sqlite3");

const MARKET_DB = process.env.EVEJS_MARKET_DB || "/var/lib/evejs/market/market.sqlite";
const TYPES_FILE = process.env.EVEJS_ITEM_TYPES_FILE || "/var/lib/evejs/gameStore/data/itemTypes/data.json";
const BACKUP_DIR = path.join(path.dirname(TYPES_FILE), "backups");
const CATEGORIES = [4, 25]; // 4 = Mineral, 25 = Asteroid (ore)
const apply = process.argv.includes("--apply");
const allTypes = process.argv.includes("--all");

function main() {
  const market = new Database(MARKET_DB, { readonly: true });
  const rows = allTypes
    ? market
        .prepare("SELECT type_id, base_price FROM market_types WHERE base_price > 0")
        .all()
    : market
        .prepare(
          "SELECT type_id, base_price FROM market_types WHERE category_id IN (" +
            CATEGORIES.map(() => "?").join(",") +
            ") AND base_price > 0",
        )
        .all(...CATEGORIES);
  market.close();

  const wanted = new Map(rows.map((row) => [Number(row.type_id), Number(row.base_price)]));

  const raw = fs.readFileSync(TYPES_FILE, "utf8");
  const payload = JSON.parse(raw);
  const types = Array.isArray(payload.types) ? payload.types : [];
  if (!types.length) {
    console.log("ABORT no types in " + TYPES_FILE);
    process.exitCode = 1;
    return;
  }

  const changes = [];
  for (const type of types) {
    const typeID = Number(type.typeID);
    const next = wanted.get(typeID);
    if (!Number.isFinite(next)) continue;
    const before = Number(type.basePrice);
    if (Number.isFinite(before) && Math.abs(before - next) < 0.005) continue;
    changes.push({ typeID, name: type.name, before, after: next });
    type.basePrice = next;
  }

  console.log("STATIC_PRICE types=" + types.length + " marketAnchors=" + wanted.size + " changed=" + changes.length);
  const sample = changes.slice(0, 6).map((c) => c.name + " " + c.before + " -> " + c.after);
  console.log("SAMPLE " + sample.join(" | "));

  if (!apply) {
    console.log("DRY_RUN pass --apply to write");
    return;
  }
  if (!changes.length) {
    console.log("NOTHING_TO_WRITE");
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(BACKUP_DIR, "itemTypes-" + stamp + ".json");
  fs.writeFileSync(backup, raw);
  console.log("BACKUP " + backup);

  payload.count = types.length;
  const tmp = TYPES_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, TYPES_FILE);
  console.log("WROTE " + TYPES_FILE + " changed=" + changes.length);
}

main();
