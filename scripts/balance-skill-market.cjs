const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const DB = "/var/lib/evejs/market/market.sqlite";
const APPLY = process.argv.includes("--apply");

// Real Jita sell prices (2026-10-24) and a deliberately rare stock count.
// CCP typeIDs are immutable: Small Skill Injector is 45635, NOT 40521.
const PLAN = [
  { typeID: 40519, name: "Skill Extractor", price: 465000000, quantity: 3 },
  { typeID: 40520, name: "Large Skill Injector", price: 731000000, quantity: 2 },
  { typeID: 45635, name: "Small Skill Injector", price: 148600000, quantity: 8 },
];

const db = new DatabaseSync(DB, { readOnly: !APPLY });
for (const entry of PLAN) {
  const rows = db.prepare("SELECT station_id, price, quantity FROM seed_stock WHERE type_id = ?").all(entry.typeID);
  if (!rows.length) { console.log(`${entry.name}: not seeded`); continue; }
  const prices = [...new Set(rows.map((r) => Number(r.price)))];
  const qty = [...new Set(rows.map((r) => Number(r.quantity)))];
  console.log(`${entry.name} (${entry.typeID}): ${rows.length} stations, price ${prices.slice(0,3).join("/")}, qty ${qty.slice(0,3).join("/")} -> ${entry.price} ISK, ${entry.quantity} units`);
}
if (!APPLY) { console.log("\ndry run; pass --apply to write"); process.exit(0); }

const backup = `/var/lib/evejs/market/market.sqlite.bak-${Date.now()}`;
fs.copyFileSync(DB, backup);
console.log("backup:", backup);
const write = new DatabaseSync(DB);
write.exec("BEGIN");
try {
  for (const entry of PLAN) {
    write.prepare("UPDATE seed_stock SET price = ?, quantity = ?, initial_quantity = ? WHERE type_id = ?")
      .run(entry.price, entry.quantity, entry.quantity, entry.typeID);
    // market_orders has its own column names; only the seed source is changed
    // here, and the daemon rebuilds live orders from it on restart.
  }
  write.exec("COMMIT");
  console.log("applied");
} catch (error) {
  write.exec("ROLLBACK");
  console.error("rolled back:", error.message);
  process.exit(3);
}
