// The admin bridge has to put a lost ship back together without a live client
// session, so it cannot use the native fitting planner (that one answers "no
// valid slot" for a bare identity). Placement is decided by the pure planner in
// space/coopAdminFitPlan.js instead.
//
// What this test proves: a module lands in a real slot of its own family, a
// second mining laser never lands on the first laser's slot, drones go to the
// drone bay, cargo goes to the hold, and an over-full hull is refused instead of
// silently stacking two modules in one slot. It does NOT prove in-client
// gameplay; that still needs the owner's client.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { planFit, toFitSlots } = require(`${forkRoot}/Code/server/src/space/coopAdminFitPlan.js`);

// Venture-shaped hull: 2 high, 3 med, 2 low, 3 rig.
const ventureSlots = {
  high: [27, 28],
  med: [19, 20, 21],
  low: [11, 12],
  rig: [92, 93, 94],
};

test("a second mining laser takes the next high slot, not the first one again", () => {
  const first = planFit({
    modules: [{ typeID: 5239, count: 2, family: "high", kind: "module" }],
    slotFlags: ventureSlots,
    occupiedFlags: [],
  });
  assert.deepEqual(first.rows.map((row) => [row.typeID, row.flag, row.ok]), [
    [5239, 27, true],
    [5239, 28, true],
  ]);
  const second = planFit({
    modules: [{ typeID: 5239, count: 1, family: "high", kind: "module" }],
    slotFlags: ventureSlots,
    occupiedFlags: [27],
  });
  assert.deepEqual(second.rows.map((row) => [row.typeID, row.flag, row.ok]), [
    [5239, 28, true],
  ]);
});

test("an empty hull receives every module in its own family", () => {
  const { rows } = planFit({
    modules: [
      { typeID: 5239, count: 2, family: "high" },
      { typeID: 8433, count: 1, family: "med" },
      { typeID: 54291, count: 1, family: "med" },
      { typeID: 6003, count: 1, family: "med" },
      { typeID: 22542, count: 1, family: "low" },
    ],
    slotFlags: ventureSlots,
    occupiedFlags: [],
  });
  assert.deepEqual(rows.map((row) => row.flag), [27, 28, 19, 20, 21, 11]);
  assert.equal(rows.every((row) => row.ok), true);
});

test("drones go to the drone bay and ore goes to the hold", () => {
  const { rows } = planFit({
    modules: [
      { typeID: 2454, count: 3, kind: "drone" },
      { typeID: 1230, count: 500, kind: "cargo" },
    ],
    slotFlags: ventureSlots,
  });
  assert.deepEqual(rows.map((row) => [row.typeID, row.flag, row.kind]), [
    [2454, 87, "drone"],
    [1230, 5, "cargo"],
  ]);
});

test("an over-full slot family is refused instead of stacking two modules in one slot", () => {
  const { rows } = planFit({
    modules: [{ typeID: 5239, count: 3, family: "high" }],
    slotFlags: ventureSlots,
    occupiedFlags: [27, 28],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, false);
  assert.match(rows[0].error, /no free high slot/);
});

test("an explicit flag always wins and toFitSlots merges identical placements", () => {
  const { rows } = planFit({
    modules: [
      { typeID: 5239, count: 1, flag: 28 },
      { typeID: 2454, count: 2, kind: "drone" },
      { typeID: 2454, count: 1, kind: "drone" },
    ],
    slotFlags: ventureSlots,
  });
  assert.deepEqual(rows.map((row) => row.flag), [28, 87, 87]);
  assert.deepEqual(toFitSlots(rows), [
    { typeID: 5239, flag: 28, count: 1 },
    { typeID: 2454, flag: 87, count: 3 },
  ]);
});
