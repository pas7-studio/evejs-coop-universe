// FW-049 guard: war presence is a PHYSICAL fleet, never a virtual route position.
//
// Measured 20:29-20:34Z on the work stack: the 500011 Angels spawned in 30003836
// vanished from war_state.presence while their native hulls were alive there,
// because the identity link's systemID follows the VIRTUAL pilot and the world
// keeps advancing that pilot along its route (x5 acceleration). Ownership, fronts
// and target selection flickered every few minutes, no border stayed open, and the
// war kept dying at the "front" step instead of at combat.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { projectWarPresence } = require("../integration/coopVirtualWorldRuntime.pure.cjs");

const corpFaction = { 1000120: 500004, 1000138: 500011 };
const authorities = (entities) => ({
  getNativeEntity: (id) => entities[id] || null,
  getFactionForCorporation: (corp) => corpFaction[corp] || 0,
});

test("a hull that really is in one system counts there, not where its route went", () => {
  const links = [{ pilotID: "coop-pilot-054", entityID: 980000005577, systemID: 30045343, role: "patrol" }];
  const pilots = projectWarPresence(links, authorities({
    980000005577: { entityID: 980000005577, systemID: 30003836, corporationID: 1000138 },
  }));
  assert.equal(pilots.length, 1);
  assert.equal(pilots[0].systemID, 30003836, "the physical hull decides the system");
  assert.equal(pilots[0].linkSystemID, 30045343);
  assert.equal(pilots[0].positionDrifted, true, "the drift is reported, never hidden");
  assert.equal(pilots[0].factionID, 500011);
});

test("a destroyed hull is not a presence any more", () => {
  const links = [{ pilotID: "coop-pilot-017", entityID: 980000005431, systemID: 30045344, role: "patrol" }];
  const pilots = projectWarPresence(links, authorities({}));
  assert.deepEqual(pilots, [], "a link without a native record is a dead ship");
});

test("a faction is still resolved from the real corporation, never guessed", () => {
  const links = [
    { pilotID: "coop-pilot-003", entityID: 1, systemID: 0, role: "patrol" },
    { pilotID: "coop-pilot-004", entityID: 2, systemID: 30003837, role: "patrol" },
  ];
  const pilots = projectWarPresence(links, authorities({
    1: { entityID: 1, systemID: 30003837, corporationID: 1000120 },
    2: { entityID: 2, systemID: 30003837, corporationID: 9999999 },
  }));
  assert.equal(pilots.length, 1, "an unknown corporation yields no faction and no presence");
  assert.equal(pilots[0].pilotID, "coop-pilot-003");
  assert.equal(pilots[0].factionID, 500004);
});

test("a missing native position falls back to the link, it is not dropped", () => {
  const links = [{ pilotID: "coop-pilot-005", entityID: 3, systemID: 30045344, role: "patrol" }];
  const pilots = projectWarPresence(links, authorities({
    3: { entityID: 3, systemID: 0, corporationID: 1000120 },
  }));
  assert.equal(pilots.length, 1);
  assert.equal(pilots[0].systemID, 30045344);
  assert.equal(pilots[0].positionDrifted, false);
});
