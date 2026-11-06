import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Two measured wastes on the world-tick hot path, both found with a live V8 CPU profile of the
// play stack on 2026-11-06 (120 s, 500 us sampling):
//
//  * nativeNpcStore.entityIndexFor() read the collection through readCollection(), which deep
//    clones the WHOLE table. Every module/cargo write clears that index, so during combat it
//    rebuilt constantly: one cold listNativeModulesForEntity() cost 45.7 ms and returned ZERO
//    rows for that entity. The index only answers "which rows belong to this entity", and
//    cachedRowsForEntity() clones each row it hands out, so the index itself needs no copy.
//
//  * runtime.logMovementDebug() built a 20-field JSON (plus five vector summaries and a
//    magnitude) for every movement event even though appendMovementDebug() writes nothing unless
//    verbose debug is on. 165 ms of self time per 120 s with debug OFF, and the garbage fed GC.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const SERVER = path.join(forkRoot, "Code/server/src");
const storeSource = fs.readFileSync(path.join(SERVER, "space/npc/nativeNpcStore.js"), "utf8");
const runtimeSource = fs.readFileSync(path.join(SERVER, "space/runtime.js"), "utf8");

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start > 0, "missing " + startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, "missing " + endMarker + " after " + startMarker);
  return source.slice(start, end);
}

test("the per-entity index reads the raw collection, not a deep clone of the whole table", () => {
  const body = block(storeSource, "function entityIndexFor(", "function cachedRowsForEntity(");
  assert.match(body, /rawCollection\(tableName, collectionKey\)/,
    "the index holds row references; the clone happens per returned row");
  assert.doesNotMatch(body, /readCollection\(tableName, collectionKey\)/,
    "a full-table deep clone per rebuild is the 45.7 ms the profile measured");
});

test("the rows the index hands out are still cloned one by one", () => {
  const body = block(storeSource, "function cachedRowsForEntity(", "function listNativeEntities(");
  assert.match(body, /rows\.map\(\(row\) => cloneValue\(row\)\)/,
    "callers must never receive a live store row");
});

test("movement debug does no work at all when verbose debug is off", () => {
  const body = block(runtimeSource, "function logMovementDebug(", "function buildStaticStationEntity(");
  const guard = body.indexOf("isVerboseDebugEnabled()");
  const work = body.indexOf("const now = Date.now();");
  assert.ok(guard > 0, "the guard must exist");
  assert.ok(work > 0, "the JSON build must still exist");
  assert.ok(guard < work, "the guard must come BEFORE the JSON build, or it saves nothing");
});
