// FW-036 guard: the war layer must observe a system where the durable roster
// proves real native hulls, and must NOT observe a system that only history
// mentions. A spawned war fleet creates a real scene in a system nobody flew
// into; without this the opening planner, mobilizer and battle director skipped
// it and the war could not start without a human flying the route.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { fleetSystemIDs } = require("../integration/coopWarObservedSystems.cjs");

const fleet = (systemID, state, ships) => ({ systemID, state, ships });
const ship = (state = "ALIVE") => ({ entityID: 1, state });

test("a live fleet makes its system observed", () => {
  const snapshot = {
    status: "OK",
    state: {
      fleets: {
        a: fleet(30045343, "ACTIVE", [ship()]),
        b: fleet(30045344, "ACTIVE", [ship("ADOPTED")]),
      },
    },
  };
  assert.deepEqual(fleetSystemIDs(snapshot).sort((x, y) => x - y), [30045343, 30045344]);
});

test("one system is reported once however many fleets hold it", () => {
  const snapshot = {
    state: {
      fleets: {
        a: fleet(30045344, "ACTIVE", [ship()]),
        b: fleet(30045344, "ACTIVE", [ship()]),
      },
    },
  };
  assert.deepEqual(fleetSystemIDs(snapshot), [30045344]);
});

test("destroyed and reconstituted fleets are history, not presence", () => {
  const snapshot = {
    state: {
      fleets: {
        a: fleet(30045343, "DESTROYED", [ship()]),
        b: fleet(30045344, "RECONSTITUTED", [ship()]),
      },
    },
  };
  assert.deepEqual(fleetSystemIDs(snapshot), []);
});

test("a fleet whose hulls are all lost cannot observe a system", () => {
  const snapshot = { state: { fleets: { a: fleet(30045343, "ACTIVE", [{ entityID: 1, state: "LOST" }]) } } };
  assert.deepEqual(fleetSystemIDs(snapshot), []);
});

test("a disabled or missing roster observes nothing", () => {
  assert.deepEqual(fleetSystemIDs({ status: "DISABLED" }), []);
  assert.deepEqual(fleetSystemIDs(null), []);
  assert.deepEqual(fleetSystemIDs({ state: { fleets: { a: { state: "ACTIVE" } } } }), []);
});
