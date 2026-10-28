import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const durable = require("../integration/coopNativeMiningFleetDurable.cjs");

// Measured 2026-10-28: a slot repair pruned a stale generation that still carried 3
// manufactured chipsets, and the goods vanished (13 produced = 8 sold + 2 held + 3 lost).
// A repair must never destroy what is inside a hull: the slot record is the witness, the
// goods are the economy.
const SYSTEM = 30000145;

function fakeStore(cargo, entities = []) {
  return {
    listNativeCargoForEntity: (id) => cargo[id] || [],
    listNativeEntitiesForSystem: () => entities,
  };
}

// What the slot itself marks: the hull the repair wants to prune (a stale generation of
// the same slot role) plus the one it wants to keep.
const HULL = 980000000010;
const marked = [{ entityID: HULL, operatorKind: `coop-mining-${SYSTEM}-1-hauler` }];

test("a stale hull that carries goods is kept and reported", () => {
  const destroyed = [];
  const logged = [];
  const result = durable.pruneStaleSlotHulls({
    store: fakeStore({ 980000000010: [{ typeID: 444, quantity: 3 }] }, marked),
    systemID: SYSTEM, slot: 1, keep: [980000000011],
    destroy: (id) => { destroyed.push(id); return { success: true }; },
    log: (m) => logged.push(m),
  });
  assert.deepEqual(destroyed, [], "a hull with goods is never destroyed");
  assert.deepEqual(result.carrying, [{ entityID: 980000000010, units: 3 }]);
  assert.ok(logged.some((m) => m.includes("980000000010(3)")),
    "the operator is told which hull was kept and what it carries");
});

test("an empty stale hull is still pruned", () => {
  const destroyed = [];
  const result = durable.pruneStaleSlotHulls({
    store: fakeStore({}, marked),
    systemID: SYSTEM, slot: 1, keep: [980000000011],
    destroy: (id) => { destroyed.push(id); return { success: true }; },
    log: () => {},
  });
  assert.deepEqual(destroyed, [980000000010]);
  assert.deepEqual(result.carrying, []);
});
