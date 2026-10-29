// Runs inside the EveJS server container. Drops one admin request on the data
// volume, waits for the in-server bridge to execute it, and prints the result.
//
// The whole request travels as one base64 JSON blob (Q_REQUEST_B64), so a batch
// of actions is one exec and one round-trip. The legacy per-field env vars are
// still accepted so an older caller keeps working.
//
// Latency: the bridge drains every ~1 s (coopAdminBridge.startFastDrain), so the
// poll interval here is what decides the tail. It also reads only the tail of the
// results file: the file is append-only and was already several megabytes, and
// re-reading it on every poll was itself a source of timeouts.
const fs = require("node:fs");

const REQUESTS = "/var/lib/evejs/coop-admin-requests.jsonl";
const RESULTS = "/var/lib/evejs/coop-admin-results.jsonl";
const POLL_MS = 150;
const TAIL_BYTES = 512 * 1024;

function buildRequest() {
  const raw = Buffer.from(String(process.env.Q_REQUEST_B64 || ""), "base64").toString("utf8");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_error) {
      /* fall through to the legacy fields so a bad blob still reports something */
    }
  }
  const request = {
    action: String(process.env.Q_ACTION || "chat_command"),
    characterID: Number(process.env.Q_CHAR) || 0,
  };
  const command = Buffer.from(String(process.env.Q_CMD_B64 || ""), "base64").toString("utf8");
  const itemID = Number(process.env.Q_ITEM_ID) || 0;
  const typeID = Number(process.env.Q_TYPE_ID) || 0;
  const quantity = Number(process.env.Q_QUANTITY) || 0;
  const stationID = Number(process.env.Q_STATION_ID) || 0;
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
  return request;
}

const request = buildRequest();
const waitMs = Number(process.env.Q_WAIT_MS) || 5000;

if (!(Number(request.characterID) > 0)) {
  console.log(JSON.stringify({ ok: false, error: "characterID is required" }));
  process.exit(0);
}
request.id = "req-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
try {
  fs.appendFileSync(REQUESTS, JSON.stringify(request) + "\n");
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: "cannot write request: " + String(error && error.message || error) }));
  process.exit(0);
}

function readResultTail() {
  let handle = null;
  try {
    const stat = fs.statSync(RESULTS);
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const length = stat.size - start;
    if (!(length > 0)) return [];
    handle = fs.openSync(RESULTS, "r");
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, start);
    const lines = buffer.toString("utf8").split("\n").map((line) => line.trim()).filter(Boolean);
    // A tail read can start mid-line; that first fragment is never valid JSON.
    return start > 0 ? lines.slice(1) : lines;
  } catch (_error) {
    return [];
  } finally {
    if (handle !== null) {
      try { fs.closeSync(handle); } catch (_ignored) { /* nothing to do */ }
    }
  }
}

const startedAt = Date.now();
const timer = setInterval(() => {
  for (const line of readResultTail()) {
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
}, POLL_MS);
