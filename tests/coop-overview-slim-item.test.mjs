import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

// The overview panel decides visibility with, verbatim,
// `if slimItem.groupID not in self.filterGroups: return False`
// (eve/client/script/ui/inflight/overview/slimItemDisplayChecker.pyj).
//
// Two consequences the server has to honour, and this test is the contract for both:
//   - `michelle.AddBalls2` builds the slim items one after another, so an object WITHOUT `groupID`
//     raises inside that loop and every ball after it is added with no slim item at all. The
//     visible symptom is an overview panel that lists nothing while ships are still drawn in space;
//   - a hull must report its own group: a Catalyst is a destroyer (group 420 in this build), and
//     the old default reported every ship as a frigate (25), which no group-specific tab lists.
//
// destiny.js and runtime.js cannot be imported by a plain node:test process (they pull the real
// gameStore, which the harness refuses), so the contract is read from the source here and the real
// numbers are measured in the container - see the probe recorded in .opencode/state.md.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const source = (relative) => readFileSync(path.join(forkRoot, relative), "utf8");

test("the slim item always carries groupID and categoryID", () => {
  const destiny = source("Code/server/src/space/destiny.js");
  assert.match(destiny, /entries\.push\(\["groupID", slimGroupID\]\);/);
  assert.match(destiny, /entries\.push\(\["categoryID", slimCategoryID\]\);/);
  // Omitted fields are the failure: the client reads the attribute unconditionally.
  assert.doesNotMatch(destiny, /if \(slimGroupID > 0\) \{/);
  assert.doesNotMatch(destiny, /if \(slimCategoryID > 0\) \{/);
});

test("a ship takes the group and category of its own type, not a frigate default", () => {
  const runtime = source("Code/server/src/space/runtime.js");
  assert.match(runtime, /function buildShipEntityCore/);
  // The resolution has to happen where the entity is built, and the slim item must use the same
  // values the entity reports - otherwise the client's filter compares a different group.
  assert.match(runtime, /resolveItemByTypeID\(typeID\)/);
  assert.match(runtime, /const shipGroupID = toInt\(\s*source\.groupID,\s*toInt\(resolvedShipType && resolvedShipType\.groupID, 25\),?\s*\);/);
  assert.match(runtime, /slimGroupID: toInt\(source\.slimGroupID, shipGroupID\)/);
  assert.match(runtime, /slimCategoryID: toInt\(source\.slimCategoryID, shipCategoryID\)/);
  // A hard-coded fallback straight into the slim item is what mislabelled every hull.
  assert.doesNotMatch(runtime, /slimGroupID: toInt\(source\.slimGroupID, toInt\(source\.groupID, 25\)\)/);
});
