// FW-051 guard: the opening planner must see the same fleet the territory map sees.
//
// Review finding: collectPresence DROPPED any hull whose identity link had drifted to
// another system, because a link's systemID follows the VIRTUAL pilot while the native
// hull stays where it was spawned (FW-049). The territory bootstrap counts the hull
// where it really is, so a border could be owned by a faction the opener could not see
// at all - two different presence projections for one world.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { collectPresence } = require("../integration/coopFactionWarOpening.cjs");

const corpFaction = { 1000138: 500011, 1000120: 500004 };
const auth = (entities) => ({
  getNativeEntity: (id) => entities[id] || null,
  getFactionForCorporation: (corp) => corpFaction[corp] || 0,
});

test("a drifted hull is counted where its hull really is, not dropped", () => {
  const presence = collectPresence({
    links: [{ pilotID: "coop-pilot-054", entityID: 11, systemID: 30045343, role: "patrol" }],
    systemIDs: [30003836],
    ...auth({ 11: { entityID: 11, systemID: 30003836, corporationID: 1000138 } }),
  });
  assert.equal(presence.status, "PRESENCE");
  assert.equal(presence.pilots.length, 1, "the opener must see a real hull");
  assert.equal(presence.pilots[0].systemID, 30003836);
  assert.equal(presence.drifted, 1);
  assert.equal(presence.pilots[0].positionDrifted, true);
});

test("a hull in a system the world does not track is still skipped", () => {
  const presence = collectPresence({
    links: [{ pilotID: "coop-pilot-054", entityID: 12, systemID: 30000142, role: "patrol" }],
    systemIDs: [30003836],
    ...auth({ 12: { entityID: 12, systemID: 30000142, corporationID: 1000138 } }),
  });
  assert.equal(presence.pilots.length, 0);
  assert.equal(presence.skipped, 1);
});

test("a hull with no native record never becomes a presence", () => {
  const presence = collectPresence({
    links: [{ pilotID: "coop-pilot-999", entityID: 13, systemID: 30003836, role: "patrol" }],
    systemIDs: [30003836], ...auth({}),
  });
  assert.equal(presence.pilots.length, 0, "no corporation, no faction, no presence");
});

test("a link whose position still matches is counted without being called drifted", () => {
  const presence = collectPresence({
    links: [{ pilotID: "coop-pilot-003", entityID: 14, systemID: 30003836, role: "patrol" }],
    systemIDs: [30003836],
    ...auth({ 14: { entityID: 14, systemID: 30003836, corporationID: 1000120 } }),
  });
  assert.equal(presence.pilots.length, 1);
  assert.equal(presence.pilots[0].factionID, "500004");
  assert.equal(presence.drifted, 0);
});
