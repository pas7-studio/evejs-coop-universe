import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { observe, noteOnce } = require("../integration/coopObserve.cjs");

test("a throwing probe never reaches gameplay", () => {
  const probe = { observe() { throw new Error("probe disk full"); } };
  assert.equal(observe(probe, "living-test", { systemID: 30000145 }, { status: "X" }), false);
});

test("a missing probe is simply no telemetry", () => {
  assert.equal(observe(null, "living-test", { systemID: 1 }, {}), false);
  assert.equal(observe({}, "living-test", {}, {}), false);
});

test("the entity context carries only the exact item id", () => {
  const seen = [];
  const probe = { observe(event, entity, space, payload) { seen.push({ event, entity, space, payload }); } };
  observe(probe, "living-hauler-loaded", { systemID: 30000144, itemID: 980000011504 }, { fleetID: 2 });
  assert.deepEqual(seen[0], {
    event: "living-hauler-loaded",
    entity: { itemID: 980000011504 },
    space: { spaceState: { systemID: 30000144 } },
    payload: { fleetID: 2 },
  });
});

test("noteOnce reports a repeated status only once", () => {
  const seen = new Set();
  const events = [];
  const probe = { observe(event) { events.push(event); } };
  assert.equal(noteOnce(seen, "30000145:1", probe, "living-skip", { systemID: 30000145 }, { status: "NO_HAULER" }), true);
  assert.equal(noteOnce(seen, "30000145:1", probe, "living-skip", { systemID: 30000145 }, { status: "NO_HAULER" }), false);
  assert.equal(noteOnce(seen, "30000145:1", probe, "living-skip", { systemID: 30000145 }, { status: "FLUSH_FAILED" }), true);
  assert.deepEqual(events, ["living-skip", "living-skip"]);
});
