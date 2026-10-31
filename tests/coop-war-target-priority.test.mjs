// FW-117: who shoots whom, by role.
//
// MEASURED on the play stack 2026-10-31: a five-hull squad-lead formation fielded tackle,
// anti-tackle, brawler, EWAR and logistics, and every one of them shot the NEAREST enemy, so
// the destroyer built to kill tackle, the EWAR ship and the remote-repair frigate all behaved
// like a brawler. The roles existed in the fitting and nowhere in the fight.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { targetPriority, orderCandidates } = require("../integration/coopWarTargetPriority.cjs");

const enemy = (entityID, distance, targetRole, kind = "WAR_SHIP") =>
  ({ entityID, distance, targetRole, kind });

test("a destroyer shoots the enemy tackle first, even when it is farther away", () => {
  const ordered = orderCandidates({
    attackerRole: "anti-tackle",
    candidates: [enemy(1, 1000, "brawler"), enemy(2, 90000, "tackle"), enemy(3, 5000, "logistics")],
  });
  assert.deepEqual(ordered.map((row) => row.entityID), [2, 3, 1]);
});

test("an EWAR ship removes the enemy's repair before it trades shots", () => {
  const ordered = orderCandidates({
    attackerRole: "ewar",
    candidates: [enemy(1, 100, "tackle"), enemy(2, 8000, "logistics"), enemy(3, 400, "ewar")],
  });
  assert.deepEqual(ordered.map((row) => row.entityID), [2, 3, 1]);
});

test("a fleet whose hulls carry no role keeps exactly the old nearest-first order", () => {
  const candidates = [enemy(1, 5000, ""), enemy(2, 1000, ""), enemy(3, 3000, "")];
  const ordered = orderCandidates({ attackerRole: "", candidates });
  assert.deepEqual(ordered.map((row) => row.entityID), [2, 3, 1],
    "no role means no behaviour change at all");
});

test("a role the table does not know never outranks distance", () => {
  const ordered = orderCandidates({
    attackerRole: "logistics",
    candidates: [enemy(1, 900, "heavy"), enemy(2, 100, "tackle")],
  });
  assert.deepEqual(ordered.map((row) => row.entityID), [2, 1],
    "logistics only values tackle; everything else stays nearest-first");
});

test("on equal priority a native hull beats a player, as before", () => {
  const ordered = orderCandidates({
    attackerRole: "anti-tackle",
    candidates: [enemy(7, 1000, "tackle", "MILITIA_PLAYER"), enemy(8, 1000, "tackle")],
  });
  assert.deepEqual(ordered.map((row) => row.entityID), [8, 7]);
});

test("ordering never invents, drops or duplicates a candidate", () => {
  const candidates = [enemy(1, 10, "tackle"), enemy(2, 10, "tackle"), enemy(3, 10, "brawler")];
  const ordered = orderCandidates({ attackerRole: "tackle", candidates });
  assert.equal(ordered.length, candidates.length);
  assert.deepEqual(ordered.map((row) => row.entityID).sort(), [1, 2, 3]);
  assert.deepEqual(orderCandidates({}), []);
  assert.deepEqual(orderCandidates({ candidates: "nope" }), []);
});

test("the priority table is explicit about every role it knows", () => {
  assert.ok(targetPriority({ attackerRole: "anti-tackle", targetRole: "tackle" }) > 0);
  assert.equal(targetPriority({ attackerRole: "nonsense", targetRole: "tackle" }), 0);
  assert.equal(targetPriority({ attackerRole: "tackle", targetRole: "nonsense" }), 0);
  assert.equal(targetPriority({}), 0);
});
