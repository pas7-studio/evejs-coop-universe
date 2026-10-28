#!/usr/bin/env node
// Operator tool: run one real NPC manufacturing job on the co-op world.
//
// It uses the native blueprint recipe and the native inventory primitives, and it
// refuses unless the corporation really owns the blueprint ITEM and the materials in
// the hangar of that station. Nothing is fabricated: every run leaves a journal under
// /var/lib/evejs/coop-native-industry (jobs/ + receipts/).
//
// Inside the server container:
//   docker cp scripts/manufacture-npc-item.cjs evejs-agents-server-1:/tmp/mf.cjs
//   docker exec evejs-agents-server-1 node /tmp/mf.cjs --seed 1076 --station 60014935
//   docker exec evejs-agents-server-1 node /tmp/mf.cjs --blueprint 1076 --runs 5 \
//     --station 60014935 --system 30000145 --wait
"use strict";
const path = require("node:path");

const SERVER_ROOT = process.env.EVEJS_SERVER_ROOT || "/app/server";
process.env.EVEJS_COOP_NPC_MANUFACTURE = process.env.EVEJS_COOP_NPC_MANUFACTURE || "1";

function arg(name, fallback = null) {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}
const ownerID = Number(arg("owner", process.env.EVEJS_COOP_FACTORY_CORP_ID || 1000129));
const stationID = Number(arg("station", 0));
const systemID = Number(arg("system", 0));
const seedType = Number(arg("seed", 0));
const blueprintType = Number(arg("blueprint", 0));
const runs = Number(arg("runs", 1));
const wait = arg("wait", false) === true;

let manufacture;
try {
  manufacture = require(path.join(SERVER_ROOT, "src/space/coopNpcManufacture"));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: "IMPORT_FAILED:" + String((error && error.message) || error).slice(0, 200) }));
  process.exit(2);
}

const out = [];
function report(step, value) { out.push({ step, ...value }); }

(async () => {
  if (seedType > 0) {
    report("seed", manufacture.seedBlueprint({ ownerID, stationID, blueprintTypeID: seedType, systemID }));
  }
  if (blueprintType > 0) {
    report("recipe", manufacture.recipe(blueprintType, runs));
    const installed = manufacture.install({ ownerID, stationID, blueprintTypeID: blueprintType, runs, systemID });
    report("install", installed);
    if (installed.status !== "INSTALLED") {
      console.log(JSON.stringify({ ok: false, steps: out }, null, 2));
      process.exit(1);
    }
    if (wait) {
      const deadline = Date.now() + 5 * 60 * 1000;
      let done = false;
      while (Date.now() < deadline) {
        const result = manufacture.tick({ now: Date.now() });
        if (result.completed && result.completed.length) {
          report("tick", result);
          done = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!done) report("tick", { status: "TIMEOUT" });
    } else {
      report("tick", manufacture.tick({}));
    }
  }
  const ok = out.every((entry) => !entry.status || ["SEEDED", "READY", "INSTALLED", "COMPLETED", "IDLE", "ALREADY_HELD"].includes(String(entry.status)));
  console.log(JSON.stringify({ ok, steps: out }, null, 2));
  process.exit(ok ? 0 : 1);
})();
