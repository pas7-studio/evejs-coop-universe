"use strict";
// Walk the payloads the runtime really builds for a scene and check every slim item in them.
//
// Runs INSIDE the server container (it needs the live runtime and its static data):
//   MSYS_NO_PATHCONV=1 docker cp scripts/coop-overview-payload-probe.js evejs-agents-server-1:/tmp/
//   MSYS_NO_PATHCONV=1 docker exec -e PROBE_SYSTEM=30000145 evejs-agents-server-1 //     node /tmp/coop-overview-payload-probe.js
//
// It builds the exact bootstrap a client receives when it enters the system (AddBalls2 and
// SetState.slims) plus one incremental OnSlimItemChange, then counts the slim items that carry no
// group - the ones that leave a row out of the overview panel.
//
// The panel reads `slimItem.groupID`; the bootstrap (AddBalls2 + SetState.slims) is what a client
// receives when it enters a system, and the incremental path reuses the same encoder. This builds both
// payloads for a real scene and counts the slim items that carry no group - the case that leaves the
// panel empty while the ships are in space.
const runtime = require("/app/server/src/space/runtime");
const destiny = require("/app/server/src/space/destiny");

const systemID = Number(process.env.PROBE_SYSTEM || 30000144);
const scene = runtime.ensureScene(systemID, { refreshStargates: false });
if (!scene) {
  console.log(`NO_SCENE ${systemID}`);
  process.exit(0);
}
const entities = [
  ...(scene.dynamicEntities instanceof Map ? Array.from(scene.dynamicEntities.values()) : []),
  ...(scene.staticEntitiesByID instanceof Map ? Array.from(scene.staticEntitiesByID.values()) : []),
];
console.log(`SCENE ${systemID} entities=${entities.length}`);

const stamp = 1 >>> 0;
const addBalls2 = destiny.buildAddBalls2Payload(stamp, entities, 0n);
const setState = destiny.buildSetStatePayload(stamp, scene, 0, entities, 0n);

function countSlims(node, seen) {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  if (node.type === "dict" && Array.isArray(node.entries)) {
    const keys = new Set(node.entries.map((row) => (Array.isArray(row) ? row[0] : null)));
    if (keys.has("itemID") && keys.has("typeID")) {
      slims.total += 1;
      if (!keys.has("groupID")) slims.missing += 1;
      else {
        const value = node.entries.find((row) => row[0] === "groupID")[1];
        if (!(Number(value) > 0)) slims.zero += 1;
      }
    }
    for (const row of node.entries) {
      if (Array.isArray(row)) countSlims(row[1], seen);
      else countSlims(row, seen);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) countSlims(item, seen);
    return;
  }
  for (const value of Object.values(node)) countSlims(value, seen);
}

const slims = { total: 0, missing: 0, zero: 0 };
countSlims(addBalls2, new Set());
const addSlims = { ...slims };
slims.total = 0;
slims.missing = 0;
slims.zero = 0;
countSlims(setState, new Set());
const stateSlims = { ...slims };

console.log(`ADDBALLS2 slims=${addSlims.total} missingGroupID=${addSlims.missing} zeroGroupID=${addSlims.zero}`);
console.log(`SETSTATE  slims=${stateSlims.total} missingGroupID=${stateSlims.missing} zeroGroupID=${stateSlims.zero}`);

// A slim item must also survive the incremental path unchanged.
const one = entities.find((entity) => entity && entity.kind === "ship");
if (one) {
  const change = destiny.buildOnSlimItemChangePayload(one.itemID, destiny.buildSlimItemObject(one));
  const wrapper = change[1] && change[1][1];
  const dict = wrapper && wrapper.args ? wrapper.args : wrapper;
  const keys = new Set((dict && Array.isArray(dict.entries) ? dict.entries : []).map((row) => row[0]));
  console.log(`ONSLIMCHANGE ship=${one.itemID} hasGroup=${keys.has("groupID")} hasCategory=${keys.has("categoryID")}`);
}

const ok = addSlims.missing === 0 && addSlims.zero === 0 &&
  stateSlims.missing === 0 && stateSlims.zero === 0;
console.log(ok ? "PAYLOAD_CHECK_OK every transmitted slim item is classified"
  : "PAYLOAD_CHECK_FAILED some transmitted slim items carry no group");
