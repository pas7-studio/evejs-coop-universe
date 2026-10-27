"use strict";
// Read-only audit of agent-mission dungeon templates, run INSIDE a server container:
//
//   docker cp scripts/audit-agent-mission-waves.cjs evejs-agents-server-1:/tmp/a.cjs
//   docker exec evejs-agents-server-1 node /tmp/a.cjs [maxRows]
//
// Question it answers: which mission dungeons spawn more than one wave, how many
// hulls that really is, and which of those waves carry no triggerMessages (so the
// client is never told the wave exists). It also reports missions that reference a
// dungeon but can never be completed because the template has no encounter plan.
const fs = require("node:fs");

const DATA = "/var/lib/evejs/gameStore/data";
const MAX_ROWS = Math.max(1, Number(process.argv[2]) || 12);

function load(name) {
  const file = `${DATA}/${name}/data.json`;
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error("LOAD_FAILED " + name + " " + error.message);
    return null;
  }
}

function walk(value, visit) {
  const stack = [value];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    visit(node);
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === "object") stack.push(child);
    }
  }
}

function text(value) {
  return String(value === undefined || value === null ? "" : value);
}

// One row per dungeon template that has a real encounter plan.
function dungeonRows(dungeonAuthority) {
  const rows = [];
  walk(dungeonAuthority, (node) => {
    const hints = node && node.populationHints;
    const plans = hints && Array.isArray(hints.encounters) ? hints.encounters : null;
    if (!plans || plans.length <= 0) return;
    const templateID = text(node.templateID);
    if (!templateID) return;
    const waves = plans
      .filter((plan) => plan && plan.supported !== false)
      .map((plan) => ({
        key: text(plan.key),
        waveIndex: Number(plan.waveIndex) || 0,
        hulls: Number(plan.amount) || (Array.isArray(plan.spawnEntries) ? plan.spawnEntries.length : 0),
        trigger: text(plan.trigger),
        messages: Array.isArray(plan.triggerMessages) ? plan.triggerMessages.length : 0,
      }));
    if (waves.length <= 1) return;
    const hulls = waves.reduce((sum, wave) => sum + wave.hulls, 0);
    rows.push({
      templateID,
      name: text(node.resolvedName) || text(node.dungeonNameID) || templateID,
      sourceDungeonID: Number(node.sourceDungeonID) || 0,
      siteKind: text(hints.siteKind) || text(node.siteKind),
      siteFamily: text(hints.siteFamily) || text(node.siteFamily),
      waves: waves.length,
      hulls,
      silentWaves: waves.filter((wave) => wave.messages === 0).length,
      maxWaveIndex: waves.reduce((max, wave) => Math.max(max, wave.waveIndex), 0),
      triggers: [...new Set(waves.map((wave) => wave.trigger))].join("+"),
    });
  });
  return rows;
}

// Missions that point at a dungeon: reward + level, so effort can be compared.
function missionIndex(missionAuthority) {
  const byDungeon = new Map();
  walk(missionAuthority, (node) => {
    if (!node || typeof node !== "object") return;
    const templateMatch = /^client-dungeon:(\d+)$/.exec(text(node.missionTemplateID));
    const dungeonID = Number(node.dungeonID || node.sourceDungeonID || (templateMatch ? templateMatch[1] : 0));
    if (!dungeonID) return;
    const rewards = node.rewards && typeof node.rewards === "object" ? node.rewards : null;
    const isk = rewards ? Number(rewards.isk || rewards.rewardISK || 0) : 0;
    const bonus = rewards ? Number(rewards.bonusIsk || 0) : 0;
    const lp = rewards ? Number(rewards.loyaltyPoints || 0) : 0;
    const level = Number(node.level || (node.missionLevel || 0));
    if (!rewards && !level) return;
    const entry = { name: text(node.missionTitle || node.name || node.missionNameID || node.templateID), isk, bonus, lp, level };
    const list = byDungeon.get(dungeonID) || [];
    if (!list.some((item) => item.name === entry.name && item.isk === entry.isk)) list.push(entry);
    byDungeon.set(dungeonID, list);
  });
  return byDungeon;
}

// Rewards for dungeons the world has really offered live: static missionAuthority
// does not link a mission to its dungeon (nodeGraphID is null), but an accepted or
// offered mission record carries both the dungeon and the reward.
function liveRewards() {
  const byDungeon = new Map();
  let Database;
  try {
    Database = require("/app/server/node_modules/better-sqlite3");
  } catch (_error) {
    return byDungeon;
  }
  try {
    const db = new Database("/var/lib/evejs/gameStore/gamestore.sqlite", { readonly: true });
    for (const row of db.prepare("select json from missionRuntimeState").all()) {
      let record;
      try {
        record = JSON.parse(row.json);
      } catch (_error) {
        continue;
      }
      const missions = record && record.missionsByAgentID;
      if (!missions || typeof missions !== "object") continue;
      for (const mission of Object.values(missions)) {
        const match = /^client-dungeon:(\d+)$/.exec(text(mission && mission.missionTemplateID));
        if (!match) continue;
        const rewards = mission.rewards && typeof mission.rewards === "object" ? mission.rewards : {};
        const entry = {
          title: text(mission.missionTitle),
          isk: Number(rewards.isk) || 0,
          bonus: Number(rewards.bonusIsk) || 0,
          lp: Number(rewards.loyaltyPoints) || 0,
        };
        byDungeon.set(Number(match[1]), entry);
      }
    }
  } catch (_error) {
    return byDungeon;
  }
  return byDungeon;
}

const dungeonAuthority = load("dungeonAuthority");
if (!dungeonAuthority) {
  console.error("NO_DUNGEON_AUTHORITY");
  process.exit(2);
}
const missionAuthority = load("missionAuthority");
const rows = dungeonRows(dungeonAuthority);
const missions = missionAuthority ? missionIndex(missionAuthority) : new Map();

const multiWave = rows.filter((row) => row.maxWaveIndex > 1);
const silent = multiWave.filter((row) => row.silentWaves > 0);
const missionRows = multiWave.filter((row) => row.siteFamily === "mission" || row.siteKind === "mission");

console.log(JSON.stringify({
  templatesWithEncounterPlan: rows.length,
  multiWaveTemplates: multiWave.length,
  multiWaveWithSilentWaves: silent.length,
  missionFamilyMultiWave: missionRows.length,
  missionDungeonsWithReward: missionRows.filter((row) => (missions.get(row.sourceDungeonID) || []).length > 0).length,
}, null, 0));

function rewardOf(dungeonID) {
  const list = missions.get(dungeonID) || [];
  if (list.length <= 0) return null;
  return list
    .sort((a, b) => (b.isk + b.bonus) - (a.isk + a.bonus))
    .slice(0, 2)
    .map((item) => `${item.name}|${item.isk}+${item.bonus} ISK|${item.lp} LP|L${item.level}`);
}

const ranked = missionRows
  .slice()
  .sort((a, b) => (b.silentWaves - a.silentWaves) || (b.hulls - a.hulls))
  .slice(0, MAX_ROWS);

console.log("templateID | name | waves | hulls | silentWaves | triggers | iskPerHull | liveReward");
const live = liveRewards();
for (const row of ranked) {
  const known = live.get(row.sourceDungeonID) || null;
  const reward = known
    ? `${known.title}|${known.isk}+${known.bonus} ISK|${known.lp} LP`
    : (rewardOf(row.sourceDungeonID) || []).join(" / ") || "no-live-record";
  const money = known ? known.isk + known.bonus : 0;
  const perHull = money > 0 && row.hulls > 0 ? Math.round(money / row.hulls) : 0;
  console.log([
    row.templateID,
    row.name,
    row.waves,
    row.hulls,
    row.silentWaves,
    row.triggers,
    perHull || "?",
    reward,
  ].join(" | "));
}
