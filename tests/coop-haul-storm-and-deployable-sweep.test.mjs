import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Two regressions measured on the owner's live stack on 2026-11-04, both with the same
// shape: a guard existed but could not work where it was placed.
//
// 1. The haul-block event suppression map was declared INSIDE strictTransferCargo, so
//    every call started with an empty map and every blocked attempt emitted - 13 440
//    events in one hour (7.6 MB) for one fleet and one reason, which is also the lag the
//    owner felt. The state has to live at module scope.
// 2. "Collect all" from a Mobile Tractor Unit moved its 65 items into the ship cargo and
//    then the empty-container sweep deleted the unit itself, which the client showed as
//    the tractor blowing up. A deployable is not a jetcan.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const SERVER = path.join(forkRoot, "Code/server/src");
const read = (rel) => fs.readFileSync(path.join(SERVER, rel), "utf8");

test("the haul block suppression state outlives the call it suppresses", () => {
  const source = read("space/coopNativeHaulCargo.js");
  const moduleScope = source.indexOf("const blockNotifyState=new Map();");
  const functionStart = source.indexOf("function strictTransferCargo(");
  assert.ok(moduleScope >= 0, "the suppression map exists");
  assert.ok(moduleScope < functionStart,
    "the map is declared at module scope, before strictTransferCargo - declaring it inside " +
    "the function is exactly the bug that emitted 13 440 duplicate events in one hour");
  const functionBody = source.slice(functionStart, source.indexOf("\n}", functionStart));
  assert.doesNotMatch(functionBody, /const blockNotifyState\s*=\s*new Map/,
    "no per-call copy of the suppression map");
  assert.match(functionBody, /gateBlockNotify\(`\$\{Number\(fleet\?\.fleetID\)\|\|0\}\|\$\{reason\}`/,
    "the gate is still keyed by fleet and reason");
});

test("the conflict verdict names the failing clause, and the scan is not per item", () => {
  const source = read("space/coopNativeHaulCargo.js");
  assert.doesNotMatch(source, /all\.filter\(x=>Number\(x\?\.cargoID\)===key\)/,
    "no full cargo scan inside the per-item loop");
  assert.match(source, /const cargoIDCounts=new Map\(\);/,
    "one counted pass over the cargo rows per attempt");
  for (const clause of ["stale_fleet_flag", "fitted_module_row", "wrong_owner",
    "cargo_id_not_unique"]) {
    assert.ok(source.includes(`conflict("${clause}")`), `clause ${clause} is reported`);
  }
  // A stale display copy is no longer a refusal: the durable row is authoritative (measured
  // 2026-11-05, "cached_quantity_differs" blocked the owner's ore loop for hours).
  assert.doesNotMatch(source, /conflict\("cached_(quantity|type)_differs"\)|conflict\("cached_item_missing"\)/,
    "a stale entity copy must be repaired from the durable row, not refused");
  assert.match(source, /function cacheRowFromStoreRow\(row\)/,
    "the repair builds the cache row from the durable row");
  assert.match(source, /living-haul-cache-repaired/, "and it is observed, not silent");
});

test("emptying a deployable never despawns the deployable", () => {
  const source = read("services/ship/jettisonRuntime.js");
  assert.match(source, /const DEPLOYABLE_CATEGORY_ID = 22;/,
    "category 22 is the deployable category (Mobile Tractor Unit = 33475, measured)");
  assert.match(source, /function isDeployableSpaceItem\(item, resolveType = resolveItemByTypeID\)/);
  const guardIndex = source.indexOf("if (isDeployableSpaceItem(container)) {");
  const removeIndex = source.indexOf("removeInventoryItem(numericID, { removeContents: false })");
  assert.ok(guardIndex > 0, "the sweep asks whether the container is a deployable");
  assert.ok(removeIndex > guardIndex,
    "the deployable guard runs BEFORE the removal that deleted the tractor unit");
  assert.match(source, /isDeployableSpaceItem,\n\};/, "the predicate is exported for tests");
});
