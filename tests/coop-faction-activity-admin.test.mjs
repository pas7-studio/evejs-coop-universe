import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// eve_public.faction.activity.admin.{Increment,Set}ContributionScore is the
// customer-support knob behind /advantage. Before this it answered a default 200
// while the read side kept the derived score, so an admin change vanished. The
// adjustment now lives in one ledger that coopWarAdvantage applies to BOTH client
// surfaces (advantage panel and victory-point bar).
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const modulePath = path.join(forkRoot, "Code/server/src/space/coopFactionActivityAdmin.js");
const {createFactionActivityAdmin, MAX_POINTS, validate} = require(modulePath);

function memoryStore() {
  const rows = new Map();
  return {
    read(table, pth) {
      const value = rows.get(`${table}${pth}`);
      return value ? {success: true, data: structuredClone(value)} : {success: false, data: null};
    },
    write(table, pth, data) {
      rows.set(`${table}${pth}`, structuredClone(data));
      return {success: true};
    },
    rows,
  };
}

test("an increment adds to the derived score without replacing it", () => {
  const admin = createFactionActivityAdmin({gameStore: memoryStore()});
  const result = admin.increment({systemID: 30000144, factionID: 500001, adjustment: 2500, derived: 1000});
  assert.equal(result.status, "APPLIED");
  assert.equal(result.contribution, 3500);
  assert.equal(admin.effective(30000144, 500001, 1000), 3500);
});

test("a set replaces the derived score and later increments still apply", () => {
  const admin = createFactionActivityAdmin({gameStore: memoryStore()});
  admin.setOverride({systemID: 30000144, factionID: 500001, override: 40000});
  assert.equal(admin.effective(30000144, 500001, 999999), 40000,
    "the override wins over whatever the war derives");
  admin.increment({systemID: 30000144, factionID: 500001, adjustment: 5000, derived: 0});
  assert.equal(admin.effective(30000144, 500001, 0), 45000);
});

test("adjustments are clamped into the client's 0..100000 domain", () => {
  const admin = createFactionActivityAdmin({gameStore: memoryStore()});
  admin.setOverride({systemID: 30000144, factionID: 500001, override: 999999});
  assert.equal(admin.effective(30000144, 500001, 0), MAX_POINTS);
  admin.increment({systemID: 30000144, factionID: 500001, adjustment: -500000, derived: 0});
  assert.equal(admin.effective(30000144, 500001, 0), 0,
    "a negative delta floors at zero, never a negative contribution");
});

test("scores for a system nobody adjusted are returned untouched", () => {
  const admin = createFactionActivityAdmin({gameStore: memoryStore()});
  const scores = [{factionID: 500001, contribution: 1000}, {factionID: 500002, contribution: 2000}];
  assert.deepEqual(admin.applyScores(30000144, scores), scores);
  admin.increment({systemID: 30000144, factionID: 500002, adjustment: 500, derived: 2000});
  const adjusted = admin.applyScores(30000144, scores);
  assert.equal(adjusted[0].contribution, 1000, "the other faction is untouched");
  assert.equal(adjusted[1].contribution, 2500);
});

test("a corrupt ledger is refused, not silently reset", () => {
  const store = memoryStore();
  store.write("corporationRuntime", "/coop-faction-war/activity-adjustments-v1", {
    version: 1,
    bySystem: {"30000144": {500001: {override: -5, delta: 0}}},
  });
  const admin = createFactionActivityAdmin({gameStore: store});
  assert.throws(() => admin.readState(), /FACTION_ACTIVITY_ADJUSTMENTS_OVERRIDE_INVALID/);
  assert.throws(() => validate({version: 1, bySystem: []}), /FACTION_ACTIVITY_ADJUSTMENTS_INVALID/);
});

test("the write side is the same record the war snapshot reads", () => {
  const source = require("node:fs").readFileSync(
    path.join(forkRoot, "Code/server/src/space/coopWarAdvantage.js"), "utf8");
  assert.match(source, /adjustScores\(systemID, factions\.map/,
    "the snapshot must apply the admin ledger to the derived scores");
  const gateway = require("node:fs").readFileSync(
    path.join(forkRoot,
      "Code/server/src/_secondary/express/gatewayServices/fwAdvantageGatewayService.js"),
    "utf8");
  assert.match(gateway, /eve_public\.faction\.activity\.admin\.IncrementContributionScoreRequest/);
  assert.match(gateway, /eve_public\.faction\.activity\.admin\.SetContributionScoreRequest/);
  assert.match(gateway, /is not part of the advantage war/,
    "an adjustment for a pair nobody reads must be refused, not stored");
});

test("the admin messages really resolve in the private proto root", () => {
  // Regression: the first version nested `activity` directly under eve_public
  // instead of eve_public.faction, so the admin request type did not exist and
  // the handler threw out to the transport instead of answering.
  const protobuf = require(path.join(forkRoot, "Code/server/node_modules/protobufjs"));
  const {createFwAdvantageGatewayService} = require(path.join(forkRoot,
    "Code/server/src/_secondary/express/gatewayServices/fwAdvantageGatewayService.js"));
  const protoRoot = protobuf.Root.fromJSON({nested: {eve_public: {nested: {faction: {nested: {
    activity: {nested: {
      GetSolarSystemScoresRequest: {fields: {solar_system: {type: "uint64", id: 1}}},
      GetSolarSystemScoresResponse: {fields: {solar_system: {type: "uint64", id: 1}}},
    }},
  }}}}}});
  const service = createFwAdvantageGatewayService({protoRoot});
  assert.ok(service.handledRequestTypes.includes(
    "eve_public.faction.activity.admin.IncrementContributionScoreRequest"));
  const result = service.handleRequest(
    "eve_public.faction.activity.admin.IncrementContributionScoreRequest",
    {payload: {value: Buffer.alloc(0)}},
  );
  assert.equal(result.statusCode, 3, "an empty request is refused with a reason, not a crash");
  assert.match(result.statusMessage, /target_system is required/);
});

test("uint64 target ids survive decode (a Long is not a Number)", () => {
  // Regression: the decoded uint64 arrives as a Long object, and Number(Long) is
  // NaN, so every real admin request was refused as "target_system is required".
  const protobuf = require(path.join(forkRoot, "Code/server/node_modules/protobufjs"));
  const {createFwAdvantageGatewayService} = require(path.join(forkRoot,
    "Code/server/src/_secondary/express/gatewayServices/fwAdvantageGatewayService.js"));
  const protoRoot = protobuf.Root.fromJSON({nested: {eve_public: {nested: {faction: {nested: {
    activity: {nested: {
      GetSolarSystemScoresRequest: {fields: {solar_system: {type: "uint64", id: 1}}},
      GetSolarSystemScoresResponse: {fields: {solar_system: {type: "uint64", id: 1}}},
    }},
  }}}}}});
  const service = createFwAdvantageGatewayService({protoRoot});
  // keepCase: protobuf.parse renames snake_case fields to camelCase by default,
  // which silently drops the target_* ids from the encoded request.
  const requestRoot = protobuf.parse(`
syntax = "proto3";
message Ident { uint64 sequential = 1; }
message AdminReq { Ident target_system = 1; Ident target_faction = 2; int32 adjustment = 3; }
`, {keepCase: true}).root;
  const type = requestRoot.lookupType("AdminReq");
  const payload = Buffer.from(type.encode(type.create({
    target_system: {sequential: 30000144},
    target_faction: {sequential: 500001},
    adjustment: 100,
  })).finish());
  const result = service.handleRequest(
    "eve_public.faction.activity.admin.IncrementContributionScoreRequest",
    {payload: {value: payload}},
  );
  assert.doesNotMatch(result.statusMessage, /required/, result.statusMessage);
  assert.match(result.statusMessage, /advantage war is not running/,
    "the ids decoded; only the war state is missing in a unit test");
});
