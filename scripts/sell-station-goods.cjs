#!/usr/bin/env node
// Operator tool: sell what the corporation really holds at a station through the
// PROVEN arrival sale (lift into a real hauler hold, then fill real seeded bids).
//
// It never places an order of its own and never invents a buyer: the lift picks only
// stacks that station really bids for, and the trader fills those bids or refuses.
//
// Inside the server container:
//   docker cp scripts/sell-station-goods.cjs evejs-agents-server-1:/tmp/sg.cjs
//   docker exec evejs-agents-server-1 node /tmp/sg.cjs --station 60014935 \
//     --system 30000145 --hauler 980000000032
"use strict";
const path = require("node:path");

const SERVER_ROOT = process.env.EVEJS_SERVER_ROOT || "/app/server";
process.env.EVEJS_COOP_NPC_MARKET_SELL_ON_ARRIVAL = process.env.EVEJS_COOP_NPC_MARKET_SELL_ON_ARRIVAL || "1";
process.env.EVEJS_COOP_NATIVE_NPC_MARKET = process.env.EVEJS_COOP_NATIVE_NPC_MARKET || "1";
process.env.EVEJS_COOP_NPC_MINERAL_LIFT = process.env.EVEJS_COOP_NPC_MINERAL_LIFT || "1";
process.env.EVEJS_COOP_LIFT_ANY_TYPE = process.env.EVEJS_COOP_LIFT_ANY_TYPE || "1";

function arg(name, fallback = null) {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}
const stationID = Number(arg("station", 0));
const systemID = Number(arg("system", 30000145));
const haulerID = Number(arg("hauler", 0));
const arrivalMeters = Number(arg("range", 9000));

let runtime, market, npcRuntime;
try {
  runtime = require(path.join(SERVER_ROOT, "src/space/runtime"));
  npcRuntime = require(path.join(SERVER_ROOT, "src/space/npc/npcRuntime"));
  market = require(path.join(SERVER_ROOT, "src/space/coopVirtualWorldRuntime"));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: "IMPORT_FAILED:" + String((error && error.message) || error).slice(0, 200) }));
  process.exit(2);
}

const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity);

(async () => {
  const scene = runtime.ensureScene(systemID, { refreshStargates: false });
  const ship = scene && scene.getEntityByID ? scene.getEntityByID(haulerID) : null;
  if (!ship) {
    console.log(JSON.stringify({ ok: false, error: "HAULER_NOT_IN_SCENE", haulerID, systemID }));
    process.exit(1);
  }
  const station = (scene.staticEntities || []).find((entity) => entity && entity.kind === "station" && Number(entity.itemID) === stationID);
  if (!station || !station.position) {
    console.log(JSON.stringify({ ok: false, error: "STATION_NOT_PHYSICAL", stationID }));
    process.exit(1);
  }
  const gap = Math.round(distance(ship.position, station.position));
  if (gap > arrivalMeters) {
    console.log(JSON.stringify({ status: "WARPING_TO_STATION", gap, stationID, haulerID }));
    try {
      npcRuntime.warpToPoint(haulerID, station.position,
        { forceImmediateStart: true, broadcastWarpStartToVisibleSessions: true });
    } catch (error) {
      console.log(JSON.stringify({ ok: false, error: "WARP_REFUSED:" + String((error && error.message) || error).slice(0, 120) }));
      process.exit(1);
    }
    const deadline = Date.now() + 4 * 60 * 1000;
    let arrived = false;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const now = scene.getEntityByID(haulerID);
      const warping = now && (String(now.mode || "").toUpperCase() === "WARP" || now.pendingWarp || now.warpState);
      if (!warping && now && distance(now.position, station.position) <= arrivalMeters) { arrived = true; break; }
    }
    if (!arrived) {
      const now = scene.getEntityByID(haulerID);
      console.log(JSON.stringify({ ok: false, error: "ARRIVAL_TIMEOUT",
        gap: Math.round(distance(now && now.position, station.position)) }));
      process.exit(1);
    }
  }
  const settled = { status: "PENDING" };
  const deadline = Date.now() + 2 * 60 * 1000;
  let calls = 0;
  while (Date.now() < deadline) {
    calls += 1;
    const result = market.sellOnArrival({ systemID, stationID, haulerID, types: [], scene });
    if (result && (result.status === "SOLD" || result.status === "NOT_SOLD")) {
      Object.assign(settled, result);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const ok = settled.status === "SOLD";
  console.log(JSON.stringify({ ok, calls, stationID, haulerID, ...settled }, null, 2));
  process.exit(ok ? 0 : 1);
})();
