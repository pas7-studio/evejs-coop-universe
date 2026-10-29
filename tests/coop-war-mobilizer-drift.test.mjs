// FW-069 guard: a patrol belongs to the system its HULL is in, not to the one its link
// remembers.
//
// Measured on the work stack: the world kept opening campaigns and expiring them because
// mobilization answered NO_PATROL_CANDIDATE for a side whose armed hull stood idle in its
// own system. The link had already drifted (the virtual pilot walks its route while the
// native hull stays put - the drift FW-048/049/051 fixed for attribution, presence and the
// opener), and the mobiliser compared `link.systemID`, so the candidate was dropped before
// the native record was ever consulted. No assault, no kill, no payout.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { physicalCandidateSystem } = require("../integration/coopWarMobilizer.cjs");

test("a drifted link is judged by the hull's real system", () => {
  const natives = { 980000005421: { entityID: 980000005421, systemID: 30003837 } };
  const link = { pilotID: "coop-pilot-017", entityID: 980000005421, systemID: 30045343, role: "patrol" };
  assert.equal(physicalCandidateSystem(link, (id) => natives[id]), 30003837);
});

test("without a native record the link's own system is used, never zero", () => {
  const link = { pilotID: "coop-pilot-017", entityID: 980000005421, systemID: 30045343 };
  assert.equal(physicalCandidateSystem(link, () => null), 30045343);
});

test("a native record with no readable system falls back to the link", () => {
  const link = { entityID: 5, systemID: 30003836 };
  assert.equal(physicalCandidateSystem(link, () => ({ entityID: 5, systemID: 0 })), 30003836);
});

test("a throwing authority or an empty link answers 0, which no side can match", () => {
  assert.equal(physicalCandidateSystem({ entityID: 5, systemID: 30045344 },
    () => { throw Error("STORE_UNAVAILABLE"); }), 30045344);
  assert.equal(physicalCandidateSystem({}, () => null), 0);
  assert.equal(physicalCandidateSystem(null, null), 0);
});
