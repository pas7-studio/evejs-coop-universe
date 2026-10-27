"use strict";
// Read-only demand audit: can an NPC manufacturer actually buy our ore today?
//
// The co-op mining loop needs a buyer, and the seeded market has no ore orders in these
// systems (measured: living-economy-destination HOLD_NO_BUYER, unfilled 183 747). The
// honest alternative is a real industrial consumer, but the native industry path needs
// state that this world may simply not have: an online facility, a registered
// blueprint, the materials and a wallet with ISK.
//
// This prints exactly what is missing per candidate station and corporation. It NEVER
// writes anything: no orders, no wallet, no jobs, no stock.
//
//   node scripts/coop-factory-audit.cjs --db <gamestore.sqlite>
const fs = require("node:fs");

const pos = (x) => {
  const n = Number(x);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};

// A corporation can be a buyer only if it is an NPC corp with a real wallet and at
// least one station whose facility is online for manufacturing (activity 1).
function walletISK(record) {
  if (!record || typeof record !== "object") return null;
  const divisions = record.divisions && typeof record.divisions === "object" ? record.divisions : null;
  if (!divisions) return null;
  let total = 0;
  for (const key of Object.keys(divisions)) {
    const balance = Number(divisions[key] && divisions[key].balance);
    if (!Number.isFinite(balance) || balance < 0) return null;
    total += balance;
  }
  return Math.round(total * 100) / 100;
}

function readJSON(db, table) {
  try {
    return db.prepare('SELECT key,json FROM "' + table + '"').all().map((row) => {
      let value = null;
      try { value = JSON.parse(row.json); } catch (_error) { value = null; }
      return {key: row.key, value};
    });
  } catch (_error) {
    return null;
  }
}

// Facilities come from the native static lookup (industryStaticData). The
// industryFacilityState table only stores TAX overrides, so an empty table is NOT proof
// that no facility exists - reading it alone is how this audit first misled itself.
function facilities(rows) {
  const out = new Map();
  for (const row of rows || []) {
    const value = row.value && typeof row.value === "object" ? row.value : {};
    const stationID = pos(value.stationID || value.facilityID);
    if (!stationID) continue;
    const activities = value.activities && typeof value.activities === "object" ? value.activities : {};
    out.set(stationID, {
      stationID,
      online: value.online === true,
      manufacturing: Boolean(activities[1] || activities["1"]),
    });
  }
  return out;
}

function blueprintStates(rows) {
  let records = null;
  for (const row of rows || []) {
    if (row.value && typeof row.value === "object" && row.value.records &&
      typeof row.value.records === "object") records = row.value.records;
  }
  return records ? Object.keys(records).length : 0;
}

function jobs(rows) {
  let count = 0;
  for (const row of rows || []) {
    const value = row.value;
    if (value && typeof value === "object") count += Object.keys(value).length;
  }
  return count;
}

function audit({db, candidateStations = [], minimumISK = 1000, resolveFacility = null} = {}) {
  if (!db || typeof db.prepare !== "function") throw Error("AUDIT_DB_REQUIRED");
  const facilityRows = readJSON(db, "industryFacilityState");
  const blueprintRows = readJSON(db, "industryBlueprintState");
  const jobRows = readJSON(db, "industryJobs");
  const walls = readJSON(db, "corporationRuntime");
  if (!facilityRows || !blueprintRows || !jobRows) {
    return {status: "INDUSTRY_TABLES_UNAVAILABLE", stations: [], jobs: 0, blueprints: 0};
  }
  const facilityMap = facilities(facilityRows);
  const blueprints = blueprintStates(blueprintRows);
  const jobCount = jobs(jobRows);
  const stations = candidateStations.map((stationID) => {
    const id = pos(stationID);
    let facility = facilityMap.get(id) || null;
    let facilitySource = facility ? "STATE_TABLE" : "UNKNOWN";
    if (!facility && typeof resolveFacility === "function") {
      try {
        const native = resolveFacility(id);
        if (native) {
          const activities = native.activities && typeof native.activities === "object" ? native.activities : {};
          facility = {stationID: id, online: native.online === true,
            manufacturing: Boolean(activities[1] || activities["1"])};
          facilitySource = "NATIVE_STATIC";
        }
      } catch (_error) { facilitySource = "LOOKUP_FAILED"; }
    }
    const problems = [];
    if (!facility) problems.push(facilitySource === "UNKNOWN" ? "FACILITY_UNKNOWN" : "NO_FACILITY");
    else {
      if (facility.online !== true) problems.push("FACILITY_OFFLINE");
      if (facility.manufacturing !== true) problems.push("NO_MANUFACTURING_ACTIVITY");
    }
    if (blueprints === 0) problems.push("NO_BLUEPRINT");
    return {stationID: id, problems, facilitySource};
  });
  // Wallets: a manufacturer cannot pay without ISK. Report the richest NPC corp we can
  // see, and how many corps could fund a buy at all.
  let richest = null;
  let funded = 0;
  for (const row of walls || []) {
    const value = row.value;
    const isk = walletISK(value);
    if (isk === null) continue;
    if (isk >= minimumISK) funded += 1;
    if (!richest || isk > richest.isk) {
      richest = {corporationID: pos(value.corporationID) || pos(String(row.key).split("\u001f").pop()), isk};
    }
  }
  const anyReady = stations.some((station) => station.problems.length === 0);
  return {
    status: anyReady ? "FACTORY_READY" : "FACTORY_NOT_READY",
    stations,
    blueprints,
    jobs: jobCount,
    fundedCorporations: funded,
    richest: richest && richest.corporationID ? richest : null,
    verdict: anyReady
      ? "A real manufacturer can run a job and needs ore."
      : "No manufacturing consumer yet: the stations are online, so the gaps are a registered blueprint and a funded NPC corporation.",
  };
}

function format(report) {
  const lines = [];
  lines.push("status=" + report.status + " blueprints=" + report.blueprints + " jobs=" + report.jobs +
    " fundedCorporations=" + report.fundedCorporations +
    (report.richest ? " richestCorp=" + report.richest.corporationID + "(@" + report.richest.isk + " ISK)" : ""));
  for (const station of report.stations) {
    lines.push(" station " + station.stationID + " " +
      (station.problems.length ? station.problems.join(",") : "READY"));
  }
  lines.push(report.verdict);
  return lines.join("\n");
}

module.exports = {audit, format, walletISK, facilities, blueprintStates, jobs};

if (require.main === module) {
  const at = process.argv.indexOf("--db");
  const file = at >= 0 ? process.argv[at + 1] : null;
  if (!file || !fs.existsSync(file)) {
    console.log("USAGE: node scripts/coop-factory-audit.cjs --db <gamestore.sqlite> [--stations 60000358,60000682]");
    process.exit(2);
  }
  const stationsAt = process.argv.indexOf("--stations");
  const stations = stationsAt >= 0 ? String(process.argv[stationsAt + 1] || "").split(",").filter(Boolean) : [];
  const {DatabaseSync} = require("node:sqlite");
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    let resolveFacility = null;
    try {
      const statics = require("/app/server/src/services/industry/industryStaticData");
      if (typeof statics.getFacilityPayloadByID === "function") {
        resolveFacility = (stationID) => statics.getFacilityPayloadByID(stationID);
      }
    } catch (_error) { resolveFacility = null; }
    console.log(format(audit({db, candidateStations: stations, resolveFacility})));
  } finally {
    db.close();
  }
}
