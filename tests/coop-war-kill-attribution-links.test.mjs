// FW-040 guard: a war hull whose identity link is only in the live registry must
// still be attributable. Measured 2026-10-28: a real war kill answered
// NOT_UNIQUE_NAMED_PIRATE because the victim link was not on disk yet, so no
// merit was awarded and the HELD bounty escrow could never pay out.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { mergeLinks } = require("../integration/coopNpcDestructionAttacker.cjs");

const onDisk = [{ pilotID: "coop-pilot-001", entityID: 900, systemID: 30045344, role: "patrol" }];
const live = [
  { pilotID: "coop-pilot-001", entityID: 900, systemID: 30045344, role: "patrol" },
  { pilotID: "coop-pilot-005", entityID: 980000003812, systemID: 30045344, role: "patrol" },
];

test("the live registry fills in a link the file does not have yet", () => {
  const merged = mergeLinks(onDisk, live);
  assert.equal(merged.length, 2, "the duplicate pair is kept once");
  assert.ok(merged.some((l) => l.entityID === 980000003812 && l.pilotID === "coop-pilot-005"));
});

test("merging is order independent and ignores junk", () => {
  assert.equal(mergeLinks(live, onDisk).length, 2);
  assert.deepEqual(mergeLinks(null, undefined, [null, 0, "x"]), []);
});
