// Runs inside the EveJS server container. Drops one admin request on the data
// volume, waits for the in-server bridge to execute it, and prints the result.
// Payload travels base64-encoded so quoting can never mangle it.
const fs = require("node:fs");

const REQUESTS = "/var/lib/evejs/coop-admin-requests.jsonl";
const RESULTS = "/var/lib/evejs/coop-admin-results.jsonl";
const characterID = Number(process.env.Q_CHAR) || 0;
const action = String(process.env.Q_ACTION || "chat_command");
const command = Buffer.from(String(process.env.Q_CMD_B64 || ""), "base64").toString("utf8");
const itemID = Number(process.env.Q_ITEM_ID) || 0;
const typeID = Number(process.env.Q_TYPE_ID) || 0;
const quantity = Number(process.env.Q_QUANTITY) || 0;
const stationID = Number(process.env.Q_STATION_ID) || 0;
const waitMs = Number(process.env.Q_WAIT_MS) || 20000;

const request = { id: "req-" + Date.now() + "-" + Math.floor(Math.random() * 1000), action, characterID };
if (command) request.command = command;
if (itemID > 0) request.itemID = itemID;
if (typeID > 0) request.typeID = typeID;
if (quantity > 0) request.quantity = quantity;
if (stationID > 0) request.stationID = stationID;
if (process.env.Q_GRANT === "0") request.grant = false;
if (process.env.Q_MODULES_B64) {
  try {
    request.modules = JSON.parse(Buffer.from(String(process.env.Q_MODULES_B64), "base64").toString("utf8"));
  } catch (_error) {
    request.modules = [];
  }
}

if (!(characterID > 0)) {
  console.log(JSON.stringify({ ok: false, error: "characterID is required" }));
  process.exit(0);
}
try {
  fs.appendFileSync(REQUESTS, JSON.stringify(request) + "\n");
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: "cannot write request: " + String(error && error.message || error) }));
  process.exit(0);
}

function readResults() {
  try {
    return fs.readFileSync(RESULTS, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  } catch (_error) {
    return [];
  }
}

const startedAt = Date.now();
const timer = setInterval(() => {
  for (const line of readResults()) {
    let row = null;
    try {
      row = JSON.parse(line);
    } catch (_error) {
      continue;
    }
    if (row && row.id === request.id) {
      clearInterval(timer);
      console.log(JSON.stringify(row));
      process.exit(0);
    }
  }
  if (Date.now() - startedAt > waitMs) {
    clearInterval(timer);
    console.log(JSON.stringify({
      ok: false,
      error:
        "no answer from the server bridge in " + waitMs + "ms (is EVEJS_COOP_ADMIN_BRIDGE=1 and the world tick running?)",
      requestID: request.id,
    }));
    process.exit(0);
  }
}, 400);
