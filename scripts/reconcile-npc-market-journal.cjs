#!/usr/bin/env node
// Operator tool: settle a native-NPC market journal left in phase RPC_CALLING.
//
// Doctrine forbids repeating an ambiguous market RPC, and that is not changed
// here: this tool never sends FillOrder. It reads the market daemon's own order
// row, and only when that row proves the exact fill (state filled, our quantity
// entered, nothing remaining, same station/type/price, issued at the journal
// time) does it credit the pilot ledger once and remove the journal.
//
// Runs INSIDE the server container, where the market daemon client and the
// native store are importable:
//
//   docker cp scripts/reconcile-npc-market-journal.cjs evejs-agents-server-1:/tmp/rec.cjs
//   docker exec evejs-agents-server-1 node /tmp/rec.cjs            # prove only
//   docker exec evejs-agents-server-1 node /tmp/rec.cjs --apply    # settle
//
// Exit code is 0 only when every pending journal is settled (or there is none).
"use strict";
const path = require("node:path");

const SERVER_ROOT = process.env.EVEJS_SERVER_ROOT || "/app/server";
const APPLY = process.argv.includes("--apply");

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: String(message) }, null, 2));
  process.exit(2);
}

let store;
let runtime;
let registry;
let marketClient;
let reconcile;
try {
  store = require(path.join(SERVER_ROOT, "src/space/npc/nativeNpcStore"));
  runtime = require(path.join(SERVER_ROOT, "src/space/runtime"));
  registry = require(path.join(SERVER_ROOT, "src/services/inventory/itemTypeRegistry"));
  marketClient = require(path.join(SERVER_ROOT, "src/services/market/marketDaemonClient")).marketDaemonClient;
  reconcile = require(path.join(SERVER_ROOT, "src/space/coopNativeNpcMarketReconcile"));
} catch (error) {
  fail("IMPORT_FAILED:" + String(error && error.message || error).slice(0, 200));
}

// The inspector is the only market call this tool makes, and it is read-only.
function inspectOrder(orderID) {
  return marketClient.call("GetOrder", { order_id: String(orderID) });
}

(async () => {
  let result;
  try {
    result = await reconcile.reconcileJournals({
      root: process.env.EVEJS_COOP_NPC_MARKET_ROOT || "/var/lib/evejs/coop-native-market",
      inspectOrder,
      store,
      // The scene is only used to refresh a live hull's cargo cache; a scene that
      // cannot be created must not block the ledger settlement.
      sceneForSystem: (systemID) => {
        try {
          return runtime.ensureScene(systemID, { refreshStargates: false });
        } catch (_error) {
          return null;
        }
      },
      resolveType: (typeID) => registry.resolveItemByTypeID(typeID),
      dryRun: APPLY !== true,
    });
  } catch (error) {
    fail("RECONCILE_THREW:" + String(error && error.message || error).slice(0, 240));
  }
  const report = { ok: result.pending.length === 0, applied: APPLY === true, ...result };
  console.log(JSON.stringify(report, null, 2));
  process.exit(result.pending.length === 0 ? 0 : 1);
})();
