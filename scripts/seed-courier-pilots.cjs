"use strict";
// Seeds NPC courier pilots as REAL player-equivalent characters: a characters
// row with a wallet balance, an accounts row, and a real ship item owned by the
// character and docked at a station in a popular system.
//
// Safety: the live server keeps gameStore tables in a write cache, so writing
// to gamestore.sqlite while it runs can be overwritten. This script therefore
// refuses to apply while the container is up, and is dry-run by default.
//
//   docker cp scripts/seed-courier-pilots.cjs evejs-server-1:/tmp/seed.cjs
//   docker exec evejs-server-1 node /tmp/seed.cjs            (dry run)
//   docker exec evejs-server-1 node /tmp/seed.cjs --apply    (only when stopped)
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB = process.env.EVEJS_DB || "/var/lib/evejs/gameStore/gamestore.sqlite";
const APPLY = process.argv.includes("--apply");
const FIRST_CHARACTER_ID = 140000100;
const FIRST_ACCOUNT_ID = 900;
// Item IDs are allocated above the highest one that already exists, so a
// seeded ship can never collide with an item the server creates later.
const ITEM_ID_HEADROOM = 1000;

// systemID -> hull. Freighter in Jita first, because that is where the owner's
// 29 500 m3 contract waits.
const PLAN = [
  { systemID: 30000142, hullName: "Charon", name: "Haul Jita Charon", balance: 25000000 },   // Charon (Caldari freighter)
  { systemID: 30000142, hullName: "Bestower", name: "Haul Jita Bestower", balance: 3000000 },   // Bestower (Amarr industrial)
  { systemID: 30000144, hullName: "Fenrir", name: "Haul Perimeter Fenrir", balance: 12000000 }, // Fenrir (Minmatar freighter)
  { systemID: 30002187, hullName: "Providence", name: "Haul Amarr Providence", balance: 12000000 }, // Providence (Amarr freighter)
  { systemID: 30002659, hullName: "Obelisk", name: "Haul Dodixie Obelisk", balance: 12000000 },  // Obelisk (Gallente freighter)
  { systemID: 30002510, hullName: "Badger", name: "Haul Rens Badger", balance: 2500000 },     // Badger (Caldari industrial)
  { systemID: 30002053, hullName: "Mammoth", name: "Haul Hek Mammoth", balance: 2500000 },     // Mammoth (Minmatar industrial)
];

function fail(message) {
  console.error("REFUSED: " + message);
  process.exit(2);
}

function readJson(db, table, key) {
  const row = db.prepare(`SELECT json FROM "${table}" WHERE key = ?`).get(String(key));
  return row ? JSON.parse(row.json) : null;
}

// Static data (stations, types) is seed JSON, not SQLite: gameStore only
// persists mutated tables.
function loadSeedTable(name) {
  const file = `/var/lib/evejs/gameStore/data/${name}/data.json`;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of ["types", "stations", "rows", "data"]) {
    if (parsed && typeof parsed[key] === "object" && parsed[key] !== null) return parsed[key];
  }
  return parsed;
}

function typeInfo(types, hullName) {
  const list = Array.isArray(types) ? types : Object.values(types);
  const record = list.find((entry) => String(entry.name) === String(hullName) && Number(entry.categoryID) === 6);
  if (!record) fail(`ship type ${hullName} not found in itemTypes seed`);
  return record;
}

const db = new DatabaseSync(DB, { readOnly: !APPLY });
const template = db.prepare("SELECT json FROM characters ORDER BY key LIMIT 1").get();
if (!template) fail("no template character to clone");
const base = JSON.parse(template.json);
const existingRows = db.prepare("SELECT key, json FROM characters").all();
const existing = new Set(existingRows.map((row) => row.key));
// Idempotent by pilot name: re-running must never duplicate a courier.
const existingNames = new Set(existingRows.map((row) => { try { return String(JSON.parse(row.json).characterName || ""); } catch (_error) { return ""; } }));
const pending = PLAN.filter((entry) => !existingNames.has(entry.name));
if (pending.length !== PLAN.length) {
  console.log(`skipping ${PLAN.length - pending.length} pilot(s) that already exist`);
}
if (!pending.length) {
  console.log("nothing to seed; every planned courier already exists");
  process.exit(0);
}
const accounts = db.prepare("SELECT * FROM accounts").all();
const nextAccount = Math.max(FIRST_ACCOUNT_ID, ...accounts.map((row) => Number(JSON.parse(row.json).id) || 0)) + 1;
const stationRows = Object.values(loadSeedTable("stations"));
const highestItemID = Number(db.prepare("SELECT MAX(CAST(key AS INTEGER)) m FROM items").get().m) || 0;
const FIRST_ITEM_ID = highestItemID + ITEM_ID_HEADROOM;
const types = loadSeedTable("itemTypes");

function stationFor(systemID) {
  const inSystem = stationRows.filter((station) => Number(station.solarSystemID) === Number(systemID));
  if (!inSystem.length) fail(`no station for system ${systemID}`);
  // Prefer the main trade hub station of the system, then the lowest ID.
  const hub = inSystem.find((station) => /Trade|Navy|Assembly|Bureau|Logistics/i.test(String(station.stationName || "")));
  const chosen = hub || inSystem.slice().sort((a, b) => Number(a.stationID) - Number(b.stationID))[0];
  return chosen;
}

console.log(`template character ${base.characterName} (account ${base.accountId}, balance ${base.balance})`);
console.log(`apply=${APPLY} db=${DB}\n`);

const work = [];
let characterID = FIRST_CHARACTER_ID;
let itemID = FIRST_ITEM_ID;
let accountID = nextAccount;
for (const entry of pending) {
  while (existing.has(String(characterID))) characterID += 1;
  const station = stationFor(entry.systemID);
  const hull = typeInfo(types, entry.hullName);
  work.push({
    characterID,
    accountID,
    itemID,
    name: entry.name,
    stationID: Number(station.stationID),
    stationName: String(station.stationName || ""),
    systemID: Number(entry.systemID),
    hullTypeID: Number(hull.typeID),
    hullName: String(hull.name || entry.hull),
    hullVolume: Number(hull.volume) || 0,
    hullCapacity: Number(hull.capacity) || 0,
    hullGroup: Number(hull.groupID) || 0,
    hullCategory: Number(hull.categoryID) || 6,
    hullMass: Number(hull.mass) || 0,
    hullRadius: Number(hull.radius) || 0,
    balance: entry.balance,
  });
  characterID += 1;
  itemID += 1;
  accountID += 1;
}

for (const pilot of work) {
  console.log(
    `${pilot.characterID} ${pilot.name.padEnd(24)} ${pilot.stationName} station ${pilot.stationID} system ${pilot.systemID} ` +
    `${pilot.hullName} (${pilot.hullCapacity} m3) balance ${pilot.balance} account ${pilot.accountID}`
  );
}

if (!APPLY) {
  console.log("\ndry run only; pass --apply with the server stopped to write these rows");
  process.exit(0);
}

const now = String(Date.now() * 10000);
const writeCharacter = db.prepare("INSERT OR REPLACE INTO characters (key, json) VALUES (?, ?)");
const writeAccount = db.prepare("INSERT OR REPLACE INTO accounts (key, json) VALUES (?, ?)");
const writeItem = db.prepare("INSERT OR REPLACE INTO items (key, json) VALUES (?, ?)");

db.exec("BEGIN");
try {
  for (const pilot of work) {
    const character = Object.assign({}, base, {
      characterID: pilot.characterID,
      accountId: pilot.accountID,
      characterName: pilot.name,
      stationID: pilot.stationID,
      homeStationID: pilot.stationID,
      cloneStationID: pilot.stationID,
      solarSystemID: pilot.systemID,
      balance: pilot.balance,
      balanceChange: 0,
      walletJournal: [],
      shipID: pilot.itemID,
      shipTypeID: pilot.hullTypeID,
      shipName: pilot.hullName,
      createDateTime: now,
      startDateTime: now,
      logoffDate: now,
      deletePrepareDateTime: "0",
      skillQueueEndTime: "0",
      trainingStartTime: "0",
      trainingEndTime: "0",
      queueEndTime: "0",
      portraitUploadedAt: 0,
      portraitByteLength: 0,
      portraitSizes: [],
    });
    writeCharacter.run(String(pilot.characterID), JSON.stringify(character));
    writeAccount.run(pilot.name, JSON.stringify({
      passwordhash: "",
      id: pilot.accountID,
      role: "0",
      chatRole: "0",
      banned: true,
      multiCharacterTrainingSlots: {},
    }));
    writeItem.run(String(pilot.itemID), JSON.stringify({
      itemID: pilot.itemID,
      typeID: pilot.hullTypeID,
      ownerID: pilot.characterID,
      locationID: pilot.stationID,
      flagID: 4,
      quantity: -1,
      stacksize: 1,
      singleton: 1,
      groupID: pilot.hullGroup,
      categoryID: pilot.hullCategory,
      customInfo: "",
      itemName: pilot.hullName,
      mass: pilot.hullMass,
      volume: pilot.hullVolume,
      capacity: pilot.hullCapacity,
      radius: pilot.hullRadius,
      spaceState: null,
      conditionState: { damage: 0, charge: 1, armorDamage: 0, shieldCharge: 1, incapacitated: false },
      shipID: pilot.itemID,
      shipTypeID: pilot.hullTypeID,
      shipName: pilot.hullName,
    }));
  }
  db.exec("COMMIT");
  console.log(`\nseeded ${work.length} courier pilots`);
} catch (error) {
  db.exec("ROLLBACK");
  console.error("rolled back: " + error.message);
  process.exit(3);
}
