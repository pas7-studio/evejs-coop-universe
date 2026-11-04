import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Measured 2026-11-05: "Serpentis Warehouse" in a combat site is `structureProfiles` role
// "ambient" materialised as siteKillableStructure scenery - it has NO inventory row at all
// (`item rows named warehouse: 0`), so opening it is always empty, for every faction and
// every site. The templates DO carry populationHints.lootProfiles (pirate_combat_loot,
// combat_overseer_loot). This module fills a lootable structure from that profile, inside the
// structure's own itemID, once, using the site service's own loot generator.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const loot = require(path.join(forkRoot, "Code/server/src/space/coopSiteLootStructures.js"));

const PROFILES = {
  lootProfiles: [
    {key: "pirate_combat_loot", tags: ["faction_module", "pirate_tag"]},
    {key: "combat_overseer_loot", tags: ["overseer_effect"]},
  ],
};

function warehouse(overrides = {}) {
  return {kind: "siteKillableStructure", dungeonMaterializedKillableStructure: true,
    itemID: 990000444401, dungeonSiteID: 990000444, dungeonSiteInstanceID: 4129,
    itemName: "Serpentis Warehouse", position: {x: 10, y: 0, z: 0}, ...overrides};
}

function build({contents = [], entries = [{itemType: {typeID: 1234}, quantity: 2}], grantResult} = {}) {
  const granted = [];
  const observed = [];
  const filler = loot.createLootStructureFiller({
    listInstances: () => [{instanceID: 4129, lifecycleState: "active", templateID: "client-dungeon:51"}],
    getTemplate: () => ({templateID: "client-dungeon:51", resolvedName: "Serpentis Narcotic Warehouses"}),
    resolvePopulationHints: () => PROFILES,
    buildLootEntries: (container, hints) => {
      assert.equal(container.dungeonSiteContentLootProfile, "pirate_combat_loot",
        "the site's own pirate combat profile is preferred");
      return entries;
    },
    listContents: () => contents,
    grantItems: (ownerID, locationID, flagID, rows) => {
      granted.push({ownerID, locationID, flagID, rows: rows.length});
      return grantResult === undefined
        ? {success: true, data: {items: [{itemID: 7001}, {itemID: 7002}]}}
        : grantResult;
    },
    observe: (...args) => observed.push(args),
    clock: () => 1_800_000_000_000,
  });
  const scene = {systemID: 30001446, sessions: new Map([[1, {characterID: 1}]]),
    staticEntitiesByID: new Map(), dynamicEntities: new Map()};
  return {filler, scene, granted, observed};
}

test("a warehouse with no contents is filled from the site's own loot profile", () => {
  const {filler, scene, granted, observed} = build();
  scene.staticEntitiesByID.set(990000444401, warehouse());
  const result = filler.tick({systemID: 30001446, scene,
    instances: [{instanceID: 4129, lifecycleState: "active"}]});
  assert.equal(result.status, "STRUCTURES_FILLED");
  assert.equal(granted.length, 1);
  assert.deepEqual(granted[0], {ownerID: 1, locationID: 990000444401, flagID: 5, rows: 1},
    "loot goes into the structure's OWN item id, owned by the site, in the cargo flag");
  assert.equal(result.filled[0].profile, "pirate_combat_loot");
  assert.equal(result.filled[0].items, 2);
  assert.equal(observed.length, 1);
  assert.match(observed[0][3].evidence, /SITE_LOOT_PROFILE_GRANTED/);
});

test("a structure that already holds something is never filled twice", () => {
  const {filler, scene, granted} = build({contents: [{itemID: 9001}]});
  scene.staticEntitiesByID.set(990000444401, warehouse());
  const result = filler.tick({systemID: 30001446, scene,
    instances: [{instanceID: 4129, lifecycleState: "active"}]});
  assert.equal(granted.length, 0);
  assert.equal(result.filled.length, 0);
  // Even after the contents are emptied by a player, the same structure is not re-seeded.
  const again = filler.tick({systemID: 30001446, scene,
    instances: [{instanceID: 4129, lifecycleState: "active"}]});
  assert.equal(granted.length, 0);
  assert.equal(again.status, "STRUCTURES_PRESENT");
});

test("scenery that is not a warehouse is not touched", () => {
  assert.equal(loot.isLootableStructure(warehouse({itemName: "Serpentis Bunker"})), false);
  assert.equal(loot.isLootableStructure(warehouse({itemName: "Acceleration Gate"})), false);
  assert.equal(loot.isLootableStructure(warehouse({itemName: "Storage Warehouse"})), true);
  const {filler, scene, granted} = build();
  scene.staticEntitiesByID.set(990000444401, warehouse({itemName: "Serpentis Bunker"}));
  const result = filler.tick({systemID: 30001446, scene,
    instances: [{instanceID: 4129, lifecycleState: "active"}]});
  assert.equal(result.status, "NO_LOOTABLE_STRUCTURES");
  assert.equal(granted.length, 0);
});

test("an empty system, an inactive instance and a template without loot all say why", () => {
  const noPlayer = build();
  noPlayer.scene.sessions.clear();
  noPlayer.scene.staticEntitiesByID.set(990000444401, warehouse());
  assert.equal(noPlayer.filler.tick({systemID: 30001446, scene: noPlayer.scene,
    instances: [{instanceID: 4129, lifecycleState: "active"}]}).status, "NO_PLAYER_IN_SCENE");

  const inactive = build();
  inactive.scene.staticEntitiesByID.set(990000444401, warehouse());
  const result = inactive.filler.tick({systemID: 30001446, scene: inactive.scene,
    instances: [{instanceID: 4129, lifecycleState: "closed"}]});
  assert.equal(result.status, "NO_ACTIVE_INSTANCE",
    "a closed instance is never filled; no per-structure work is even attempted");
  assert.equal(inactive.granted.length, 0);

  const noProfile = build();
  noProfile.scene.staticEntitiesByID.set(990000444401, warehouse());
  assert.equal(loot.pickLootProfile({}), null, "a template with no lootProfiles has no profile");
  assert.equal(loot.pickLootProfile(PROFILES).key, "pirate_combat_loot",
    "the site's pirate combat profile is preferred");
  assert.equal(loot.pickLootProfile({lootProfiles: [{key: "combat_overseer_loot"}]}).key,
    "combat_overseer_loot", "an overseer-only site still has a profile");
});

test("a refused grant is reported, not retried into a loot fountain", () => {
  const {filler, scene, granted} = build({grantResult: {success: false, errorMsg: "CONTAINER_FULL"}});
  scene.staticEntitiesByID.set(990000444401, warehouse());
  const result = filler.tick({systemID: 30001446, scene,
    instances: [{instanceID: 4129, lifecycleState: "active"}]});
  assert.equal(result.skipped[0].reason, "CONTAINER_FULL");
  filler.tick({systemID: 30001446, scene, instances: [{instanceID: 4129, lifecycleState: "active"}]});
  assert.equal(granted.length, 1, "one grant attempt per structure");
});
