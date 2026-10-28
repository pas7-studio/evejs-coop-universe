// FW-036 guard: a war party must be able to field a real navy.
// Measured on the work stack 2026-10-28: war:500011-500014 opened with 500014 =
// ORE, whose only charged rows are mining lasers, so the attacker could never
// reach ASSAULT, no defending wreck could ever exist, and the campaign squatted
// the target until every other front answered NO_OPENABLE_FRONT.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { evaluateNavy, decideFront, createNavyCapability } =
  require("../integration/coopWarNavyCapability.cjs");
const opening = require("../integration/coopFactionWarOpening.cjs");
const core = require("../integration/coopFactionWarCore.cjs");

const STRIP_MINER = { typeID: 1, loadoutID: "ore_mining_venture_dual_miner",
  modules: [{ typeID: 483 }, { typeID: 483 }], charges: [{ typeID: 17938, quantityPerModule: 1 }] };
// A strip miner is a real module with a real charge, which is exactly why ORE
// looked armed; only a real weapon family counts.
const WEAPONS = new Set([13926]);
const isWeapon = (typeID) => WEAPONS.has(Number(typeID));
const TURRET = { typeID: 2, loadoutID: "guristas_light_missile_frigate",
  modules: [{ typeID: 13926 }], charges: [{ typeID: 27365, quantityPerModule: 80 }] };
const EMPTY_SDE = { typeID: 3, loadoutID: "retail_empty_npc_entity_loadout",
  modules: [], charges: [] };

test("a hull with no modules or no charge is not a navy", () => {
  assert.equal(evaluateNavy({ factionID: 500014, hulls: [EMPTY_SDE], isWeapon }).status, "NO_NAVY");
  assert.equal(evaluateNavy({ factionID: 500014, hulls: [], isWeapon }).status, "NO_NAVY");
  assert.equal(evaluateNavy({ factionID: 500014, hulls: [
    { typeID: 4, loadoutID: "x", modules: [{ typeID: 13926 }], charges: [] }], isWeapon }).status, "NO_NAVY");
  assert.equal(evaluateNavy({ factionID: 500014, hulls: [
    { typeID: 4, loadoutID: "x", modules: [{ typeID: 13926 }],
      charges: [{ typeID: 2, quantityPerModule: 0 }] }], isWeapon }).status, "NO_NAVY");
  // The strip miner carries a module and a charge and is still not a navy.
  assert.equal(evaluateNavy({ factionID: 500014, hulls: [STRIP_MINER], isWeapon }).status, "NO_NAVY");
  // With no weapon resolver at all nothing is a navy.
  assert.equal(evaluateNavy({ factionID: 500011, hulls: [TURRET] }).status, "NO_NAVY");
});

test("a real fitted hull with a real charge is a navy", () => {
  const out = evaluateNavy({ factionID: 500011, hulls: [TURRET], isWeapon });
  assert.equal(out.status, "CAN_FIELD");
  assert.equal(out.armedHulls, 1);
  assert.equal(out.hulls[0].loadoutID, "guristas_light_missile_frigate");
  assert.equal(evaluateNavy({ factionID: 0, hulls: [TURRET], isWeapon }).status, "INVALID_FACTION");
});

test("a border needs BOTH sides to be able to fight", () => {
  const navy = evaluateNavy({ factionID: 1, hulls: [TURRET], isWeapon });
  const miner = evaluateNavy({ factionID: 2, hulls: [STRIP_MINER], isWeapon });
  assert.deepEqual(decideFront({ attacker: navy, defender: miner }),
    { open: false, reason: "NO_NAVY_CAPABILITY:DEFENDER" });
  assert.deepEqual(decideFront({ attacker: miner, defender: navy }),
    { open: false, reason: "NO_NAVY_CAPABILITY:ATTACKER" });
  assert.deepEqual(decideFront({ attacker: navy, defender: navy }),
    { open: true, reason: "BOTH_SIDES_CAN_FIELD_NAVY" });
  assert.equal(decideFront({}).open, false, "an unknown capability is never a yes");
});

test("the authority adapter reads the real doctrine composition and caches it", () => {
  let composed = 0;
  const capability = createNavyCapability({
    compose: ({ factionID }) => {
      composed += 1;
      return factionID === 500011
        ? { status: "COMPOSED", ships: [{ loadoutID: "guristas_light_missile_frigate", hullTypeID: 2, role: "tackle" }] }
        : { status: "COMPOSED", ships: [{ loadoutID: "ore_mining_venture_dual_miner", hullTypeID: 1, role: "tackle" }] };
    },
    getLoadout: (id) => (id === "guristas_light_missile_frigate"
      ? { modules: TURRET.modules, charges: TURRET.charges }
      : { modules: STRIP_MINER.modules, charges: STRIP_MINER.charges }),
    isWeapon,
  });
  assert.equal(capability.faction(500011).status, "CAN_FIELD");
  assert.equal(capability.faction(500014).status, "NO_NAVY");
  capability.faction(500011);
  assert.equal(composed, 2, "each faction is composed once");
  assert.throws(() => createNavyCapability({}), /WAR_NAVY_CAPABILITY_AUTHORITIES_REQUIRED/);
});

// The planner gate itself: without it the ORE border is planned as a real war.
const STAR_GATES = {
  1: [{ itemID: 11, destinationID: 12, destinationSolarSystemID: 2, solarSystemID: 1 }],
  2: [{ itemID: 12, destinationID: 11, destinationSolarSystemID: 1, solarSystemID: 2 }],
};
const GATES = {
  11: { itemID: 11, destinationID: 12, solarSystemID: 1 },
  12: { itemID: 12, destinationID: 11, solarSystemID: 2 },
};
const presence = () => ({
  pilots: [
    { pilotID: "coop-pilot-001", systemID: 1, factionID: "500001" },
    { pilotID: "coop-pilot-002", systemID: 1, factionID: "500001" },
    { pilotID: "coop-pilot-003", systemID: 2, factionID: "500014" },
    { pilotID: "coop-pilot-004", systemID: 2, factionID: "500014" },
  ],
  skipped: [],
});
const planWith = (navyCapability) => opening.planWars({
  state: core.empty(), presence: presence(),
  getStargatesForSystem: (id) => STAR_GATES[id] || [],
  getGate: (id) => GATES[id] || null,
  nowMs: 1000, navyCapability,
});

test("the planner refuses a border whose party cannot field a navy", () => {
  const blocked = planWith(() => ({ open: false, reason: "NO_NAVY_CAPABILITY:DEFENDER" }));
  assert.equal(blocked.status, "REFUSED");
  assert.equal(blocked.reason, "NO_OPENABLE_FRONT");
  assert.equal(blocked.skipped[0].reason, "NO_NAVY_CAPABILITY:DEFENDER");
  const allowed = planWith(() => ({ open: true, reason: "BOTH_SIDES_CAN_FIELD_NAVY" }));
  assert.equal(allowed.status, "READY");
  assert.equal(allowed.openings.length, 1);
  // No authority at all keeps the previous behaviour byte for byte.
  assert.equal(planWith(null).status, allowed.status);
});
