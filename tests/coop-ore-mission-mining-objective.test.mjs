// ORE-style mission sites (e.g. client-dungeon:13338 "ORE Phased Field Operation Site", the target of
// the native mission "The Missing Pilot") used to materialize empty: their static template declares
// resourceComposition.oreTypeIDs but no populationHints.miningRocks and no objectiveQuantity, and their
// siteFamily is "combat", so the mission-context derivation in dungeonUniverseSiteService was skipped and
// no rock, no objective and no completion path existed.
//
// The derivation itself lives in dungeonMissionMiningObjective.js, which has no game-store, scene or
// session dependency, so it is unit tested directly here. What this test proves is the data shape the
// materializer consumes (buildMiningRockEntities -> miningRuntimeState -> processMiningObjective).
// It does NOT claim live in-client gameplay: that needs the owner's client on the site.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { deriveMiningObjectiveFromResources, declaresMiningObjective } = require(
  `${forkRoot}/Code/server/src/services/dungeon/dungeonMissionMiningObjective.js`,
);

const oreSite = {
  templateID: "client-dungeon:13338",
  sourceDungeonID: 13338,
  siteFamily: "combat",
  siteKind: "signature",
  resolvedName: "ORE Phased Field Operation Site",
  resourceComposition: { oreTypeIDs: [1228, 1230], gasTypeIDs: [], iceTypeIDs: [], hasAnyResources: true },
};

test("an ORE mission site derives mineable rocks from its declared ore", () => {
  const mining = deriveMiningObjectiveFromResources(oreSite);
  assert.equal(mining.miningRocks.length, 2, "one rock spec per declared ore type");
  assert.deepEqual(
    mining.miningRocks.map((rock) => rock.typeID).sort((a, b) => a - b),
    [1228, 1230],
  );
  for (const rock of mining.miningRocks) {
    assert.ok(rock.count > 0, "each derived spec spawns at least one asteroid");
    assert.ok(rock.quantity > 0, "each derived asteroid carries ore");
  }
  assert.equal(
    mining.objectiveQuantity,
    mining.miningRocks.reduce((sum, rock) => sum + (rock.count * rock.quantity), 0),
    "the mining objective equals the total ore the site can yield",
  );
});

test("a site with no declared ore gains no mining objective", () => {
  const combat = {
    templateID: "client-dungeon:875",
    siteFamily: "combat",
    siteKind: "combat",
    populationHints: { encounters: [{ key: "wave_01", spawnQuery: "npc_deadspace_hostiles", amount: 9 }] },
  };
  const mining = deriveMiningObjectiveFromResources(combat);
  assert.equal(mining.miningRocks.length, 0);
  assert.equal(mining.objectiveQuantity, 0);
});

test("gas-only or ice-only compositions do not invent ore rocks", () => {
  const gasSite = { resourceComposition: { oreTypeIDs: [], gasTypeIDs: [30370], hasAnyResources: true } };
  const mining = deriveMiningObjectiveFromResources(gasSite);
  assert.equal(mining.miningRocks.length, 0);
  assert.equal(mining.objectiveQuantity, 0);
});

test("junk input never throws and never yields an objective", () => {
  for (const input of [null, undefined, {}, { resourceComposition: null }, { resourceComposition: { oreTypeIDs: ["x", -1, 0] } }]) {
    const mining = deriveMiningObjectiveFromResources(input);
    assert.equal(mining.miningRocks.length, 0);
    assert.equal(mining.objectiveQuantity, 0);
  }
});

// The owner's report: a mining mission showed Complete although he had mined
// nothing. The site's objective had been satisfied by the destroyed-target path
// once its defenders were gone (a world restart pruned them). Ore must be the only
// way to satisfy a site that declares a mining objective.
test("a site that declares an ore objective is finished by mining, not by kills", () => {
  const oreSite = { miningRocks: [{ typeID: 1228, count: 1, quantity: 500 }], objectiveQuantity: 1000 };
  assert.equal(declaresMiningObjective(oreSite), true);
  assert.equal(declaresMiningObjective({ miningRocks: [{ typeID: 1228, count: 1, quantity: 500 }] }), false);
  assert.equal(declaresMiningObjective({ objectiveQuantity: 0 }), false);
  assert.equal(declaresMiningObjective(null), false);
  assert.equal(declaresMiningObjective({ objectiveQuantity: "1000" }), true);
});

