#!/usr/bin/env node
"use strict";
// Grant native skills to one character inside the running EveJS container.
//
//   docker exec evejs-server-1 node /tmp/coop-grant-skills.cjs \
//     --character 140000005 --skills "Corporation Management:5,Empire Control:4"
//
// Dry run by default. Add --apply to write; a JSON backup of the character's
// previous skill document is written next to the store before any change.
const fs = require("node:fs");
const readline = require("node:readline");
const { DatabaseSync } = require("node:sqlite");
const { planSkillGrants, applyPlan } = require("/tmp/coopSkillGrant.cjs");

const STORE = process.env.EVEJS_GAMESTORE || "/var/lib/evejs/gameStore/gamestore.sqlite";
const TYPES = "/var/lib/evejs/sde/eve-online-static-data-3396210-jsonl/types.jsonl";
const SKILL_TIME_CONSTANT = 275;

function args(argv) {
  const out = { apply: false, skills: [], character: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--apply") out.apply = true;
    else if (value === "--character") out.character = Number(argv[++i]);
    else if (value === "--skills") out.skills = String(argv[++i] || "").split(",").map((x) => x.trim()).filter(Boolean);
  }
  return out;
}

async function resolveTypes(names) {
  const wanted = new Map(names.map((entry) => [entry.split(":")[0].trim().toLowerCase(), entry]));
  const found = new Map();
  const stream = fs.createReadStream(TYPES, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    if (!/skill/i.test(line)) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const name = String(row.name && row.name.en ? row.name.en : row.name || "").toLowerCase();
    if (!wanted.has(name) || found.has(name)) continue;
    const rank = (row.dogmaAttributes || []).find((entry) => Number(entry.attributeID) === SKILL_TIME_CONSTANT);
    found.set(name, {
      typeID: Number(row._key || row.typeID),
      name: row.name && row.name.en ? row.name.en : String(row.name),
      groupID: Number(row.groupID),
      groupName: "",
      categoryID: Number(row.categoryID),
      published: row.published !== false,
      rank: Number(rank && rank.value) || 1,
      level: Number(String(wanted.get(name)).split(":")[1] || 1),
    });
    if (found.size === wanted.size) break;
  }
  lines.close();
  stream.destroy();
  return found;
}

(async () => {
  const opts = args(process.argv.slice(2));
  if (!opts.character || !opts.skills.length) {
    console.error("usage: --character <id> --skills \"Name:level,Name:level\" [--apply]");
    process.exit(2);
  }
  const resolved = await resolveTypes(opts.skills);
  const missing = opts.skills.filter((spec) => !resolved.has(spec.split(":")[0].trim().toLowerCase()));
  if (missing.length) {
    console.error("unknown skill names:", missing.join(", "));
    process.exit(3);
  }
  const db = new DatabaseSync(STORE, { readOnly: !opts.apply });
  const row = db.prepare('select json from "skills" where key = ?').get(String(opts.character));
  if (!row) {
    console.error(`no skills document for character ${opts.character}`);
    process.exit(4);
  }
  const existing = JSON.parse(row.json);
  const plan = planSkillGrants({ existing, wanted: [...resolved.values()], characterID: opts.character });
  console.log(`character ${opts.character}: ${Object.keys(existing).length} skills, template type ${plan.templateTypeID}`);
  for (const entry of plan.add) {
    console.log(`  ADD ${entry.itemName} (type ${entry.typeID}, rank ${entry.skillRank}) -> level ${entry.skillLevel}, ${entry.skillPoints} SP`);
  }
  for (const entry of plan.skip) console.log(`  SKIP ${entry.name}: already ${entry.have} >= ${entry.want}`);
  if (!opts.apply) {
    console.log("dry run: nothing written (add --apply)");
    db.close();
    return;
  }
  const backup = `/var/lib/evejs/backup-skills-${opts.character}-${Date.now()}.json`;
  fs.writeFileSync(backup, row.json);
  const next = applyPlan(existing, plan);
  db.exec("begin immediate");
  db.prepare('update "skills" set json = ? where key = ?').run(JSON.stringify(next), String(opts.character));
  db.exec("commit");
  db.close();
  console.log(`wrote ${plan.add.length} skill(s); backup: ${backup}`);
  console.log("re-login the character (or restart the server) so the client reloads skills");
})().catch((error) => {
  console.error("failed:", error.message);
  process.exit(1);
});
