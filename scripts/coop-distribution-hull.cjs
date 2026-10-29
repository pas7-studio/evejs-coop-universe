#!/usr/bin/env node
/**
 * Make a durable native hull a DISTRIBUTION hull.
 *
 * Why this exists: a mining-fleet hauler cannot carry goods across a gate. Measured
 * 2026-10-29, its own mining behaviour flew it back to a belt after every order and the gap
 * to the gate oscillated between 7 km and 13 km for half an hour, while the fleet also
 * treated the hull as missing from its slot.
 *
 * So a hull that is going to fly freight is re-marked, in the durable store, with
 * `coop-distribution-<n>-hauler`. That is an identity change and nothing else:
 *   - it does not move the ship, and it never claims a jump;
 *   - it does not invent cargo, orders, sales or events;
 *   - it is the same call the fleet's own recompose uses (upsertNativeEntity/Controller),
 *     so it is not a second write path into the store.
 *
 * Usage (inside the server container):
 *   node _dist-hull.cjs --entity 980000004164 --mark coop-distribution-1-hauler --dry-run
 *   node _dist-hull.cjs --entity 980000004164 --mark coop-distribution-1-hauler --confirm
 */
const path = require("path");
const S = process.env.EVEJS_COOP_SERVER_SRC || "/app/server/src";
const store = require(path.join(S, "space/npc/nativeNpcStore"));

function arg(name, fallback = null) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes("--" + name);

const entityID = Number(arg("entity", 0));
const mark = String(arg("mark", "")).trim();
if (!Number.isSafeInteger(entityID) || entityID <= 0) {
  console.error("USAGE: --entity <id> --mark coop-distribution-<n>-hauler [--dry-run|--confirm]");
  process.exit(2);
}
if (!/^coop-distribution-[0-9]+-hauler$/.test(mark)) {
  console.error("REFUSED_BAD_MARK: the only accepted form is coop-distribution-<n>-hauler");
  process.exit(2);
}

const entity = store.getNativeEntity(entityID);
const controller = store.getNativeController(entityID);
if (!entity || !controller) {
  console.error("REFUSED_NOT_DURABLE: no durable record for " + entityID);
  process.exit(3);
}
if (entity.transient === true || controller.transient === true) {
  console.error("REFUSED_TRANSIENT: a transient hull is not a durable one");
  process.exit(3);
}
const cargo = (() => {
  try { return store.listNativeCargoForEntity(entityID) || []; } catch (_e) { return []; }
})();
const units = cargo.reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0);

const report = {
  entityID,
  systemID: Number(entity.systemID),
  from: String(entity.operatorKind || "") || null,
  to: mark,
  cargoUnits: units,
  modules: (() => {
    try { return (store.listNativeModulesForEntity(entityID) || []).length; } catch (_e) { return null; }
  })(),
};
if (flag("dry-run") || !flag("confirm")) {
  console.log("DRY_RUN " + JSON.stringify(report));
  if (!flag("dry-run")) console.log("NOTHING_CHANGED: pass --confirm to write");
  process.exit(0);
}

const a = store.upsertNativeEntity({ ...entity, operatorKind: mark });
const b = store.upsertNativeController({ ...controller, operatorKind: mark });
if (a?.success !== true || b?.success !== true) {
  console.log("WRITE_FAILED " + JSON.stringify({ entity: a, controller: b }));
  process.exit(4);
}
console.log("REMARKED " + JSON.stringify({ ...report, after: String(store.getNativeEntity(entityID)?.operatorKind || "") }));
