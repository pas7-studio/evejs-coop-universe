#!/usr/bin/env node
/**
 * Spawn one durable DISTRIBUTION hull at a real anchor.
 *
 * Why: the freight run iterates every `coop-distribution-*` hull, but the corporation had only
 * three (the two idle Jita haulers were re-marked by hand). Growing the fleet should be an
 * operator decision with a real ship behind it, not a renamed miner.
 *
 * It spawns through the same native path the mining fleet uses - a real scene, a real anchor
 * (an asteroid belt's coordinates), `transient: false` so the hull survives a restart - and it
 * NEVER invents a movement, a cargo row, a sale or an event about one. If the world refuses,
 * the refusal is printed.
 *
 * Usage (inside the server container):
 *   node _spawn-dist-hull.cjs --system 30000145 --mark coop-distribution-4-hauler --dry-run
 *   node _spawn-dist-hull.cjs --system 30000145 --mark coop-distribution-4-hauler --confirm
 */
const path = require("path");
const S = process.env.EVEJS_COOP_SERVER_SRC || "/app/server/src";
const runtime = require(path.join(S, "space/runtime"));
const service = require(path.join(S, "space/npc/nativeNpcService"));

function arg(name, fallback = null) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes("--" + name);

const systemID = Number(arg("system", 0));
const mark = String(arg("mark", "")).trim();
const profile = String(arg("profile", "ore_mining_impel_hauler")).trim();
if (!Number.isSafeInteger(systemID) || systemID <= 0) {
  console.error("USAGE: --system <id> --mark coop-distribution-<n>-hauler [--dry-run|--confirm]");
  process.exit(2);
}
if (!/^coop-distribution-[0-9]+-hauler$/.test(mark)) {
  console.error("REFUSED_BAD_MARK: the only accepted form is coop-distribution-<n>-hauler");
  process.exit(2);
}

const scene = runtime.ensureScene(systemID, {refreshStargates: false});
const entities = scene && Array.isArray(scene.staticEntities) ? scene.staticEntities : [];
const belt = entities.find((row) => String(row.kind) === "asteroidBelt" && row.position);
if (!belt) {
  console.error("REFUSED_NO_BELT: a hull needs a real anchor in this system");
  process.exit(3);
}
const existing = entities.filter((row) => String(row.kind) === "ship");
const report = {
  systemID,
  mark,
  profile,
  anchor: {itemID: Number(belt.itemID) || 0,
    position: [Math.round(belt.position.x), Math.round(belt.position.y), Math.round(belt.position.z)]},
  shipsInScene: existing.length,
};
if (flag("dry-run") || !flag("confirm")) {
  console.log("DRY_RUN " + JSON.stringify(report));
  if (!flag("dry-run")) console.log("NOTHING_SPAWNED: pass --confirm to spawn");
  process.exit(0);
}

const direction = belt.direction || {x: 1, y: 0, z: 0};
const answer = service.spawnNativeNpcEntityInSystem(systemID, {
  profileQuery: profile,
  operatorKind: mark,
  transient: false,
  broadcast: false,
  anchorDescriptor: {
    kind: "coordinates",
    position: belt.position,
    direction,
    name: "Distribution Hull Anchor",
  },
});
const data = (answer && answer.data) || {};
const entityID = Number(data.entityID
  || (data.entity && (data.entity.entityID || data.entity.itemID))
  || (data.entityRecord && data.entityRecord.entityID)
  || (data.controller && data.controller.entityID) || 0);
console.log((answer && answer.success === true ? "SPAWNED " : "REFUSED ")
  + JSON.stringify({...report, entityID, errorMsg: (answer && answer.errorMsg) || null}));
