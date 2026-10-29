// FW-048 guard: identity must follow the physical hull, not a moving virtual pilot.
//
// Measured 19:59:42Z on the work stack: a real war ship was destroyed (entity
// 980000005122, coop-pilot-014) and its identity link already recorded systemID
// 30045343 because the virtual world keeps advancing that pilot between systems
// (x5 acceleration) while the native hull stays where it was spawned. The strict
// systemID match answered VICTIM_NOT_NAMED, the stock fallback then refused
// NOT_UNIQUE_NAMED_PIRATE, and the kill earned no merit and no bounty.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const attackerProof = require("../integration/coopNpcDestructionAttacker.cjs");
const stockProof = require("../integration/coopNpcStockWreckProof.cjs");

const SYSTEM = 30045344;
const MOVED_TO = 30045343;
const VICTIM = 980000005122;
const ATTACKER = 980000005123;

function scene() {
  const victim = { itemID: VICTIM, nativeNpc: true, kind: "ship" };
  const attacker = { itemID: ATTACKER, nativeNpc: true, kind: "ship" };
  const wreck = { itemID: 980300000019, nativeNpcWreck: true, launcherID: VICTIM };
  return { scene: {
    systemID: SYSTEM,
    sessions: new Map(),
    getEntityByID: (id) => (id === VICTIM ? victim : id === ATTACKER ? attacker : id === wreck.itemID ? wreck : null),
  }, victim, attacker, wreck };
}

const WRECK = { wreckID: 980300000019, systemID: SYSTEM, sourceEntityID: VICTIM, launcherID: VICTIM };

test("a killed war ship is still named when its virtual pilot has moved away", () => {
  const { scene: s, victim, attacker } = scene();
  const proof = attackerProof.verify({
    scene: s, victim, wreck: WRECK, options: { attackerEntity: attacker },
    links: [
      { pilotID: "coop-pilot-014", entityID: VICTIM, systemID: MOVED_TO, role: "patrol" },
      { pilotID: "coop-pilot-017", entityID: ATTACKER, systemID: MOVED_TO, role: "patrol" },
    ],
  });
  assert.equal(proof.status, "NATIVE_DESTRUCTION_ATTACKER_PROVIDED",
    "locality is proven by the scene and the wreck, not by the link's position");
  assert.equal(proof.victimPilotID, "coop-pilot-014");
  assert.equal(proof.attackerPilotID, "coop-pilot-017");
  assert.equal(proof.staleLinkPosition, true, "the stale position is reported, never hidden");
});

test("a link that still matches the scene is preferred over a stale duplicate", () => {
  const { scene: s, victim, attacker } = scene();
  const proof = attackerProof.verify({
    scene: s, victim, wreck: WRECK, options: { attackerEntity: attacker },
    links: [
      { pilotID: "coop-pilot-014", entityID: VICTIM, systemID: MOVED_TO, role: "patrol" },
      { pilotID: "coop-pilot-014", entityID: VICTIM, systemID: SYSTEM, role: "patrol" },
      { pilotID: "coop-pilot-017", entityID: ATTACKER, systemID: SYSTEM, role: "patrol" },
    ],
  });
  assert.equal(proof.status, "NATIVE_DESTRUCTION_ATTACKER_PROVIDED");
  assert.equal(proof.staleLinkPosition, false);
});

test("an unnamed victim is still unnamed, and an unnamed attacker still refuses", () => {
  const { scene: s, victim, attacker } = scene();
  const noVictim = attackerProof.verify({ scene: s, victim, wreck: WRECK,
    options: { attackerEntity: attacker }, links: [
      { pilotID: "coop-pilot-017", entityID: ATTACKER, systemID: MOVED_TO, role: "patrol" }] });
  assert.equal(noVictim.status, "VICTIM_NOT_NAMED", "a missing link is never invented");
  const noAttacker = attackerProof.verify({ scene: s, victim, wreck: WRECK,
    options: { attackerEntity: attacker }, links: [
      { pilotID: "coop-pilot-014", entityID: VICTIM, systemID: MOVED_TO, role: "patrol" }] });
  assert.equal(noAttacker.status, "ATTACKER_NOT_NAMED");
});

test("the stock fallback no longer misreads a named victim with a moved link", () => {
  const { scene: s, victim, attacker } = scene();
  const proof = stockProof.verifyStockKill({
    scene: s, victim, wreck: WRECK, options: { attackerEntity: attacker },
    links: [{ pilotID: "coop-pilot-014", entityID: VICTIM, systemID: MOVED_TO, role: "patrol" }],
    fleets: [],
  });
  assert.equal(proof.status, "NAMED_VICTIM_USE_STANDARD_PROOF",
    "a named war ship must never be handled by the stock pirate path");
});

// FW-074: a duplicated link must not make a real attacker ambiguous.
//
// Measured 11:24:26Z: the casualty was recorded and capture-by-force followed, yet
// attribution answered NOT_UNIQUE_NAMED_PIRATE because the disk copy and the live registry
// both held the SAME entity under different recorded systems.
const { mergeLinks } = require("../integration/coopNpcDestructionAttacker.cjs");

test("the same hull is one identity however many copies the registry holds", () => {
  const merged = mergeLinks([
    { pilotID: "coop-pilot-014", entityID: 980000005122, systemID: 30045343, linkedAt: 100 },
    { pilotID: "coop-pilot-014", entityID: 980000005122, systemID: 30045344, linkedAt: 200 },
  ]);
  assert.equal(merged.length, 1, "two copies of one hull are one hull");
  assert.equal(merged[0].systemID, 30045344, "the newest record wins");
});

test("one pilot is one hull, and two pilots stay two", () => {
  const merged = mergeLinks([
    { pilotID: "coop-pilot-014", entityID: 11, systemID: 30045344, linkedAt: 10 },
    { pilotID: "coop-pilot-014", entityID: 12, systemID: 30045344, linkedAt: 20 },
    { pilotID: "coop-pilot-015", entityID: 13, systemID: 30045344, linkedAt: 5 },
  ]);
  const pilots = merged.map((row) => row.pilotID).sort();
  assert.deepEqual(pilots, ["coop-pilot-014", "coop-pilot-015"]);
  assert.equal(merged.find((row) => row.pilotID === "coop-pilot-014").entityID, 12);
});

test("a link without an entity is merged by pilot, never dropped", () => {
  const merged = mergeLinks([{ pilotID: "coop-pilot-016", entityID: 0, systemID: 30045342 }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].pilotID, "coop-pilot-016");
});
