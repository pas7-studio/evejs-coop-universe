#!/usr/bin/env node
"use strict";
// Build an overview profile whose group lists match THIS build's SDE.
//
// Why: the panel hides a row when `slimItem.groupID not in filterGroups`
// (eve/client/script/ui/inflight/overview/slimItemDisplayChecker.pyj). The profiles in use on this
// machine were written against older static data - a destroyer is group 420 in this build, the NPC
// mining hulls are 1764/1765/1766, an exhumer is 543 - so a preset carrying the old ids simply does
// not match most hulls and the panel looks broken even though the server classifies every ship.
//
// The script takes a known-good profile (the YAML the client already imported once, so its schema
// is right) and unions every preset's `groups` list with the group ids published in the SDE for the
// categories an overview is expected to show: celestial, station, ship, entity, deployable,
// structure. Nothing is removed, so no row that used to be visible disappears.
//
// Usage:
//   docker exec <server> node -e "..." # or point --sde at a copy of gameStore/data/itemTypes/data.json
//   node scripts/coop-overview-profile.cjs --sde itemTypes.json --template alife-base.yaml --out fixed.yaml
const fs = require("node:fs");

const CATEGORIES = new Set([2, 3, 6, 11, 22, 23, 65]);

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
}

const sdePath = arg("sde");
const templatePath = arg("template");
const outPath = arg("out", "coop-overview-fixed.yaml");
if (!sdePath || !templatePath) {
  console.log("USAGE --sde <itemTypes.json> --template <profile.yaml> [--out <file>]");
  process.exit(2);
}

const doc = JSON.parse(fs.readFileSync(sdePath, "utf8"));
const types = Array.isArray(doc.types) ? doc.types : Object.values(doc.types || {});
const groups = new Set();
for (const type of types) {
  const category = Number(type && type.categoryID);
  const group = Number(type && type.groupID);
  if (!CATEGORIES.has(category) || !(group > 0)) continue;
  groups.add(group);
}
const sorted = [...groups].sort((left, right) => left - right);
console.log(`SDE groups for categories ${[...CATEGORIES].join(",")}: ${sorted.length}`);

const lines = fs.readFileSync(templatePath, "utf8").split("\n");
const out = [];
let presets = 0;
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  out.push(line);
  // A preset's group list starts at "    - - groups" (or deeper inside a tab block).
  if (!/^\s*- - groups\s*$/.test(line)) continue;
  presets += 1;
  const indent = line.match(/^\s*/)[0];
  // Drop the template's own list: the item lines that follow, all indented two spaces more than
  // their "- - <id>" parent.
  const itemIndent = `${indent}  `;
  while (index + 1 < lines.length && new RegExp(`^${itemIndent}\\s+- -?\\d+\\s*$`).test(lines[index + 1])) {
    index += 1;
  }
  sorted.forEach((group, position) => {
    out.push(position === 0 ? `${itemIndent}- - ${group}` : `${itemIndent}  - ${group}`);
  });
}
fs.writeFileSync(outPath, out.join("\n"));
console.log(`presets rewritten: ${presets}`);
console.log(`WROTE ${outPath}`);
