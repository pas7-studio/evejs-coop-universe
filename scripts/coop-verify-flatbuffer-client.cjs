#!/usr/bin/env node
"use strict";
// Verify a flatbuffer our server publishes by parsing it with the CLIENT'S OWN generated reader.
//
// Why this exists: our tests read the buffer with a reader we wrote, so the same wrong assumption
// about a field width appears on both sides and passes. That is exactly what happened to the
// achievement catalogue - Target is uint64 in the client and we wrote uint32, and our own reader
// agreed with us. Running the client's generated module instead is the only check that cannot make
// the same mistake twice.
//
// The generated module is CCP code: it is fetched from the local client archive into a temp
// directory at run time and is never written into this repository. Only the parse result is ours.
//
// Usage: node scripts/coop-verify-flatbuffer-client.cjs achievement
//   needs python3 with the `flatbuffers` package on PATH, and the client archive reachable by
//   scripts/coop-client-code.py. When either is missing the script says SKIPPED, never PASS.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const tempDir = path.join(
  process.env.TEMP || process.env.TMP || os.tmpdir(),
  "opencode",
  "client-readers",
);

const TARGETS = {
  achievement: {
    module: "achievement_system/client/model/flatbuffer/generated.pyj",
    rootModule: path.join(process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs",
      "Code/server/src/space/coopAchievementContent.js"),
    builder: "buildAchievementData",
    script: `
import importlib.util, struct
spec = importlib.util.spec_from_file_location("client_reader", READER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
data = bytearray(open(BUFFER, "rb").read())
assert bytes(data[4:8]) == b"ACHV", "identifier"
root = module.AchievementData.GetRootAsAchievementData(data, 0)
challenges = root.Challenges()
time_limited = root.TimeLimited()
assert challenges is not None and time_limited is not None, "both roots exist"
assert root.ContributionMethodsLength() >= 1, "a contribution method"
rows = []
for index in range(challenges.AchievementsLength()):
    achievement = challenges.Achievements(index)
    milestones = []
    for milestone_index in range(achievement.MilestonesLength()):
        milestone = achievement.Milestones(milestone_index)
        rewards = []
        for reward_index in range(milestone.RewardsLength()):
            reward = milestone.Rewards(reward_index)
            if reward.PayloadType() == module.RewardPayload.SpReward:
                payload = module.SpReward()
                payload.Init(reward.Payload().Bytes, reward.Payload().Pos)
                rewards.append(payload.Quantity())
        milestones.append({"target": milestone.Target(),
                           "points": milestone.CategoryPoints(),
                           "sp": rewards})
    rows.append({"name": achievement.Name(),
                 "method": achievement.Contribution().MethodId().decode(),
                 "milestones": milestones})
print(json.dumps({"roots": [challenges.Id().decode(), time_limited.Id().decode()],
                  "achievements": rows}))
`,
    validate(parsed) {
      const problems = [];
      for (const achievement of parsed.achievements) {
        if (!achievement.name) problems.push("a name is a real message id");
        if (achievement.method !== "coop_cumulative") problems.push(`method ${achievement.method}`);
        achievement.milestones.forEach((milestone) => {
          if (milestone.target <= 0) problems.push("target reads as a real number");
          if (milestone.sp.length !== 1 || milestone.sp[0] <= 0) problems.push("one SP reward");
        });
      }
      return problems;
    },
  },
};

function pythonAvailable() {
  try {
    execFileSync("python", ["-c", "import flatbuffers"], { stdio: "ignore" });
    return true;
  } catch (_error) {
    return false;
  }
}

function main() {
  const name = process.argv[2] || "achievement";
  const target = TARGETS[name];
  if (!target) {
    console.log(`UNKNOWN_TARGET ${name}`);
    return 1;
  }
  if (!pythonAvailable()) {
    console.log("SKIPPED python3 with the flatbuffers package is not available");
    return 0;
  }

  fs.mkdirSync(tempDir, { recursive: true });
  const readerPath = path.join(tempDir, `${name}-generated.py`);
  try {
    const source = execFileSync(
      "python",
      ["scripts/coop-client-code.py", "--module", target.module],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    // The decompiler leaves a module-level `return` at the end of the file, which Python 3 rejects.
    const cleaned = source.split("\n").filter((line) => line.trim() !== "return" || /^[\s]/.test(line));
    fs.writeFileSync(readerPath, cleaned.join("\n"));
  } catch (error) {
    console.log(`SKIPPED the client archive is not readable: ${String(error.message).split("\n")[0]}`);
    return 0;
  }

  const built = execFileSync(process.execPath, ["-e", `
const { ${target.builder} } = require(${JSON.stringify(target.rootModule)});
process.stdout.write(${target.builder}());
`], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  const bufferPath = path.join(tempDir, `${name}.bin`);
  fs.writeFileSync(bufferPath, built);

  const script = `
import json
READER = ${JSON.stringify(readerPath)}
BUFFER = ${JSON.stringify(bufferPath)}
${target.script}`;
  const scriptPath = path.join(tempDir, `${name}-parse.py`);
  fs.writeFileSync(scriptPath, script);
  const output = execFileSync("python", [scriptPath], { encoding: "utf8" });
  const parsed = JSON.parse(output.trim().split("\n").pop());

  const problems = target.validate(parsed);
  console.log(`CLIENT_READER bytes=${built.length} roots=${parsed.roots.join(",")} achievements=${parsed.achievements.length}`);
  for (const achievement of parsed.achievements) {
    console.log(`  ${achievement.name} method=${achievement.method} targets=${achievement.milestones.map((m) => m.target).join("/")} sp=${achievement.milestones.map((m) => m.sp.join("+")).join("/")}`);
  }
  if (problems.length) {
    console.log(`CLIENT_READER_PROBLEMS ${problems.join("; ")}`);
    return 1;
  }
  console.log("CLIENT_READER_OK");
  return 0;
}

process.exit(main());
