import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Measured on a live native spawn (agents stack, 2026-11-05): the sentry entity is real
// (typeID 17575, kind "ship", controller with the retail behaviour profile) but the retail
// loadout is empty, so it carries ZERO weapon modules and can never fire itself. The
// sentry TYPE does carry real weapon attributes, and this module fires those through the
// engine's own damage path (space/runtime applyWeaponDamageToTarget), so client damage
// notifications, destruction and kill attribution stay native. No damage number is
// written in the module: a type without damage attributes never fires.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const fire = require(path.join(forkRoot, "Code/server/src/space/coopSiteSentryFire.js"));

// Real measured dogma attributes.
const BLOOD_SENTRY = {114: 4, 116: 1, 117: 1, 118: 4, 64: 8, 51: 8000, 479: 500000};
const EMPTY_BATTERY = {114: 0, 116: 0, 117: 0, 118: 0, 64: 3.5, 51: 20000000, 479: 250000};

function playerShip(itemID, position, characterID = 140000005) {
  return {kind: "ship", itemID, position, session: {characterID}};
}

function build({attributes = {13116: BLOOD_SENTRY}, applyResult = {damageResult: {success: true}}} = {}) {
  const shots = [];
  const observed = [];
  const sentries = [{entityID: 9001, systemID: 30000144}];
  const entities = new Map([
    [9001, {kind: "ship", itemID: 9001, typeID: 13116, position: {x: 0, y: 0, z: 0}}],
  ]);
  const clock = {now: 1_800_000_000_000};
  const scene = {
    systemID: 30000144,
    dynamicEntities: new Map(),
    staticEntitiesByID: new Map(),
  };
  const director = fire.createSentryFire({
    listSentries: () => sentries,
    getEntity: (givenScene, entityID) => entities.get(entityID) || null,
    readAttributes: (typeID) => attributes[typeID] || {},
    applyDamage: (givenScene, attacker, target, damage, nowMs) => {
      shots.push({attacker: attacker.itemID, target: target.itemID, damage, nowMs});
      return applyResult;
    },
    observe: (...args) => observed.push(args),
    clock: () => clock.now,
  });
  return {director, scene, shots, observed, clock, entities};
}

test("a sentry fires the type's own damage numbers, once per cycle, at the nearest player", () => {
  const {director, scene, shots, observed, clock} = build();
  scene.dynamicEntities.set(1, playerShip(5001, {x: 1000, y: 0, z: 0}));
  scene.dynamicEntities.set(2, playerShip(5002, {x: 30000, y: 0, z: 0}));
  const first = director.tick({systemID: 30000144, scene});
  assert.equal(first.status, "SENTRIES_FIRED");
  assert.equal(shots.length, 1, "one shot in one cycle");
  assert.equal(shots[0].target, 5001, "the nearest ship is the target");
  assert.deepEqual(shots[0].damage, {em: 32, explosive: 8, kinetic: 8, thermal: 32},
    "damage 4/1/1/4 x multiplier 8, straight from the type's attributes");
  // Second tick inside the cycle: nothing fires.
  clock.now += 4000;
  const second = director.tick({systemID: 30000144, scene});
  assert.equal(shots.length, 1);
  assert.equal(second.status, "SENTRIES_READY");
  // Past the cycle: fires again.
  clock.now += 4001;
  director.tick({systemID: 30000144, scene});
  assert.equal(shots.length, 2);
  assert.equal(observed.length, 2, "each shot is observed");
  assert.match(observed[0][3].evidence, /NATIVE_DAMAGE_PATH/);
});

test("a type without damage attributes never fires", () => {
  const {director, scene, shots} = build({attributes: {13116: EMPTY_BATTERY},});
  scene.dynamicEntities.set(1, playerShip(5001, {x: 1000, y: 0, z: 0}));
  const result = director.tick({systemID: 30000144, scene});
  assert.equal(shots.length, 0);
  assert.equal(result.skipped[0].reason, "NO_WEAPON_ATTRIBUTES");
});

test("no player in the scene means no shot, and a ship out of range is not fired at", () => {
  const empty = build();
  assert.equal(empty.director.tick({systemID: 30000144, scene: empty.scene}).status,
    "NO_PLAYER_IN_SCENE");
  const far = build();
  far.scene.dynamicEntities.set(1, playerShip(5001, {x: 400000, y: 0, z: 0}));
  const result = far.director.tick({systemID: 30000144, scene: far.scene});
  assert.equal(far.shots.length, 0, "400 km is beyond the sentry's 250 km clamp");
  assert.equal(result.skipped[0].reason, "NO_TARGET_IN_RANGE");
});

test("NPC hulls and non-ship entities are never targets", () => {
  assert.equal(fire.isPlayerShip({kind: "ship", itemID: 5, position: {}, session: {}}), false,
    "an NPC ship has no session character");
  assert.equal(fire.isPlayerShip({kind: "drone", itemID: 5, position: {}, session: {characterID: 7}}),
    false);
  assert.equal(fire.isPlayerShip(playerShip(5, {x: 0, y: 0, z: 0})), true);
});

test("the profile clamps absurd data instead of trusting it", () => {
  const profile = fire.weaponProfile({114: 1, 64: 1, 51: 0, 479: 0});
  assert.equal(profile.cycleMs, 1000, "a missing rate of fire is floored");
  assert.equal(profile.rangeMeters, 5000, "a missing range is floored");
  const clamped = fire.weaponProfile({114: 1, 64: 1, 51: 90000000, 479: 50000000});
  assert.equal(clamped.cycleMs, 60000);
  assert.equal(clamped.rangeMeters, 250000);
  assert.equal(fire.weaponProfile(EMPTY_BATTERY), null);
});
