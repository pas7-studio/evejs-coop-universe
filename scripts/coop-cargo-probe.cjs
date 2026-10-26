"use strict";
// Read-only native cargo probe. Runs INSIDE the evejs container:
//   docker exec -i evejs-server-1 node - < scripts/coop-cargo-probe.cjs
//
// Why this file exists: an earlier acceptance run measured durability by reading
// gameStore/data/npcCargo/data.json and reported zero rows, while the live world
// had already moved to gamestore.sqlite. The measurement was wrong, not the
// world. The authoritative store is now the SQLite table `npcCargo`, whose
// `cargo` key holds the whole row map as JSON.
//
// Read-only: never writes, never migrates, never touches the WAL.
const fs = require("node:fs");
const path = require("node:path");

const DB = process.env.EVEJS_GAMESTORE_SQLITE ||
  "/var/lib/evejs/gameStore/gamestore.sqlite";

function open() {
  if (!fs.existsSync(DB)) return { error: "SQLITE_MISSING" };
  try {
    const { DatabaseSync } = require("node:sqlite");
    return { db: new DatabaseSync(DB, { readOnly: true }) };
  } catch (error) {
    return { error: "SQLITE_UNAVAILABLE:" + String(error.message || error).slice(0, 80) };
  }
}

function cargoMap(db) {
  const row = db.prepare("select json from npcCargo where key = ?").get("cargo");
  if (!row || !row.json) return {};
  const parsed = JSON.parse(row.json);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function main() {
  const opened = open();
  if (opened.error) {
    console.log(JSON.stringify({ ok: false, error: opened.error, db: DB }));
    return 0;
  }
  const { db } = opened;
  const cargo = cargoMap(db);
  const rows = Object.values(cargo);
  const haul = rows.filter((row) => Number(row?.coopHaulFleetID) > 0);
  console.log(JSON.stringify({
    ok: true,
    db: path.basename(DB),
    rowsTotal: rows.length,
    haulRows: haul.length,
    nextCargoID: (() => {
      try {
        const row = db.prepare("select json from npcCargo where key = ?").get("nextCargoID");
        return row ? Number(JSON.parse(row.json)) : 0;
      } catch (_error) {
        return 0;
      }
    })(),
    rows: haul.map((row) => ({
      cargoID: Number(row.cargoID) || 0,
      entityID: Number(row.entityID) || 0,
      ownerID: Number(row.ownerID) || 0,
      typeID: Number(row.typeID) || 0,
      quantity: Number(row.quantity) || 0,
      transient: row.transient === true,
      fleetID: Number(row.coopHaulFleetID) || 0,
      systemID: Number(row.coopHaulSystemID) || 0,
      fromMinerID: Number(row.coopHaulFromMinerID) || 0,
      loadedAt: Number(row.coopHaulLoadedAt) || 0,
      adoptedAt: Number(row.coopHaulAdoptedAt) || 0,
    })),
  }));
  return 0;
}

process.exitCode = main();
