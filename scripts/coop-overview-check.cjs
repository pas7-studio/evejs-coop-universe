#!/usr/bin/env node
"use strict";
// Does the running server classify every ball it sends?
//
// The overview panel hides a row when `slimItem.groupID not in filterGroups`, and `michelle.AddBalls2`
// builds the slim items in a loop - one object without `groupID` aborts the loop and every following
// ball arrives with no slim item, which looks like an empty panel while the ships are still in space.
// The server therefore has to answer "every entity I send carries a group".
//
// This asks the running container for its own scene through the read-only admin action
// `scene_slim_diagnose` (space/coopAdminBridge) and fails when anything is unclassified or when a
// ship reports group 0. It is a gate, not a screenshot: it fails on real data.
//
// Usage:
//   node scripts/coop-overview-check.cjs --system 30000145 [--container evejs-server-1]
//   node scripts/coop-overview-check.cjs --character 140000005      (needs the character in space)
const {execFileSync} = require("node:child_process");
const crypto = require("node:crypto");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
}

const container = arg("container", "evejs-server-1");
const systemID = Number(arg("system", "0"));
const characterID = Number(arg("character", "0"));
if (!systemID && !characterID) {
  console.log("USAGE --system <id> | --character <id> [--container name]");
  process.exit(2);
}

const id = `overview-check-${crypto.randomBytes(4).toString("hex")}`;
const request = JSON.stringify({
  id,
  action: "scene_slim_diagnose",
  ...(systemID ? {systemID} : {}),
  ...(characterID ? {characterID} : {}),
});

function docker(args) {
  return execFileSync("docker", args, {encoding: "utf8", timeout: 120000});
}

docker(["exec", container, "sh", "-c",
  `printf '%s\\n' '${request}' >> /var/lib/evejs/coop-admin-requests.jsonl`]);

const deadline = Date.now() + 60000;
let result = null;
while (Date.now() < deadline) {
  const line = docker(["exec", container, "sh", "-c",
    `grep -h '${id}' /var/lib/evejs/coop-admin-results.jsonl | tail -1`]).trim();
  if (line) {
    result = JSON.parse(line);
    break;
  }
  execFileSync(process.execPath, ["-e", "setTimeout(()=>{},1000)"]);
}

if (!result) {
  console.log("OVERVIEW_CHECK_TIMEOUT the server did not answer within 60 s");
  process.exit(3);
}
if (!result.ok) {
  console.log(`OVERVIEW_CHECK_REFUSED ${result.error}`);
  process.exit(3);
}

const ships = Array.isArray(result.ships) ? result.ships : [];
const unclassifiedShips = ships.filter((row) => !row.hasGroup || !(Number(row.groupID) > 0));
console.log(`OVERVIEW_SCENE system=${result.systemID} dynamic=${result.dynamicCount} ` +
  `static=${result.staticCount} ships=${ships.length} missingGroupID=${result.missingGroupID} ` +
  `shipsWithoutGroup=${unclassifiedShips.length}`);
for (const row of ships.slice(0, 8)) {
  console.log(`  ${row.name || "(no name)"} typeID=${row.typeID} groupID=${row.groupID} ` +
    `categoryID=${row.categoryID} ownerID=${row.ownerID} warFactionID=${row.warFactionID} ` +
    `charID=${row.charID}`);
}
if (result.missingGroupID > 0 || unclassifiedShips.length > 0) {
  console.log("OVERVIEW_CHECK_FAILED some balls would arrive without a usable group");
  process.exit(1);
}
console.log("OVERVIEW_CHECK_OK every ball carries a group");
