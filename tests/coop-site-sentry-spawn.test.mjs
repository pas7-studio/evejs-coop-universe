import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Measured live 2026-11-04: site batteries are category 23 scenery with no weapon
// attributes and no controller, so they can never fire. The engine already has a native
// NPC profile for every real destructible sentry (229 measured in the container), so the
// honest bridge is: spawn one native sentry per battery, at the battery, of the site's own
// faction - and let the native behaviour/loadout do the shooting.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const spawner = require(path.join(forkRoot, "Code/server/src/space/coopSiteSentrySpawn.js"));

const PROFILES = [
  {profileID: "parity_destructible_sentry_guns_13116_blood_raider_sentry_gun",
    name: "Blood Raider Sentry Gun"},
  {profileID: "parity_destructible_sentry_guns_13068_guristas_sentry_gun",
    name: "Guristas Sentry Gun"},
];

function sceneWith(sessions, entities) {
  return {
    systemID: 30000144,
    sessions: new Map(sessions.map((id) => [id, {characterID: id}])),
    staticEntitiesByID: new Map(entities.map((entity) => [entity.itemID, entity])),
    dynamicEntities: new Map(),
  };
}

function battery(overrides = {}) {
  return {kind: "siteKillableStructure", dungeonMaterializedKillableStructure: true,
    itemID: 990000012301, dungeonSiteInstanceID: 77, dungeonSiteID: 9900000123,
    itemName: "Heavy Missile Battery", position: {x: 1000, y: 0, z: 0}, ...overrides};
}

function build({instances, template, spawnResult, observed} = {}) {
  const calls = [];
  const instance = spawner.createSentrySpawner({
    listInstances: () => instances,
    getTemplate: () => template,
    listProfiles: () => PROFILES,
    spawn: (systemID, options) => {
      calls.push({systemID, options});
      return spawnResult === undefined
        ? {success: true, data: {spawned: [{entityID: 4242}]}}
        : spawnResult;
    },
    observe: (...args) => { if (observed) observed.push(args); },
    clock: () => 1_800_000_000_000,
  });
  return {instance, calls};
}

const TEMPLATE = {populationHints: {encounters: [{key: "wave_1", spawnQuery: "blood_deadspace_pve"}]}};
const INSTANCES = [{instanceID: 77, lifecycleState: "active", templateID: "client-dungeon:47"}];

test("a battery in a live site spawns one native sentry of its own faction and size", () => {
  const observed = [];
  const {instance, calls} = build({instances: INSTANCES, template: TEMPLATE, observed});
  const result = instance.tick({systemID: 30000144, scene: sceneWith([140000005], [battery()]), instances: INSTANCES});
  assert.equal(result.status, "SENTRIES_SPAWNED");
  assert.equal(calls.length, 1, "exactly one native spawn");
  assert.equal(calls[0].options.profileQuery,
    "parity_destructible_sentry_guns_13116_blood_raider_sentry_gun");
  assert.deepEqual(calls[0].options.spawnStateOverride.position, {x: 1000, y: 0, z: 0},
    "the sentry stands exactly where the battery stands");
  assert.equal(calls[0].options.transient, true);
  assert.equal(result.spawned[0].entityID, 4242);
  assert.equal(observed.length, 1, "one observation event");
  assert.match(observed[0][3].evidence, /NOT_DAMAGE_PROOF/);
});

test("the same battery is never spawned twice", () => {
  const {instance, calls} = build({instances: INSTANCES, template: TEMPLATE});
  const scene = sceneWith([140000005], [battery()]);
  instance.tick({systemID: 30000144, scene, instances: INSTANCES});
  const second = instance.tick({systemID: 30000144, scene, instances: INSTANCES});
  assert.equal(calls.length, 1, "still one spawn");
  assert.equal(second.spawned.length, 0);
  assert.equal(instance.snapshot().length, 1);
});

test("an empty system never accumulates sentries", () => {
  const {instance, calls} = build({instances: INSTANCES, template: TEMPLATE});
  const result = instance.tick({systemID: 30000144, scene: sceneWith([], [battery()]), instances: INSTANCES});
  assert.equal(result.status, "NO_PLAYER_IN_SCENE");
  assert.equal(calls.length, 0);
});

test("a site without a known faction skips once, and says why", () => {
  const {instance, calls} = build({instances: INSTANCES, template: {populationHints: {encounters: []}}});
  const scene = sceneWith([140000005], [battery()]);
  const result = instance.tick({systemID: 30000144, scene, instances: INSTANCES});
  assert.equal(calls.length, 0);
  assert.equal(result.skipped[0].reason, "NOT_A_BATTERY_OR_NO_SENTRY_GUN_FACTION");
  instance.tick({systemID: 30000144, scene, instances: INSTANCES});
  assert.equal(result.skipped.length, 1, "a known non-candidate is not retried");
});

test("scenery that is not a battery is not a candidate at all", () => {
  assert.equal(spawner.isBatteryEntity(battery({itemName: "Cargo Rig"})), false);
  assert.equal(spawner.isBatteryEntity(battery({itemName: "Acceleration Gate"})), false);
  assert.equal(spawner.isBatteryEntity(battery()), true);
  const {instance, calls} = build({instances: INSTANCES, template: TEMPLATE});
  const result = instance.tick({systemID: 30000144,
    scene: sceneWith([140000005], [battery({itemName: "Cargo Rig"})]), instances: INSTANCES});
  assert.equal(result.status, "NO_BATTERIES");
  assert.equal(calls.length, 0);
});

test("a failed native spawn is reported, not retried into a spawn storm", () => {
  const {instance, calls} = build({instances: INSTANCES, template: TEMPLATE,
    spawnResult: {success: false, errorMsg: "NPC_NATIVE_SPAWN_FAILED"}});
  const scene = sceneWith([140000005], [battery()]);
  const first = instance.tick({systemID: 30000144, scene, instances: INSTANCES});
  assert.equal(first.spawned.length, 0);
  assert.equal(first.skipped[0].reason, "NPC_NATIVE_SPAWN_FAILED");
  instance.tick({systemID: 30000144, scene, instances: INSTANCES});
  assert.equal(calls.length, 1, "one attempt per battery");
});
