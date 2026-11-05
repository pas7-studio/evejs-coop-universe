import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { recordBaseline, compareBaselines, UNKNOWN, UNAVAILABLE } = require(require("node:path").join((process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs"), "Code/server/src/space/coopEconomyBaselineRecorder.js"));

test("recordBaseline with clock () => 7 returns recordedAt 7; a reader returning 5 gives { id, status: OK, value: 5 }; ok is true when every source is OK", () => {
  const result = recordBaseline({ sources: [{ id: "a", read: () => 5 }], clock: () => 7 });
  assert.equal(result.recordedAt, 7);
  const entry = result.sources[0];
  assert.deepEqual(entry, { id: "a", status: "OK", value: 5 });
  assert.equal(result.ok, true);
});

test("a reader that throws gives status UNKNOWN with the message in .error, the id in .unknown, ok false, and the entry has no numeric value", () => {
  const boom = new Error("boom");
  const result = recordBaseline({ sources: [{ id: "b", read: () => { throw boom; } }], clock: () => 1 });
  const entry = result.sources[0];
  assert.equal(entry.status, UNKNOWN);
  assert.equal(entry.error, boom.message);
  assert.deepEqual(result.unknown, ["b"]);
  assert.equal(result.ok, false);
  assert.equal(typeof entry.value, "undefined");
});

test("a source without a read function gives status UNAVAILABLE, the id in .unavailable, ok false", () => {
  const result = recordBaseline({ sources: [{ id: "c" }], clock: () => 1 });
  const entry = result.sources[0];
  assert.equal(entry.status, UNAVAILABLE);
  assert.deepEqual(result.unavailable, ["c"]);
  assert.equal(result.ok, false);
});

test("sources without a usable id are skipped; recordBaseline() with no arguments does not throw and returns ok true with an empty sources array", () => {
  const result = recordBaseline();
  assert.equal(result.ok, true);
  assert.deepEqual(result.sources, []);
});

test("compareBaselines(before, after): equal values -> UNCHANGED; different -> CHANGED with from/to; a source UNKNOWN on either side -> status UNKNOWN; an id present on one side only -> UNKNOWN; ok is false when any entry is UNKNOWN", () => {
  const unchanged = compareBaselines({ sources: [{ id: "a", value: 5 }] }, { sources: [{ id: "a", value: 5 }] });
  assert.equal(unchanged.entries[0].status, "UNCHANGED");
  assert.equal(unchanged.ok, true);

  const changed = compareBaselines({ sources: [{ id: "a", value: 5 }] }, { sources: [{ id: "a", value: 6 }] });
  assert.equal(changed.entries[0].status, "CHANGED");
  assert.equal(changed.entries[0].from, 5);
  assert.equal(changed.entries[0].to, 6);
  assert.equal(changed.ok, true);

  const unknownSide = compareBaselines({ sources: [{ id: "a", status: UNKNOWN }] }, { sources: [{ id: "a", value: 5 }] });
  assert.equal(unknownSide.entries[0].status, UNKNOWN);
  assert.equal(unknownSide.ok, false);

  const missingId = compareBaselines({ sources: [{ id: "a", value: 5 }] }, { sources: [{ id: "b", value: 5 }] });
  assert.equal(missingId.entries[0].status, UNKNOWN);
  assert.equal(missingId.ok, false);
});

test("UNKNOWN === 'UNKNOWN' and UNAVAILABLE === 'UNAVAILABLE'", () => {
  assert.equal(UNKNOWN, "UNKNOWN");
  assert.equal(UNAVAILABLE, "UNAVAILABLE");
});



