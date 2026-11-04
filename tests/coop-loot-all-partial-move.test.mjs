import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";

// Live client 2026-11-03 22:36:05: invLootAllBtn -> UserError NotEnoughCargoSpace
// {'available': 0.8175, 'volume': 388}. Loot All sends the whole wreck as one invbroker
// MultiAdd, and a single item that did not fit threw, aborting the entire batch - so a hold
// with 0.8 m3 free looted nothing. Real EVE moves what fits and leaves the rest.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const srcRoot = path.join(forkRoot, "Code/server/src");
const require = createRequire(import.meta.url);
const {resolveCapacityClampedQuantity} = require(
  path.join(srcRoot, "services/inventory/invMoveCapacity.js"),
);

const BROKER = path.join(srcRoot, "services/inventory/invBrokerService.js");

function multiAddCapacityBranch() {
  const source = readFileSync(BROKER, "utf8");
  const start = source.indexOf("Handle_MultiAdd(args, session, kwargs)");
  assert.ok(start > 0, "Handle_MultiAdd must exist");
  const end = source.indexOf("Handle_", start + 10);
  const body = source.slice(start, end > start ? end : undefined);
  const at = body.indexOf('if (capacityCheck.errorMsg === "NotEnoughCargoSpace") {');
  assert.ok(at > 0, "the MultiAdd capacity branch must exist");
  return body.slice(Math.max(0, at - 700), at + 400);
}

test("a stack that does not fit is clamped, not refused", () => {
  const partial = resolveCapacityClampedQuantity({
    capacityCheck: {success: false, errorMsg: "NotEnoughCargoSpace", free: 40},
    unitVolume: 1,
    wantedQuantity: 186,
  });
  assert.equal(partial.success, true);
  assert.equal(partial.quantity, 40, "only what fits may move");
  assert.equal(partial.partial, true);
});

test("a hold with 0.8 m3 free cannot take a 388 m3 batch item", () => {
  const nothing = resolveCapacityClampedQuantity({
    capacityCheck: {success: false, errorMsg: "NotEnoughCargoSpace", free: 0.8175},
    unitVolume: 388,
    wantedQuantity: 1,
  });
  assert.equal(nothing.success, false);
  assert.equal(nothing.quantity, 0);
});

test("MultiAdd skips unfitting items instead of aborting Loot All", () => {
  const branch = multiAddCapacityBranch();
  assert.match(
    branch,
    /itemIDs\.length > 1 \|\| movedCount > 0/,
    "a multi-item batch must skip the item that does not fit",
  );
  assert.match(branch, /continue;/, "the batch must continue with the remaining items");
});
