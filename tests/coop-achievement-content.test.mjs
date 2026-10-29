import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Our achievement catalogue. In game the client parses this file with generated code and follows
// exactly two roots (Challenges, TimeLimited) plus the contribution methods, and names are
// localization message ids. The test below reads the buffer the same way, with a reader written
// separately from the builder, and asserts the shape the client's repository depends on.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const contentPath = path.join(forkRoot, "Code/server/src/space/coopAchievementContent.js");
const { buildAchievementData, content, CATEGORIES, METHODS, skillPointsFor, CDN_PATH } = require(contentPath);
const {
  ACHIEVEMENT_DEFINITION_PROTO_ROOT,
  createAchievementDefinitionGatewayService,
} = require(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/achievementDefinitionGatewayService.js"));
const API = "eve_public.achievement.definition.api.cdn";

function tableReader(buffer, pos) {
  const vtable = pos - buffer.readInt32LE(pos);
  const vtableSize = buffer.readUInt16LE(vtable);
  const field = (slot) => {
    const entryAt = 4 + slot * 2;
    if (entryAt >= vtableSize) return 0;
    const offset = buffer.readUInt16LE(vtable + entryAt);
    return offset === 0 ? 0 : pos + offset;
  };
  return {
    pos,
    field,
    string(slot) {
      const at = field(slot);
      if (!at) return null;
      const target = at + buffer.readUInt32LE(at);
      const length = buffer.readUInt32LE(target);
      return buffer.toString("utf8", target + 4, target + 4 + length);
    },
    uint8(slot) {
      const at = field(slot);
      return at ? buffer.readUInt8(at) : 0;
    },
    uint32(slot) {
      const at = field(slot);
      return at ? buffer.readUInt32LE(at) : 0;
    },
    // Target and SpReward.Quantity are uint64 in the client's generated reader. Reading them as
    // uint32 happens to return the same number and hides a wrong width, which is how the catalogue
    // shipped a uint32 target for one commit - see the client-reader check below.
    uint64(slot) {
      const at = field(slot);
      return at ? Number(buffer.readBigUInt64LE(at)) : 0;
    },
    table(slot) {
      const at = field(slot);
      return at ? tableReader(buffer, at + buffer.readUInt32LE(at)) : null;
    },
    vectorOfTables(slot) {
      const at = field(slot);
      if (!at) return [];
      const start = at + buffer.readUInt32LE(at);
      const count = buffer.readUInt32LE(start);
      return Array.from({ length: count }, (_, index) => {
        const element = start + 4 + index * 4;
        return tableReader(buffer, element + buffer.readUInt32LE(element));
      });
    },
  };
}

function root(buffer) {
  return tableReader(buffer, buffer.readUInt32LE(0));
}

test("the catalogue is one ACHV buffer whose roots the client's repository loads", () => {
  const buffer = Buffer.from(buildAchievementData());
  assert.equal(buffer.toString("utf8", 4, 8), "ACHV", "the flatbuffer identifier the client checks");

  const parsed = root(buffer);
  const challenges = parsed.table(1);
  const timeLimited = parsed.table(2);
  assert.ok(challenges, "Challenges() is read unconditionally and must exist");
  assert.ok(timeLimited, "TimeLimited() is read unconditionally and must exist");
  assert.equal(timeLimited.vectorOfTables(6).length, 0, "the time limited root holds no achievements yet");

  assert.equal(challenges.string(0), CATEGORIES[0].id);
  assert.ok(/^[0-9a-f]{32}$/.test(challenges.string(0)), "ids are uuid hex text, which uuid.UUID() accepts");
  assert.ok(challenges.uint32(1) > 0, "the name is a real localization message id, not text");
  assert.ok(challenges.uint32(2) > 0, "so is the description");
  assert.equal(challenges.string(7), "coop_operations");

  const entries = challenges.vectorOfTables(6);
  assert.equal(entries.length, CATEGORIES[0].achievements.length);
  const mining = entries[0];
  assert.equal(mining.string(0), CATEGORIES[0].achievements[0].id);
  assert.equal(mining.uint32(1), CATEGORIES[0].achievements[0].nameId);
  assert.equal(mining.string(13), "coop_mine_ore");

  const contribution = mining.table(6);
  assert.equal(contribution.string(0), "coop_cumulative");
  assert.deepEqual(contribution.vectorOfTables(1), [], "this method takes no parameters");

  const milestones = mining.vectorOfTables(7);
  assert.equal(milestones.length, 2);
  assert.equal(milestones[0].uint64(1), 1, "the first target is one unit of progress");
  assert.equal(milestones[0].uint32(2), 10, "category points");
  assert.equal(milestones[1].uint64(1), 100);
  assert.equal(milestones[1].string(4), "coop_mine_ore_hundred");
});

test("every milestone carries a skill point reward in the union the client reads", () => {
  const buffer = Buffer.from(buildAchievementData());
  const entries = root(buffer).table(1).vectorOfTables(6);

  for (const achievement of entries) {
    const milestones = achievement.vectorOfTables(7);
    assert.ok(milestones.length > 0, `${achievement.string(13)} has milestones`);
    for (const milestone of milestones) {
      const rewards = milestone.vectorOfTables(3);
      assert.equal(rewards.length, 1);
      const reward = rewards[0];
      assert.ok(/^[0-9a-f]{32}$/.test(reward.string(0)), "the reward id is a uuid too");
      assert.equal(reward.uint8(1), 2, "RewardPayload.SpReward");
      // Payload() is the union member table itself, which is where SpReward() is initialised.
      const payload = reward.table(2);
      assert.ok(payload, "the union payload table exists");
      assert.ok(payload.uint64(0) > 0, "SpReward.Quantity");
    }
  }
});

test("the contribution methods the achievements name are all published", () => {
  const buffer = Buffer.from(buildAchievementData());
  const methods = root(buffer).vectorOfTables(3);
  assert.equal(methods.length, METHODS.length);
  assert.equal(methods[0].string(0), "coop_cumulative");
  assert.equal(methods[0].uint8(7), 1, "ProgressConfig.CumulativeMode");
  assert.ok(methods[0].uint32(1) > 0 && methods[0].uint32(5) > 0, "real message ids");
  assert.ok(methods[0].table(8), "the cumulative config table itself is present");
});

test("the checkpoint describes the bytes it advertises", () => {
  const frozen = content();
  assert.equal(frozen.path, CDN_PATH);
  assert.match(frozen.url, /^https?:\/\/[^/]+\/elysian-eve\/achievements\/1\.0\.0\.achievements$/);
  assert.equal(frozen.buffer.toString("utf8", 4, 8), "ACHV");
  // A second call must hand back the same frozen object: url, version and CRC cannot drift apart.
  assert.equal(content(), frozen);
  assert.equal(frozen.crc, require("node:zlib").crc32(frozen.buffer) >>> 0);
});

test("claim pays the skill points the catalogue declares", () => {
  assert.equal(skillPointsFor(CATEGORIES[0].achievements[0].id), 3500);
  assert.equal(skillPointsFor(CATEGORIES[0].achievements[1].id), 1500);
  assert.equal(skillPointsFor("nonexistent"), 0);
});

test("the gateway checkpoint points at the file we serve, with its real CRC", () => {
  const served = content();
  const service = createAchievementDefinitionGatewayService({ achievementContent: served });
  assert.deepEqual(service.handledRequestTypes, [`${API}.GetLatestRequest`]);
  const result = service.handleRequest(`${API}.GetLatestRequest`, {
    payload: { value: Buffer.alloc(0) },
    authoritative_context: { identity: { character: { sequential: 7 } } },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.responseTypeName, `${API}.GetLatestResponse`);

  const body = ACHIEVEMENT_DEFINITION_PROTO_ROOT.lookupType(`${API}.GetLatestResponse`)
    .decode(result.responsePayloadBuffer);
  assert.equal(body.checkpoint.url, served.url);
  assert.equal(body.checkpoint.crc.crc, served.crc);
  assert.deepEqual(
    { major: body.checkpoint.version.major, minor: body.checkpoint.version.minor, patch: body.checkpoint.version.patch },
    { major: 1, minor: 0, patch: 0 },
  );
  // the checkpoint describes exactly these bytes, which is what the client verifies after download
  assert.equal(require("node:zlib").crc32(served.buffer) >>> 0, body.checkpoint.crc.crc);
  assert.equal(body.checkpoint.url.endsWith(CDN_PATH), true);
});

test("the field widths are the ones the client's own schema declares", () => {
  const schemaPath = path.join(process.cwd(), "docs/client-contracts/achievement-flatbuffer.json");
  const schema = JSON.parse(require("node:fs").readFileSync(schemaPath, "utf8"));
  const kindOf = (table, field) => schema[table] && schema[table].fields[field] && schema[table].fields[field].kind;
  // A reader that guesses these agrees with a writer that guesses the same way; only the schema
  // extracted from the client's generated Add functions is authoritative.
  assert.equal(kindOf("AchievementMilestone", "Target"), "uint64");
  assert.equal(kindOf("AchievementMilestone", "CategoryPoints"), "uint32");
  assert.equal(kindOf("SpReward", "Quantity"), "uint64");
  assert.equal(kindOf("Reward", "PayloadType"), "uint8");
  assert.equal(kindOf("Achievement", "Name"), "uint32");
  assert.equal(kindOf("Achievement", "ReleaseDateUnixMs"), "int64");
  assert.equal(kindOf("Achievement", "Archived"), "bool");
  assert.equal(kindOf("ContributionMethodDefinition", "ProgressType"), "uint8");
});
